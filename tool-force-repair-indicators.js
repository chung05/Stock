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

async function run() {
  console.log("🔥 🚨 【真・全量資料無損重建大工程】全面啟動...");

  // 1. 取得乾淨的 180 檔母名單
  const { data: targets, error: tErr } = await supabase.from('stock_targets').select('stock_id');
  if (tErr) throw tErr;
  const stockList = targets || [];
  console.log(`📊 雲端母名單讀取成功，共有: ${stockList.length} 檔主力股。`);

  const commonHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const startDateStr = "2026-01-02";
  const endDateStr = "2026-06-23"; 

  // 2. 逐檔進行物理清空與強制完整性下載
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i].stock_id).trim();
    
    // 🛡️ 升級版安全防火牆：每 4 檔就強制休息 15 秒，並拉長個股間隔，從根本杜絕 429 封鎖
    if (i > 0 && i % 4 === 0) {
      console.log(`⏳ [流量自我保護] 已處理 ${i} 檔，強制原地冷卻 15 秒...`);
      await sleep(15000);
    }

    console.log(`\n🔄 [進度 ${i + 1}/${stockList.length}] 正在全量重建個股: ${sId}`);

    try {
      const dateMap = {};

      // === (A) 下載完整籌碼 ===
      let chipFetched = false;
      let chipRetries = 3;
      while (!chipFetched && chipRetries > 0) {
        try {
          const chipUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
          const cRes = await axios.get(chipUrl, { headers: commonHeaders });
          
          if (cRes.data.status === 200 && Array.isArray(cRes.data.data)) {
            cRes.data.data.forEach(row => {
              const d = row.date;
              if (!dateMap[d]) {
                dateMap[d] = { 
                  stock_id: sId, date: d, price: null, open: 0, max: 0, min: 0, trading_volume: 0, change_value: 0,
                  f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0 
                };
              }
              if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
              else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
              else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
              else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
              else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
            });
            chipFetched = true;
          } else {
            console.log(`⚠️ 籌碼 API 回傳非預期狀態 (${cRes.data.status})，10秒後進行第 ${4 - chipRetries} 次重試...`);
            await sleep(10000);
            chipRetries--;
          }
        } catch (e) {
          console.log(`💥 籌碼連線異常，10秒後重試: ${e.message}`);
          await sleep(10000);
          chipRetries--;
        }
      }

      // 🚨 核心防禦：如果籌碼下載失敗，直接跳過本檔，絕不拿殘缺資料去覆蓋資料庫！
      if (!chipFetched) {
        console.error(`❌ [嚴重錯誤] 個股 ${sId} 籌碼歷史資料取得失敗，安全跳過，避免破壞結構。`);
        continue;
      }

      await sleep(600); // 延長 API 間隔，細水長流

      // === (B) 下載完整價格 ===
      let priceFetched = false;
      let priceRetries = 3;
      while (!priceFetched && priceRetries > 0) {
        try {
          const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
          const pRes = await axios.get(priceUrl, { headers: commonHeaders });
          
          if (pRes.data.status === 200 && Array.isArray(pRes.data.data)) {
            pRes.data.data.forEach(pRow => {
              const d = pRow.date;
              // 確保跟籌碼時間流同步
              if (!dateMap[d]) {
                dateMap[d] = { stock_id: sId, date: d, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0 };
              }
              dateMap[d].price = pRow.close;
              dateMap[d].open = pRow.open;
              dateMap[d].max = pRow.max;
              dateMap[d].min = pRow.min;
              dateMap[d].trading_volume = pRow.Trading_Volume;
              dateMap[d].change_value = pRow.spread || 0;
            });
            priceFetched = true;
          } else {
            console.log(`⚠️ 價格 API 回傳非預期狀態 (${pRes.data.status})，10秒後進行第 ${4 - priceRetries} 次重試...`);
            await sleep(10000);
            priceRetries--;
          }
        } catch (e) {
          console.log(`💥 價格連線異常，10秒後重試: ${e.message}`);
          await sleep(10000);
          priceRetries--;
        }
      }

      if (!priceFetched) {
        console.error(`❌ [嚴重錯誤] 個股 ${sId} 價格歷史資料取得失敗，安全跳過。`);
        continue;
      }

      // === (C) 物理清除舊帳本並精準計算寫入 ===
      let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
      // 確保至少同時擁有價格與籌碼，才允許進行物理抹除與重建
      if (sortedDays.length === 0 || !sortedDays[sortedDays.length - 1].price) {
        console.warn(`⚠️ 個股 ${sId} 驗證歷史天數嚴重不足，取消洗白程序。`);
        continue;
      }

      console.log(`🧹 [物理清空] 正在將資料庫中 ${sId} 舊歷史連根拔起...`);
      const { error: delErr } = await supabase
        .from('stock_chips_daily')
        .delete()
        .eq('stock_id', sId)
        .gte('date', startDateStr)
        .lte('date', endDateStr);
      if (delErr) throw delErr;

      // 技術指標精純計算核心
      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      let prevK = 50.0; let prevD = 50.0;
      let avgUp = 0, avgDown = 0;

      for (let j = 0; j < sortedDays.length; j++) {
        const targetDay = sortedDays[j];
        const subPool = sortedDays.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        if (currentPrice !== null && currentPrice !== undefined) {
          // MA 均線
          if (subLen >= 5) targetDay.ma5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) targetDay.ma10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) targetDay.ma20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));

          // RSI 14
          if (j > 0 && sortedDays[j - 1].price !== null) {
            const change = currentPrice - sortedDays[j - 1].price;
            const up = change > 0 ? change : 0;
            const down = change < 0 ? Math.abs(change) : 0;
            if (subLen <= 15) {
              avgUp += up; avgDown += down;
              if (subLen === 15) { avgUp /= 14; avgDown /= 14; targetDay.rsi14 = avgDown === 0 ? 100 : parseFloat((100 - (100 / (1 + avgUp / avgDown))).toFixed(2)); }
            } else {
              avgUp = (avgUp * 13 + up) / 14; avgDown = (avgDown * 13 + down) / 14;
              targetDay.rsi14 = avgDown === 0 ? 100 : parseFloat((100 - (100 / (1 + avgUp / avgDown))).toFixed(2));
            }
          }

          // KD 指標
          const lookback = Math.min(subLen, 9);
          const lastNDays = subPool.slice(-lookback);
          const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
          const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
          let rsv = highN - lowN !== 0 ? ((currentPrice - lowN) / (highN - lowN)) * 100 : 50;
          let currentK = (prevK * (2/3)) + (rsv * (1/3));
          let currentD = (prevD * (2/3)) + (currentK * (1/3));
          prevK = currentK; prevD = currentD;

          if (targetDay.date >= "2026-02-02") {
            targetDay.rsv = parseFloat(rsv.toFixed(2));
            targetDay.kd_k = parseFloat(currentK.toFixed(2));
            targetDay.kd_d = parseFloat(currentD.toFixed(2));
          }

          // MACD 指標
          if (subLen === 12) prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
          else if (subLen > 12) prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));
          if (subLen === 26) prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
          else if (subLen > 26) prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));

          if (prevEma12 !== null && prevEma26 !== null) {
            let dif = prevEma12 - prevEma26; difHistory.push(dif);
            if (difHistory.length === 9) prevMacd9 = difHistory.reduce((a,b)=>a+b,0)/9;
            else if (difHistory.length > 9) prevMacd9 = (dif * (2/10)) + (prevMacd9 * (8/10));
            targetDay.macd_dif = parseFloat(dif.toFixed(4));
            if (prevMacd9 !== null) {
              targetDay.macd_signal = parseFloat(prevMacd9.toFixed(4));
              targetDay.macd_osc = parseFloat((dif - prevMacd9).toFixed(4));
            }
          }
        }
      }

      // 5. 乾淨寫入新大帳本
      const { error: insertErr } = await supabase.from('stock_chips_daily').insert(sortedDays);
      if (insertErr) throw insertErr;
      console.log(`✨ [真・重建成功] 個股 ${sId} 全時段 28 欄位完美入庫。`);

    } catch (singleErr) {
      console.error(`❌ 重建個股 ${sId} 失敗，已自動跳過:`, singleErr.message);
    }
    
    await sleep(500); // 每次穩健停頓半秒鐘
  }

  console.log("\n🎉 【真・全量無損重建大工程】完美收官！");
}

run();
