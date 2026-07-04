// backend-sync-v2.js
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

async function run() {
  try {
    console.log("🚀 啟動【主力成分股 v2 - 核心去重三大 API + 28欄位核心指標大腦】終極同步程序...");

    // 1. 直接從唯一真理母名單 stock_targets 讀取股票並進行嚴格去重
    console.log("📥 正在從雲端 stock_targets 表載入核心主力成分股名單...");
    const { data: targetsData, error: targetError } = await supabase
      .from('stock_targets')
      .select('stock_id');
          
    if (targetError) throw targetError;
    
    const rawStockIds = (targetsData || []).map(item => String(item.stock_id).trim()).filter(id => id && id !== 'undefined' && id !== 'null');
    const stockIds = [...new Set(rawStockIds)];
    console.log(`📊 成功獲取核心去重名單總計: ${stockIds.length} 檔。`);

    if (stockIds.length === 0) return;

    // 2. 自動尋找大帳本當前的最晚日期，自適應推導增量時間區間
    const { data: lastRecord, error: dateErr } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
      
    if (dateErr) console.log("⚠️ 偵測大帳本最大日期異常:", dateErr.message);

    let startDate = new Date('2026-01-02');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      const lastDate = new Date(lastRecord[0].date);
      lastDate.setDate(lastDate.getDate() + 1);
      startDate = lastDate;
    }
    
    // 3. 🛡️ 【下午16:00盤後防護機制】
    const now = new Date();
    const taipeiHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: '2-digit', hour12: false }), 10);
    let endDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    
    if (taipeiHour < 16) {
      console.log("🕒 當前時間未滿台灣下午 16:00，今日盤後籌碼尚未 Ready。安全機制啟動：同步終點限制在【昨天】。");
      endDate.setDate(endDate.getDate() - 1);
    } else {
      console.log("🕒 當前時間已過台灣下午 16:00，今日盤後數據已 Ready。同步終點允許至【今天】。");
    }

    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(endDate);
    
    if (startDate > endDate) {
      console.log(`💡 檢查完畢：大帳本已是最新狀態（已同步至 ${formatDateToString(endDate)}）。今日新資料尚未 Ready，暫不更新。`);
      return;
    }

    console.log(`📅 大帳本實質增量抓取區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // 4. 逐檔增量同步核心（三大 API 深度融合，包含籌碼、股價、融資券）
    if (startDate <= endDate) {
      for (let i = 0; i < stockIds.length; i++) {
        const sId = stockIds[i];
        
        // 頻率控制：每 12 檔休息 10 秒，完美保護 API 配額
        if (i > 0 && i % 12 === 0) {
          console.log(`⏳ 已同步 ${i} 檔，保護 API 流量強制休息 10 秒...`);
          await sleep(10000);
        }

        console.log(`[全量下載大數據] (${i + 1}/${stockIds.length}) 標的: ${sId}`);

        try {
          const dateMap = {};

          // (A) 下載三大法人籌碼
          const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const res = await axios.get(apiUrl, { headers: commonHeaders, timeout: 15000 });
          
          if (res.data.status === 200 && Array.isArray(res.data.data)) {
            res.data.data.forEach(row => {
              const d = row.date;
              if (!dateMap[d]) {
                dateMap[d] = { 
                  stock_id: sId, date: d, price: null, change_value: 0, 
                  f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
                  margin_buy: 0, margin_sell: 0, margin_balance: 0, short_buy: 0, short_sell: 0, short_balance: 0,
                  open: 0, max: 0, min: 0, trading_volume: 0
                };
              }
              if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
              else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
              else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
              else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
              else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
            });
          }

          // (B) 下載收盤K線價量
          const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders, timeout: 15000 });
          
          if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
            priceRes.data.data.forEach(pRow => {
              const d = pRow.date;
              if (!dateMap[d]) {
                dateMap[d] = { 
                  stock_id: sId, date: d, price: null, change_value: 0, 
                  f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
                  margin_buy: 0, margin_sell: 0, margin_balance: 0, short_buy: 0, short_sell: 0, short_balance: 0,
                  open: 0, max: 0, min: 0, trading_volume: 0
                };
              }
              dateMap[d].price = pRow.close;
              dateMap[d].open = pRow.open;
              dateMap[d].max = pRow.max;
              dateMap[d].min = pRow.min;
              dateMap[d].trading_volume = pRow.Trading_Volume;
              dateMap[d].change_value = pRow.spread || 0;
            });
          }

          // (C) 🌟 完美補齊：整合 tool-patch-margin-data.js 的融資券接口，一次撈回資券明細！
          const marginApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const marginRes = await axios.get(marginApiUrl, { headers: commonHeaders, timeout: 15000 });
          
          if (marginRes.data.status === 200 && Array.isArray(marginRes.data.data)) {
            marginRes.data.data.forEach(mRow => {
              const d = mRow.date;
              if (dateMap[d]) {
                dateMap[d].margin_buy = mRow.MarginPurchaseBuy || 0;
                dateMap[d].margin_sell = mRow.MarginPurchaseSell || 0;
                dateMap[d].margin_balance = mRow.MarginPurchaseTodayBalance || 0;
                dateMap[d].short_buy = mRow.ShortSaleBuy || 0;
                dateMap[d].short_sell = mRow.ShortSaleSell || 0;
                dateMap[d].short_balance = mRow.ShortSaleTodayBalance || 0;
              }
            });
          }

          const rowsToUpsert = Object.values(dateMap);
          if (rowsToUpsert.length > 0) {
            const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert, { onConflict: 'stock_id,date' });
            if (upsertErr) throw upsertErr;
          }

        } catch (err) {
          console.error(`❌ 下載 ${sId} 發生異常: ${err.message}`);
        }
        await sleep(150);
      }
    }

    // 5. 啟動全歷史 28 欄位技術指標遞迴重算大腦，計算 MA5, MA20, RSI, MACD
    console.log("💡 [第二步] 啟動全歷史 28 欄位技術指標遞迴重算大腦...");
    await calculateAndWriteBackIndicators(stockIds);

    console.log("🎉 所有增量同步與技術指標計算流程全數完成！");
  } catch (error) {
    console.error("💥 全局同步流程發生嚴重致命錯誤:", error.message);
    process.exit(1);
  }
}

async function calculateAndWriteBackIndicators(stockList) {
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i]).trim();

    try {
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('*')
        .eq('stock_id', sId)
        .order('date', { ascending: true });

      if (fetchErr || !pricePool || pricePool.length === 0) continue;

      const totalLen = pricePool.length;
      const rowUpdates = [];

      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      let prevK = 50.0; let prevD = 50.0;

      for (let j = 0; j < totalLen; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        let calculatedMA5 = null, calculatedMA10 = null, calculatedMA20 = null;
        let calculatedRSI14 = null;
        let calculatedRSV = null, calculatedK = null, calculatedD = null;
        let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

        if (currentPrice !== null && currentPrice !== undefined) {
          if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((acc, c) => acc + (c.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((acc, c) => acc + (c.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((acc, c) => acc + (c.price || 0), 0) / 20).toFixed(2));

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

          const lookbackPeriod = Math.min(subLen, 9);
          const lastNDays = subPool.slice(-lookbackPeriod);
          const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
          const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
          
          let rsv = 50.0;
          if (highN - lowN !== 0) {
            rsv = ((currentPrice - lowN) / (highN - lowN)) * 100;
          }

          let currentK = (prevK * (2 / 3)) + (rsv * (1 / 3));
          let currentD = (prevD * (2 / 3)) + (currentK * (1 / 3));
          prevK = currentK; prevD = currentD;

          if (targetDay.date >= "2026-02-02") {
            calculatedRSV = parseFloat(rsv.toFixed(2));
            calculatedK = parseFloat(currentK.toFixed(2));
            calculatedD = parseFloat(currentD.toFixed(2));
          }

          if (subLen === 12) { prevEma12 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 12; }
          else if (subLen > 12) { prevEma12 = (currentPrice * (2 / 13)) + (prevEma12 * (11 / 13)); }
          if (subLen === 26) { prevEma26 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 26; }
          else if (subLen > 26) { prevEma26 = (currentPrice * (2 / 27)) + (prevEma26 * (25 / 27)); }

          if (prevEma12 !== null && prevEma26 !== null) {
            calculatedDif = parseFloat((prevEma12 - prevEma26).toFixed(4)); difHistory.push(calculatedDif);
            if (difHistory.length === 9) {
              prevMacd9 = difHistory.reduce((acc, val) => acc + val, 0) / 9; calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
            } else if (difHistory.length > 9) {
              prevMacd9 = (calculatedDif * (2 / 10)) + (prevMacd9 * (8 / 10)); calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
            }
            if (calculatedMacdSignal !== null) calculatedMacdOsc = parseFloat((calculatedDif - calculatedMacdSignal).toFixed(4));
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
          margin_buy: targetDay.margin_buy, margin_sell: targetDay.margin_sell, margin_balance: targetDay.margin_balance,
          short_buy: targetDay.short_buy, short_sell: targetDay.short_sell, short_balance: targetDay.short_balance,
          ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: calculatedRSI14,
          rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
          macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
        });
      }

      if (rowUpdates.length > 0) {
        await supabase.from('stock_chips_daily').upsert(rowUpdates, { onConflict: 'stock_id,date' });
        console.log(`[主力股核心指標與資券全量演算完畢] ${sId}`);
      }

    } catch (singleErr) {
      console.error(`❌ 主力個股 ${sId} 演算異常:`, singleErr.message);
    }
    await sleep(60); 
  }
}

run();
