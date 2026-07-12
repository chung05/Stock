// tool-patch-high-price-stocks.js
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 自動取得動態當天日期 (格式：YYYY-MM-DD)
function getTodayStr() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function run() {
  console.log("🔥 🚨 【全新高價股專用・精準歷史補件大程序】啟動...");

  // 🎯 1. 讀取母名單，同時拉出 sheet_tags 標籤進行精準審查
  const { data: targets, error: tErr } = await supabase
    .from('stock_targets')
    .select('stock_id, sheet_tags'); // 🌟 多撈取標籤欄位
    
  if (tErr) throw tErr;
  
  // 🎯 2. 精準黃金濾網：只留下真正需要「補齊全新資料」的個股
  const stockList = (targets || []).filter(item => {
    const tags = item.sheet_tags || [];
    
    // 條件 A：必須包含您的高價股標籤 (請與您資料庫填寫的字串完全一致)
    const hasHighPriceTag = tags.includes("High_100");
    
    // 條件 B：排除同時擁有舊分類(TW50, TW100, MSCI) 的已有資料個股
    const hasOldTags = tags.includes("TW50") || tags.includes("TW100") || tags.includes("MSCI");
    
    // 只有「包含高價股 100」且「不屬於任何舊有成分股」的股票，才是需要補資料的全新標的
    return hasHighPriceTag && !hasOldTags;
  });

  console.log(`📊 篩選完畢！已自動掠過複合標籤個股，共有: ${stockList.length} 檔全新高價股需要進行資料補齊。`);
  if (stockList.length === 0) {
    console.log("✅ 沒有符合條件的全新個股，程序安全結束。");
    return;
  }

  const commonHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const startDateStr = "2026-01-02";
  const endDateStr = getTodayStr(); // 動態自動取得當天日期
  console.log(`📅 資料歷史補件範圍設定：${startDateStr} 至 ${endDateStr}`);

  // 3. 逐檔進行完整性校驗與實體重建
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i].stock_id).trim();
    
    // 🛡️ 流量防護：每 3 檔就強制休息 15 秒，極速降低觸發 FinMind 空殼或頻率限制的機率
    if (i > 0 && i % 3 === 0) {
      console.log(`⏳ [安全防禦] 已處理 ${i} 檔，強制原地冷卻 15 秒...`);
      await sleep(15000);
    }

    console.log(`\n🔄 [補件進度 ${i + 1}/${stockList.length}] 正在專屬抓取重建個股: ${sId}`);

    try {
      // 宣告一個真理交易日對照表，只有通過價格審查的日子才能留存
      const tradingDayMap = {};

      // === (A) 核心關卡一：優先下載完整「價格」資料 ===
      let priceFetched = false;
      let priceRetries = 3;
      while (!priceFetched && priceRetries > 0) {
        try {
          const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
          const pRes = await axios.get(priceUrl, { headers: commonHeaders });
          
          if (pRes.data.status === 200 && Array.isArray(pRes.data.data) && pRes.data.data.length > 0) {
            pRes.data.data.forEach(pRow => {
              const d = pRow.date;
              
              // 🚫 【硬性判定】如果收盤價不存在、為 0 或是 NULL，代表當天台股休市！
              if (!pRow.close || pRow.close === null || pRow.close === 0) {
                return; // 徹底掠過，絕不在記憶體中建立這天的 Row 外殼
              }

              // 🌟 只有實打實有成交價的日子，才准許建立初始結構
              tradingDayMap[d] = { 
                stock_id: sId, date: d, 
                price: pRow.close, open: pRow.open || pRow.close, max: pRow.max || pRow.close, min: pRow.min || pRow.close, 
                trading_volume: pRow.Trading_Volume || 0, change_value: pRow.spread || 0,
                f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0 
              };
            });
            priceFetched = true;
          } else {
            console.log(`⚠️ 價格 API 回傳空殼 (Status: ${pRes.data.status})，15秒後重試...`);
            await sleep(15000);
            priceRetries--;
          }
        } catch (e) {
          console.log(`💥 價格連線異常，15秒後重試: ${e.message}`);
          await sleep(15000);
          priceRetries--;
        }
      }

      if (!priceFetched || Object.keys(tradingDayMap).length === 0) {
        console.error(`❌ [安全熔斷] 個股 ${sId} 無法取得任何開市價格，跳過此個股。`);
        continue;
      }

      await sleep(600); // 延長 API 間隔

      // === (B) 核心關卡二：下載完整籌碼，並與開市日強行對齊 ===
      let chipFetched = false;
      let chipRetries = 3;
      while (!chipFetched && chipRetries > 0) {
        try {
          const chipUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
          const cRes = await axios.get(chipUrl, { headers: commonHeaders });
          
          if (cRes.data.status === 200 && Array.isArray(cRes.data.data) && cRes.data.data.length > 0) {
            cRes.data.data.forEach(row => {
              const d = row.date;
              
              // 🚫 【硬性判定】如果這個籌碼日期在「開市真理表」裡找不到，表示當天台股放假！
              if (!tradingDayMap[d]) {
                return; // 直接扔掉休市日的籌碼髒資料
              }

              // 確定當天有開市，才填入法人籌碼
              if (row.name === 'Foreign_Investor') { tradingDayMap[d].f_buy = row.buy; tradingDayMap[d].f_sell = row.sell; }
              else if (row.name === 'Foreign_Dealer_Self') { tradingDayMap[d].fd_buy = row.buy; tradingDayMap[d].fd_sell = row.sell; }
              else if (row.name === 'Investment_Trust') { tradingDayMap[d].it_buy = row.buy; tradingDayMap[d].it_sell = row.sell; }
              else if (row.name === 'Dealer_self') { tradingDayMap[d].ds_buy = row.buy; tradingDayMap[d].ds_sell = row.sell; }
              else if (row.name === 'Dealer_Hedging') { tradingDayMap[d].dh_buy = row.buy; tradingDayMap[d].dh_sell = row.sell; }
            });
            chipFetched = true;
          } else {
            console.log(`⚠️ 籌碼 API 回傳空殼 (Status: ${cRes.data.status})，15秒後重試...`);
            await sleep(15000);
            chipRetries--;
          }
        } catch (e) {
          console.log(`💥 籌碼連線異常，15秒後重試: ${e.message}`);
          await sleep(15000);
          chipRetries--;
        }
      }

      if (!chipFetched) {
        console.error(`❌ [安全熔斷] 個股 ${sId} 無法取得歷史籌碼，跳過此個股。`);
        continue;
      }

      // === (C) 執行無損技術指標遞迴計算 ===
      let sortedDays = Object.values(tradingDayMap).sort((a, b) => a.date.localeCompare(b.date));
      if (sortedDays.length < 10) {
        console.warn(`⚠️ [驗證失敗] 個股 ${sId} 的實體開市天數嚴重不足，拒絕入庫。`);
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

        if (currentPrice && currentPrice > 0) {
          // MA 均線 (5, 10, 20)
          if (subLen >= 5) targetDay.ma5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) targetDay.ma10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) targetDay.ma20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));

          // RSI 14 (時間軸純淨連續，無休市斷代問題)
          if (j > 0 && sortedDays[j - 1].price > 0) {
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

      // === (D) 整批乾淨寫入大帳本 ===
      const { error: insertErr } = await supabase.from('stock_chips_daily').insert(sortedDays);
      if (insertErr) throw insertErr;
      console.log(`✨ [補件成功] 個股 ${sId} 歷史大帳本物理重建完畢。`);

    } catch (singleErr) {
      console.error(`❌ 重建個股 ${sId} 失敗:`, singleErr.message);
    }
    
    await sleep(600); // 延長間隔
  }

  console.log("\n🎉 【純淨全新高價股專用・歷史補件大工程】完美收官！");
}

run();
