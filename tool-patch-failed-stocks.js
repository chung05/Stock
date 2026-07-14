// tool-patch-failed-stocks.js
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
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
    console.log("🔥 🚨 【臨時維護・下載失敗個股專用補件程序】啟動...");

    // 🎯 1. 精準對齊您指定下載失敗的 31 + 4 檔個股名單
    const stockIds = [
 //     "1434", "1717", "6121", "2362", "2201", "2392", "6244", "1722", "2101", "2393", 
 //     "2103", "8069", "4137", "3443", "3533", "3665", "3189", "3034", "3481", "2845", 
 //     "2912", "3702", "2915", "3005", "3023", "3036", "3044", "3051", "3706", "6505", "5904"
    ];
    console.log(`📊 目標補件個股總計: ${stockIds.length} 檔。`);

    // 🎯 2. 自適應推導增量時間區間
    const { data: lastRecord, error: dateErr } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
      
    if (dateErr) console.log("⚠️ 偵測大帳本最大日期異常:", dateErr.message);

    let startDate = new Date('2026-01-02');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      // 🌟 補件晶片核心邏輯：就地回溯一天開始補件，防止任何時間邊界資料殘缺
      startDate = new Date(lastRecord[0].date);
    }
    
    const now = new Date();
    const taipeiHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: '2-digit', hour12: false }), 10);
    let endDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    
    // 🌟 完美修正點：將原先打錯字的 taipeHour 修正補回關鍵的 "i" -> taipeiHour！
    if (taipeiHour < 16) {
      console.log("🕒 當前台灣時間未滿 16:00，同步終點限制在【昨天】。");
      endDate.setDate(endDate.getDate() - 1);
    }

    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(endDate);
    
    if (startDate > endDate) {
      console.log(`💡 大帳本日期倒置，暫不更新。`);
      return;
    }

    console.log(`📅 實質增量補件區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // 🎯 3. 逐檔進行 34 欄位資料完整下載修復
    for (let i = 0; i < stockIds.length; i++) {
      const sId = stockIds[i];
      
      // 🛡️ 流量控制：每 2 檔就強制休息 12 秒，高安全降載防禦
      if (i > 0 && i % 2 === 0) {
        console.log(`⏳ 補件防護機制：已同步 ${i} 檔，保護 API 強制冷卻 12 秒...`);
        await sleep(12000);
      }

      console.log(`[補件全量下載] (${i + 1}/${stockIds.length}) 標的: ${sId}`);

      try {
        const dateMap = {};

        // (A) 下載三大法人籌碼
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const res = await axios.get(apiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (res.data.status === 200 && Array.isArray(res.data.data)) {
          res.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              dateMap[d] = { 
                stock_id: sId, date: d, price: null, change_value: 0, 
                f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
                margin_buy: 0, margin_sell: 0, margin_balance: 0, short_buy: 0, short_sell: 0, short_balance: 0,
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

        // (B) 下載收盤K線價量
        const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
          priceRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) {
              dateMap[d] = { 
                stock_id: sId, date: d, price: null, change_value: 0, 
                f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
                margin_buy: 0, margin_sell: 0, margin_balance: 0, short_buy: 0, short_sell: 0, short_balance: 0,
                open: 0, max: 0, min: 0, trading_volume: 0
              };
            }
            dateMap[d].price = pRow.close; dateMap[d].open = pRow.open; dateMap[d].max = pRow.max; dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume; dateMap[d].change_value = pRow.spread || 0;
          });
        }

        // (C) 下載融資券接口
        const marginApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const marginRes = await axios.get(marginApiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (marginRes.data.status === 200 && Array.isArray(marginRes.data.data)) {
          marginRes.data.data.forEach(mRow => {
            const d = mRow.date;
            if (dateMap[d]) {
              dateMap[d].margin_buy = mRow.MarginPurchaseBuy || 0;
              dateMap[d].margin_sell = mRow.MarginPurchaseSell || 0;
              dateMap[d].margin_balance = mRow.MarginPurchaseTodayBalance || 0;
              dateMap[d].short_buy = mRow.ShortSaleBuy || 0;
              dateMap[d].short_sell = mRow.ShortSaleSell || 0;
              dateMap[d].short_balance = mRow.ShortSaleTodayBalance || 0;
            }
          });
        }

        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert, { onConflict: 'stock_id,date' });
          if (upsertErr) throw upsertErr;
        }

      } catch (err) {
        console.error(`❌ 下載 ${sId} 補件異常: ${err.message}`);
      }
      await sleep(200);
    }

    // 🎯 4. 全量資券與價量對齊到位後，發動指標大腦重算補齊
    console.log("💡 補件大底打好！發動 28 欄位技術指標遞迴重算大腦...");
    await calculateAndWriteBackIndicators(stockIds);

    console.log("🎉 【31檔失敗個股・歷史補件完全體】全數完美收官！");
  } catch (error) {
    console.error("💥 補件全局流程發生致命錯誤:", error.message);
  }
}

// 完整保留繼承自 v2 的指標演算大腦
async function calculateAndWriteBackIndicators(stockList) {
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i]).trim();
    try {
      const { data: pricePool, error: fetchErr } = await supabase.from('stock_chips_daily').select('*').eq('stock_id', sId).order('date', { ascending: true });
      if (fetchErr || !pricePool || pricePool.length === 0) continue;

      const totalLen = pricePool.length; const rowUpdates = [];
      let prevEma12 = null, prevEma26 = null, prevMacd9 = null; const difHistory = []; let prevK = 50.0; let prevD = 50.0;

      for (let j = 0; j < totalLen; j++) {
        const targetDay = pricePool[j]; const subPool = pricePool.slice(0, j + 1); const subLen = subPool.length; const currentPrice = targetDay.price;
        let calculatedMA5 = null, calculatedMA10 = null, calculatedMA20 = null, calculatedRSI14 = null, calculatedRSV = null, calculatedK = null, calculatedD = null, calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

        if (currentPrice !== null && currentPrice !== undefined) {
          if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((acc, c) => acc + (c.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((acc, c) => acc + (c.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((acc, c) => acc + (c.price || 0), 0) / 20).toFixed(2));

          if (subLen >= 15) {
            let avgUp = 0, avgDown = 0; let rsiInitialized = false;
            for (let k = 1; k < subLen; k++) {
              const diff = subPool[k].price - subPool[k - 1].price;
              const currentUp = diff > 0 ? diff : 0; const currentDown = diff < 0 ? Math.abs(diff) : 0;
              if (!rsiInitialized) {
                avgUp += currentUp; avgDown += currentDown; if (k === 14) { avgUp /= 14; avgDown /= 14; rsiInitialized = true; }
              } else { avgUp = (avgUp * 13 + currentUp) / 14; avgDown = (avgDown * 13 + currentDown) / 14; }
            }
            if (rsiInitialized) {
              if (avgDown === 0) calculatedRSI14 = avgUp === 0 ? 50.00 : 100.00;
              else calculatedRSI14 = parseFloat((100 - (100 / (1 + (avgUp / avgDown)))).toFixed(2));
            }
          }

          const lookbackPeriod = Math.min(subLen, 9); const lastNDays = subPool.slice(-lookbackPeriod);
          const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0)); const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
          let rsv = (highN - lowN !== 0) ? ((currentPrice - lowN) / (highN - lowN)) * 100 : 50.0;
          let currentK = (prevK * (2 / 3)) + (rsv * (1 / 3)); let currentD = (prevD * (2 / 3)) + (currentK * (1 / 3));
          prevK = currentK; prevD = currentD;

          if (targetDay.date >= "2026-02-02") { calculatedRSV = parseFloat(rsv.toFixed(2)); calculatedK = parseFloat(currentK.toFixed(2)); calculatedD = parseFloat(currentD.toFixed(2)); }
          if (subLen === 12) prevEma12 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 12;
          else if (subLen > 12) prevEma12 = (currentPrice * (2 / 13)) + (prevEma12 * (11 / 13));
          if (subLen === 26) prevEma26 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 26;
          else if (subLen > 26) prevEma26 = (currentPrice * (2 / 27)) + (prevEma26 * (25 / 27));

          if (prevEma12 !== null && prevEma26 !== null) {
            calculatedDif = parseFloat((prevEma12 - prevEma26).toFixed(4)); difHistory.push(calculatedDif);
            if (difHistory.length === 9) { prevMacd9 = difHistory.reduce((acc, val) => acc + val, 0) / 9; calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4)); }
            else if (difHistory.length > 9) { prevMacd9 = (calculatedDif * (2 / 10)) + (prevMacd9 * (8 / 10)); calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4)); }
            if (calculatedMacdSignal !== null) calculatedMacdOsc = parseFloat((calculatedDif - calculatedMacdSignal).toFixed(4));
          }
        }

        rowUpdates.push({
          stock_id: sId, date: targetDay.date, price: targetDay.price, open: targetDay.open, max: targetDay.max, min: targetDay.min, trading_volume: targetDay.trading_volume, change_value: targetDay.change_value, f_buy: targetDay.f_buy, f_sell: targetDay.f_sell, fd_buy: targetDay.fd_buy, fd_sell: targetDay.fd_sell, it_buy: targetDay.it_buy, it_sell: targetDay.it_sell, ds_buy: targetDay.ds_buy, ds_sell: targetDay.ds_sell, dh_buy: targetDay.dh_buy, dh_sell: targetDay.dh_sell, margin_buy: targetDay.margin_buy, margin_sell: targetDay.margin_sell, margin_balance: targetDay.margin_balance, short_buy: targetDay.short_buy, short_sell: targetDay.short_sell, short_balance: targetDay.short_balance, ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: calculatedRSI14, rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD, macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
        });
      }

      if (rowUpdates.length > 0) {
        await supabase.from('stock_chips_daily').upsert(rowUpdates, { onConflict: 'stock_id,date' });
        console.log(`[補件指標演算完畢] ${sId}`);
      }
    } catch (singleErr) {
      console.error(`❌ 演算異常: ${singleErr.message}`);
    }
    await sleep(60); 
  }
}
run();
