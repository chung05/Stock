const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// 1. 初始化環境變數
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const EXCEL_SOURCE_URL = "https://raw.githubusercontent.com/" + process.env.GITHUB_REPOSITORY + "/main/Stock_list.xlsx"; 
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;
// const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiQ2h1bmcwNSIsImVtYWlsIjoiY2hpdTYuY2h1bmcwNUBnbWFpbC5jb20iLCJ0b2tlbl92ZXJzaW9uIjowfQ.Jsmprys2d_Vz8x5eeXnLZRn9_MjWpNH7kp77gL3qRz0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatDateToString(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 計算常規的最近 5 個交易日（保底用）
function getRecentFiveTradeDays() {
  let dates = [];
  let d = new Date();
  while(dates.length < 5) {
    let day = d.getDay();
    if (day !== 0 && day !== 6) { 
      dates.push(formatDateToString(d));
    }
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

async function run() {
  try {
    console.log("🚀 開始執行【智慧型動態增量】同步總流程...");

    // ---- 步驟一：同步 Excel 名單 ----
    console.log("1. 正在下載並解析 Excel 標的名單...");
    const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const stockMap = new Map();

    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      jsonData.forEach(row => {
        const stockId = String(row['股票代號'] || row['代號'] || '').trim();
        const stockName = String(row['股票名稱'] || row['名稱'] || '').trim();
        if (stockId && stockName) {
          if (stockMap.has(stockId)) {
            const item = stockMap.get(stockId);
            if (!item.sheet_tags.includes(sheetName)) item.sheet_tags.push(sheetName);
          } else {
            stockMap.set(stockId, { stock_id: stockId, stock_name: stockName, sheet_tags: [sheetName], updated_at: new Date().toISOString() });
          }
        }
      });
    });

    const rowsToUpload = Array.from(stockMap.values());
    if (rowsToUpload.length > 0) {
      const { error: err1 } = await supabase.from('stock_targets').upsert(rowsToUpload, { onConflict: 'stock_id' });
      if (err1) throw err1;
    }

    const { data: dbStockData, error: err2 } = await supabase.from('stock_targets').select('stock_id, stock_name').order('stock_id', { ascending: true });
    if (err2) throw err2;

    if (!dbStockData || dbStockData.length === 0) {
      console.log("⚠️ 找不到任何標的股票，流程結束。");
      return;
    }

    // ---- 💡 步驟二：智慧判斷資料庫到底缺幾天 ----
    console.log("2. 正在向資料庫比對目前的最新數據日期...");
    
    // 找出目前資料庫裡最新的一筆籌碼日期是哪一天
    const { data: latestDbRow, error: err3 } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);

    if (err3) throw err3;

    const nativeRecent5Days = getRecentFiveTradeDays();
    let startDateStr = nativeRecent5Days[nativeRecent5Days.length - 1]; // 預設 5 天前
    let endDateStr = nativeRecent5Days[0]; // 預設今天

    if (latestDbRow && latestDbRow.length > 0) {
      const lastAvailableDateStr = latestDbRow[0].date;
      console.log(`📊 資料庫目前最新資料停留在：${lastAvailableDateStr}`);

      if (lastAvailableDateStr === endDateStr) {
        // 狀況 A：今天資料庫已經有最新一天的資料了，這代表有人剛點過或是今天跑過了
        console.log("✨ 檢測到今日籌碼已是最新，啟動【無破洞安全覆蓋】機制（僅向 FinMind 覆蓋檢查今天一日）。");
        startDateStr = endDateStr; 
      } else {
        // 狀況 B：資料庫最新的日子比今天舊（例如停在 5/20，或停在 5/19）
        // 那我們的起算點（Start Date）就設定為資料庫最新日期的「隔一天」
        let nextDay = new Date(lastAvailableDateStr);
        nextDay.setDate(nextDay.getDate() + 1);
        
        const calculatedStartDate = formatDateToString(nextDay);
        
        // 安全機制：如果斷訊太久（缺超過5天），我們還是保底只抓5天，避免打API打到超時
        if (new Date(calculatedStartDate) < new Date(startDateStr)) {
          console.log(`⚠️ 資料庫缺失天數過多，為確保效能，本次將保底補抓最近 5 天。`);
        } else {
          startDateStr = calculatedStartDate;
          console.log(`🔥 智慧增量判定：本次僅需精準補抓【${startDateStr} ~ ${endDateStr}】這段缺失的區間！`);
        }
      }
    } else {
      console.log("🆕 資料庫為全新空白狀態，將直接啟動完整 5 日初始化抓取。");
    }

    // ---- 步驟三：精準下載與寫入 ----
    console.log(`🚀 執行 FinMind 請求區間：${startDateStr} 至 ${endDateStr}`);

    for (let i = 0; i < dbStockData.length; i++) {
      const stock = dbStockData[i];
      console.log(`[增量同步] (${i + 1}/${dbStockData.length}) ${stock.stock_id} ${stock.stock_name}`);

      try {
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        
        const res = await axios.get(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        
        if (res.status === 429) { 
          await sleep(4000); 
          i--; 
          continue; 
        } 
        
        const resJson = res.data;
        if (resJson.status === 200 && Array.isArray(resJson.data) && resJson.data.length > 0) {
          const dateMap = {};
          resJson.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              dateMap[d] = { stock_id: stock.stock_id, date: d, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0 };
            }
            if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
            else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
            else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
            else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
            else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
          });

          const rowsToUpsert = Object.values(dateMap);
          if (rowsToUpsert.length > 0) {
            await supabase.from('stock_chips_daily').upsert(rowsToUpsert);
          }
        }
      } catch (err) {
        console.error(`❌ 同步 ${stock.stock_id} 發生錯誤:`, err.message);
      }
      await sleep(150); // 💡 因為每次只抓 1~2 天，資料量變小，安全延遲可以從 350ms 縮短到 150ms，速度再飆快一倍！
    }

    console.log("🎉 恭喜！動態增量排程全數安全執行完畢！");

  } catch (error) {
    console.error("❌ 核心流程中斷，發生未預期錯誤:", error);
    process.exit(1);
  }
}

run();
