// tool-patch-margin-data.js (診斷偵錯版)
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

async function run() {
  console.log("🔍 [診斷模式] 開始診斷第一檔股票...");
  
  // 隨機取一檔測試
  const { data: targets } = await supabase.from('stock_targets').select('stock_id').limit(1);
  const sId = String(targets[0].stock_id).trim();
  const startDate = "2026-06-01"; // 只抓近一個月方便觀察
  const endDate = "2026-07-02";

  try {
    // 1. 抓取 API
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDate}&end_date=${endDate}&token=${process.env.FINMIND_TOKEN}`;
    const res = await axios.get(url);

    if (res.data.data && res.data.data.length > 0) {
      console.log(`✅ API 成功回傳！第一筆資料結構如下：`);
      console.log(JSON.stringify(res.data.data[0], null, 2));
      
      // 2. 檢查是否有融券資料
      const sample = res.data.data[0];
      console.log(`\n📋 檢查關鍵欄位是否存在：`);
      console.log(`- MarginPurchaseBuy 存在? ${sample.hasOwnProperty('MarginPurchaseBuy')}`);
      console.log(`- MarginShortRentalBuy 存在? ${sample.hasOwnProperty('MarginShortRentalBuy')}`);
      console.log(`- MarginShortSaleBuy 存在? ${sample.hasOwnProperty('MarginShortSaleBuy')}`);
      console.log(`- 融券欄位值: ${sample.MarginShortRentalBuy || sample.MarginShortSaleBuy || "未找到任何類似欄位"}`);
    } else {
      console.log("❌ API 回傳為空，請檢查 data_id 或日期範圍");
    }
  } catch (e) {
    console.log("💥 錯誤:", e.message);
  }
}
run();
