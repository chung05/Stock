const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

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
    console.log("🚀 開始執行【智慧增量同步 + 技術指標獨立精準計算】流程...");

    // 1. 載入標的清單 (完全保留原架構)
    const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const stockMap = new Map();
    workbook.SheetNames.forEach(name => {
      const sheet = workbook.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet);
      json.forEach(row => {
        const sId = String(row['股票代號'] || row['代號'] || '').trim();
        const sName = String(row['股票名稱'] || row['名稱'] || '').trim();
        if (!sId) return;
        if (!stockMap.has(sId)) {
          stockMap.set(sId, { stock_id: sId, stock_name: sName, sheet_tags: [] });
        }
        if (!stockMap.get(sId).sheet_tags.includes(name)) {
          stockMap.get(sId).sheet_tags.push(name);
        }
      });
    });

    const dbStockData = Array.from(stockMap.values());
    console.log(`📊 本次欲檢查並同步的雲端股票總數: ${dbStockData.length} 檔`);

    if (dbStockData.length === 0) return;

    // 2. 自動判定起訖日期 (智慧增量 - 完全保留原邏輯)
    const { data: lastRecord, error: dateErr } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
      
    if (dateErr) console.log("⚠️ 偵測最大日期異常(可能尚未有任何資料):", dateErr.message);

    let startDate = new Date('2026-01-01');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      const lastDate = new Date(lastRecord[0].date);
      lastDate.setDate(lastDate.getDate() + 1);
      startDate = lastDate;
    }
    
    const today = new Date();
    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(today);
    console.log(`📅 本次增量同步區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // 3. 步驟一：專心跑 FinMind 籌碼與價格下載 (保留原始核心，欄位全小寫 stock_id 絕不動)
    if (startDate <= today) {
      for (let i = 0; i < dbStockData.length; i++) {
        const stock = dbStockData[i];
        
        if (i > 0 && i % 15 === 0) {
          console.log(`⏳ 已抓取 ${i} 檔，為保護 API 額度，強制休息 10 秒...`);
          await sleep(10000);
        }

        console.log(`[第一步：下載籌碼] (${i + 1}/${dbStockData.length}) ${stock.stock_id}`);

        try {
          const dateMap = {};

          // --- 法人籌碼 ---
          const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const res = await axios.get(apiUrl, { headers: commonHeaders });
          
          if (res.data.status === 200 && Array.isArray(res.data.data)) {
            res.data.data.forEach(row => {
              const d = row.date;
              if (!dateMap[d]) {
                dateMap[d] = { 
                  stock_id: stock.stock_id, date: d, price: null, change_value: 0, 
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

          // --- 價格與開高低量 ---
          const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders });
          
          if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
            priceRes.data.data.forEach(pRow => {
              const d = pRow.date;
              if (!dateMap[d]) dateMap[d] = { stock_id: stock.stock_id, date: d };
              
              dateMap[d].price = pRow.close;
              dateMap[d].open = pRow.open;
              dateMap[d].max = pRow.max;
              dateMap[d].min = pRow.min;
              dateMap[d].trading_volume = pRow.Trading_Volume;
              dateMap[d].change_value = pRow.spread || 0;
            });
          }

          const rowsToUpsert = Object.values(dateMap);
          if (rowsToUpsert.length > 0) {
            const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert);
            if (upsertErr) throw upsertErr;
          }

        } catch (err) {
          console.error(`❌ 下載 ${stock.stock_id} 錯誤: ${err.message}`);
        }
        await sleep(200);
      }
    } else {
      console.log("✨ 雲端籌碼資料已是最新，跳過下載步驟。");
    }

    // 4. 步驟二：執行精準獨立計算指標 Function
    console.log("💡 開始跑獨立指標計算 function 進行全時間軸精準更新...");
    await calculateAndWriteBackIndicators(dbStockData);

    console.log("🎉 所有增量同步與技術指標計算流程全數完成！");
  } catch (error) {
    console.error("💥 全局同步流程發生嚴重致命錯誤:", error.message);
    process.exit(1);
  }
}

// 🛠️ 專職從 1/2 開始由舊到新「正序」精準計算技術指標的獨立 Function
async function calculateAndWriteBackIndicators(stockList) {
  for (let i = 0; i < stockList.length; i++) {
    const stock = stockList[i];

    try {
      // 💡 關鍵優化：不再從最新倒著撈，而是直接「由舊到新 (ascending: true)」撈取該股票有史以來的所有資料
      // 這樣可以確保 pricePool[0] 永遠是這檔股票在資料庫裡的最起點（如 1/2），時間軸不再發生截斷錯位
      const { data: pricePool, error: fetchErr } = await supabase
        .from('stock_chips_daily')
        .select('*')
        .eq('stock_id', stock.stock_id)
        .order('date', { ascending: true }); // 👈 改為由舊到新正序排列

      if (fetchErr) {
        console.error(`❌ 無法獲取 ${stock.stock_id} 的歷史價格:`, fetchErr.message);
        continue;
      }

      if (!pricePool || pricePool.length === 0) {
        continue;
      }

      const totalLen = pricePool.length;
      const rowUpdates = [];

      // 依正序逐日掃描，建立完美遞增的完整歷史池
      for (let j = 0; j < totalLen; j++) {
        const targetDay = pricePool[j];
        const subPool = pricePool.slice(0, j + 1); // 包含從第一天(1/2)到當天為止的所有資料
        const subLen = subPool.length;

        let calculatedMA10 = null;
        let calculatedMA20 = null;
        let calculatedMA60 = null;
        let calculatedRSI14 = null;

        // 1️⃣ 精準計算 MA10：當 subLen 達到 10，代表這正好是歷史第 10 天，前面恰好留空 9 個 null
        if (subLen >= 10) {
          const sum10 = subPool.slice(-10).reduce((acc, curr) => acc + (curr.price || 0), 0);
          calculatedMA10 = parseFloat((sum10 / 10).toFixed(2));
        }

        // 2️⃣ 精準計算 MA20：當 subLen 達到 20，代表歷史第 20 天，前面恰好留空 19 個 null
        if (subLen >= 20) {
          const sum20 = subPool.slice(-20).reduce((acc, curr) => acc + (curr.price || 0), 0);
          calculatedMA20 = parseFloat((sum20 / 20).toFixed(2));
        }

        // 3️⃣ 精準計算 MA60：當 subLen 達到 60，代表歷史第 60 天，前面恰好留空 59 個 null
        if (subLen >= 60) {
          const sum60 = subPool.slice(-60).reduce((acc, curr) => acc + (curr.price || 0), 0);
          calculatedMA60 = parseFloat((sum60 / 60).toFixed(2));
        }

        // 4️⃣ 精準計算 RSI14：第 15 筆資料時（j=14, subLen=15），前面恰好留向 14 個 null
        if (subLen >= 15) {
          let avgUp = 0;
          let avgDown = 0;
          let rsiInitialized = false;

          for (let k = 1; k < subLen; k++) {
            const prevPrice = subPool[k - 1].price;
            const currPrice = subPool[k].price;
            
            if (prevPrice === null || currPrice === null) continue;

            const diff = currPrice - prevPrice;
            const currentUp = diff > 0 ? diff : 0;
            const currentDown = diff < 0 ? Math.abs(diff) : 0;

            if (!rsiInitialized) {
              avgUp += currentUp;
              avgDown += currentDown;
              if (k === 14) {
                avgUp = avgUp / 14;
                avgDown = avgDown / 14;
                rsiInitialized = true;
              }
            } else {
              avgUp = (avgUp * 13 + currentUp) / 14;
              avgDown = (avgDown * 13 + currentDown) / 14;
            }
          }

          if (rsiInitialized) {
            if (avgDown === 0) {
              calculatedRSI14 = avgUp === 0 ? 50.00 : 100.00;
            } else {
              const rs = avgUp / avgDown;
              calculatedRSI14 = parseFloat((100 - (100 / (1 + rs))).toFixed(2));
            }
          }
        }

        // 只更新「指標有發生改變」或「新抓到」的行，為了保險並一次性校正，我們把所有算好的資料一併打包
        rowUpdates.push({
          ...targetDay, 
          stock_id: targetDay.stock_id,
          date: targetDay.date,
          ma10: calculatedMA10,
          ma20: calculatedMA20,
          ma60: calculatedMA60,
          rsi14: calculatedRSI14
        });
      }

      // 安全寫回資料庫
      if (rowUpdates.length > 0) {
        const { error: writeErr } = await supabase
          .from('stock_chips_daily')
          .upsert(rowUpdates);

        if (writeErr) {
          console.error(`❌ 寫回 ${stock.stock_id} 指標失敗:`, writeErr.message);
        } else {
          console.log(`[精準更新成功] (${i + 1}/${stockList.length}) ${stock.stock_id} 歷史指標校正完畢！`);
        }
      }

    } catch (singleErr) {
      console.error(`❌ 處理 ${stock.stock_id} 技術指標時發生錯誤:`, singleErr.message);
    }

    await sleep(80); 
  }
}

run();
