const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBackfill() {
  console.log("🚀 開始執行【全量覆蓋】MACD 補件工程...");

  // 1. 取得所有股票代號
  const { data: stocks, error: stockErr } = await supabase
    .from('stock_chips_daily')
    .select('stock_id');

  if (stockErr) { console.error("無法撈取代號:", stockErr); return; }
  const uniqueStockIds = [...new Set(stocks.map(s => s.stock_id))];
  console.log(`📊 總共有 ${uniqueStockIds.length} 檔股票需要檢查。`);

  for (let i = 0; i < uniqueStockIds.length; i++) {
    const stockId = uniqueStockIds[i];
    console.log(`🔄 (${i + 1}/${uniqueStockIds.length}) 處理中: ${stockId}`);

    try {
      // 2. 獲取該股所有歷史資料 (確保完整時間軸)
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('stock_id, date, price')
        .eq('stock_id', stockId)
        .order('date', { ascending: true });

      if (fetchErr || !pricePool) continue;

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      const rowUpdates = [];

      for (let j = 0; j < pricePool.length; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1);
        const currentPrice = targetDay.price;

        let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

        if (currentPrice !== null) {
          // EMA 遞迴邏輯
          if (subPool.length === 12) prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
          else if (subPool.length > 12) prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));

          if (subPool.length === 26) prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
          else if (subPool.length > 26) prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));

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
          stock_id: stockId,
          date: targetDay.date,
          macd_dif: calculatedDif ? parseFloat(calculatedDif.toFixed(4)) : null,
          macd_signal: calculatedMacdSignal ? parseFloat(calculatedMacdSignal.toFixed(4)) : null,
          macd_osc: calculatedMacdOsc ? parseFloat(calculatedMacdOsc.toFixed(4)) : null
        });
      }

      // 3. 分批寫入 (Supabase 單次寫入限制建議不要太大)
      const { error: writeErr } = await supabase
        .from('stock_chips_daily')
        .upsert(rowUpdates, { onConflict: 'stock_id,date' });
      
      if (writeErr) console.error(`❌ 寫入 ${stockId} 失敗:`, writeErr.message);

    } catch (err) {
      console.error(`⚠️ ${stockId} 計算異常，跳過。`);
    }
    await sleep(50); // 避免對資料庫造成瞬間高壓
  }
  console.log("✅ 全部處理完畢！");
}

runBackfill();
