// sync-data.js
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
    console.log("🚀 開始執行【180檔母名單直連 + 增量同步 + KD暖身篩選計算】流程...");

    const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const stockMap = new Map();
    workbook.SheetNames.forEach(name => {
      const sheet = workbook.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet);
      json.forEach(row => {
        const sId = String(row['股票代號'] || row['代號'] || '').trim();
        const sName = String(row['股票名稱'] || row['名稱'] || '').trim();
        if (!sId) return;
        if (!stockMap.has(sId)) {
          stockMap.set(sId, { stock_id: sId, stock_name: sName, sheet_tags: [] });
        }
        if (!stockMap.get(sId).sheet_tags.includes(name)) {
          stockMap.get(sId).sheet_tags.push(name);
        }
      });
    });

    const dbStockData = Array.from(stockMap.values());
    console.log(`📊 本次欲檢查並同步的雲端股票總數: ${dbStockData.length} 檔`);

    if (dbStockData.length === 0) return;

    const { data: lastRecord, error: dateErr } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
      
    if (dateErr) console.log("⚠️ 偵測最大日期異常:", dateErr.message);

    let startDate = new Date('2026-01-02');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      const lastDate = new Date(lastRecord[0].date);
      lastDate.setDate(lastDate.getDate() + 1);
      startDate = lastDate;
    }
    
    const today = new Date();
    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(today);
    console.log(`📅 本次增量同步區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    if (startDate <= today) {
      for (let i = 0; i < dbStockData.length; i++) {
        const stock = dbStockData[i];
        
        if (i > 0 && i % 15 === 0) {
          console.log(`⏳ 已抓取 ${i} 檔，為保護 API 額度，強制休息 10 秒...`);
          await sleep(10000);
        }

        console.log(`[第一步：下載籌碼] (${i + 1}/${dbStockData.length}) ${stock.stock_id}`);

        try {
          const dateMap = {};

          const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const res = await axios.get(apiUrl, { headers: commonHeaders });
          
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
            const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert);
            if (upsertErr) throw upsertErr;
          }

        } catch (err) {
          console.error(`❌ 下載 ${stock.stock_id} 錯誤: ${err.message}`);
        }
        await sleep(200);
      }
    }

    console.log("💡 開始跑全指標計算 Function...");
    await calculateAndWriteBackIndicators(dbStockData);

    console.log("🎉 所有增量同步與技術指標計算流程全數完成！");
  } catch (error) {
    console.error("💥 全局同步流程發生嚴重致命錯誤:", error.message);
    process.exit(1);
  }
}

async function calculateAndWriteBackIndicators(stockList) {
  for (let i = 0; i < stockList.length; i++) {
    const stock = stockList[i];

    try {
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('*')
        .eq('stock_id', stock.stock_id)
        .order('date', { ascending: true });

      if (fetchErr || !pricePool || pricePool.length === 0) continue;

      const totalLen = pricePool.length;
      const rowUpdates = [];

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];

      let prevK = 50.0;
      let prevD = 50.0;

      for (let j = 0; j < totalLen; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1);
        const subLen = subPool.length;

        let calculatedMA5 = null, calculatedMA10 = null, calculatedMA20 = null, calculatedMA60 = null;
        let calculatedRSI14 = null;
        let calculatedRSV = null, calculatedK = null, calculatedD = null;

        if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((acc, c) => acc + (c.price || 0), 0) / 5).toFixed(2));
        if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((acc, c) => acc + (c.price || 0), 0) / 10).toFixed(2));
        if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((acc, c) => acc + (c.price || 0), 0) / 20).toFixed(2));
        if (subLen >= 60) calculatedMA60 = parseFloat((subPool.slice(-60).reduce((acc, c) => acc + (c.price || 0), 0) / 60).toFixed(2));

        if (subLen >= 15) {
          let avgUp = 0, avgDown = 0; let rsiInitialized = false;
          for (let k = 1; k < subLen; k++) {
            const diff = subPool[k].price - subPool[k - 1].price;
            const currentUp = diff > 0 ? diff : 0; const currentDown = diff < 0 ? Math.abs(diff) : 0;
            if (!rsiInitialized) {
              avgUp += currentUp; avgDown += currentDown;
              if (k === 14) { avgUp /= 14; avgDown /= 14; rsiInitialized = true; }
            } else { avgUp = (avgUp * 13 + currentUp) / 14; avgDown = (avgDown * 13 + currentDown) / 14; }
          }
          if (rsiInitialized) {
            if (avgDown === 0) calculatedRSI14 = avgUp === 0 ? 50.00 : 100.00;
            else calculatedRSI14 = parseFloat((100 - (100 / (1 + (avgUp / avgDown)))).toFixed(2));
          }
        }

        // 🚀 增量同步核心：前推自適應天際線遞迴
        const lookbackPeriod = Math.min(subLen, 9);
        const lastNDays = subPool.slice(-lookbackPeriod);
        const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
        const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
        
        let rsv = 50.0;
        if (highN - lowN !== 0) {
          rsv = ((targetDay.price - lowN) / (highN - lowN)) * 100;
        }

        let currentK = (prevK * (2 / 3)) + (rsv * (1 / 3));
        let currentD = (prevD * (2 / 3)) + (currentK * (1 / 3));

        prevK = currentK;
        prevD = currentD;

        // 💡 智慧檢查點：判定日期大於等於 2026-02-02 始准許寫入實體格子
        if (targetDay.date >= "2026-02-02") {
          calculatedRSV = parseFloat(rsv.toFixed(2));
          calculatedK = parseFloat(currentK.toFixed(2));
          calculatedD = parseFloat(currentD.toFixed(2));
        } else {
          calculatedRSV = null;
          calculatedK = null;
          calculatedD = null;
        }

        // MACD
        const currentPrice = targetDay.price;
        if (currentPrice !== null && currentPrice !== undefined) {
          if (subLen === 12) { prevEma12 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 12; }
          else if (subLen > 12) { prevEma12 = (currentPrice * (2 / 13)) + (prevEma12 * (11 / 13)); }
          if (subLen === 26) { prevEma26 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 26; }
          else if (subLen > 26) { prevEma26 = (currentPrice * (2 / 27)) + (prevEma26 * (25 / 27)); }

          if (prevEma12 !== null && prevEma26 !== null) {
            let calculatedDif = parseFloat((prevEma12 - prevEma26).toFixed(4)); difHistory.push(calculatedDif);
            if (difHistory.length === 9) {
              prevMacd9 = difHistory.reduce((acc, val) => acc + val, 0) / 9; calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
            } else if (difHistory.length > 9) {
              prevMacd9 = (calculatedDif * (2 / 10)) + (prevMacd9 * (8 / 10)); calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
            }
            if (calculatedMacdSignal !== null) calculatedMacdOsc = parseFloat((calculatedDif - calculatedMacdSignal).toFixed(4));
          }
        }

        rowUpdates.push({
          ...targetDay, 
          ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, ma60: calculatedMA60, rsi14: calculatedRSI14,
          rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
          macd_dif: targetDay.macd_dif, macd_signal: targetDay.macd_signal, macd_osc: targetDay.macd_osc
        });
      }

      if (rowUpdates.length > 0) {
        await supabase.from('stock_chips_daily').upsert(rowUpdates);
        console.log(`[智慧增量完畢] ${stock.stock_id} 暖身過濾完畢。`);
      }

    } catch (singleErr) {
      console.error(`❌ 處理 ${stock.stock_id} 指標失敗:`, singleErr.message);
    }
    await sleep(80); 
  }
}

run();
