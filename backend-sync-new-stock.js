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
    console.log("🚀 啟動【當日強勢股雙重去重防護牆 + 內部數據就地取材完全體引擎】...");

    const today = new Date();
    const endDateStr = formatDateToString(today);
    const past90Days = new Date();
    past90Days.setDate(today.getDate() - 90); 
    const startDateStr = formatDateToString(past90Days);

    const commonHeaders = { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    
    // 1. 智能定位最新開盤日
    const checkUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330&start_date=${formatDateToString(new Date(today.getTime() - 10*24*60*60*1000))}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
    const checkRes = await axios.get(checkUrl, { headers: commonHeaders });
    let baseMarketDate = today;
    if (checkRes.data.status === 200 && Array.isArray(checkRes.data.data) && checkRes.data.data.length > 0) {
      baseMarketDate = new Date(checkRes.data.data[checkRes.data.data.length - 1].date);
    }

    // 2. 證交所大表安全回溯
    let rawT86Rows = null; let finalMarketDateStr = "";
    for (let dRetry = 0; dRetry < 7; dRetry++) {
      const checkTargetDate = new Date(baseMarketDate.getTime() - dRetry * 24 * 60 * 60 * 1000);
      const twseDateParam = formatDateToString(checkTargetDate).replace(/-/g, '');
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${twseDateParam}&selectType=ALLBUT0999`;
      try {
        const twseRes = await axios.get(twseUrl, { headers: commonHeaders });
        if (twseRes.data && twseRes.data.stat === 'OK' && Array.isArray(twseRes.data.data)) {
          rawT86Rows = twseRes.data.data; finalMarketDateStr = formatDateToString(checkTargetDate);
          console.log(`🟢 [證交所連線成功] 交易日為: ${finalMarketDateStr}`);
          break;
        }
      } catch (e) {}
    }
    if (!rawT86Rows) throw new Error("❌ 嚴重錯誤：無法取得證交所 T86 大表。");

    // 3. 讀取並保存當前 stock_targets 快照以進行交叉去重
    const { data: currentTargets, error: tFetchErr } = await supabase.from('stock_targets').select('*');
    if (tFetchErr) throw tFetchErr;
    
    // 找出目前「原本就屬於 180 檔固定主力股」的代號集合（不含純 NEW 股）
    const coreStockIdsSet = new Set(
      (currentTargets || [])
        .filter(t => Array.isArray(t.sheet_tags) && t.sheet_tags.some(tag => tag !== "NEW"))
        .map(t => String(t.stock_id).trim())
    );

    // 4. 動態洗滌唯一管理表 stock_targets 中的舊 'NEW' 標籤
    console.log("🧹 正在動態洗滌管理表 stock_targets 中的舊 'NEW' 標籤...");
    for (let t of (currentTargets || [])) {
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

    // 5. 開局全量清空強勢股暫存大帳本
    console.log("🧹 正在物理洗淨清空個股純數據表 stock_chips_new_daily...");
    await supabase.from('stock_chips_new_daily').delete().neq('stock_id', 'RESET_POOL');

    const foreignRank = []; const itRank = []; const dealerRank = [];
    const stockNameMap = new Map();

    rawT86Rows.forEach(row => {
      const sId = String(row[0]).trim(); const sName = String(row[1]).trim();
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

    // 🧱 策略核心 1：三大法人前 50 名進行聯集過濾重複
    const topForeign = foreignRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const topIt = itRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const topDealer = dealerRank.sort((a, b) => b.netBuy - a.netBuy).slice(0, 50).map(x => x.sId);
    const rawNewStockIds = Array.from(new Set([...topForeign, ...topIt, ...topDealer]));
    console.log(`📊 法人買超 Top 50 聯集去重後，共計有: ${rawNewStockIds.length} 檔強勢個股。`);

    // 動態註冊回 stock_targets 母名單
    const { data: refreshedTargets } = await supabase.from('stock_targets').select('*');
    const targetMapSnapshot = new Map(refreshedTargets.map(t => [t.stock_id, t]));

    for (let stockId of rawNewStockIds) {
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
    console.log("📝 stock_targets 飆股動態標籤註冊更新完畢。");

    // ==========================================================
    // 🧱 策略核心 2：與 180 檔固定成分股交叉比對去重，分流排載
    // ==========================================================
    for (let i = 0; i < rawNewStockIds.length; i++) {
      const stockId = rawNewStockIds[i];
      const currentStockName = stockNameMap.get(stockId) || "未知股名";

      console.log(`[分流判斷] (${i + 1}/${rawNewStockIds.length}) ${stockId} ${currentStockName}`);

      // 🎯 情況 A：如果此股屬於固定 180 檔常規主力股 -> 100% 迴避 API，就地取材複製數據
      if (coreStockIdsSet.has(stockId)) {
        console.log(`   💡 偵測為 180 檔固定成分股！發動【就地取材】，直接從本地常規大帳本複製最近 20 天數據...`);
        const { data: localData, error: localErr } = await supabase
          .from('stock_chips_daily')
          .select('stock_id, date, price, open, max, min, trading_volume, change_value, f_buy, f_sell, fd_buy, fd_sell, it_buy, it_sell, ds_buy, ds_sell, dh_buy, dh_sell, ma5, ma10, ma20, rsi14, rsv, kd_k, kd_d, macd_dif, macd_signal, macd_osc')
          .eq('stock_id', stockId)
          .order('date', { ascending: false })
          .limit(20);

        if (!localErr && localData && localData.length > 0) {
          // 轉為正序並直接塞入強勢股大表
          await supabase.from('stock_chips_new_daily').upsert(localData.reverse());
          console.log(`   ✅ 本地數據同步成功！`);
        }
        continue; 
      }

      // 🎯 情況 B：真正不重複的外部流星飆股 -> 才耗費額度去 FinMind 索取 90 天歷史
      if (i > 0 && i % 8 === 0) { await sleep(8000); } // 降速保護安全網
      console.log(`   🔥 屬於獨立新星飆股！啟動 FinMind API 連線獲取 90 日歷史...`);

      try {
        const dateMap = {};
        // (A) 下載籌碼
        const chipUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stockId}&start_date=${startDateStr}&end_date=${finalMarketDateStr}&token=${process.env.FINMIND_TOKEN}`;
        const cRes = await axios.get(chipUrl, { headers: commonHeaders });
        if (cRes.data.status === 200 && Array.isArray(cRes.data.data)) {
          cRes.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              dateMap[d] = { stock_id: stockId, date: d, price: null, change_value: 0, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0, open:0, max:0, min:0, trading_volume:0 };
            }
            if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
            else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
            else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
            else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
          });
        }

        // (B) 下載價量
        const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&start_date=${startDateStr}&end_date=${finalMarketDateStr}&token=${process.env.FINMIND_TOKEN}`;
        const pRes = await axios.get(priceUrl, { headers: commonHeaders });
        if (pRes.data.status === 200 && Array.isArray(pRes.data.data)) {
          pRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) {
              dateMap[d] = { stock_id: stockId, date: d, price: null, change_value: 0, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0, open:0, max:0, min:0, trading_volume:0 };
            }
            dateMap[d].price = pRow.close; dateMap[d].open = pRow.open; dateMap[d].max = pRow.max; dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume; dateMap[d].change_value = pRow.spread || 0;
          });
        }

        let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
        if (sortedDays.length === 0) continue;

        const totalLen = sortedDays.length; const computedPool = [];
        let prevEma12 = null, prevEma26 = null, prevMacd9 = null; const difHistory = []; let prevK = 50.0; let prevD = 50.0;

        for (let j = 0; j < totalLen; j++) {
          const targetDay = sortedDays[j]; const subPool = sortedDays.slice(0, j + 1); const subLen = subPool.length; const currentPrice = targetDay.price;
          let calculatedMA5 = null, calculatedMA10 = null, calculatedMA20 = null; let calculatedRSV = null, calculatedK = null, calculatedD = null; let calculatedDif = null, calculatedMacdSignal = null, calculatedMacdOsc = null;

          if (currentPrice !== null && currentPrice !== undefined) {
            if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((acc, c) => acc + (c.price || 0), 0) / 5).toFixed(2));
            if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((acc, c) => acc + (c.price || 0), 0) / 10).toFixed(2));
            if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((acc, c) => acc + (c.price || 0), 0) / 20).toFixed(2));

            const lookback = Math.min(subLen, 9); const lastNDays = subPool.slice(-lookback);
            const highN = Math.max(...lastNDays.map(d => d.max || d.price || 0)); const lowN = Math.min(...lastNDays.map(d => d.min || d.price || 999999));
            let rsv = highN - lowN !== 0 ? ((currentPrice - lowN) / (highN - lowN)) * 100 : 50.0;
            let currentK = (prevK * (2 / 3)) + (rsv * (1 / 3)); let currentD = (prevD * (2 / 3)) + (currentK * (1 / 3));
            prevK = currentK; prevD = currentD;
            calculatedRSV = parseFloat(rsv.toFixed(2)); calculatedK = parseFloat(currentK.toFixed(2)); calculatedD = parseFloat(currentD.toFixed(2));

            if (subLen === 12) { prevEma12 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 12; }
            else if (subLen > 12) { prevEma12 = (currentPrice * (2 / 13)) + (prevEma12 * (11 / 13)); }
            if (subLen === 26) { prevEma26 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 26; }
            else if (subLen > 26) { prevEma26 = (currentPrice * (2 / 27)) + (prevEma26 * (25 / 27)); }

            if (prevEma12 !== null && prevEma26 !== null) {
              calculatedDif = parseFloat((prevEma12 - prevEma26).toFixed(4)); difHistory.push(calculatedDif);
              if (difHistory.length === 9) { prevMacd9 = difHistory.reduce((acc, val) => acc + val, 0) / 9; calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4)); }
              else if (difHistory.length > 9) { prevMacd9 = (calculatedDif * (2 / 10)) + (prevMacd9 * (8 / 10)); calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4)); }
              if (calculatedMacdSignal !== null) calculatedMacdOsc = parseFloat((calculatedDif - calculatedMacdSignal).toFixed(4));
            }
          }

          computedPool.push({
            stock_id: stockId, date: targetDay.date,
            price: targetDay.price, open: targetDay.open, max: targetDay.max, min: targetDay.min,
            trading_volume: targetDay.trading_volume, change_value: targetDay.change_value,
            f_buy: targetDay.f_buy, f_sell: targetDay.f_sell, fd_buy: targetDay.fd_buy, fd_sell: targetDay.fd_sell,
            it_buy: targetDay.it_buy, it_sell: targetDay.it_sell, ds_buy: targetDay.ds_buy, ds_sell: targetDay.ds_sell, dh_buy: targetDay.dh_buy, dh_sell: targetDay.dh_sell,
            ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: 50.0,
            rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
            macd_dif: calculatedDif, macd_signal: calculatedMacdSignal, macd_osc: calculatedMacdOsc
          });
        }

        const finalRowsToUpsert = computedPool.slice(-20);
        if (finalRowsToUpsert.length > 0) {
          await supabase.from('stock_chips_new_daily').upsert(finalRowsToUpsert);
          console.log(`   ✅ [外部新星寫入成功] ${stockId} 20天指標已入庫。`);
        }

      } catch (err) { console.error(`❌ 處理外部個股 ${stockId} 失敗:`, err.message); }
    }

    console.log("🎉 【雙重過濾智慧降載排載模組】全面完美通車！");
  } catch (error) { console.error("💥 致命流程錯誤:", error.message); process.exit(1); }
}

run();
