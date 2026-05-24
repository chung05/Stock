const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const EXCEL_SOURCE_URL = "https://raw.githubusercontent.com/" + process.env.GITHUB_REPOSITORY + "/main/Stock_list.xlsx"; 
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

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
    console.log("🚀 開始執行【智慧型動態增量 + 股價開高低量】同步總流程...");

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

    if (!dbStockData || dbStockData.length === 0) return;

    console.log("2. 正在向資料庫比對目前的最新數據日期...");
    const { data: latestDbRow, error: err3 } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);

    if (err3) throw err3;

//    const nativeRecent5Days = getRecentFiveTradeDays();
//    let startDateStr = nativeRecent5Days[nativeRecent5Days.length - 1]; 
//    let endDateStr = nativeRecent5Days[0]; 
    // 💡 暫時強制定義區間，確保程式會去抓這段時間的資料
let startDateStr = '2026-05-04'; 
let endDateStr = '2026-05-24'; // 抓到目前已有的起點前一天

    if (latestDbRow && latestDbRow.length > 0) {
      const lastAvailableDateStr = latestDbRow[0].date;
      if (lastAvailableDateStr === endDateStr) {
        startDateStr = endDateStr; 
      } else {
        let nextDay = new Date(lastAvailableDateStr);
        nextDay.setDate(nextDay.getDate() + 1);
        startDateStr = formatDateToString(nextDay);
      }
    }

    let priceStartDateObj = new Date(startDateStr);
    priceStartDateObj.setDate(priceStartDateObj.getDate() - 4);
    let priceStartDateStr = formatDateToString(priceStartDateObj);

    console.log(`🚀 執行 FinMind 同步區間：${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

    for (let i = 0; i < dbStockData.length; i++) {
      const stock = dbStockData[i];
      console.log(`[增量同步] (${i + 1}/${dbStockData.length}) ${stock.stock_id}`);

      try {
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const res = await axios.get(apiUrl, { headers: commonHeaders });
        
        if (res.status === 429) { await sleep(4000); i--; continue; } 
        
        const dateMap = {};
        if (res.data.status === 200 && Array.isArray(res.data.data)) {
          res.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              // 💡 修正後：初始化結構已包含新增的四個欄位
              dateMap[d] = { 
                stock_id: stock.stock_id, date: d, price: null, change_value: 0, 
                f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0,
                open: 0, max: 0, min: 0, trading_volume: 0 
              };
            }
            if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
            else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
            else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
            else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
            else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
          });
        }

        const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.stock_id}&start_date=${priceStartDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders });
        
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
          priceRes.data.data.sort((a, b) => new Date(a.date) - new Date(b.date));
          
          for (let pIdx = 0; pIdx < priceRes.data.data.length; pIdx++) {
            const pRow = priceRes.data.data[pIdx];
            const d = pRow.date;
            
            if (dateMap[d]) {
              dateMap[d].price = pRow.close;
              // 💡 新增：正確填入開高低量
              dateMap[d].open = pRow.open;
              dateMap[d].max = pRow.max;
              dateMap[d].min = pRow.min;
              dateMap[d].trading_volume = pRow.Trading_Volume;
              
              if (pIdx > 0) {
                dateMap[d].change_value = Number((pRow.close - priceRes.data.data[pIdx - 1].close).toFixed(2));
              } else {
                dateMap[d].change_value = pRow.spread || 0;
              }
            }
          }
        }

        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          await supabase.from('stock_chips_daily').upsert(rowsToUpsert);
        }

      } catch (err) {
        console.error(`❌ 同步 ${stock.stock_id} 錯誤:`, err.message);
      }
      await sleep(200); 
    }
    console.log("🎉 同步完成！");
  } catch (error) {
    console.error("❌ 流程中斷:", error);
    process.exit(1);
  }
}

run();
