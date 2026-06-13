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
  console.log("🚀 開始執行【2026-02-02 起正式存儲】技術指標與 KD/RSV 全量回填大補件工程...");

  let uniqueStockIds = [];

  try {
    let allNodes = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const fromRange = page * pageSize;
      const toRange = fromRange + pageSize - 1;

      const { data: nodes, error: pErr } = await supabase
        .from('stock_chips_daily')
        .select('stock_id')
        .not('stock_id', 'is', null)
        .range(fromRange, toRange);

      if (pErr) throw pErr;

      if (!nodes || nodes.length === 0) {
        hasMore = false;
      } else {
        allNodes.push(...nodes);
        if (nodes.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    uniqueStockIds = [...new Set(allNodes.map(s => String(s.stock_id).trim()))].sort();
    console.log(`🎯 成功鎖定全量有紀錄的股票總數: ${uniqueStockIds.length} 檔`);

  } catch (err) {
    console.error("❌ 分頁撈取歷史代號清單時發生異常:", err.message);
    return;
  }

  if (uniqueStockIds.length === 0) return;

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < uniqueStockIds.length; i++) {
    const stockId = uniqueStockIds[i];
    console.log(`🔄 (${i + 1}/${uniqueStockIds.length}) 歷史暖身指標 + KD 覆蓋重算中: ${stockId}`);

    try {
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('*')
        .eq('stock_id', stockId)
        .order('date', { ascending: true });

      if (fetchErr || !pricePool || pricePool.length === 0) {
        failCount++;
        continue;
      }

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      const rowUpdates = [];

      // 1/2 開局第一天無昨日，初始化為 50
      let prevK = 50.0;
      let prevD = 50.0;

      for (let j = 0; j < pricePool.length; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        let calculatedMA5 = null, calculatedMA10 = null, calculatedMA20 = null, calculatedMA60 = null;
        let calculatedRSI14 = null;
        let calculatedRSV = null, calculatedK = null, calculatedD = null;
        let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

        if (currentPrice !== null && currentPrice !== undefined) {
          // (A) 均線與 RSI
          if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));
          if (subLen >= 60) calculatedMA60 = parseFloat((subPool.slice(-60).reduce((a, b) => a + (b.price || 0), 0) / 60).toFixed(2));

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

          // 🚀 核心更新：一月份照樣進行 KD 公式遞迴收斂，但只有 2/2 起才正式將數據塞入欄位
          const lookbackPeriod = Math.min(subLen, 9);
          const lastNDays = subPool.slice(-lookbackPeriod);
          const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
          const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
          
          let rsv = 50.0;
          if (highN - lowN !== 0) {
            rsv = ((currentPrice - lowN) / (highN - lowN)) * 100;
          }
          
          // 遞迴公式每日運作以維持數據連續性
          let currentK = (prevK * (2 / 3)) + (rsv * (1 / 3));
          let currentD = (prevD * (2 / 3)) + (currentK * (1 / 3));
          
          prevK = currentK;
          prevD = currentD;

          // 💡 智慧檢查點：判定日期是否大於等於 2026-02-02
          if (targetDay.date >= "2026-02-02") {
            calculatedRSV = parseFloat(rsv.toFixed(2));
            calculatedK = parseFloat(currentK.toFixed(2));
            calculatedD = parseFloat(currentD.toFixed(2));
          } else {
            // 一月份暖身期：格子保持 NULL 清爽狀態
            calculatedRSV = null;
            calculatedK = null;
            calculatedD = null;
          }

          // (F) MACD
          if (subLen === 12) prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
          else if (subLen > 12) prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));
          if (subLen === 26) prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
          else if (subLen > 26) prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));

          if (prevEma12 !== null && prevEma26 !== null) {
            calculatedDif = prevEma12 - prevEma26; difHistory.push(calculatedDif);
            if (difHistory.length === 9) prevMacd9 = difHistory.reduce((a, b) => a + b, 0) / 9;
            else if (difHistory.length > 9) prevMacd9 = (calculatedDif * (2/10)) + (prevMacd9 * (8/10));
            calculatedMacdSignal = prevMacd9; calculatedMacdOsc = calculatedDif - calculatedMacdSignal;
          }
        }

        rowUpdates.push({
          ...targetDay,
          ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, ma60: calculatedMA60, rsi14: calculatedRSI14,
          rsv: calculatedRSV,
          kd_k: calculatedK,
          kd_d: calculatedD,
          macd_dif: calculatedDif ? parseFloat(calculatedDif.toFixed(4)) : null,
          macd_signal: calculatedMacdSignal ? parseFloat(calculatedMacdSignal.toFixed(4)) : null,
          macd_osc: calculatedMacdOsc ? parseFloat(calculatedMacdOsc.toFixed(4)) : null
        });
      }

      const { error: writeErr } = await supabase.from('stock_chips_daily').upsert(rowUpdates);
      if (!writeErr) successCount++;

    } catch (err) {
      failCount++;
    }
    await sleep(60); 
  }
  console.log(`\n🏁 【補件工程完成】2月起精準 KD 歷史洗白成功：${successCount} 檔`);
}

runBackfill();
