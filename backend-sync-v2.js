// backend-sync-v2.js
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const finmindToken = process.env.FINMIND_TOKEN;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ 欠缺關鍵環境變數 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，程序被迫中斷。");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatDateToString(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function startHighPerformanceSync() {
  console.log("🚀 啟動【主力成分股 v2】逐檔安全配速同步程序...");
  
  try {
    // 階段 A：從真理母名單讀取股票並嚴格去重
    const { data: dbData, error: dbError } = await supabase
      .from('stock_targets')
      .select('stock_id, stock_name')
      .order('stock_id', { ascending: true });

    if (dbError) throw dbError;
    if (!dbData || dbData.length === 0) {
      console.warn("⚠️ 警告：從 stock_targets 未取得任何股票標的。");
      return;
    }

    const rawStockIds = dbData.map(item => String(item.stock_id).trim()).filter(id => id && id !== 'undefined' && id !== 'null');
    const stockIds = [...new Set(rawStockIds)];

    // 自適應台灣交易時區時間
    const now = new Date();
    const taipeiTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const targetDate = taipeiTime.toISOString().split('T')[0];

    console.log(`📅 同步日期: ${targetDate}, 實際名單長度: ${dbData.length}, 去重後精準股票總數: ${stockIds.length}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    let allFetchedDailyChips = [];

    // 階段 B：比照舊版安全機制，一次一個個股資料，穩健推進
    for (let i = 0; i < stockIds.length; i++) {
      const sId = stockIds[i];
      
      // 每 15 檔強制休息 8 秒，防止被 FinMind 判定為惡意頻繁爬蟲而鎖 IP
      if (i > 0 && i % 15 === 0) {
        console.log(`⏳ 已安全同步 ${i} 檔，保護 API 流量強制休息 8 秒...`);
        await sleep(8000);
      }

      console.log(`[下載個股籌碼] (${i + 1}/${stockIds.length}) 標的: ${sId}`);

      // 💡 智慧修正：回歸單一 data_id 請求，徹底排除多個股打包時引發的 400 錯誤！
      const finalApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTaiwanCompanyBuySell&data_id=${sId}&start_date=${targetDate}&end_date=${targetDate}&token=${finmindToken || ''}`;

      let retries = 2;
      let fetchSuccess = false;

      while (retries > 0 && !fetchSuccess) {
        try {
          const response = await axios.get(finalApiUrl, { headers: commonHeaders, timeout: 15000 });

          if (response.data && response.data.status === 200) {
            const dayData = response.data.data || [];
            allFetchedDailyChips = allFetchedDailyChips.concat(dayData);
            fetchSuccess = true;
          } else {
            retries--;
            if (retries > 0) await sleep(1000);
          }
        } catch (apiErr) {
          console.warn(`  ⚠️ 標的 ${sId} 連線忙碌中 (${apiErr.message})，進行複檢重試...`);
          retries--;
          if (retries > 0) await sleep(1500);
        }
      }
      
      // 檔與檔之間的微秒配速，防禦伺服器過載
      await sleep(150);
    }

    console.log(`\n📊 本日累計成功撈回 ${allFetchedDailyChips.length} 筆明細欄位紀錄。`);

    if (allFetchedDailyChips.length === 0) {
      console.log("ℹ️ 本日無新籌碼數據更新（可能為非交易日或個股盤後未完全釋出），流程安全結束。");
      return;
    }

    // 階段 C：清洗格式並寫入 Supabase 大帳本
    console.log("💾 正在發動 Supabase 智慧矩陣更新 (Upsert) 寫入作業...");
    
    // 將撈回來的多筆資料（外資、投信、自營商等）聚合對位回大帳本對應的 28 欄位
    const dateMap = {};
    allFetchedDailyChips.forEach(row => {
      const d = row.date;
      const sId = String(row.stock_id).trim();
      const compositeKey = `${sId}_${d}`;

      if (!dateMap[compositeKey]) {
        dateMap[compositeKey] = {
          stock_id: sId,
          date: d,
          f_buy: 0, f_sell: 0,
          it_buy: 0, it_sell: 0,
          ds_buy: 0, ds_sell: 0,
          dh_buy: 0, dh_sell: 0,
          updated_at: new Date().toISOString()
        };
      }

      // 依據 FinMind 傳回的法人名稱精準分流至對應的欄位
      if (row.name === 'Foreign_Investor') { dateMap[compositeKey].f_buy = row.buy; dateMap[compositeKey].f_sell = row.sell; }
      else if (row.name === 'Investment_Trust') { dateMap[compositeKey].it_buy = row.buy; dateMap[compositeKey].it_sell = row.sell; }
      else if (row.name === 'Dealer_self') { dateMap[compositeKey].ds_buy = row.buy; dateMap[compositeKey].ds_sell = row.sell; }
      else if (row.name === 'Dealer_Hedging') { dateMap[compositeKey].dh_buy = row.buy; dateMap[compositeKey].dh_sell = row.sell; }
    });

    const finalUploadRows = Object.values(dateMap);

    // 分批寫入資料庫，防止大Payload超載
    const saveChunkSize = 100;
    for (let j = 0; j < finalUploadRows.length; j += saveChunkSize) {
      const saveChunk = finalUploadRows.slice(j, j + saveChunkSize);
      const { error: upsertError } = await supabase
        .from('stock_chips_daily')
        .upsert(saveChunk, { onConflict: 'stock_id,date' });

      if (upsertError) {
        console.error(`❌ 寫入資料庫批次 ${j} 失敗:`, upsertError);
      }
    }

    console.log("🟢 雲端大帳本數據天天自動同步全面大成功！");

  } catch (globalError) {
    console.error("💥 同步流程發生未預期嚴重折損:", globalError.message || globalError);
    process.exit(1);
  }
}

startHighPerformanceSync();
