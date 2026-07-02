// tool-patch-margin-data.js (最終修正版)
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
  const now = new Date();
  const idn = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const yyyy = idn.getUTCFullYear();
  const mm = String(idn.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(idn.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function run() {
  console.log("🚀 【融資券歷史大帳本 - 最終欄位修正版】啟動...");

  const { data: targets, error: tErr } = await supabase.from('stock_targets').select('stock_id');
  if (tErr) throw tErr;
  const stockList = targets || [];

  const startDateStr = "2026-01-02";
  const endDateStr = getTodayStr();

  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i].stock_id).trim();

    if (i > 0 && i % 3 === 0) await sleep(12000);
    console.log(`🔄 [進度 ${i + 1}/${stockList.length}] 更新: ${sId}`);

    try {
      const { data: existingRows } = await supabase
        .from('stock_chips_daily')
        .select('date')
        .eq('stock_id', sId)
        .gte('date', startDateStr);

      if (!existingRows || existingRows.length === 0) continue;
      const existingDaysSet = new Set(existingRows.map(r => r.date));

      const marginUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
      const res = await axios.get(marginUrl);
      const marginData = res.data.data || [];

      let patchCount = 0;
      for (const row of marginData) {
        if (!existingDaysSet.has(row.date)) continue;

        // 🟢 根據你提供的真實 JSON 結構進行映射
        const { error: updateErr } = await supabase
          .from('stock_chips_daily')
          .update({
            margin_buy: row.MarginPurchaseBuy || 0,
            margin_sell: row.MarginPurchaseSell || 0,
            margin_balance: row.MarginPurchaseTodayBalance || 0,
            short_buy: row.ShortSaleBuy || 0,          // 🌟 修正：移除 Margin 字首
            short_sell: row.ShortSaleSell || 0,        // 🌟 修正：移除 Margin 字首
            short_balance: row.ShortSaleTodayBalance || 0 // 🌟 修正：移除 Margin 字首
          })
          .eq('stock_id', sId)
          .eq('date', row.date);
        
        if (!updateErr) patchCount++;
      }
      console.log(`  ✨ 成功補齊 ${patchCount} 天資料`);
    } catch (e) {
      console.error(`❌ 錯誤: ${e.message}`);
    }
    await sleep(600);
  }
  console.log("\n🎉 大補帖工程完美完工！");
}

run();
