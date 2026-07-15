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
    console.log("🔥 🚨 【核心演進・全新與創新板 6 檔個股專用無損補件程序】啟動...");

    // 🎯 1. 專屬鎖定這 6 檔需要強力灌錄歷史燃料的個股
    const stockIds = ["1477", "7610"];
    console.log(`📊 目標補件頑固個股總計: ${stockIds.length} 檔。`);

    // 🎯 2. 時間地際線固定：從 2026-01-02 重新灌錄
    let startDateStr = "2026-01-02";
    
    const now = new Date();
    const taipeiHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: '2-digit', hour12: false }), 10);
    let endDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    
    if (taipeiHour < 16) {
      console.log("🕒 當前台灣時間未滿 16:00，同步終點限制在【昨天】。");
      endDate.setDate(endDate.getDate() - 1);
    }
    const endDateStr = formatDateToString(endDate);
    console.log(`📅 實質物理增量補件區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // 🎯 3. 逐檔進行自適應補件
    for (let i = 0; i < stockIds.length; i++) {
      const sId = stockIds[i];
      
      // 每 2 檔強制冷卻 12 秒，極速保護 API 限流
      if (i > 0 && i % 2 === 0) {
        console.log(`⏳ 補件防護機制：已同步 ${i} 檔，保護 API 強制冷卻 12 秒...`);
        await sleep(12000);
      }

      console.log(`\n[新股無損下載] (${i + 1}/${stockIds.length}) 標的: ${sId}`);

      try {
        const dateMap = {};

        // === (A) 核心第一關：以「收盤價格」為開市最高真理大底 ===
        const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data) && priceRes.data.data.length > 0) {
          priceRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!pRow.close || pRow.close === null || pRow.close === 0) return; // 徹底掠過真實休市日

            // 建立 34 欄位完全體初始格子，預設將所有籌碼與資券填滿 0 進行無損對齊
            dateMap[d] = { 
              stock_id: sId, date: d, price: pRow.close, open: pRow.open || pRow.close, max: pRow.max || pRow.close, min: pRow.min || pRow.close, 
              trading_volume: pRow.Trading_Volume || 0, change_value: pRow.spread || 0,
              f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
              margin_buy: 0, margin_sell: 0, margin_balance: 0, short_buy: 0, short_sell: 0, short_balance: 0
            };
          });
        }

        if (Object.keys(dateMap).length === 0) {
          console.log(`⚠️ 個股 ${sId} 價格 API 未回傳有效開市資料，跳過。`);
          continue;
        }
        await sleep(400);

        // === (B) 核心第二關：增量加灌「三大法人籌碼」 (自適應寬容) ===
        try {
          const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const res = await axios.get(apiUrl, { headers: commonHeaders, timeout: 15000 });
          
          if (res.data.status === 200 && Array.isArray(res.data.data)) {
            res.data.data.forEach(row => {
              const d = row.date;
              if (!dateMap[d]) return; // 拋棄休市雜訊
              if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
              else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
              else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
              else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
              else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
            });
          }
        } catch (chipErr) {
          console.log(`💡 提示：個股 ${sId} 無歷史法人紀錄，啟用寬容政策，自動填 0 通車。`);
        }
        await sleep(400);

        // === (C) 核心第三關：增量加灌「融資融券明細」 (自適應寬容) ===
        try {
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
        } catch (marginErr) {
          console.log(`💡 提示：個股 ${sId} 尚未開放信用交易(無資券紀錄)，啟用寬容政策，自動填 0 通車。`);
        }

        // 寫入雲端大帳本
        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert, { onConflict: 'stock_id,date' });
          if (upsertErr) throw upsertErr;
          console.log(`✨ [大底無損對齊成功] 個股 ${sId} 基礎格子建立。`);
        }

      } catch (err) {
        console.error(`❌ 下載 ${sId} 發生異常: ${err.message}`);
      }
      await sleep(200);
    }

    // 🎯 4. 基礎 34 欄位入庫後，發動指標大腦全量重算重建
    console.log("\n💡 數據底層對齊完畢！全面發動 28 欄位技術指標遞迴重算大腦...");
    await calculateAndWriteBackIndicators(stockIds);

    console.log("🎉 【6 檔創新板/全新股歷史補件大工程】全數完美收官！");
  } catch (error) {
    console.error("💥 補件全局流程發生致命錯誤:", error.message);
  }
}

// 完美承襲指標演算核心模組
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
        console.log(`[新股指標重建完畢] ${sId}`);
      }
    } catch (singleErr) {
      console.error(`❌ 演算異常: ${singleErr.message}`);
    }
    await sleep(60); 
  }
}
run();
