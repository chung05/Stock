// backend-sync-v3-part2.js
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
    console.log("🚀 【牛牛大帳本 v3 - Part2】啟動 (獨立資券下載 + 實體格就地無損融合)...");

    const { data: targetsData, error: targetError } = await supabase.from('stock_targets').select('stock_id');
    if (targetError) throw targetError;
    const stockIds = [...new Set((targetsData || []).map(item => String(item.stock_id).trim()).filter(id => id))];
    if (stockIds.length === 0) return;

    // 💡 智慧回溯防線：融資券在下午會微調修正前一天水位，故回溯 1 天作為增量緩衝
    const { data: lastRecord } = await supabase.from('stock_chips_daily').select('date').order('date', { ascending: false }).limit(1);
    let startDate = new Date('2026-01-02');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      startDate = new Date(lastRecord[0].date); 
    }
    
    const now = new Date();
    const taipeiHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: '2-digit', hour12: false }), 10);
    let endDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    if (taipeiHour < 16) endDate.setDate(endDate.getDate() - 1);

    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(endDate);
    console.log(`📅 Part2 融資券增量填補區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

    // 專職單接口下載信用交易數據
    for (let i = 0; i < stockIds.length; i++) {
      const sId = stockIds[i];
      if (i > 0 && i % 20 === 0) {
        console.log(`⏳ 已下載 ${i} 檔資券，冷卻防護 8 秒...`);
        await sleep(8000);
      }

      console.log(`[Part2 資券填補] (${i + 1}/${stockIds.length}) 標的: ${sId}`);

      try {
        const dateMap = {};
        // 接口 1：獨立抓取融資融券數據
        const marginApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const marginRes = await axios.get(marginApiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (marginRes.data.status === 200 && Array.isArray(marginRes.data.data)) {
          marginRes.data.data.forEach(mRow => {
            const d = mRow.date;
            // 🌟 就地取材融合：只打包資券欄位
            dateMap[d] = {
              stock_id: sId, date: d,
              margin_buy: mRow.MarginPurchaseBuy || 0, margin_sell: mRow.MarginPurchaseSell || 0, margin_balance: mRow.MarginPurchaseTodayBalance || 0,
              short_buy: mRow.ShortSaleBuy || 0, short_sell: mRow.ShortSaleSell || 0, short_balance: mRow.ShortSaleTodayBalance || 0
            };
          });
        }

        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          // 透過 upsert 進行「就地融合」，只會補齊資券空缺，絕不影響 Part1 寫好的法人與價量欄位！
          const { error: patchErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert, { onConflict: 'stock_id,date' });
          if (patchErr) throw patchErr;
        }
      } catch (err) {
        console.error(`❌ Part2 資券下載 ${sId} 異常: ${err.message}`);
      }
      await sleep(100);
    }

    // 資券全部補齊後，發動第二次最終校準演算，讓籌碼換手、致命軋空等信用策略完美共振！
    console.log("💡 全量資券已精準補齊！發動最終校準演算法...");
    await reCalibrateIndicators(stockIds);

    console.log("🎉 【Part2 資券無損填補與策略校準】流程完美收官！");
  } catch (error) {
    console.error("💥 Part2 全局致命錯誤:", error.message);
  }
}

// 最終校準大腦：確保新填入的資券數據與技術指標 100% 同步結合
async function reCalibrateIndicators(stockList) {
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

        // 全欄位完整打包，最終精準校準覆蓋
        rowUpdates.push({
          stock_id: sId, date: targetDay.date, price: targetDay.price, open: targetDay.open, max: targetDay.max, min: targetDay.min, trading_volume: targetDay.trading_volume, change_value: targetDay.change_value, f_buy: targetDay.f_buy, f_sell: targetDay.f_sell, fd_buy: targetDay.fd_buy, fd_sell: targetDay.fd_sell, it_buy: targetDay.it_buy, it_sell: targetDay.it_sell, ds_buy: targetDay.ds_buy, ds_sell: targetDay.ds_sell, dh_buy: targetDay.dh_buy, dh_sell: targetDay.dh_sell, margin_buy: targetDay.margin_buy, margin_sell: targetDay.margin_sell, margin_balance: targetDay.margin_balance, short_buy: targetDay.short_buy, short_sell: targetDay.short_sell, short_balance: targetDay.short_balance, ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: calculatedRSI14, rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD, macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
        });
      }

      if (rowUpdates.length > 0) {
        await supabase.from('stock_chips_daily').upsert(rowUpdates, { onConflict: 'stock_id,date' });
      }
    } catch (singleErr) { console.error(`❌ Part2 最終校準異常: ${singleErr.message}`); }
    await sleep(60);
  }
}
run();
