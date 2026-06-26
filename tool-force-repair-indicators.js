// tool-repair-target-stocks.js
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 輔助函式：格式化日期為 YYYY-MM-DD
function formatDateToString(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 輔助函式：切成 14 天一個短區間，用最安全、穩健的步伐向 FinMind 討歷史籌碼
function splitDateRangeIntoChunks(startStr, endStr, days = 14) {
  let chunks = [];
  let currentStart = new Date(startStr);
  let finalEnd = new Date(endStr);
  while (currentStart <= finalEnd) {
    let currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + (days - 1));
    if (currentEnd > finalEnd) currentEnd = new Date(finalEnd);
    chunks.push({
      start: currentStart.toISOString().split('T')[0],
      end: currentEnd.toISOString().split('T')[0]
    });
    currentStart.setDate(currentEnd.getDate() + 1);
  }
  return chunks;
}

async function run() {
  const targetStockIds = ["2301", "6446"]; 
  
  // 📅 🔥 動態核心機制：嚴格改為執行程式的那一天
  const todayObj = new Date();
  const startDateStr = "2026-01-02"; // 歷史起點保持不變
  const endDateStr = formatDateToString(todayObj); // 自動變更為執行當天 (例: 2026-06-26)

  console.log(`🎯 啟動【動態日期雙管分流重建程序】`);
  console.log(`📅 追蹤區間：${startDateStr} 至 當前執行日: ${endDateStr}`);

  const commonHeaders = {
    'accept': 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const finmindApiUrl = "https://api.finmindtrade.com/api/v4/data";
  const token = process.env.FINMIND_TOKEN || '';

  for (let i = 0; i < targetStockIds.length; i++) {
    const sId = targetStockIds[i];
    console.log(`\n========================================\n🚀 啟動動態重構個股: ${sId}`);

    try {
      const chipMemoryStore = {};   
      const priceMemoryStore = {};  

      // ==========================================================
      // 【第一次取得：獨立攻堅三大法人歷史籌碼大帳本】
      // ==========================================================
      const chipChunks = splitDateRangeIntoChunks(startDateStr, endDateStr, 14);
      console.log(`📥 [管線 1/2] 歷史籌碼啟動，拆分為 ${chipChunks.length} 個安全區間分批 POST 獲取...`);

      let totalChipsRowsFetched = 0;
      for (let chunk of chipChunks) {
        try {
          const cParams = new URLSearchParams({
            dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
            data_id: sId,
            start_date: chunk.start,
            end_date: chunk.end,
            token: token
          });

          const cRes = await axios.post(finmindApiUrl, cParams, { headers: commonHeaders });
          
          if (cRes.data.status === 200 && Array.isArray(cRes.data.data) && cRes.data.data.length > 0) {
            cRes.data.data.forEach(row => {
              const d = row.date;
              if (!chipMemoryStore[d]) {
                chipMemoryStore[d] = { f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0 };
              }
              if (row.name === 'Foreign_Investor') { chipMemoryStore[d].f_buy = row.buy || 0; chipMemoryStore[d].f_sell = row.sell || 0; totalChipsRowsFetched++; }
              else if (row.name === 'Foreign_Dealer_Self') { chipMemoryStore[d].fd_buy = row.buy || 0; chipMemoryStore[d].fd_sell = row.sell || 0; totalChipsRowsFetched++; }
              else if (row.name === 'Investment_Trust') { chipMemoryStore[d].it_buy = row.buy || 0; chipMemoryStore[d].it_sell = row.sell || 0; totalChipsRowsFetched++; }
              else if (row.name === 'Dealer_self') { chipMemoryStore[d].ds_buy = row.buy || 0; chipMemoryStore[d].ds_sell = row.sell || 0; totalChipsRowsFetched++; }
              else if (row.name === 'Dealer_Hedging') { chipMemoryStore[d].dh_buy = row.buy || 0; chipMemoryStore[d].dh_sell = row.sell || 0; totalChipsRowsFetched++; }
            });
          }
          await sleep(600); 
        } catch (chunkErr) {
          console.log(`⚠️ 籌碼切片 ${chunk.start} 下載跳過: ${chunkErr.message}`);
        }
      }
      console.log(`📊 [管線 1/2 完成] 成功擷取到 ${totalChipsRowsFetched} 筆法人籌碼明細數據。`);


      // ==========================================================
      // 【第二次取得：獨立拉取歷史 K 線價格、成交量與計算指標】
      // ==========================================================
      console.log(`📥 [管線 2/2] 啟動拉取動態區間 K 線全帳本...`);
      const pParams = new URLSearchParams({
        dataset: 'TaiwanStockPrice',
        data_id: sId,
        start_date: startDateStr,
        end_date: endDateStr,
        token: token
      });

      const pRes = await axios.post(finmindApiUrl, pParams, { headers: commonHeaders });
      
      if (pRes.data.status === 200 && Array.isArray(pRes.data.data) && pRes.data.data.length > 0) {
        pRes.data.data.forEach(pRow => {
          const d = pRow.date;
          if (!pRow.close || pRow.close === 0) return;

          const vol = pRow.Trading_Volume !== undefined ? pRow.Trading_Volume : (pRow.trading_volume || 0);
          const high = pRow.max !== undefined ? pRow.max : (pRow.Max !== undefined ? pRow.Max : pRow.close);
          const low = pRow.min !== undefined ? pRow.min : (pRow.Min !== undefined ? pRow.Min : pRow.close);
          const openPrice = pRow.open !== undefined ? pRow.open : pRow.close;
          const spreadVal = pRow.spread !== undefined ? pRow.spread : (pRow.change_value || 0);

          priceMemoryStore[d] = {
            stock_id: sId, date: d,
            price: pRow.close, open: openPrice, max: high, min: low,
            trading_volume: vol, change_value: spreadVal
          };
        });
      }

      let sortedPriceDays = Object.values(priceMemoryStore).sort((a, b) => a.date.localeCompare(b.date));
      if (sortedPriceDays.length === 0) {
        console.error(`❌ [管線 2/2 失敗] 找不到個股 ${sId} 的價格資料，跳過。`);
        continue;
      }
      console.log(`📈 [管線 2/2 完成] 歷史量價下載完畢，共計 ${sortedPriceDays.length} 個交易日。`);


      // ==========================================================
      // 【第三階段：記憶體交叉匯流融合 ＆ 精密遞迴計算技術指標】
      // ==========================================================
      console.log(`⚙️  [階段 3] 啟動記憶體交叉融合，清空並重新對齊 28 欄位...`);
      
      // 動態清洗 Supabase 到執行當天為止的舊殘留，完美防重複
      await supabase.from('stock_chips_daily').delete().eq('stock_id', sId).gte('date', startDateStr).lte('date', endDateStr);

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = []; let prevK = 50.0; let prevD = 50.0; let avgUp = 0, avgDown = 0;
      
      const finalRowUpdates = [];

      for (let j = 0; j < sortedPriceDays.length; j++) {
        const targetDay = sortedPriceDays[j];
        const subPool = sortedPriceDays.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;
        const d = targetDay.date;

        const cData = chipMemoryStore[d] || { f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0 };

        let calculatedMA5 = null; let calculatedMA10 = null; let calculatedMA20 = null;
        let calculatedRSI14 = null; let calculatedRSV = null; let calculatedK = null; let calculatedD = null;
        let calculatedDif = null; let calculatedMacdSignal = null; let calculatedMacdOsc = null;

        if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
        if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
        if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));

        if (j > 0 && sortedPriceDays[j - 1].price > 0) {
          const change = currentPrice - sortedPriceDays[j - 1].price;
          const up = change > 0 ? change : 0; const down = change < 0 ? Math.abs(change) : 0;
          if (subLen <= 15) {
            avgUp += up; avgDown += down;
            if (subLen === 15) { avgUp /= 14; avgDown /= 14; calculatedRSI14 = avgDown === 0 ? 100 : parseFloat((100 - (100 / (1 + avgUp / avgDown))).toFixed(2)); }
          } else {
            avgUp = (avgUp * 13 + up) / 14; avgDown = (avgDown * 13 + down) / 14;
            calculatedRSI14 = avgDown === 0 ? 100 : parseFloat((100 - (100 / (1 + avgUp / avgDown))).toFixed(2));
          }
        }

        const lookback = Math.min(subLen, 9);
        const lastNDays = subPool.slice(-lookback);
        const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
        const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
        let rsv = (highN - lowN !== 0 && !isNaN(highN) && !isNaN(lowN)) ? ((currentPrice - lowN) / (highN - lowN)) * 100 : 50;
        
        let currentK = (prevK * (2/3)) + (rsv * (1/3)); 
        let currentD = (prevD * (2/3)) + (currentK * (1/3));
        prevK = currentK; prevD = currentD;

        if (targetDay.date >= "2026-02-02") {
          calculatedRSV = parseFloat(rsv.toFixed(2)); calculatedK = parseFloat(currentK.toFixed(2)); calculatedD = parseFloat(currentD.toFixed(2));
        }

        if (subLen === 12) prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
        else if (subLen > 12) prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));
        if (subLen === 26) prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
        else if (subLen > 26) prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));

        if (prevEma12 !== null && prevEma26 !== null) {
          let dif = prevEma12 - prevEma26; difHistory.push(dif);
          if (difHistory.length === 9) prevMacd9 = difHistory.reduce((a,b)=>a+b,0)/9;
          else if (difHistory.length > 9) prevMacd9 = (dif * (2/10)) + (prevMacd9 * (8/10));
          calculatedDif = parseFloat(dif.toFixed(4));
          if (prevMacd9 !== null) {
            calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4)); calculatedMacdOsc = parseFloat((dif - prevMacd9).toFixed(4));
          }
        }

        finalRowUpdates.push({
          stock_id: sId,
          date: d,
          price: targetDay.price, open: targetDay.open, max: targetDay.max, min: targetDay.min,
          trading_volume: targetDay.trading_volume, change_value: targetDay.change_value,
          f_buy: cData.f_buy, f_sell: cData.f_sell, fd_buy: cData.fd_buy, fd_sell: cData.fd_sell,
          it_buy: cData.it_buy, it_sell: cData.it_sell, ds_buy: cData.ds_buy, ds_sell: cData.ds_sell,
          dh_buy: cData.dh_buy, dh_sell: cData.dh_sell,
          ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: calculatedRSI14,
          rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
          macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
        });
      }

      // ==========================================================
      // 【第四階段：整批寫入 Supabase 資料庫】
      // ==========================================================
      const { error: insErr } = await supabase.from('stock_chips_daily').insert(finalRowUpdates);
      if (insErr) throw insErr;
      console.log(`✨ [動態分流大修復成功] 個股 ${sId} 到今日為止的歷史紀錄已完美還原入庫！`);

    } catch (err) {
      console.error(`❌ 補件個股 ${sId} 遭遇核心層級錯誤:`, err.message);
    }
    await sleep(2000); 
  }
  console.log("🎉 特定個股自動化動態歷史重構全數結束！");
}
run();
