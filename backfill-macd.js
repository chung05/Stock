// backfill-macd.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBackfill() {
  console.log("🚀 開始執行【全量歷史結構覆蓋】技術指標大回填補件工程...");

  // 1. 取得資料庫中所有股票代號
  const { data: stocks, error: stockErr } = await supabase
    .from('stock_chips_daily')
    .select('stock_id');

  if (stockErr) { console.error("無法撈取代號:", stockErr); return; }
  const uniqueStockIds = [...new Set(stocks.map(s => s.stock_id))];
  console.log(`📊 總共有 ${uniqueStockIds.length} 檔股票需要進行歷史全指標回填。`);

  for (let i = 0; i < uniqueStockIds.length; i++) {
    const stockId = uniqueStockIds[i];
    console.log(`🔄 (${i + 1}/${uniqueStockIds.length}) 歷史全指標洗白重算中: ${stockId}`);

    try {
      // 2. 獲取該股自 2026 年以來的所有歷史資料
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('*')
        .eq('stock_id', stockId)
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

        let calculatedMA5 = null;
        let calculatedMA10 = null;
        let calculatedMA20 = null;
        let calculatedMA60 = null;
        let calculatedRSI14 = null;
        let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

        if (currentPrice !== null && currentPrice !== undefined) {
          // 🧠 (A) MA5 計算
          if (subLen >= 5) {
            const sum5 = subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0);
            calculatedMA5 = parseFloat((sum5 / 5).toFixed(2));
          }
          // 🧠 (B) MA10 計算
          if (subLen >= 10) {
            const sum10 = subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0);
            calculatedMA10 = parseFloat((sum10 / 10).toFixed(2));
          }
          // 🧠 (C) MA20 計算
          if (subLen >= 20) {
            const sum20 = subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0);
            calculatedMA20 = parseFloat((sum20 / 20).toFixed(2));
          }
          // 🧠 (D) MA60 計算
          if (subLen >= 60) {
            const sum60 = subPool.slice(-60).reduce((a, b) => a + (b.price || 0), 0);
            calculatedMA60 = parseFloat((sum60 / 60).toFixed(2));
          }

          // 🧠 (E) RSI14 遞迴回填
          if (subLen >= 15) {
            let avgUp = 0, avgDown = 0;
            let rsiInitialized = false;
            for (let k = 1; k < subLen; k++) {
              const diff = subPool[k].price - subPool[k - 1].price;
              const currentUp = diff > 0 ? diff : 0;
              const currentDown = diff < 0 ? Math.abs(diff) : 0;
              if (!rsiInitialized) {
                avgUp += currentUp; avgDown += currentDown;
                if (k === 14) { avgUp /= 14; avgDown /= 14; rsiInitialized = true; }
              } else {
                avgUp = (avgUp * 13 + currentUp) / 14;
                avgDown = (avgDown * 13 + currentDown) / 14;
              }
            }
            if (rsiInitialized) {
              if (avgDown === 0) calculatedRSI14 = avgUp === 0 ? 50.00 : 100.00;
              else calculatedRSI14 = parseFloat((100 - (100 / (1 + (avgUp / avgDown)))).toFixed(2));
            }
          }

          // 🧠 (F) MACD 遞迴計算
          if (subLen === 12) {
            prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
          } else if (subLen > 12) {
            prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));
          }

          if (subLen === 26) {
            prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
          } else if (subLen > 26) {
            prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));
          }

          if (prevEma12 !== null && prevEma26 !== null) {
            calculatedDif = prevEma12 - prevEma26;
            difHistory.push(calculatedDif);

            if (difHistory.length === 9) prevMacd9 = difHistory.reduce((a, b) => a + b, 0) / 9;
            else if (difHistory.length > 9) prevMacd9 = (calculatedDif * (2/10)) + (prevMacd9 * (8/10));
            
            calculatedMacdSignal = prevMacd9;
            calculatedMacdOsc = calculatedDif - calculatedMacdSignal;
          }
        }

        rowUpdates.push({
          ...targetDay,
          ma5: calculatedMA5,
          ma10: calculatedMA10,
          ma20: calculatedMA20,
          ma60: calculatedMA60,
          rsi14: calculatedRSI14,
          macd_dif: calculatedDif ? parseFloat(calculatedDif.toFixed(4)) : null,
          macd_signal: calculatedMacdSignal ? parseFloat(calculatedMacdSignal.toFixed(4)) : null,
          macd_osc: calculatedMacdOsc ? parseFloat(calculatedMacdOsc.toFixed(4)) : null
        });
      }

      // 3. 分批安全寫回
      const { error: writeErr } = await supabase
        .from('stock_chips_daily')
        .upsert(rowUpdates);
      
      if (writeErr) console.error(`❌ 歷史更新 ${stockId} 失敗:`, writeErr.message);

    } catch (err) {
      console.error(`⚠️ ${stockId} 歷史校正發生異常，跳過。`);
    }
    await sleep(60); 
  }
  console.log("✅ 歷史全量補件與 MA5 週線工程大獲全勝！");
}

runBackfill();
