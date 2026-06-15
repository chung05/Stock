// sync-new-daily.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const EXCEL_SOURCE_URL = "https://raw.githubusercontent.com/" + process.env.GITHUB_REPOSITORY + "/main/Stock_list.xlsx"; 
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false }
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
    console.log("🚀 【流星暫存池引擎】讀取 Excel 檔案中的 NEW 分頁流程啟動...");

    // 1. 下載並讀取雲端最新的 Stock_list.xlsx 檔案
    const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    
    if (!workbook.SheetNames.includes('NEW')) {
      console.log("⚠️ 提示：目前 Excel 檔案中尚未產生 'NEW' 分頁，終止執行。");
      return;
    }

    // 2. 蒐集並提取當前 NEW 分頁內的所有股票代號
    const newSheet = workbook.Sheets['NEW'];
    const jsonRows = XLSX.utils.sheet_to_json(newSheet);
    const newStockIds = [];

    jsonRows.forEach(row => {
      const sId = String(row['股票代號'] || row['代號'] || '').trim();
      if (sId && !newStockIds.includes(sId)) {
        newStockIds.push(sId);
      }
    });

    console.log(`📊 當前 'NEW' 分頁共計有: ${newStockIds.length} 檔強勢流星股票需要處理。`);
    if (newStockIds.length === 0) return;

    // ========================================================
    // 🧱 核心步驟一：開局物理清空 (DELETE) 洗淨暫存池表，確保 0 殭屍垃圾資料
    // ========================================================
    console.log("🧹 正在全量洗淨清空實體雲端 stock_chips_new_daily 資料表...");
    const { error: truncateErr } = await supabase
      .from('stock_chips_new_daily')
      .delete()
      .neq('stock_id', 'FORCE_EMPTY_ALL_POOL_SHADOW_KEEP'); // 藉由恆真條件強制安全清空整張表

    if (truncateErr) throw new Error(`清空暫存池失敗: ${truncateErr.message}`);
    console.log("✨ 暫存池資料表洗淨洗白成功！");

    // ========================================================
    // 🧱 核心步驟二：動態計算最近 41 個交易日的精準起始與結束區間 (月線必備 41 天)
    // ========================================================
    const today = new Date();
    const endDateStr = formatDateToString(today);
    
    // 為了保證能安全拿到連續不間斷的 41 天台股交易日歷史，我們將 FinMind 起始時間往前寬限推至 75 天前
    const safetyPastDate = new Date();
    safetyPastDate.setDate(today.getDate() - 75);
    const startDateStr = formatDateToString(safetyPastDate);
    
    console.log(`📅 鎖定 FinMind 連續歷史數據抓取區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // 3. 遍歷 NEW 分頁股票，進行飽滿的 41 天數據全量加載
    for (let i = 0; i < newStockIds.length; i++) {
      const stockId = newStockIds[i];
      
      // 每處理 15 檔強制休息 10 秒保護 FinMind API 流量配額
      if (i > 0 && i % 15 === 0) {
        console.log(`⏳ 已抓取 ${i} 檔新星，保護 API 額度強制休息 10 秒...`);
        await sleep(10000);
      }

      console.log(`[下載與分析新星] (${i + 1}/${newStockIds.length}) ${stockId}`);

      try {
        const dateMap = {};

        // (A) 下載三大法人買賣超籌碼大帳本
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

        // (B) 下載全交易日收盤價與高低價大帳本
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

        // 按日期排序歷史區間，準備進行精準的指標暖身計算
        let sortedDays = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
        
        // 💡 關鍵對齊點：我們只需要這檔個股最近的 41 個實體交易日，直接切片過濾保留最後 41 筆資料
        if (sortedDays.length > 41) {
          sortedDays = sortedDays.slice(-41);
        }

        const totalLen = sortedDays.length;
        const rowUpdates = [];

        let prevEma12 = null, prevEma26 = null, prevMacd9 = null;
        const difHistory = [];
        let prevK = 50.0; let prevD = 50.0;

        // (C) 進行這連續 41 天的技術指標遞迴推算
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
            // 均線
            if (subLen >= 5) calculatedMA5 = parseFloat((subPool.slice(-5).reduce((acc, c) => acc + (c.price || 0), 0) / 5).toFixed(2));
            if (subLen >= 10) calculatedMA10 = parseFloat((subPool.slice(-10).reduce((acc, c) => acc + (c.price || 0), 0) / 10).toFixed(2));
            if (subLen >= 20) calculatedMA20 = parseFloat((subPool.slice(-20).reduce((acc, c) => acc + (c.price || 0), 0) / 20).toFixed(2));

            // RSI14
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

            // KD 指標 (自適應 9 天)
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

            // 💡 符合策略防線：依舊只有大於等於 2026-02-02 (暖身後) 才允許寫入實體格子
            if (targetDay.date >= "2026-02-02") {
              calculatedRSV = parseFloat(rsv.toFixed(2));
              calculatedK = parseFloat(currentK.toFixed(2));
              calculatedD = parseFloat(currentD.toFixed(2));
            }

            // MACD
            if (subLen === 12) { prevEma12 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 12; }
            else if (subLen > 12) { prevEma12 = (currentPrice * (2 / 13)) + (prevEma12 * (11 / 13)); }
            if (subLen === 26) { prevEma26 = subPool.reduce((acc, c) => acc + (c.price || 0), 0) / 26; }
            else if (subLen > 26) { prevEma26 = (currentPrice * (2 / 27)) + (prevEma26 * (25 / 27)); }

            if (prevEma12 !== null && prevEma26 !== null) {
              let calculatedDif = parseFloat((prevEma12 - prevEma26).toFixed(4)); difHistory.push(calculatedDif);
              if (difHistory.length === 9) {
                prevMacd9 = difHistory.reduce((acc, val) => acc + val, 0) / 9; calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
              } else if (difHistory.length > 9) {
                prevMacd9 = (calculatedDif * (2 / 10)) + (prevMacd9 * (8 / 10)); calculatedMacdSignal = parseFloat(prevMacd9.toFixed(4));
              }
              if (calculatedMacdSignal !== null) calculatedMacdOsc = parseFloat((calculatedDif - calculatedMacdSignal).toFixed(4));
            }
          }

          // 打包單日新星封包數據（已遵照吩咐：完全精簡移除 ma60）
          rowUpdates.push({
            ...targetDay, 
            ma5: calculatedMA5, ma10: calculatedMA10, ma20: calculatedMA20, rsi14: calculatedRSI14,
            rsv: calculatedRSV, kd_k: calculatedK, kd_d: calculatedD,
            macd_dif: calculatedDif ? parseFloat(calculatedDif.toFixed(4)) : null, 
            macd_signal: calculatedMacdSignal ? parseFloat(calculatedMacdSignal.toFixed(4)) : null, 
            macd_osc: calculatedMacdOsc ? parseFloat(calculatedMacdOsc.toFixed(4)) : null
          });
        }

        // (D) 將這連續 41 天的豐沛數據批次 upsert 寫入全新的新星流星暫存池
        if (rowUpdates.length > 0) {
          const { error: upsertErr } = await supabase.from('stock_chips_new_daily').upsert(rowUpdates);
          if (upsertErr) throw upsertErr;
        }

      } catch (singleErr) {
        console.error(`❌ 處理新星個股 ${stockId} 失敗:`, singleErr.message);
      }
      await sleep(200); // 溫和調用
    }

    console.log("🎉 【流星暫存池引擎】今日新星 41 天不斷層資料全數同步計算完畢！");
  } catch (error) {
    console.error("💥 新星池同步流程發生致命錯誤:", error.message);
    process.exit(1);
  }
}

run();
