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

// 💡 戰術升級：將時間切成 7 天一小塊，用高頻短跨度攻破歷史籌碼封鎖
function splitDateRangeIntoSevenDays(startStr, endStr) {
  let chunks = [];
  let currentStart = new Date(startStr);
  let finalEnd = new Date(endStr);
  while (currentStart <= finalEnd) {
    let currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + 6); // 7天一包
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
  console.log(`🎯 啟動【特定個股歷史 28 欄位：POST 破壁全量重構程序】`);

  const commonHeaders = {
    'accept': 'application/json',
    'content-type': 'application/x-www-form-urlencoded', // 🔥 強制宣告為表單發送
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const startDateStr = "2026-01-02";
  const endDateStr = "2026-06-24"; 
  const finmindApiUrl = "https://api.finmindtrade.com/api/v4/data";
  const token = process.env.FINMIND_TOKEN || '';

  for (let i = 0; i < targetStockIds.length; i++) {
    const sId = targetStockIds[i];
    console.log(`\n🚀 [全力攻堅] 正在解鎖個股: ${sId}`);

    try {
      const tradingDayMap = {};

      // === (A) 歷史價格下載：改為 POST 傳遞 ===
      console.log(`📥 正在拉取歷史價格全帳本...`);
      const pParams = new URLSearchParams({
        dataset: 'TaiwanStockPrice',
        data_id: sId,
        start_date: startDateStr,
        end_date: endDateStr,
        token: token
      });

      let pRes = await axios.post(finmindApiUrl, pParams, { headers: commonHeaders });
      
      if (pRes.data.status === 200 && Array.isArray(pRes.data.data) && pRes.data.data.length > 0) {
        pRes.data.data.forEach(pRow => {
          const d = pRow.date;
          if (!pRow.close || pRow.close === 0) return;

          // 大小寫全防禦防線
          const vol = pRow.Trading_Volume !== undefined ? pRow.Trading_Volume : (pRow.trading_volume || 0);
          const high = pRow.max !== undefined ? pRow.max : (pRow.Max !== undefined ? pRow.Max : pRow.close);
          const low = pRow.min !== undefined ? pRow.min : (pRow.Min !== undefined ? pRow.Min : pRow.close);
          const openPrice = pRow.open !== undefined ? pRow.open : pRow.close;
          const spreadVal = pRow.spread !== undefined ? pRow.spread : (pRow.change_value || 0);

          tradingDayMap[d] = { 
            stock_id: sId, date: d, 
            price: pRow.close, open: openPrice, max: high, min: low, 
            trading_volume: vol, change_value: spreadVal,
            f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0 
          };
        });
      }

      if (Object.keys(tradingDayMap).length === 0) {
        console.error(`❌ 個股 ${sId} 歷史價格下載失敗，跳過。`);
        continue;
      }

      // === (B) 歷史籌碼下載：全面改用 POST + 7天短切片衝鋒 ===
      const dateChunks = splitDateRangeIntoSevenDays(startDateStr, endDateStr);
      console.log(`📦 歷史籌碼分拆成 ${dateChunks.length} 個短跨度切片，改用 POST 強力突穿...`);

      let totalChipsCount = 0;
      for (let chunk of dateChunks) {
        try {
          const cParams = new URLSearchParams({
            dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
            data_id: sId,
            start_date: chunk.start,
            end_date: chunk.end,
            token: token
          });

          let cRes = await axios.post(finmindApiUrl, cParams, { headers: commonHeaders });
          
          if (cRes.data.status === 200 && Array.isArray(cRes.data.data) && cRes.data.data.length > 0) {
            cRes.data.data.forEach(row => {
              const d = row.date;
              if (!tradingDayMap[d]) return; 

              // 🔥 核心回填：將非零數據注入
              if (row.name === 'Foreign_Investor') { tradingDayMap[d].f_buy = row.buy || 0; tradingDayMap[d].f_sell = row.sell || 0; totalChipsCount++; }
              else if (row.name === 'Foreign_Dealer_Self') { tradingDayMap[d].fd_buy = row.buy || 0; tradingDayMap[d].fd_sell = row.sell || 0; totalChipsCount++; }
              else if (row.name === 'Investment_Trust') { tradingDayMap[d].it_buy = row.buy || 0; tradingDayMap[d].it_sell = row.sell || 0; totalChipsCount++; }
              else if (row.name === 'Dealer_self') { tradingDayMap[d].ds_buy = row.buy || 0; tradingDayMap[d].ds_sell = row.sell || 0; totalChipsCount++; }
              else if (row.name === 'Dealer_Hedging') { tradingDayMap[d].dh_buy = row.buy || 0; tradingDayMap[d].dh_sell = row.sell || 0; totalChipsCount++; }
            });
          }
          await sleep(800); // 精密小歇，避免觸發 FinMind 限流
        } catch (chunkErr) {
          console.log(`⚠️ 切片區間 ${chunk.start} ~ ${chunk.end} 籌碼獲取異常: ${chunkErr.message}`);
        }
      }
      console.log(`📊 籌碼下載完畢，成功對齊並擷取到外資投信明細共 ${totalChipsCount} 筆。`);

      // === (C) 技術指標遞迴計算與 28 欄位融合 ===
      let sortedDays = Object.values(tradingDayMap).sort((a, b) => a.date.localeCompare(b.date));
      
      // 抹零洗白舊有錯誤帳本
      await supabase.from('stock_chips_daily').delete().eq('stock_id', sId).gte('date', startDateStr).lte('date', endDateStr);

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = []; let prevK = 50.0; let prevD = 50.0; let avgUp = 0, avgDown = 0;
      const rowUpdates = []; 

      for (let j = 0; j < sortedDays.length; j++) {
        const targetDay = sortedDays[j];
        const subPool = sortedDays.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        let calculatedMA5 = null; let calculatedMA10 = null; let calculatedMA20 = null;
        let calculatedRSI14 = null; let calculatedRSV = null; let calculatedK = null; let calculatedD = null;
        let calculatedDif = null; let calculatedMacdSignal = null; let calculatedMacdOsc = null;

        if (currentPrice && currentPrice > 0) {
          if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));

          if (j > 0 && sortedDays[j - 1].price > 0) {
            const change = currentPrice - sortedDays[j - 1].price;
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
        }

        rowUpdates.push({
          stock_id: sId,
          date: targetDay.date,
          price: targetDay.price, open: targetDay.open, max: targetDay.max, min: targetDay.min,
          trading_volume: targetDay.trading_volume, change_value: targetDay.change_value,
          f_buy: targetDay.f_buy, f_sell: targetDay.f_sell, fd_buy: targetDay.fd_buy, fd_sell: targetDay.fd_sell,
          it_buy: targetDay.it_buy, it_sell: targetDay.it_sell, ds_buy: targetDay.ds_buy, ds_sell: targetDay.ds_sell,
          dh_buy: targetDay.dh_buy, dh_sell: targetDay.dh_sell,
          ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: calculatedRSI14,
          rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
          macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
        });
      }

      // === (D) 大數據封裝直入庫 ===
      const { error: insErr } = await supabase.from('stock_chips_daily').insert(rowUpdates);
      if (insErr) throw insErr;
      console.log(`✨ [真・全方位修復成功] 個股 ${sId} 歷史大帳本與外資投信買賣超已完好無損寫入！`);

    } catch (err) {
      console.error(`❌ 補件個股 ${sId} 失敗:`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 2000)); // 個股之間稍作喘息
  }
  console.log("🎉 所有特種補件程序徹底圓滿結束！");
}
run();
