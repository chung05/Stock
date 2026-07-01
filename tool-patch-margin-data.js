// tool-patch-margin-data.js
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getTodayStr() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function run() {
  console.log("🚀 【融資券歷史大補帖工程】啟動...");

  // 1. 取得 180 檔母名單
  const { data: targets, error: tErr } = await supabase.from('stock_targets').select('stock_id');
  if (tErr) throw tErr;
  const stockList = targets || [];
  console.log(`📊 雲端母名單讀取成功，共有: ${stockList.length} 檔主力股。`);

  const commonHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const startDateStr = "2026-01-02";
  const endDateStr = getTodayStr();
  console.log(`📅 補件時間範圍：${startDateStr} 至 ${endDateStr}\n`);

  // 2. 逐檔開始補齊融資券
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i].stock_id).trim();

    // 🛡️ 流量防禦：每 3 檔強制休息 12 秒
    if (i > 0 && i % 3 === 0) {
      console.log(`⏳ [安全防禦] 已處理 ${i} 檔，強制原地冷卻 12 秒...`);
      await sleep(12000);
    }

    console.log(`🔄 [進度 ${i + 1}/${stockList.length}] 正在補齊個股融資券: ${sId}`);

    try {
      // 先從資料庫撈出這檔股票 2026-01-02 到現在，有哪些日子已經存在（代表有開市）
      const { data: existingRows, error: dbErr } = await supabase
        .from('stock_chips_daily')
        .select('date')
        .eq('stock_id', sId)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (dbErr) throw dbErr;

      if (!existingRows || existingRows.length === 0) {
        console.log(`⚠️  個股 ${sId} 在資料庫中無基本價格紀錄，跳過。`);
        continue;
      }

      // 將資料庫有的日期做成 Set，方便快速對照
      const existingDaysSet = new Set(existingRows.map(r => r.date));

      // 抓取 FinMind 融資券 API
      let marginFetched = false;
      let marginRetries = 3;
      let marginData = [];

      while (!marginFetched && marginRetries > 0) {
        try {
          const marginUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
          const mRes = await axios.get(marginUrl, { headers: commonHeaders });

          if (mRes.data.status === 200 && Array.isArray(mRes.data.data)) {
            marginData = mRes.data.data;
            marginFetched = true;
          } else {
            console.log(`  ⚠️ API回傳空殼 (Status: ${mRes.data.status})，10秒後重試...`);
            await sleep(10000);
            marginRetries--;
          }
        } catch (e) {
          console.log(`  💥 連線異常，10秒後重試: ${e.message}`);
          await sleep(10000);
          marginRetries--;
        }
      }

      if (!marginFetched || marginData.length === 0) {
        console.error(`  ❌ 無法取得 ${sId} 的融資券 API 資料，跳過此檔。`);
        continue;
      }

      // 過濾出「只有在我們資料庫開市日有存在」的融資券資料，並逐日更新
      let patchCount = 0;
      for (const row of marginData) {
        const d = row.date;
        if (!existingDaysSet.has(d)) continue; // 略過休市日

        // 執行更新指定日期與代碼的 Row
        const { error: updateErr } = await supabase
          .from('stock_chips_daily')
          .update({
            margin_buy: row.MarginPurchaseBuy || 0,
            margin_sell: row.MarginPurchaseSell || 0,
            margin_balance: row.MarginPurchaseTodayBalance || 0,
            short_buy: row.MarginShortSaleBuy || 0,
            short_sell: row.MarginShortSaleSell || 0,
            short_balance: row.MarginShortSaleTodayBalance || 0
          })
          .eq('stock_id', sId)
          .eq('date', d);

        if (updateErr) {
          console.error(`  ❌ 更新 ${d} 失敗: ${updateErr.message}`);
        } else {
          patchCount++;
        }
      }

      console.log(`  ✨ 成功補齊 ${sId} 共 ${patchCount} 天的融資券水位資料。`);

    } catch (singleErr) {
      console.error(`❌ 處理個股 ${sId} 時發生致命錯誤:`, singleErr.message);
    }

    await sleep(600); // 檔與檔之間的小冷卻
  }

  console.log("\n🎉 【融資券歷史大補帖工程】全部完美完工！");
}

run();
