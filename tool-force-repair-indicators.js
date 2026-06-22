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
  console.log("🛠️ 啟動【180檔主力股全量漏洞修復與指標強行洗白工具 - 終極修正版】...");

  // 1. 直連母名單
  const { data: targets, error: tErr } = await supabase.from('stock_targets').select('stock_id');
  if (tErr) throw tErr;
  const stockList = targets || [];
  console.log(`📊 鎖定待盤查主力個股: ${stockList.length} 檔`);

  const commonHeaders = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  };

  // 2. 逐檔強制追蹤補件
  for (let i = 0; i < stockList.length; i++) {
    const sId = String(stockList[i].stock_id).trim();
    
    if (i > 0 && i % 10 === 0) {
      console.log("⏳ 已處理 10 檔，強制休息 12 秒保護 API 流量額度...");
      await sleep(12000);
    }

    console.log(`🔄 (${i + 1}/${stockList.length}) 正在診斷修復個股: ${sId}`);

    try {
      const dateMap = {};
      const startDateStr = "2026-01-02";
      const endDateStr = "2026-06-19";

      // 💡 預先抓取 Supabase 現有的這段期間資料（防禦中間漏掉某天，或是 API 沒有回傳法人時的覆蓋悲劇）
      const { data: existingRecords } = await supabase
        .from('stock_chips_daily')
        .select('*')
        .eq('stock_id', sId)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (existingRecords) {
        existingRecords.forEach(row => {
          dateMap[row.date] = { ...row };
        });
      }

      // (A) 抓取籌碼
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
          // 🔥 修正：補上原本漏掉的外陸資自營商欄位
          else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
          else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
          else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
          else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
        });
      }

      // (B) 抓取價格
      const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${process.env.FINMIND_TOKEN}`;
      const pRes = await axios.get(priceUrl, { headers: commonHeaders });
      if (pRes.data.status === 200 && Array.isArray(pRes.data.data)) {
        pRes.data.data.forEach(pRow => {
          const d = pRow.date;
          if (!dateMap[d]) {
            dateMap[d] = { 
              stock_id: sId, date: d, 
              f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0 
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

      // 確保陣列依日期排序（這對技術指標遞迴至關重要）
      let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
      if (sortedDays.length === 0) continue;

      // 3. 滿格歷史指標重算大腦
      let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
      const difHistory = [];
      let prevK = 50.0; let prevD = 50.0;
      
      // RSI 專用平滑變數
      let avgUp = 0, avgDown = 0;

      for (let j = 0; j < sortedDays.length; j++) {
        const targetDay = sortedDays[j];
        const subPool = sortedDays.slice(0, j + 1);
        const subLen = subPool.length;
        const currentPrice = targetDay.price;

        // 初始化所有指標格子為 null，防止殘留舊錯誤髒資料
        targetDay.ma5 = null; targetDay.ma10 = null; targetDay.ma20 = null;
        targetDay.rsi14 = null; targetDay.rsv = null; targetDay.kd_k = null; targetDay.kd_d = null;
        targetDay.macd_dif = null; targetDay.macd_signal = null; targetDay.macd_osc = null;

        if (currentPrice !== null && currentPrice !== undefined) {
          // MA 計算
          if (subLen >= 5) targetDay.ma5 = parseFloat((subPool.slice(-5).reduce((a, b) => a + (b.price || 0), 0) / 5).toFixed(2));
          if (subLen >= 10) targetDay.ma10 = parseFloat((subPool.slice(-10).reduce((a, b) => a + (b.price || 0), 0) / 10).toFixed(2));
          if (subLen >= 20) targetDay.ma20 = parseFloat((subPool.slice(-20).reduce((a, b) => a + (b.price || 0), 0) / 20).toFixed(2));

          // 🔥 修正：完整實作 RSI14 真實遞迴演算法，拒絕死碼 50
          if (subLen > 1) {
            const change = currentPrice - sortedDays[j - 1].price;
            const up = change > 0 ? change : 0;
            const down = change < 0 ? Math.abs(change) : 0;
            
            if (subLen <= 15) {
              avgUp += up;
              avgDown += down;
              if (subLen === 15) {
                avgUp /= 14;
                avgDown /= 14;
                targetDay.rsi14 = avgDown === 0 ? 100 : parseFloat((100 - (100 / (1 + avgUp / avgDown))).toFixed(2));
              }
            } else {
              avgUp = (avgUp * 13 + up) / 14;
              avgDown = (avgDown * 13 + down) / 14;
              targetDay.rsi14 = avgDown === 0 ? 100 : parseFloat((100 - (100 / (1 + avgUp / avgDown))).toFixed(2));
            }
          }

          // KD 計算
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

          // MACD 計算
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

      // 4. 強制寫入大帳本
      if (sortedDays.length > 0) {
        const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(sortedDays);
        if (upsertErr) throw upsertErr;
        console.log(`✅ [修復成功] 個股 ${sId} 已強行刷滿全歷史 28 欄位資訊！`);
      }

    } catch (singleErr) {
      console.error(`❌ 修復個股 ${sId} 失敗:`, singleErr.message);
    }
    await sleep(200);
  }

  console.log("🎉 【全量漏洞修復大工程】完美收官！");
}

run();
