const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// 1. 初始化環境變數 (由 GitHub Secrets 提供)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const EXCEL_SOURCE_URL = "https://raw.githubusercontent.com/" + process.env.GITHUB_REPOSITORY + "/main/Stock_list.xlsx"; 

// 💡 修正一：直接填入您原本網頁測試ok的 Token，排除 Secrets 填錯的可能
const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiQ2h1bmcwNSIsImVtYWlsIjoiY2hpdTYuY2h1bmcwNUBnbWFpbC5jb20iLCJ0b2tlbl92ZXJzaW9uIjowfQ.Jsmprys2d_Vz8x5eeXnLZRn9_MjWpNH7kp77gL3qRz0";

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
    console.log("🚀 開始執行智慧同步總流程...");

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
      console.log(`將同步 ${rowsToUpload.length} 檔標的名單至 stock_targets...`);
      const { error: err1 } = await supabase.from('stock_targets').upsert(rowsToUpload, { onConflict: 'stock_id' });
      if (err1) throw err1;
    }

    const { data: dbStockData, error: err2 } = await supabase.from('stock_targets').select('stock_id, stock_name').order('stock_id', { ascending: true });
    if (err2) throw err2;

    if (!dbStockData || dbStockData.length === 0) {
      console.log("⚠️ 找不到任何標的股票，流程結束。");
      return;
    }

    const recentDates = getRecentFiveTradeDays();
    const startDateStr = recentDates[recentDates.length - 1];
    const endDateStr = recentDates[0];
    console.log(`2. 檢查區間：${startDateStr} ~ ${endDateStr} 的雲端寬資料...`);

    const { data: existingRows } = await supabase
      .from('stock_chips_daily')
      .select('stock_id, date')
      .in('stock_id', dbStockData.map(s => s.stock_id))
      .in('date', recentDates);

    const existingSet = new Set((existingRows || []).map(r => `${r.stock_id}_${r.date}`));

    for (let i = 0; i < dbStockData.length; i++) {
      const stock = dbStockData[i];
      let isMissing = false;
      for (let d of recentDates) {
        if (!existingSet.has(`${stock.stock_id}_${d}`)) {
          isMissing = true;
          break;
        }
      }

      if (!isMissing) continue; 

      console.log(`[補抓] 正在同步 (${i + 1}/${dbStockData.length}) ${stock.stock_id} ${stock.stock_name}`);

      try {
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        
        // 💡 修正二：在這裡加上真實瀏覽器的 Headers 偽裝
        const res = await axios.get(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        
        if (res.status === 429) { 
          console.log("⚠️ 觸發 FinMind 速率限制，等待 4 秒...");
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
      await sleep(350); 
    }

    console.log("🎉 恭喜！每日自動定時排程全數安全執行完畢！");

  } catch (error) {
    console.error("❌ 核心流程中斷，發生未預期錯誤:", error);
    process.exit(1);
  }
}

run();
