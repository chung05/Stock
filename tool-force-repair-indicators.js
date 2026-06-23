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
  console.log("🔥 🚨 【真・全量大洗白】全面啟動！正在將 180 檔主力股大帳本物理重建...");

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
  const endDateStr = "2026-06-23"; // 包含到今天最新

  // 2. 逐檔進行「物理抹除」與「完全重建」
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i].stock_id).trim();
    
    // 🛡️ 最嚴格的流量防火牆：每 5 檔就強制休息 15 秒，極致安全
    if (i > 0 && i % 5 === 0) {
      console.log(`⏳ 安全冷卻：已處理 ${i} 檔，強制休眠 15 秒，確保 FinMind API 絕對順暢...`);
      await sleep(15000);
    }

    console.log(`🧹 [1/2 物理清空] 正在抹除個股歷史資料: ${sId}`);
    try {
      // 💡 貫徹「重建」精神：先把這檔股票在該區間的舊資料在資料庫「連根拔起」刪除！
      const { error: delErr } = await supabase
        .from('stock_chips_daily')
        .delete()
        .eq('stock_id', sId)
        .gte('date', startDateStr)
        .lte('date', endDateStr);
        
      if (delErr) throw delErr;
    } catch (dErr) {
      console.error(`⚠️ 抹除 ${sId} 失敗:`, dErr.message);
    }

    console.log(`📥 [2/2 實體重建] 正在從 FinMind 重新下載並運算指標: ${sId}`);

    try {
      const dateMap = {};

      // (A) 下載完整籌碼
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
          } else if (cRes.data.status === 429) {
            console.log("🚨 觸發流量牆 (429)，集體休眠 30 秒...");
            await sleep(30000);
            chipRetries--;
          } else {
            chipRetries--;
          }
        } catch (e) {
          chipRetries--;
          await sleep(2000);
        }
      }

      await sleep(400); // API 之間的安全停頓

      // (B) 下載完整價格
      let priceFetched = false;
      let priceRetries = 3;
      while (!priceFetched && priceRetries > 0) {
        try {
          const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
          const pRes = await axios.get(priceUrl, { headers: commonHeaders });
          
          if (pRes.data.status === 200 && Array.isArray(pRes.data.data)) {
            pRes.data.data.forEach(pRow => {
              const d = pRow.date;
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
          } else if (pRes.data.status === 429) {
            console.log("🚨 觸發流量牆 (429)，集體休眠 30 秒...");
            await sleep(30000);
            priceRetries--;
          } else {
            priceRetries--;
          }
        } catch (e) {
          priceRetries--;
          await sleep(2000);
        }
      }

      // 3. 技術指標純淨計算
      let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
      if (sortedDays.length === 0) {
        console.warn(`⚠️ 個股 ${sId} 歷史資料重建為空，跳過。`);
        continue;
      }

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

      // 4. 乾淨寫入（因為舊資料已被刪除，這裡會寫入最完美的 28 欄位）
      const { error: insertErr } = await supabase.from('stock_chips_daily').insert(sortedDays);
      if (insertErr) throw insertErr;
      console.log(`✨ [重建成功] 個股 ${sId} 已完美洗白。`);

    } catch (singleErr) {
      console.error(`❌ 重建個股 ${sId} 失敗:`, singleErr.message);
    }
    
    await sleep(400);
  }

  console.log("🎉 【真・全量物理洗白大工程】完美收官！");
}

run();
