// tool-patch-margin-data.js (偵錯版)
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
  console.log("🔍 [偵錯模式] 啟動...");
  
  const { data: targets } = await supabase.from('stock_targets').select('stock_id');
  const stockList = targets || [];
  const startDateStr = "2026-01-02";
  const endDateStr = getTodayStr();

  // 為了偵錯，我們只跑第一檔股票就好，不要跑全部
  const testId = String(stockList[0].stock_id).trim();
  console.log(`🧪 正在偵錯個股: ${testId}`);

  try {
    const marginUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${testId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
    const res = await axios.get(marginUrl);
    
    if (res.data.status === 200 && Array.isArray(res.data.data) && res.data.data.length > 0) {
      console.log("✅ API 成功回傳！以下是前 2 筆原始數據 (請檢查欄位名稱)：");
      // 這裡直接把資料印出來
      console.log(JSON.stringify(res.data.data.slice(0, 2), null, 2));
    } else {
      console.log("❌ API 回傳異常或無資料:", res.data);
    }
  } catch (e) {
    console.log("💥 連線失敗:", e.message);
  }

  console.log("\n🛑 [偵錯結束] 請查看上方 Log 並將 JSON 內容貼給我。");
}

run();
