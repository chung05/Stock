const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  console.log("📥 正在從資料庫撈取最近 60 個交易日的完整記錄...");
  
  // 設定：180 檔股票 * 60 個交易日 = 10800 筆，我們設定 12000 筆以包含緩衝
  const LIMIT_COUNT = 180 * 67; 

  const { data, error } = await supabase
    .from('stock_chips_daily')
    .select('*')
    .order('date', { ascending: false })
    .limit(LIMIT_COUNT);

  if (error) {
    console.error("❌ 讀取失敗:", error);
    return;
  }

  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(data, null, 2));
  console.log(`✅ 已成功抓取 ${data.length} 筆資料至 ./data/raw_data.json`);
}

fetchData();
