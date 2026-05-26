const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  console.log("📥 [步驟 1] 正在分析資料庫中的交易日記錄...");

  // 1. 動態動態獲取所有不重複的日期，用來推算第 60 個交易日是哪一天
  // 這樣能完美應對未來股票檔數增加的狀況
  const { data: dateRows, error: dateError } = await supabase
    .from('stock_chips_daily')
    .select('date')
    .order('date', { ascending: false });

  if (dateError) {
    console.error("❌ 無法取得日期清單:", dateError);
    return;
  }

  // 利用 Set 算出不重複的日期陣列
  const uniqueDates = [...new Set(dateRows.map(item => item.date))];
  
  if (uniqueDates.length === 0) {
    console.log("⚠️ 資料庫中沒有任何交易日資料。");
    return;
  }

  // 取出最新一天與第 60 個交易日的日期（若總天數不滿 60 天則取最後一天）
  const targetDays = Math.min(60, uniqueDates.length);
  const cutoffDate = uniqueDates[targetDays - 1]; 
  const latestDate = uniqueDates[0];

  console.log(`📅 偵測到最新交易日: ${latestDate} ～ 目標第 60 個交易日限制線: ${cutoffDate}`);
  console.log(`📥 [步驟 2] 開始分段擷取資料（每次 1000 筆）...`);

  // 2. 開始分段（分頁）撈取大於等於該日期的所有股票資料
  let allData = [];
  let page = 0;
  const PAGE_SIZE = 1000; // 每次擷取 1000 筆
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    console.log(`   正在擷取第 ${from + 1} 至 ${to + 1} 筆資料...`);

    const { data, error } = await supabase
      .from('stock_chips_daily')
      .select('*')
      .gte('date', cutoffDate) // 🛡️ 核心：只撈取這 60 天內的所有資料
      .order('date', { ascending: false })
      .range(from, to); // 📌 使用分頁區間

    if (error) {
      console.error("❌ 擷取資料失敗:", error);
      return;
    }

    allData = allData.concat(data);

    // 判斷是否還有下一頁：如果回傳的資料小於 1000 筆，代表後面沒資料了
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  // 3. 統計與健康檢查（防呆與驗證未來股票增加的狀況）
  const totalFetchedRows = allData.length;
  const distinctDatesFetched = [...new Set(allData.map(item => item.date))].length;
  
  // 檢查總共包含多少檔獨立股票 (自動偵測 stock_id 或 code 欄位，請依你資料庫實際名稱調整)
  const distinctStocks = [...new Set(allData.map(item => item.stock_id || item.code || 'unknown'))];

  console.log(`\n📊 === 擷取報告 ===`);
  console.log(`✅ 總共分段擷取了 ${page + 1} 次`);
  console.log(`✅ 累計總筆數: ${totalFetchedRows} 筆`);
  console.log(`✅ 實際涵蓋交易日: ${distinctDatesFetched} 天 (目標 60 天)`);
  console.log(`✅ 偵測到股票總檔數: ${distinctStocks.length} 檔 (未來增加也會自動適應)`);

  // 4. 寫入檔案
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(allData, null, 2));
  console.log(`💾 檔案已成功儲存至 ./data/raw_data.json\n`);
}

fetchData();
