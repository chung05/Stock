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

async function run() {
  try {
    console.log("🚀 開始執行【智慧增量 + 開高低量】同步流程...");

    // 1. 載入標的清單
    const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const stockMap = new Map();
    workbook.SheetNames.forEach(sheetName => {
      XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]).forEach(row => {
        const stockId = String(row['股票代號'] || row['代號'] || '').trim();
        const stockName = String(row['股票名稱'] || row['名稱'] || '').trim();
        if (stockId && stockName) {
          stockMap.set(stockId, { stock_id: stockId, stock_name: stockName, sheet_tags: [sheetName], updated_at: new Date().toISOString() });
        }
      });
    });
    const dbStockData = Array.from(stockMap.values());

    // 2. 💡 智慧日期偵測：讀取資料庫最新日期作為起點
    const { data: latestDbRow } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);

    let startDate = new Date('2026-01-01'); // 預設安全起始日
    if (latestDbRow && latestDbRow.length > 0) {
      let lastDate = new Date(latestDbRow[0].date);
      lastDate.setDate(lastDate.getDate() + 1);
      startDate = lastDate;
      console.log(`📊 偵測到最新資料日期：${latestDbRow[0].date}，將從 ${formatDateToString(startDate)} 開始更新。`);
    }

    const endDate = new Date();
    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(endDate);

    if (startDate > endDate) {
      console.log("✅ 資料庫已是最新，無須執行更新。");
      return;
    }

    console.log(`📅 本次同步區間：${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

    // 3. 分批處理執行迴圈
    for (let i = 0; i < dbStockData.length; i++) {
      const stock = dbStockData[i];
      
      // 💡 節流：每處理 15 檔休息 10 秒
      if (i > 0 && i % 15 === 0) {
        console.log(`⏳ 已處理 ${i} 檔，為保護 API 額度，強制休息 10 秒...`);
        await sleep(10000);
      }

      console.log(`[同步進度] (${i + 1}/${dbStockData.length}) ${stock.stock_id}`);

      try {
        // 法人籌碼
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const res = await axios.get(apiUrl, { headers: commonHeaders });
        
        const dateMap = {};
        if (res.data.status === 200 && Array.isArray(res.data.data)) {
          res.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
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

        // 價格與開高低量
        const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders });
        
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
          priceRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) dateMap[d] = { stock_id: stock.stock_id, date: d };
            
            dateMap[d].price = pRow.close;
            dateMap[d].open = pRow.open;
            dateMap[d].max = pRow.max;
            dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume;
            dateMap[d].change_value = pRow.spread || 0;
          });
        }

        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          await supabase.from('stock_chips_daily').upsert(rowsToUpsert);
        }

      } catch (err) {
        console.error(`❌ 同步 ${stock.stock_id} 錯誤: ${err.message}`);
      }
      await sleep(200); 
    }
    console.log("🎉 同步流程結束。");
  } catch (error) {
    console.error("❌ 流程中斷:", error);
  }
}

run();
