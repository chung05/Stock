const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  console.log("📥 [步驟 1] 正在精準分析資料庫中的不重複交易日歷史...");

  let uniqueDates = [];
  let datePage = 0;
  const DATE_PAGE_SIZE = 1000;
  let hasMoreDates = true;

  // 1. 為了防止撈日期也被 1000 筆卡死，我們用迴圈把所有日期痕跡都撈出來，或者直到收集滿 60 個獨立日期為止
  while (hasMoreDates) {
    const from = datePage * DATE_PAGE_SIZE;
    const to = from + DATE_PAGE_SIZE - 1;

    // 為了節省流量，只 select('date') 欄位即可
    const { data: dateRows, error: dateError } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .range(from, to);

    if (dateError) {
      console.error("❌ 無法取得日期清單:", dateError);
      return;
    }

    // 將新拿到的日期加入 Set 進行去重
    const currentBatchDates = dateRows.map(item => item.date);
    uniqueDates = [...new Set([...uniqueDates, ...currentBatchDates])];

    // 終止條件：1. 資料庫沒資料了 2. 我們已經成功收集到至少 60 個不重複的交易日
    if (dateRows.length < DATE_PAGE_SIZE || uniqueDates.length >= 60) {
      hasMoreDates = false;
    } else {
      datePage++;
    }
  }

  // 將收集到的不重複日期重新排序（降序：最新到最舊）
  uniqueDates.sort((a, b) => new Date(b) - new Date(a));

  if (uniqueDates.length === 0) {
    console.log("⚠️ 資料庫中沒有任何交易日資料。");
    return;
  }

  // 確實取出第 60 個交易日
  const targetDays = Math.min(60, uniqueDates.length);
  const cutoffDate = uniqueDates[targetDays - 1]; 
  const latestDate = uniqueDates[0];

  console.log(`📅 成功穿透限制！`);
  console.log(`   最新交易日: ${latestDate}`);
  console.log(`   目標第 ${targetDays} 個交易日限制線（基準日）: ${cutoffDate} (從此日期開始往後抓)`);
  console.log(`📥 [步驟 2] 開始分段擷取完整股票籌碼資料（每次 1000 筆）...`);

  // 2. 開始分段（分頁）撈取大於等於該基準日期的所有股票資料
  let allData = [];
  let page = 0;
  const PAGE_SIZE = 1000; 
  let hasMoreData = true;

  while (hasMoreData) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    console.log(`   正在擷取第 ${from + 1} 至 ${to + 1} 筆資料...`);

    const { data, error } = await supabase
      .from('stock_chips_daily')
      .select('*')
      .gte('date', cutoffDate) // 🛡️ 核心：過濾出大於等於 60 天前那個日期的所有資料
      .order('date', { ascending: false })
      .range(from, to); 

    if (error) {
      console.error("❌ 擷取資料失敗:", error);
      return;
    }

    allData = allData.concat(data);

    if (data.length < PAGE_SIZE) {
      hasMoreData = false;
    } else {
      page++;
    }
  }

  // 3. 統計與健康檢查
  const totalFetchedRows = allData.length;
  const distinctDatesFetched = [...new Set(allData.map(item => item.date))].length;
  const distinctStocks = [...new Set(allData.map(item => item.stock_id || item.code || 'unknown'))];

  console.log(`\n📊 === 擷取報告 ===`);
  console.log(`✅ 總共分段擷取了 ${page + 1} 次`);
  console.log(`✅ 累計總筆數: ${totalFetchedRows} 筆`);
  console.log(`✅ 實際涵蓋交易日: ${distinctDatesFetched} 天`);
  console.log(`✅ 偵測到股票總檔數: ${distinctStocks.length} 檔`);

  // 4. 寫入檔案
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(allData, null, 2));
  console.log(`💾 檔案已成功更新至 ./data/raw_data.json\n`);
}

fetchData();
