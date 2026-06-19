// backend-sync-new-stream.js
if (!global.WebSocket) { global.WebSocket = class {}; }
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

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
    console.log("🚀 啟動【當日強勢流星股 (NEW) 獨立隔離計算引擎】...");

    // ==========================================================
    // 🧱 需求 1：開局物理清空暫存池，保證 0 殭屍垃圾資料污染
    // ==========================================================
    console.log("🧹 正在全量洗淨清空 stock_chips_new_daily 資料表...");
    const { error: truncateErr } = await supabase
      .from('stock_chips_new_daily')
      .delete()
      .neq('stock_id', 'FORCE_EMPTY_ALL_POOL_SHADOW_KEEP'); 

    if (truncateErr) throw new Error(`清空強勢股資料表失敗: ${truncateErr.message}`);
    console.log("✨ 強勢股資料表完全洗淨洗白！");

    // ==========================================================
    // 🧱 需求 2：向 FinMind 取得最新交易日外資、投信、自營商買超前 50 大
    // ==========================================================
    const today = new Date();
    const endDateStr = formatDateToString(today);
    // 台股放長假或假日寬限，回抓 75 天足以包含 41 個實體交易日
    const safetyPastDate = new Date();
    safetyPastDate.setDate(today.getDate() - 75); 
    const startDateStr = formatDateToString(safetyPastDate);

    console.log(`📥 正在向 FinMind 盤查三大法人最新交易日買超 Top 50 聯集名單...`);
    const commonHeaders = { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0' };
    
    // 利用 TaiwanStockPrice 隨便抓一檔（如2330）來確認市場上最新有資料的交易日是哪一天
    const checkUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330&start_date=${formatDateToString(new Date(today.getTime() - 10*24*60*60*1000))}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
    const checkRes = await axios.get(checkUrl, { headers: commonHeaders });
    let latestMarketDate = endDateStr;
    if (checkRes.data.status === 200 && Array.isArray(checkRes.data.data) && checkRes.data.data.length > 0) {
      latestMarketDate = checkRes.data.data[checkRes.data.data.length - 1].date;
    }
    console.log(`📅 經智能定錨，市場最新實體交易日為: ${latestMarketDate}`);

    // 下載最新交易日的所有法人買賣超大表 (TaiwanStockInstitutionalInvestorsBuySell)
    const t86Url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&start_date=${latestMarketDate}&end_date=${latestMarketDate}&token=${FINMIND_TOKEN}`;
    const t86Res = await axios.get(t86Url, { headers: commonHeaders });
    
    if (t86Res.data.status !== 200 || !Array.isArray(t86Res.data.data)) {
      throw new Error("無法從 FinMind 取得當日法人大表，終止流程。");
    }

    const t86Data = t86Res.data.data;
    
    // 分類篩選三大法人買超（買進股數 - 賣出股數）
    const foreignRank = [];
    const itRank = [];
    const dealerRank = [];

    t86Data.forEach(row => {
      const sId = String(row.stock_id).trim();
      if (sId.length > 4) return; // 過濾權證與衍生商品
      const netBuy = row.buy - row.sell; // 買超股數
      if (netBuy <= 0) return;

      if (row.name === 'Foreign_Investor') foreignRank.push({ sId, netBuy });
      else if (row.name === 'Investment_Trust') itRank.push({ sId, netBuy });
      else if (row.name === 'Dealer_self' || row.name === 'Dealer_Hedging') {
        // 自營商自行買賣與避險加總計算
        if (row.name === 'Dealer_self') dealerRank.push({ sId, netBuy });
      }
    });

    // 排序並各取前 50 名
    const topForeign = foreignRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const topIt = itRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const topDealer = dealerRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);

    // 進行重複比對（聯集去重），且【不與】固定 180 檔比對
    const newStockIds = Array.from(new Set([...topForeign, ...topIt, ...topDealer]));
    console.log(`🎯 三大法人 Top 50 聯集去重完畢，共計有: ${newStockIds.length} 檔飆股入選 NEW 流星池。`);

    if (newStockIds.length === 0) return;

    // ==========================================================
    // 🧱 需求 3：逐檔加載 41 天歷史價量，並重算指標寫入 stock_chips_new_daily
    // ==========================================================
    for (let i = 0; i < newStockIds.length; i++) {
      const stockId = newStockIds[i];
      
      if (i > 0 && i % 12 === 0) {
        console.log(`⏳ 已處理 ${i} 檔新星，保護 API 額度強制休息 10 秒...`);
        await sleep(10000);
      }

      console.log(`[NEW飆股 41天全量回溯計算] (${i + 1}/${newStockIds.length}) ${stockId}`);

      try {
        const dateMap = {};

        // 1. 下載籌碼歷史
        const chipUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stockId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const res = await axios.get(chipUrl, { headers: commonHeaders });
        if (res.data.status === 200 && Array.isArray(res.data.data)) {
          res.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              dateMap[d] = { 
                stock_id: stockId, date: d, price: null, change_value: 0, 
                f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0,
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

        // 2. 下載價格歷史
        const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const priceRes = await axios.get(priceUrl, { headers: commonHeaders });
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
          priceRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) dateMap[d] = { stock_id: stockId, date: d };
            dateMap[d].price = pRow.close;
            dateMap[d].open = pRow.open;
            dateMap[d].max = pRow.max;
            dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume;
            dateMap[d].change_value = pRow.spread || 0;
          });
        }

        // 精準裁切保留最近 41 個不間斷台股實體交易日（確保 MA20/MACD 有足夠天數暖身）
        let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
        if (sortedDays.length > 41) {
          sortedDays = sortedDays.slice(-41);
        }

        const totalLen = sortedDays.length;
        const rowUpdates = [];

        let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
        const difHistory = [];
        let prevK = 50.0; let prevD = 50.0;

        // 3. 技術指標雪球遞迴大腦
        for (let j = 0; j < totalLen; j++) {
          const targetDay = sortedDays[j];
          const subPool = sortedDays.slice(0, j + 1);
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

          // 封裝 28 個完全體欄位
          rowUpdates.push({
            stock_id: stockId,
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

        if (rowUpdates.length > 0) {
          // 🎯 精準指引：只寫入獨立強勢股 stock_chips_new_daily 資料表
          const { error: upsertErr } = await supabase.from('stock_chips_new_daily').upsert(rowUpdates);
          if (upsertErr) throw upsertErr;
        }

      } catch (singleErr) {
        console.error(`❌ 處理新星個股 ${stockId} 失敗:`, singleErr.message);
      }
      await sleep(150); 
    }

    console.log("🎉 【NEW 強勢飆股流星池】獨立隔離下載與 41天全量指標運算全數完工！");
  } catch (error) {
    console.error("💥 新星池同步流程發生致命錯誤:", error.message);
    process.exit(1);
  }
}

run();
