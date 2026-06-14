// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

// 格式化日期為 20260612 格式 (證交所需要的格式)
function getFormattedDate(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function fetchTwseDataWithRetry() {
  // 因為週末沒有交易，我們從今天(0天前)開始往前嘗試推5天，直到拿到有開盤的最新交易日資料
  for (let i = 0; i < 5; i++) {
    const dateStr = getFormattedDate(i);
    // 證交所：三大法人買賣超前50名排行 API
    const url = `https://www.twse.com.tw/rwd/zh/fund/TWT38U?date=${dateStr}&response=json`;
    
    try {
      console.log(`🌐 嘗試向臺灣證交所獲取日期 ${dateStr} 的法人排行資料...`);
      const res = await axios.get(url, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
      });
      
      if (res.data && res.data.stat === 'OK' && res.data.data && res.data.data.length > 0) {
        console.log(`📅 成功獲取證交所最新交易日數據: ${dateStr}`);
        return { date: dateStr, rows: res.data.data };
      }
    } catch (e) {
      console.log(`⚠️ 日期 ${dateStr} 獲取失敗或無資料，嘗試前一天...`);
    }
  }
  throw new Error("無法從證交所獲取最近5天內任何有效的交易日資料。");
}

async function run() {
  try {
    console.log("🚀 開始執行【證交所三大法人前50名比對 $\rightarrow$ 寫入 Stock_list.xlsx 'NEW' 分頁】流程...");

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

    // 4. 從證交所撈取法人買超前 50 名
    const twseResult = await fetchTwseDataWithRetry();
    
    // 5. 解析證交所欄位
    // 證交所 TWT38U 欄位順序：
    // [0] 排名, [1] 股票代號, [2] 股票名稱, [3] 外資買超, [4] 投信買超, [5] 自營商買超, [6] 三大法人合計買超
    // 注意：證交所這個日報表本身就已經「依據三大法人合計買超張數」幫我們排好前 50 名了！
    
    const newlyFoundStocksMap = new Map();

    twseResult.rows.forEach(row => {
      const sId = String(row[1]).trim(); // 股票代號
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
