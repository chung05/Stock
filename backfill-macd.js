const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // 確保能讀取到環境變數

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 初始化 Supabase 客戶端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBackfill() {
  try {
    console.log("🚀 開始執行歷史資料 MACD 一次性自動補件流（精準正序計算）...");

    // 1. 撈取目前資料庫中所有不重複的股票代號
    const { data: stockRows, error: stockErr } = await supabase
      .from('stock_chips_daily')
      .select('stock_id')
      .order('stock_id');
      
    if (stockErr) throw stockErr;
    
    const uniqueStockIds = Array.from(new Set(stockRows.map(s => s.stock_id)));
    console.log(`📊 偵測到目前資料庫共有 ${uniqueStockIds.length} 檔股票需要補齊 MACD 指標。`);

    if (uniqueStockIds.length === 0) return;

    // 2. 逐檔股票進行全時間軸正序計算
    for (let i = 0; i < uniqueStockIds.length; i++) {
      const stockId = uniqueStockIds[i];
      console.log(`⏳ (${i + 1}/${uniqueStockIds.length}) 正在精算並補件: ${stockId} ...`);

      // 由舊到新（ascending: true）撈取該股有史以來的所有歷史價格，起點為 2026/01/02
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('stock_id, date, price')
        .eq('stock_id', stockId)
        .order('date', { ascending: true });

      if (fetchErr) {
        console.error(`❌ 無法獲取 ${stockId} 的歷史資料:`, fetchErr.message);
        continue;
      }

      if (!pricePool || pricePool.length === 0) continue;

      const totalLen = pricePool.length;
      const rowUpdates = [];

      // 💡 關鍵變數：用來維護連續 EMA 的遞迴狀態
      let prevEma12 = null;
      let prevEma26 = null;
      let prevMacd9 = null;
      
      // 用來收集累積的 DIF 歷史，以便在第 9 筆時精準初始化 Signal 線的 SMA
      const difHistory = []; 

      // 開始逐日正序推進計算
      for (let j = 0; j < totalLen; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1);
        const subLen = subPool.length; // 當前歷史累積天數

        let calculatedDif = null;
        let calculatedMacdSignal = null;
        let calculatedMacdOsc = null;

        const currentPrice = targetDay.price;

        if (currentPrice !== null && currentPrice !== undefined) {
          // --- 1. 計算 EMA(12) ---
          if (subLen < 12) {
            // 歷史不足 12 天，維持 Null
          } else if (subLen === 12) {
            // 第 12 天：初始值使用前 12 天的收盤價簡單平均 (SMA)
            const sum12 = subPool.slice(0, 12).reduce((acc, curr) => acc + (curr.price || 0), 0);
            prevEma12 = sum12 / 12;
          } else {
            // 第 13 天起：套用標準 EMA 遞迴公式
            prevEma12 = (currentPrice * (2 / 13)) + (prevEma12 * (11 / 13));
          }

          // --- 2. 計算 EMA(26) ---
          if (subLen < 26) {
            // 歷史不足 26 天，維持 Null
          } else if (subLen === 26) {
            // 第 26 天：初始值使用前 26 天的收盤價簡單平均 (SMA)
            const sum26 = subPool.slice(0, 26).reduce((acc, curr) => acc + (curr.price || 0), 0);
            prevEma26 = sum26 / 26;
          } else {
            // 第 27 天起：套用標準 EMA 遞迴公式
            prevEma26 = (currentPrice * (2 / 27)) + (prevEma26 * (25 / 27));
          }

          // --- 3. 計算 DIF (快線) ---
          // 必須滿足 EMA12 與 EMA26 皆有值（即歷史第 26 天起）
          if (prevEma12 !== null && prevEma26 !== null) {
            calculatedDif = parseFloat((prevEma12 - prevEma26).toFixed(4));
            difHistory.push(calculatedDif); // 記錄快線歷史以供慢線計算

            // --- 4. 計算 Signal (慢線 / DEA) ---
            // 需要累積滿 9 個 DIF 值（即歷史第 26 + 8 = 34 天起）
            if (difHistory.length < 9) {
              // DIF 歷史不滿 9 天，維持 Null
            } else if (difHistory.length === 9) {
              // 第 9 筆 DIF 出現：初始值使用 9 筆 DIF 的簡單平均 (SMA)
              const sumDif9 = difHistory.reduce((acc, val) => acc + val, 0);
              prevMacd9 = sumDif9 / 9;
              calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
            } else {
              // 第 10 筆 DIF 起：套用標準 EMA(9) 遞迴公式
              prevMacd9 = (calculatedDif * (2 / 10)) + (prevMacd9 * (8 / 10));
              calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
            }

            // --- 5. 計算 OSC (柱狀體) ---
            if (calculatedMacdSignal !== null) {
              calculatedMacdOsc = parseFloat((calculatedDif - calculatedMacdSignal).toFixed(4));
            }
          }
        }

        // 僅打包需要更新的欄位物件，其餘如籌碼、開高低收等資料絕不動搖
        rowUpdates.push({
          stock_id: targetDay.stock_id,
          date: targetDay.date,
          macd_dif: calculatedDif,
          macd_signal: calculatedMacdSignal,
          macd_osc: calculatedMacdOsc
        });
      }

      // 安全且精準地批次寫回資料庫
      if (rowUpdates.length > 0) {
        const { error: writeErr } = await supabase
          .from('stock_chips_daily')
          .upsert(rowUpdates, { onConflict: 'stock_id,date' }); // 依據主鍵進行部分欄位覆蓋

        if (writeErr) {
          console.error(`❌ 寫回 ${stockId} MACD 指標時發生異常:`, writeErr.message);
        } else {
          console.log(`✨ [成功] ${stockId} 自 2026/01/02 至今的 MACD 歷史指標已校正填補完畢。`);
        }
      }

      // 每次迴圈微幅冷卻，確保資料庫連線品質
      await sleep(60);
    }

    console.log("🎉 恭喜！全數股票歷史 MACD 指標填補工程已圓滿安全完成！");
  } catch (error) {
    console.error("💥 全局補件程序發生嚴重致命錯誤:", error.message);
  }
}

runBackfill();
