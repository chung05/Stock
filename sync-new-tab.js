// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

// 延遲函式，避免請求過於密集
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 格式化日期為 20260612 格式
function getFormattedDate(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function fetchTwseDataWithRetry() {
  // 從今天開始往前尋找最多 7 天（確保能安全跨越連續假期或週末）
  for (let i = 0; i < 7; i++) {
    const dateStr = getFormattedDate(i);
    const targetUrl = `https://www.twse.com.tw/rwd/zh/fund/TWT38U?date=${dateStr}&response=json`;
    
    // 💡 核心亮點：透過 allorigins 代理轉發，完美繞過證交所對 GitHub 伺服器 IP 的爬蟲阻擋
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    try {
      console.log(`🌐 正在透過安全節點獲取日期 ${dateStr} 的法人排行...`);
      
      const res = await axios.get(proxyUrl, { timeout: 10000 });
      
      if (res.data && res.data.contents) {
        // allorigins 會將原始 JSON 字串放在 contents 欄位中，我們需要手動 JSON.parse
        const rawData = JSON.parse(res.data.contents);
        
        if (rawData.stat === 'OK' && rawData.data && rawData.data.length > 0) {
          console.log(`🎉 成功突破限制！成功獲取最新交易日數據: ${dateStr}`);
          return { date: dateStr, rows: rawData.data };
        }
      }
      
      console.log(`⚠️ 日期 ${dateStr} 為非交易日（週末或假期），準備嘗試前一天...`);
    } catch (e) {
      console.log(`⚠️ 日期 ${dateStr} 請求受阻，錯誤簡述: ${e.message}。嘗試前一天...`);
    }
    
    // 每次請求完強制休息 1.5 秒，展現溫和的爬蟲禮儀
    await sleep(1500);
  }
  throw new Error("❌ 歷經 7 天重試，依然被證交所全面封鎖。請稍後再試。");
}

async function run() {
  try {
    console.log("🚀 開始執行【跨網域安全版：證交所法人前50名比對 寫入 NEW 分頁】流程...");

    // 1. 檢查並讀取本地的 Stock_list.xlsx
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到檔案: ${EXCEL_FILE_PATH}，請確認專案路徑。`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 2. 蒐集目前的核心 180 檔母名單 (TW50, TW100, MSCI)
    const coreSheets = ['TW50', 'TW100', 'MSCI'];
    const existingStocks = new Set();

    coreSheets.forEach(sheetName => {
      if (workbook.SheetNames.includes(sheetName)) {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        json.forEach(row => {
          const sId = String(row['股票代號'] || row['代號'] || '').trim();
          if (sId) existingStocks.add(sId);
        });
      }
    });
    console.log(`📊 目前核心名單共有 ${existingStocks.size} 檔股票。`);

    // 3. 讀取現有 'NEW' 分頁裡的股票
    const existingNewStocks = new Set();
    let currentNewRows = [];
    if (workbook.SheetNames.includes('NEW')) {
      const newSheet = workbook.Sheets['NEW'];
      currentNewRows = XLSX.utils.sheet_to_json(newSheet);
      currentNewRows.forEach(row => {
        const sId = String(row['股票代號'] || row['代號'] || '').trim();
        if (sId) existingNewStocks.add(sId);
      });
    }
    console.log(`📂 目前 'NEW' 分頁中已有 ${existingNewStocks.size} 檔歷史篩選股。`);

    // 4. 從證交所代理端撈取法人買超前 50 名
    const twseResult = await fetchTwseDataWithRetry();
    
    // 5. 解析證交所欄位並比對
    const newlyFoundStocksMap = new Map();

    twseResult.rows.forEach(row => {
      const sId = String(row[1]).trim();   // 股票代號
      const sName = String(row[2]).trim(); // 股票名稱

      // 條件：不在 180 檔核心 且 不在 現有的 NEW 分頁中
      if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
        newlyFoundStocksMap.set(sId, {
          '股票代號': sId,
          '股票名稱': sName
        });
      }
    });

    console.log(`✨ 今日比對完成！新增了 ${newlyFoundStocksMap.size} 檔不在核心名單內的新股票。`);

    // 6. 如果有新股票，才需要重寫 Excel 檔案
    if (newlyFoundStocksMap.size > 0) {
      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      // 將異動存回本地 Stock_list.xlsx 檔案
      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功將最新名單寫入 ${EXCEL_FILE_PATH} 的 'NEW' 分頁！`);
    } else {
      console.log("重疊度高或無最新法人股，Excel 未做任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
