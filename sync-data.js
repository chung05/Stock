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
    console.log("🚀 開始執行【智慧增量 + 技術指標全量回溯計算】同步流程...");

    // 1. 載入標的清單 (保留原架構)
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

    // 2. 自動判定起訖日期 (智慧增量 - 保留原邏輯)
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

    // 3. 分批處理執行迴圈
    for (let i = 0; i < dbStockData.length; i++) {
      const stock = dbStockData[i];
      
      if (i > 0 && i % 15 === 0) {
        console.log(`⏳ 已同步處理 ${i} 檔，為保護 API 額度，強制休息 10 秒...`);
        await sleep(10000);
      }

      console.log(`[同步與指標計算] (${i + 1}/${dbStockData.length}) ${stock.stock_id}`);

      try {
        const dateMap = {};

        // --- A. 抓取法人籌碼 (僅當有需要增量更新時抓取) ---
        if (startDate <= today) {
          const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const res = await axios.get(apiUrl, { headers: commonHeaders });
          
          if (res.data.status === 200 && Array.isArray(res.data.data)) {
            res.data.data.forEach(row => {
              const d = row.date;
              if (!dateMap[d]) {
                dateMap[d] = { 
                  stock_id: stock.stock_id, date: d, price: null, change_value: 0, 
                  f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0,
                  open: 0, max: 0, min: 0, trading_volume: 0,
                  ma10: null, ma20: null, ma60: null, rsi14: null
                };
              }
              if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
              else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
              else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
              else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
              else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
            });
          }

          // --- B. 抓取價格與開高低量 ---
          const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.stock_id}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
          const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders });
          
          if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
            priceRes.data.data.forEach(pRow => {
              const d = pRow.date;
              if (!dateMap[d]) dateMap[d] = { stock_id: stock.stock_id, date: d, ma10: null, ma20: null, ma60: null, rsi14: null };
              
              dateMap[d].price = pRow.close;
              dateMap[d].open = pRow.open;
              dateMap[d].max = pRow.max;
              dateMap[d].min = pRow.min;
              dateMap[d].trading_volume = pRow.Trading_Volume;
              dateMap[d].change_value = pRow.spread || 0;
            });
          }
        }

        // --- C. 💡 修正關鍵：從 Supabase 讀取自 1/2 以來的所有歷史舊資料（包含既有欄位） ---
        // 這樣做可以確保 1/2 以來 ma 欄位是 null 的資料通通被撈出來重新計算並更新！
        const { data: dbHistory, error: histErr } = await supabase
          .from('stock_chips_daily')
          .select('*') // 撈出所有原始欄位，避免覆蓋掉舊有的三大法人籌碼數據
          .eq('stock_id', stock.stock_id)
          .order('date', { ascending: true }); // 由舊到新正序排列

        if (histErr) console.error(`[警告] 讀取 ${stock.stock_id} 歷史資料失敗:`, histErr.message);

        // 將 Supabase 中的歷史舊資料，轉入一個以日期為 key 的對照表
        const mergedDateMap = {};
        if (dbHistory && dbHistory.length > 0) {
          dbHistory.forEach(row => {
            mergedDateMap[row.date] = { ...row };
          });
        }

        // 把本次 FinMind 抓到的新資料也倒進去合併 (若日期重複則新資料覆蓋或保留)
        Object.keys(dateMap).forEach(d => {
          mergedDateMap[d] = { ...mergedDateMap[d], ...dateMap[d] };
        });

        // 取得大合併後（舊資料 + 新資料）的所有日期，並由舊到新排序
        let allSortedDates = Object.keys(mergedDateMap).sort();
        let priceSequencePool = [];

        // 依時間正序逐日處理，從最老的那一天（1/2）開始往後累積計算指標
        allSortedDates.forEach(dStr => {
          const currentPrice = mergedDateMap[dStr].price;
          if (currentPrice !== null && currentPrice !== undefined) {
            priceSequencePool.push({ date: dStr, price: currentPrice });
          }

          const poolLen = priceSequencePool.length;

          // 1️⃣ 增量/回溯計算 MA10
          if (poolLen >= 10) {
            const sum10 = priceSequencePool.slice(-10).reduce((acc, c) => acc + c.price, 0);
            mergedDateMap[dStr].ma10 = parseFloat((sum10 / 10).toFixed(2));
          } else {
            mergedDateMap[dStr].ma10 = null;
          }

          // 2️⃣ 增量/回溯計算 MA20
          if (poolLen >= 20) {
            const sum20 = priceSequencePool.slice(-20).reduce((acc, c) => acc + c.price, 0);
            mergedDateMap[dStr].ma20 = parseFloat((sum20 / 20).toFixed(2));
          } else {
            mergedDateMap[dStr].ma20 = null;
          }

          // 3️⃣ 增量/回溯計算 MA60
          if (poolLen >= 60) {
            const sum60 = priceSequencePool.slice(-60).reduce((acc, c) => acc + c.price, 0);
            mergedDateMap[dStr].ma60 = parseFloat((sum60 / 60).toFixed(2));
          } else {
            mergedDateMap[dStr].ma60 = null;
          }

          // 4️⃣ 增量/回溯計算 RSI14 (標準威爾德平滑滾動法)
          if (poolLen >= 15) {
            let avgUp = 0;
            let avgDown = 0;
            let rsiInitialized = false;

            for (let j = 1; j < poolLen; j++) {
              const diff = priceSequencePool[j].price - priceSequencePool[j - 1].price;
              const currentUp = diff > 0 ? diff : 0;
              const currentDown = diff < 0 ? Math.abs(diff) : 0;

              if (!rsiInitialized) {
                avgUp += currentUp;
                avgDown += currentDown;
                if (j === 14) {
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
                mergedDateMap[dStr].rsi14 = avgUp === 0 ? 50.00 : 100.00;
              } else {
                const rs = avgUp / avgDown;
                mergedDateMap[dStr].rsi14 = parseFloat((100 - (100 / (1 + rs))).toFixed(2));
              }
            } else {
              mergedDateMap[dStr].rsi14 = null;
            }
          } else {
            mergedDateMap[dStr].rsi14 = null;
          }
        });

        // --- D. 執行 Upsert 寫入資料庫 ---
        // 這裡會把所有舊資料（填上指標後）與新資料一起洗回 Supabase
        const rowsToUpsert = Object.values(mergedDateMap);
        if (rowsToUpsert.length > 0) {
          const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert);
          if (upsertErr) throw upsertErr;
        }

      } catch (err) {
        console.error(`❌ 同步與指標計算 ${stock.stock_id} 錯誤: ${err.message}`);
      }
      await sleep(200); 
    }

    console.log("🎉 智慧增量與技術指標計算同步流程全數完成！");
  } catch (error) {
    console.error("💥 全局同步流程發生嚴重致命錯誤:", error.message);
    process.exit(1);
  }
}

run();
