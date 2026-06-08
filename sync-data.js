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

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      const rowUpdates = [];

      for (let j = 0; j < pricePool.length; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        let calculatedMA10 = null, calculatedMA20 = null, calculatedMA60 = null, calculatedRSI14 = null;
        let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

        if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
        if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));
        if (subLen >= 60) calculatedMA60 = parseFloat((subPool.slice(-60).reduce((a, b) => a + (b.price || 0), 0) / 60).toFixed(2));

        if (currentPrice !== null) {
          if (subLen === 12) prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
          else if (subLen > 12) prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));
          if (subLen === 26) prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
          else if (subLen > 26) prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));
          if (prevEma12 !== null && prevEma26 !== null) {
            calculatedDif = prevEma12 - prevEma26;
            difHistory.push(calculatedDif);
            if (difHistory.length === 9) prevMacd9 = difHistory.reduce((a, b) => a + b, 0) / 9;
            else if (difHistory.length > 9) prevMacd9 = (calculatedDif * (2/10)) + (prevMacd9 * (8/10));
            calculatedMacdSignal = prevMacd9;
            calculatedMacdOsc = calculatedDif - calculatedMacdSignal;
          }
        }
        rowUpdates.push({ ...targetDay, ma10: calculatedMA10, ma20: calculatedMA20, ma60: calculatedMA60, macd_dif: calculatedDif ? parseFloat(calculatedDif.toFixed(4)) : null, macd_signal: calculatedMacdSignal ? parseFloat(calculatedMacdSignal.toFixed(4)) : null, macd_osc: calculatedMacdOsc ? parseFloat(calculatedMacdOsc.toFixed(4)) : null });
      }
      await supabase.from('stock_chips_daily').upsert(rowUpdates);
    } catch (err) { console.error(`處理 ${stock.stock_id} 失敗:`, err.message); }
    await sleep(80);
  }
}

async function run() {
  const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
  const workbook = XLSX.read(response.data, { type: 'buffer' });
  const stockMap = new Map();
  workbook.SheetNames.forEach(name => {
    const json = XLSX.utils.sheet_to_json(workbook.Sheets[name]);
    json.forEach(row => {
      const sId = String(row['股票代號'] || row['代號'] || '').trim();
      const sName = String(row['股票名稱'] || row['名稱'] || '').trim();
      if (!sId) return;
      if (!stockMap.has(sId)) stockMap.set(sId, { stock_id: sId, stock_name: sName, sheet_tags: [] });
      if (!stockMap.get(sId).sheet_tags.includes(name)) stockMap.get(sId).sheet_tags.push(name);
    });
  });
  const dbStockData = Array.from(stockMap.values());

  const { data: lastRecord } = await supabase.from('stock_chips_daily').select('date').order('date', { ascending: false }).limit(1);
  let startDate = new Date('2026-01-01');
  if (lastRecord && lastRecord.length > 0) {
    const lastDate = new Date(lastRecord[0].date);
    lastDate.setDate(lastDate.getDate() + 1);
    startDate = lastDate;
  }
  const endDateStr = formatDateToString(new Date());
  
  for (let stock of dbStockData) {
    const dateMap = {};
    try {
        const pRes = await axios.get(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.stock_id}&start_date=${formatDateToString(startDate)}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`);
        if(pRes.data.data) {
            pRes.data.data.forEach(p => {
                dateMap[p.date] = { stock_id: stock.stock_id, date: p.date, price: p.close, change_value: p.spread || 0 };
            });
        }
        await supabase.from('stock_chips_daily').upsert(Object.values(dateMap));
    } catch(e) { console.error(e); }
  }
  await calculateAndWriteBackIndicators(dbStockData);
}
run();
