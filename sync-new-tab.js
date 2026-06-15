// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

/**
 * 💡 精準鎖定最新的一個交易日
 * 規則：
 * 1. 如果是週六，改抓週五。
 * 2. 如果是週日，改抓週五。
 * 3. 如果是週一到週五，且在下午 17:30 之前跑，可能當天資料還沒好，自動拿昨天（如果是週一就拿上週五）。
 */
function getLatestTradeDate() {
  const now = new Date();
  
  // 轉換成台灣時間 (UTC+8)
  const twTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = twTime.getDay(); // 0: 週日, 1: 週一, ..., 6: 週六
  const hour = twTime.getHours();
  const minute = twTime.getMinutes();

  let targetDate = new Date(twTime);

  if (day === 6) { 
    // 週六 -> 改抓週五
    targetDate.setDate(twTime.getDate() - 1);
  } else if (day === 0) { 
    // 週日 -> 改抓週五
    targetDate.setDate(twTime.getDate() - 2);
  } else if (day === 1 && (hour < 17 || (hour === 17 && minute < 30))) {
    // 週一傍晚 17:30 之前 -> 拿上週五
    targetDate.setDate(twTime.getDate() - 3);
  } else if (hour < 17 || (hour === 17 && minute < 30)) {
    // 週二至週五傍晚 17:30 之前 -> 拿前一天
    targetDate.setDate(twTime.getDate() - 1);
  }
  // 其餘時間（週一至週五 17:30 之後）-> 直接抓當天

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function run() {
  try {
    const targetDateStr = getLatestTradeDate();
    console.log(`🚀 開始執行【精準精確版：證交所法人前50名比對 寫入 NEW 分頁】流程...`);
    console.log(`🎯 系統判定應抓取的最新交易日為: ${targetDateStr}`);

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

    // 4. 改走政府高速開放資料庫分流節點（高速、不擋海外 IP、不超時）
    const url = `https://openapi.twse.com.tw/v1/fund/TWT38U?date=${targetDateStr}`;
    console.log(`🌐 正在從開放資料庫高速下載法人排行數據...`);
    
    // 設定 15 秒超時，並增加容錯
    const res = await axios.get(url, { timeout: 15000 }).catch(err => {
      throw new Error(`連線至開放平台失敗: ${err.message}`);
    });

    if (!res.data || !Array.isArray(res.data) || res.data.length === 0) {
      console.log(`⚠️ 該交易日 (${targetDateStr}) 暫時無資料，可能尚未到傍晚發布時間或為特殊休市日。`);
      return;
    }

    // 5. 解析政府開放資料欄位
    // 政府 OpenAPI 格式為 JSON 陣列，物件欄位通常為: Code (代號), Name (名稱)
    const newlyFoundStocksMap = new Map();

    res.data.forEach(item => {
      const sId = String(item.Code || item.CodeNo || '').trim();
      const sName = String(item.Name || '').trim();

      if (sId) {
        // 條件：不在 180 檔核心 且 不在 現有的 NEW 分頁中
        if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
          newlyFoundStocksMap.set(sId, {
            '股票代號': sId,
            '股票名稱': sName
          });
        }
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
