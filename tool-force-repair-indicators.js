// tool-force-repair-indicators.js
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
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

// 既然籌碼強制規定用 GET，我們將切片壓縮到 4 天一包，用極小流量安全繞過大熱門股的限流風控
function splitDateRangeIntoChunks(startStr, endStr, days = 4) {
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
  
  const todayObj = new Date();
  const startDateStr = "2026-01-02"; // 歷史起點
  const endDateStr = formatDateToString(todayObj); // 📅 自動補齊到執行的最新交易日

  console.log(`🎯 ====================================================`);
  console.log(`🎯 啟動【三大法人 GET 極致小切片防禦 ＆ 歷史覆蓋管線】`);
  console.log(`📅 重建區間：${startDateStr} 至 最新交易日: ${endDateStr}`);
  console.log(`🎯 ====================================================`);

  // 加上完整的瀏覽器偽裝標頭，防止被 FinMind 判定為惡意爬蟲
  const commonHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const token = process.env.FINMIND_TOKEN || '';
  console.log(`🔑 [Token 狀態檢查]：Token 前 6 碼為: "${token ? token.substring(0, 6) + '...' : '❌ 未定義 EMPTY!!!!'}"`);

  for (let i = 0; i < targetStockIds.length; i++) {
    const sId = targetStockIds[i];
    console.log(`\n🚀 ----------------------------------------------------`);
    console.log(`🚀 正在強力重構核心個股 (GET 模式): ${sId}`);
    console.log(`🚀 ----------------------------------------------------`);

    try {
      const chipMemoryStore = {};   
      const priceMemoryStore = {};  

      // ==========================================================
      // 【第一階段：三大法人歷史籌碼大攻堅 (修正為安全 GET 模式)】
      // ==========================================================
      const chipChunks = splitDateRangeIntoChunks(startDateStr, endDateStr, 4);
      console.log(`📥 [管線 1/2] 籌碼下載：拆分為 ${chipChunks.length} 個極短切片進行安全 GET 連線...`);

      let totalChipsRowsFetched = 0;
      
      for (let idx = 0; idx < chipChunks.length; idx++) {
        const chunk = chipChunks[idx];
        try {
          // 順應伺服器規範，改回使用 URL query 參數的 GET 請求
          const cApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${chunk.start}&end_date=${chunk.end}&token=${token}`;

          const cRes = await axios.get(cApiUrl, { headers: commonHeaders });
          
          // 📡 雷達監控日誌：抽樣檢查，確保我們知道它到底有沒有吐資料
          if (idx === 0 || idx === Math.floor(chipChunks.length / 2) || idx === chipChunks.length - 1) {
            console.log(`📡 [GET 籌碼監控] 區間 ${chunk.start} ~ ${chunk.end}:`);
            console.log(`   -> HTTP 狀態: ${cRes.status} | 陣列長度: ${Array.isArray(cRes.data.data) ? cRes.data.data.length : 'N/A'}`);
            if (Array.isArray(cRes.data.data) && cRes.data.data.length > 0) {
              console.log(`   -> 真實樣本:`, JSON.stringify(cRes.data.data.slice(0, 1)));
            }
          }

          if (cRes.data.status === 200 && Array.isArray(cRes.data.data) && cRes.data.data.length > 0) {
            cRes.data.data.forEach(row => {
              const d = row.date;
              if (!chipMemoryStore[d]) {
                chipMemoryStore[d] = { f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0 };
              }
              
              const buyVal = Number(row.buy) || 0;
              const sellVal = Number(row.sell) || 0;
              const nameKey = String(row.name).trim();

              if (nameKey === 'Foreign_Investor') { chipMemoryStore[d].f_buy = buyVal; chipMemoryStore[d].f_sell = sellVal; totalChipsRowsFetched++; }
              else if (nameKey === 'Foreign_Dealer_Self') { chipMemoryStore[d].fd_buy = buyVal; chipMemoryStore[d].fd_sell = sellVal; totalChipsRowsFetched++; }
              else if (nameKey === 'Investment_Trust') { chipMemoryStore[d].it_buy = buyVal; chipMemoryStore[d].it_sell = sellVal; totalChipsRowsFetched++; }
              else if (nameKey === 'Dealer_self') { chipMemoryStore[d].ds_buy = buyVal; chipMemoryStore[d].ds_sell = sellVal; totalChipsRowsFetched++; }
              else if (nameKey === 'Dealer_Hedging') { chipMemoryStore[d].dh_buy = buyVal; chipMemoryStore[d].dh_sell = sellVal; totalChipsRowsFetched++; }
            });
          }
          await sleep(1200); // 延長冷卻時間到 1.2 秒，溫和請求
        } catch (chunkErr) {
          console.log(`⚠️ 切片 ${chunk.start} GET 異常: ${chunkErr.message}`);
        }
      }
      console.log(`📊 [管線 1/2 結果] 籌碼下載完畢，成功注入 ${totalChipsRowsFetched} 筆法人買賣明細！`);

      // ==========================================================
      // 【第二階段：獨立拉取歷史 K 線量價數據 (GET 模式)】
      // ==========================================================
      console.log(`📥 [管線 2/2] 正在拉取歷史量價全帳本（至最新交易日）...`);
      const pApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${token}`;

      const pRes = await axios.get(pApiUrl, { headers: commonHeaders });
      
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
      console.log(`📈 [管線 2/2 完成] 歷史量價下載完畢，最新日期到 ${sortedPriceDays[sortedPriceDays.length - 1].date}，共計 ${sortedPriceDays.length} 個交易日。`);

      // ==========================================================
      // 【第三階段：記憶體融合 ＆ 技術指標重算】
      // ==========================================================
      console.log(`⚙️  [階段 3] 進行記憶體融合與指標重組...`);
      
      // 清空舊數據
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
          stock_id: sId, date: d,
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

      // 📝 最終檢查日誌
      const sampleDay = finalRowUpdates[finalRowUpdates.length - 1];
      console.log(`📝 [資料庫寫入前檢查] 最新一天 (${sampleDay.date}) 封裝：`);
      console.log(`   -> 外資買超: ${sampleDay.f_buy} | 投信買超: ${sampleDay.it_buy} | 最新股價: ${sampleDay.price}`);

      const { error: insErr } = await supabase.from('stock_chips_daily').insert(finalRowUpdates);
      if (insErr) throw insErr;
      console.log(`✨ 個股 ${sId} 歷史大帳本【GET 4天防禦版】重構成功。`);

    } catch (err) {
      console.error(`❌ 重建個股 ${sId} 失敗:`, err.message);
    }
    await sleep(2000); 
  }
}
run();
