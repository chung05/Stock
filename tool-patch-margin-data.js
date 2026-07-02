// tool-patch-margin-data.js (診斷版)
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
  console.log("🔍 [診斷模式] 正在檢查 FinMind API 的欄位名稱...");

  const { data: targets } = await supabase.from('stock_targets').select('stock_id').limit(1);
  const sId = String(targets[0].stock_id).trim();
  const startDateStr = "2026-06-01";
  const endDateStr = getTodayStr();

  try {
    const marginUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
    const res = await axios.get(marginUrl);

    if (res.data.status === 200 && Array.isArray(res.data.data) && res.data.data.length > 0) {
      console.log(`✅ API 成功回傳！正在診斷個股: ${sId}`);
      const sample = res.data.data[0];
      
      console.log("-----------------------------------------");
      console.log("✅ API 資料集內的完整欄位名稱如下 (請複製此清單給我)：");
      console.log(JSON.stringify(Object.keys(sample), null, 2));
      console.log("-----------------------------------------");
      console.log("✅ 第一筆原始資料範例：");
      console.log(JSON.stringify(sample, null, 2));
      console.log("-----------------------------------------");
    } else {
      console.log("❌ API 回傳異常或無資料:", res.data);
    }
  } catch (e) {
    console.log("💥 連線錯誤:", e.message);
  }
}

run();
