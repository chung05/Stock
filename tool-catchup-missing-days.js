// tool-catchup-missing-days.js
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getLookbackDate(targetDateStr, daysBack = 45) {
  const d = new Date(targetDateStr);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split('T')[0];
}

// 🛡️ 封裝階梯式延遲重試請求函式：
// 第 1 次失敗延遲 5 秒重試，第 2 次失敗延遲 10 秒重試，遇 402/429 額度限制則自動長休 60 秒
async function fetchWithRetry(url, headers, maxRetries = 3) {
  const delaySchedule = [5000, 10000]; // 第1次失敗等5秒，第2次失敗等10秒

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(url, { headers, timeout: 15000 });
      return res;
    } catch (err) {
      const status = err.response ? err.response.status : null;
      
      // 如果已達最大重試次數，直接拋出錯誤
      if (attempt === maxRetries) {
        throw new Error(`[重試上限] HTTP ${status || 'TIMEOUT'} - ${err.message}`);
      }

      // 情況 A：遇 402/429 (API 頻率/額度限制) -> 自動長休 60 秒
      if (status === 402 || status === 429) {
        console.warn(`⏳ [觸發 API 頻率限制 HTTP ${status}] 等待 60 秒後進行第 ${attempt + 1}/${maxRetries} 次重試...`);
        await sleep(60000);
      } 
      // 情況 B：遇 502/500/503 伺服器異常、超時或一般網路錯誤 -> 依階梯延遲 (5秒 -> 10秒)
      else {
        const waitMs = delaySchedule[attempt - 1] || 10000;
        console.warn(`⚠️ [連線/伺服器異常 HTTP ${status || 'TIMEOUT'}] 延遲 ${waitMs / 1000} 秒後進行第 ${attempt + 1}/${maxRetries} 次重試... (${err.message})`);
        await sleep(waitMs);
      }
    }
  }
}

async function run() {
  // 🌟 =========================================================================
  // 🛠️ 【參數設定區】支援 GitHub Actions 介面輸入，亦可在此直接寫死執行
  // 🌟 =========================================================================
  
  // 1. 設定要修復或補齊的日期區間 (格式: YYYY-MM-DD)
  const targetStartDate = process.env.START_DATE || "2026-08-27"; 
  const targetEndDate   = process.env.END_DATE   || "2026-08-28";

  // 2. 設定個股模式：
  //    - 指定個股：字串陣列，例如 ["2330", "2337", "6669"]
  //    - 全量 231 檔：保持 null
  const envStocks = process.env.MANUAL_STOCKS ? process.env.MANUAL_STOCKS.split(',').map(s => s.trim()).filter(Boolean) : null;
  const MANUAL_STOCKS = envStocks || null; 

  // 3. 是否強制覆蓋既有資料（包含覆寫 0 值或錯誤指標）：
  //    - true:  強制全量重抓並覆寫資料庫 (解決 8/27~8/28 填入 0 的問題)
  //    - false: 僅檢查 Supabase，只補漏完全沒有資料列的股票 (節省 API)
  const FORCE_OVERWRITE = process.env.FORCE_OVERWRITE !== undefined 
    ? (process.env.FORCE_OVERWRITE === 'true' || process.env.FORCE_OVERWRITE === true)
    : true;

  // 🌟 =========================================================================

  const calcStartDate = getLookbackDate(targetStartDate, 45);
  let targetStockList = [];

  // 1. 篩選目標個股
  if (MANUAL_STOCKS && Array.isArray(MANUAL_STOCKS) && MANUAL_STOCKS.length > 0) {
    targetStockList = MANUAL_STOCKS.map(s => String(s).trim());
    console.log(`🎯 [指定個股模式] 鎖定個股 ${targetStockList.length} 檔: ${targetStockList.join(', ')}`);
  } else {
    const { data: targets, error: tErr } = await supabase.from('stock_targets').select('stock_id');
    if (tErr) {
      console.error("❌ 無法取得 stock_targets 名單:", tErr.message);
      return;
    }
    const allStockIds = (targets || []).map(t => String(t.stock_id).trim());

    if (FORCE_OVERWRITE) {
      targetStockList = allStockIds;
      console.log(`🔥 [強制覆蓋模式] 將對全量母名單 ${targetStockList.length} 檔重新計算並強制覆寫資料庫！`);
    } else {
      console.log(`🔍 [智能省流模式] 正在向 Supabase 檢查 ${targetStartDate} ~ ${targetEndDate} 期間缺漏狀況...`);
      const { data: existingRows, error: exErr } = await supabase
        .from('stock_chips_daily')
        .select('stock_id, date')
        .gte('date', targetStartDate)
        .lte('date', targetEndDate);

      if (exErr) {
        console.warn("⚠️ 預檢失敗，轉為全量直接執行:", exErr.message);
        targetStockList = allStockIds;
      } else {
        const countMap = {};
        (existingRows || []).forEach(r => { countMap[r.stock_id] = (countMap[r.stock_id] || 0) + 1; });
        targetStockList = allStockIds.filter(sId => (countMap[sId] || 0) < 2);
        console.log(`💡 [智能省流] 總計 ${allStockIds.length} 檔中，${allStockIds.length - targetStockList.length} 檔已存在跳過，僅需補漏 ${targetStockList.length} 檔。`);
      }
    }
  }

  if (targetStockList.length === 0) {
    console.log("🎉 目標區間資料均完整，無需呼叫 FinMind API！");
    return;
  }

  console.log(`📅 補漏目標區間: ${targetStartDate} 至 ${targetEndDate}`);
  console.log(`📐 指標回溯計算起點: ${calcStartDate}`);

  const commonHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  const token = process.env.FINMIND_TOKEN || '';
  
  const failureReports = [];
  let successCount = 0;

  // 2. 逐檔向 FinMind 抓取、計算並寫入 Supabase
  for (let i = 0; i < targetStockList.length; i++) {
    const sId = targetStockList[i];

    // 每 4 檔進行基礎冷卻
    if (i > 0 && i % 4 === 0) {
      console.log(`⏳ [防禦冷卻] 進度 ${i}/${targetStockList.length}，冷卻 10 秒...`);
      await sleep(10000);
    }

    try {
      // (A) 量價數據 (TaiwanStockPrice)
      const pUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${calcStartDate}&end_date=${targetEndDate}&token=${token}`;
      const pRes = await fetchWithRetry(pUrl, commonHeaders);

      if (!pRes.data.data || !Array.isArray(pRes.data.data) || pRes.data.data.length === 0) {
        console.warn(`⚠️ [量價缺失] 股票 ${sId} 在 FinMind 查無量價資料。`);
        failureReports.push({ stock_id: sId, reason: 'NO_PRICE_DATA', detail: 'TaiwanStockPrice 回傳空陣列' });
        continue;
      }

      const tradingDayMap = {};
      pRes.data.data.forEach(pRow => {
        // 排除休市日或無成交日
        if (!pRow.close || pRow.close === null || pRow.close === 0) return;
        const d = pRow.date;
        tradingDayMap[d] = {
          stock_id: sId, 
          date: d,
          price: pRow.close, 
          open: pRow.open || pRow.close, 
          max: pRow.max || pRow.close, 
          min: pRow.min || pRow.close,
          trading_volume: pRow.Trading_Volume !== undefined ? pRow.Trading_Volume : (pRow.trading_volume || 0),
          change_value: pRow.spread !== undefined ? pRow.spread : (pRow.change_value || 0),
          // 三大法人欄位
          f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
          // 融資融券欄位
          margin_buy: 0, margin_sell: 0, margin_balance: 0,
          short_buy: 0, short_sell: 0, short_balance: 0
        };
      });

      // (B) 三大法人買賣超 (TaiwanStockInstitutionalInvestorsBuySell)
      const cUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${calcStartDate}&end_date=${targetEndDate}&token=${token}`;
      const cRes = await fetchWithRetry(cUrl, commonHeaders);

      if (cRes.data.data && Array.isArray(cRes.data.data)) {
        cRes.data.data.forEach(row => {
          const d = row.date;
          if (!tradingDayMap[d]) return;
          const buyVal = Number(row.buy) || 0;
          const sellVal = Number(row.sell) || 0;
          const nameKey = String(row.name).trim();

          if (nameKey === 'Foreign_Investor') { tradingDayMap[d].f_buy = buyVal; tradingDayMap[d].f_sell = sellVal; }
          else if (nameKey === 'Foreign_Dealer_Self') { tradingDayMap[d].fd_buy = buyVal; tradingDayMap[d].fd_sell = sellVal; }
          else if (nameKey === 'Investment_Trust') { tradingDayMap[d].it_buy = buyVal; tradingDayMap[d].it_sell = sellVal; }
          else if (nameKey === 'Dealer_self') { tradingDayMap[d].ds_buy = buyVal; tradingDayMap[d].ds_sell = sellVal; }
          else if (nameKey === 'Dealer_Hedging') { tradingDayMap[d].dh_buy = buyVal; tradingDayMap[d].dh_sell = sellVal; }
        });
      }

      // (C) 融資融券明細 (TaiwanStockMarginPurchaseShortSale)
      const mUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${calcStartDate}&end_date=${targetEndDate}&token=${token}`;
      const mRes = await fetchWithRetry(mUrl, commonHeaders);

      if (mRes.data.data && Array.isArray(mRes.data.data)) {
        mRes.data.data.forEach(mRow => {
          const d = mRow.date;
          if (!tradingDayMap[d]) return;
          tradingDayMap[d].margin_buy = Number(mRow.MarginPurchaseBuy) || 0;
          tradingDayMap[d].margin_sell = Number(mRow.MarginPurchaseSell) || 0;
          tradingDayMap[d].margin_balance = Number(mRow.MarginPurchaseTodayBalance) || 0;
          tradingDayMap[d].short_buy = Number(mRow.ShortSaleBuy) || 0;
          tradingDayMap[d].short_sell = Number(mRow.ShortSaleSell) || 0;
          tradingDayMap[d].short_balance = Number(mRow.ShortSaleTodayBalance) || 0;
        });
      }

      // (D) 遞迴計算技術指標 (MA, RSI, KD, MACD)
      const sortedDays = Object.values(tradingDayMap).sort((a, b) => a.date.localeCompare(b.date));
      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      let prevK = 50.0; let prevD = 50.0;
      let avgUp = 0, avgDown = 0;

      for (let j = 0; j < sortedDays.length; j++) {
        const targetDay = sortedDays[j];
        const subPool = sortedDays.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        // MA 均線
        if (subLen >= 5) targetDay.ma5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
        if (subLen >= 10) targetDay.ma10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
        if (subLen >= 20) targetDay.ma20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));

        // RSI 14
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

        // KD 指標 (9日 RSV)
        const lookback = Math.min(subLen, 9);
        const lastNDays = subPool.slice(-lookback);
        const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
        const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
        let rsv = (highN - lowN !== 0 && !isNaN(highN) && !isNaN(lowN)) ? ((currentPrice - lowN) / (highN - lowN)) * 100 : 50;
        let currentK = (prevK * (2/3)) + (rsv * (1/3));
        let currentD = (prevD * (2/3)) + (currentK * (1/3));
        prevK = currentK; prevD = currentD;

        targetDay.rsv = parseFloat(rsv.toFixed(2));
        targetDay.kd_k = parseFloat(currentK.toFixed(2));
        targetDay.kd_d = parseFloat(currentD.toFixed(2));

        // MACD 指標 (EMA12, EMA26, DIF, MACD9, OSC)
        if (subLen === 12) prevEma12 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 12;
        else if (subLen > 12) prevEma12 = (currentPrice * (2/13)) + (prevEma12 * (11/13));
        if (subLen === 26) prevEma26 = subPool.reduce((a, b) => a + (b.price || 0), 0) / 26;
        else if (subLen > 26) prevEma26 = (currentPrice * (2/27)) + (prevEma26 * (25/27));

        if (prevEma12 !== null && prevEma26 !== null) {
          let dif = prevEma12 - prevEma26;
          difHistory.push(dif);
          if (difHistory.length === 9) prevMacd9 = difHistory.reduce((a, b) => a + b, 0) / 9;
          else if (difHistory.length > 9) prevMacd9 = (dif * (2/10)) + (prevMacd9 * (8/10));
          targetDay.macd_dif = parseFloat(dif.toFixed(4));
          if (prevMacd9 !== null) {
            targetDay.macd_signal = parseFloat(prevMacd9.toFixed(4));
            targetDay.macd_osc = parseFloat((dif - prevMacd9).toFixed(4));
          }
        }
      }

      // (E) 篩選目標區間並強制 Upsert 覆蓋
      const missingDaysRows = sortedDays.filter(d => d.date >= targetStartDate && d.date <= targetEndDate);

      if (missingDaysRows.length > 0) {
        const { error: upErr } = await supabase
          .from('stock_chips_daily')
          .upsert(missingDaysRows, { onConflict: 'stock_id,date' });

        if (upErr) {
          console.error(`❌ [${sId}] 寫入資料庫失敗:`, upErr.message);
          failureReports.push({ stock_id: sId, reason: 'SUPABASE_UPSERT_ERROR', detail: upErr.message });
        } else {
          console.log(`✅ [${i + 1}/${targetStockList.length}] ${sId} 成功覆蓋寫入 ${missingDaysRows.length} 天資料`);
          successCount++;
        }
      } else {
        console.log(`ℹ️ [${sId}] 目標區間內無有效交易資料。`);
      }

    } catch (singleErr) {
      console.error(`💥 [${sId}] 處理失敗:`, singleErr.message);
      failureReports.push({ stock_id: sId, reason: 'API_REQUEST_EXCEPTION', detail: singleErr.message });
    }

    await sleep(600); // 正常每檔請求間隔
  }

  // 3. 輸出執行成果與異常報告
  console.log(`\n🎯 ================= 執行結算 =================`);
  console.log(`✅ 成功修復/補齊: ${successCount} 檔`);
  console.log(`❌ 失敗/缺失個股: ${failureReports.length} 檔`);

  if (failureReports.length > 0) {
    const reportFileName = `failed_catchup_${targetStartDate}_${targetEndDate}.json`;
    fs.writeFileSync(reportFileName, JSON.stringify(failureReports, null, 2));
    console.log(`📁 失敗詳細報告已寫入本機: ${reportFileName}`);
    console.log(`👉 失敗代碼清單: ${failureReports.map(f => f.stock_id).join(',')}`);
  }
}

run();
