// backend-sync-new-stock.js
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

async function run() {
  try {
    console.log("🚀 啟動【當日強勢股母名單動態註冊 + 智能回溯退回機制完全體引擎】...");

    const today = new Date();
    const endDateStr = formatDateToString(today);
    // 🧱 完美對齊修復工具：起點硬性指定 2026-01-02，保證歷史天數飽滿
    const startDateStr = "2026-01-02";

    const commonHeaders = { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    
    // 1. 智能定位最新開盤日 (確認 FinMind 方面最新日期)
    const checkUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330&start_date=${formatDateToString(new Date(today.getTime() - 10*24*60*60*1000))}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
    const checkRes = await axios.get(checkUrl, { headers: commonHeaders });
    let baseMarketDate = today;
    if (checkRes.data.status === 200 && Array.isArray(checkRes.data.data) && checkRes.data.data.length > 0) {
      baseMarketDate = new Date(checkRes.data.data[checkRes.data.data.length - 1].date);
    }

    // ==========================================================
    // 💡 核心除錯機制：若今日大表尚未公布，自動往過去遞減日期，直到抓到有資料的交易日為止！
    // ==========================================================
    let rawT86Rows = null;
    let finalMarketDateStr = "";
    
    for (let dRetry = 0; dRetry < 7; dRetry++) {
      const checkTargetDate = new Date(baseMarketDate.getTime() - dRetry * 24 * 60 * 60 * 1000);
      const twseDateParam = formatDateToString(checkTargetDate).replace(/-/g, '');
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${twseDateParam}&selectType=ALLBUT0999`;

      console.log(`📥 嘗試從證交所下載日期為 [ ${formatDateToString(checkTargetDate)} ] 的全市場大表...`);
      try {
        const twseRes = await axios.get(twseUrl, { headers: commonHeaders });
        if (twseRes.data && twseRes.data.stat === 'OK' && Array.isArray(twseRes.data.data)) {
          rawT86Rows = twseRes.data.data;
          finalMarketDateStr = formatDateToString(checkTargetDate);
          console.log(`🟢 [成功抓取] 成功鎖定實體大表日期為: ${finalMarketDateStr}，包含紀錄共 ${rawT86Rows.length} 筆！`);
          break;
        }
      } catch (e) {
        console.log(`⚠️ 日期 ${formatDateToString(checkTargetDate)} 證交所尚未公布或放假，繼續往昨日回溯...`);
      }
    }

    if (!rawT86Rows) {
      throw new Error("❌ 嚴重錯誤：連續盤查過去 7 天均無法取得證交所 T86 大表，終止流程。");
    }

    // ==========================================================
    // 🧱 需求 2.3：確認有資料後，才安全清空 stock_targets 的 "NEW" 標籤與暫存大表
    // ==========================================================
    console.log("🧹 正在啟動 stock_targets 母名單 'NEW' 標籤動態洗滌程序...");
    const { data: allTargets, error: targetFetchErr } = await supabase.from('stock_targets').select('*');
    if (targetFetchErr) throw targetFetchErr;

    const targetsList = allTargets || [];
    for (let t of targetsList) {
      let tags = Array.isArray(t.sheet_tags) ? t.sheet_tags : [];
      if (tags.includes("NEW")) {
        if (tags.length === 1) {
          await supabase.from('stock_targets').delete().eq('stock_id', t.stock_id);
        } else {
          let newTags = tags.filter(tag => tag !== "NEW");
          await supabase.from('stock_targets').update({ sheet_tags: newTags }).eq('stock_id', t.stock_id);
        }
      }
    }

    console.log("🧹 正在物理清空 stock_chips_new_daily 資料表...");
    await supabase.from('stock_chips_new_daily').delete().neq('stock_id', 'RESET');

    const foreignRank = []; const itRank = []; const dealerRank = [];
    const stockNameMap = new Map();

    rawT86Rows.forEach(row => {
      const sId = String(row[0]).trim();
      const sName = String(row[1]).trim();
      if (sId.length !== 4) return;
      if (sId.startsWith('00') || sId.startsWith('01') || sId.startsWith('91')) return;

      stockNameMap.set(sId, sName);

      const fNet = parseInt(String(row[4]).replace(/,/g, '')) || 0;  
      const itNet = parseInt(String(row[10]).replace(/,/g, '')) || 0; 
      const dNet = parseInt(String(row[14]).replace(/,/g, '')) || 0;  

      if (fNet > 0) foreignRank.push({ sId, netBuy: fNet });
      if (itNet > 0) itRank.push({ sId, netBuy: itNet });
      if (dNet > 0) dealerRank.push({ sId, netBuy: dNet });
    });

    const topForeign = foreignRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const topIt = itRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const topDealer = dealerRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);

    const newStockIds = Array.from(new Set([...topForeign, ...topIt, ...topDealer]));
    console.log(`🎯 純個股前 50 聯集去重完畢，共計: ${newStockIds.length} 檔強勢股。`);

    // 動態將今日入選的飆股分類註冊回 stock_targets 表
    const { data: refreshedTargets } = await supabase.from('stock_targets').select('*');
    const targetMapSnapshot = new Map(refreshedTargets.map(t => [t.stock_id, t]));

    for (let stockId of newStockIds) {
      const currentStockName = stockNameMap.get(stockId) || "未知個股";
      if (targetMapSnapshot.has(stockId)) {
        let existData = targetMapSnapshot.get(stockId);
        let tags = Array.isArray(existData.sheet_tags) ? existData.sheet_tags : [];
        if (!tags.includes("NEW")) {
          tags.push("NEW");
          await supabase.from('stock_targets').update({ sheet_tags: tags }).eq('stock_id', stockId);
        }
      } else {
        await supabase.from('stock_targets').insert({ stock_id: stockId, stock_name: currentStockName, sheet_tags: ["NEW"] });
      }
    }

    // 3. 逐檔下載歷史並重算 (自適應切片，從 2026-01-02 開始全量深度推導)
    for (let i = 0; i < newStockIds.length; i++) {
      const stockId = newStockIds[i];
      const currentStockName = stockNameMap.get(stockId) || "未知股名";

      if (i > 0 && i % 12 === 0) { await sleep(10000); }
      console.log(`[強勢股分析中] (${i + 1}/${newStockIds.length}) ${stockId} ${currentStockName}`);

      try {
        const dateMap = {};

        // 抓籌碼
        const chipUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stockId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
        const cRes = await axios.get(chipUrl, { headers: commonHeaders });
        if (cRes.data.status === 200 && Array.isArray(cRes.data.data)) {
          cRes.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) dateMap[d] = { stock_id: stockId, date: d, price: null, change_value: 0, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0, open:0, max:0, min:0, trading_volume:0 };
            if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
            else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
            else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
            else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
          });
        }

        // 抓價格
        const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
        const pRes = await axios.get(priceUrl, { headers: commonHeaders });
        if (pRes.data.status === 200 && Array.isArray(pRes.data.data)) {
          pRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) dateMap[d] = { stock_id: stockId, date: d };
            dateMap[d].price = pRow.close; dateMap[d].open = pRow.open; dateMap[d].max = pRow.max; dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume; dateMap[d].change_value = pRow.spread || 0;
          });
        }

        let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
        if (sortedDays.length === 0) continue;

        const totalLen = sortedDays.length;
        const computedPool = [];
        let prevEma12 = null, prevEma26 = null, prevMacd9 = null; const difHistory = []; let prevK = 50.0; let prevD = 50.0;

        for (let j = 0; j < totalLen; j++) {
          const targetDay = sortedDays[j];
          const subPool = sortedDays.slice(0, j + 1);
          const subLen = subPool.length;
          const currentPrice = targetDay.price;

          let calculatedMA5 = null, calculatedMA10 = null, calculatedMA20 = null;
          let calculatedRSV = null, calculatedK = null, calculatedD = null;
          let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

          if (currentPrice !== null && currentPrice !== undefined) {
            if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((acc, c) => acc + (c.price || 0), 0) / 5).toFixed(2));
            if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((acc, c) => acc + (c.price || 0), 0) / 10).toFixed(2));
            if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((acc, c) => acc + (c.price || 0), 0) / 20).toFixed(2));

            const lookback = Math.min(subLen, 9);
            const lastNDays = subPool.slice(-lookback);
            const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0));
            const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
            
            let rsv = highN - lowN !== 0 ? ((currentPrice - lowN) / (highN - lowN)) * 100 : 50.0;
            let currentK = (prevK * (2 / 3)) + (rsv * (1 / 3));
            let currentD = (prevD * (2 / 3)) + (currentK * (1 / 3));
            prevK = currentK; prevD = currentD;

            calculatedRSV = parseFloat(rsv.toFixed(2));
            calculatedK = parseFloat(currentK.toFixed(2));
            calculatedD = parseFloat(currentD.toFixed(2));

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

          computedPool.push({
            stock_id: stockId, stock_name: currentStockName, date: targetDay.date,
            price: targetDay.price, open: targetDay.open, max: targetDay.max, min: targetDay.min,
            trading_volume: targetDay.trading_volume, change_value: targetDay.change_value,
            f_buy: targetDay.f_buy, f_sell: targetDay.f_sell, fd_buy: targetDay.fd_buy, fd_sell: targetDay.fd_sell,
            it_buy: targetDay.it_buy, it_sell: targetDay.it_sell, ds_buy: targetDay.ds_buy, ds_sell: targetDay.ds_sell, dh_buy: targetDay.dh_buy, dh_sell: targetDay.dh_sell,
            ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: 50.0,
            rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
            macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
          });
        }

        // 🧱 精準只保留最尾端 20 天黃金輸出塞入資料庫
        const finalRowsToUpsert = computedPool.slice(-20);
        if (finalRowsToUpsert.length > 0) {
          await supabase.from('stock_chips_new_daily').upsert(finalRowsToUpsert);
        }

      } catch (err) { console.error(`❌ 處理 ${stockId} 失敗:`, err.message); }
      await sleep(120); 
    }

    console.log("🎉 【NEW強勢個股流水池】智能時間定位 + 20天自適應大表完美解鎖通車！");
  } catch (error) { console.error("💥 致命流程錯誤:", error.message); process.exit(1); }
}

run();
