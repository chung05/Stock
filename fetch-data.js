const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  console.log("📥 [步驟 1] 正在撈取不重複的交易日歷史...");

  let uniqueDates = [];
  let datePage = 0;
  const DATE_PAGE_SIZE = 1000;
  let hasMoreDates = true;

  while (hasMoreDates) {
    const { data: dateRows, error } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .range(datePage * DATE_PAGE_SIZE, (datePage + 1) * DATE_PAGE_SIZE - 1);

    if (error) return console.error("❌ 取得日期失敗:", error);
    uniqueDates = [...new Set([...uniqueDates, ...dateRows.map(item => item.date)])];
    
    // 多抓幾天（75天）作技術指標緩衝
    if (dateRows.length < DATE_PAGE_SIZE || uniqueDates.length >= 75) {
      hasMoreDates = false;
    } else {
      datePage++;
    }
  }

  uniqueDates.sort((a, b) => new Date(b) - new Date(a));
  if (uniqueDates.length === 0) return console.log("⚠️ 資料庫中沒有任何交易日資料。");

  const cutoffDate = uniqueDates[Math.min(70, uniqueDates.length) - 1];

  console.log(`📥 [步驟 2] 分批撈取完整原始資料（每次 1000 筆）...`);
  let allRawData = [];
  let page = 0;
  let hasMoreData = true;

  while (hasMoreData) {
    const { data, error } = await supabase
      .from('stock_chips_daily')
      .select('*')
      .gte('date', cutoffDate)
      .order('date', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error) return console.error("❌ 撈取失敗:", error);
    allRawData = allRawData.concat(data);
    if (data.length < 1000) hasMoreData = false;
    else page++;
  }

  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(allRawData, null, 2));
  console.log(`💾 成功下載 ${allRawData.length} 筆原始資料至 ./data/raw_data.json。請執行 node export-for-ai.js 進行轉換。`);
}

fetchData();
