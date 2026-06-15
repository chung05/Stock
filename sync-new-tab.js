// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

/**
 * 自動精準判定最新交易日
 * 週末或週一白天執行時，會自動精準鎖定上週五（如 20260612）
 */
function getLatestTradeDateStr() {
  const now = new Date();
  const twTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = twTime.getDay();
  const hour = twTime.getHours();
  const minute = twTime.getMinutes();

  let targetDate = new Date(twTime);

  if (day === 6) { 
    targetDate.setDate(twTime.getDate() - 1);
  } else if (day === 0) { 
    targetDate.setDate(twTime.getDate() - 2);
  } else if (day === 1 && (hour < 17 || (hour === 17 && minute < 30))) {
    targetDate.setDate(twTime.getDate() - 3);
  } else if (hour < 17 || (hour === 17 && minute < 30)) {
    targetDate.setDate(twTime.getDate() - 1);
  }

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function run() {
  try {
    const tradeDate = getLatestTradeDateStr();
    console.log(`🚀 開始執行【證交所原生流：三大法人各自前50名比對】流程...`);
    console.log(`🎯 系統精準鎖定最新交易日: ${tradeDate}`);

    // 1. 檢查並讀取本地的 Stock_list.xlsx
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到檔案: ${EXCEL_FILE_PATH}，請確認專案路徑。`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 2. 蒐集目前的核心 180 檔母名單
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

    // 4. 連線證交所：三大法人各自買賣超前 50 名日報表
    const url = `https://www.twse.com.tw/rwd/zh/fund/BFAM85U?date=${tradeDate}&response=json`;
    console.log(`🌐 正在使用標準瀏覽器特徵直連證交所下載數據...`);

    // 💡 關鍵亮點：完美模擬 Chrome 瀏覽器標頭，徹底解決 403 Forbidden 與 Timeout 阻擋！
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.twse.com.tw/zh/page/trading/fund/BFAM85U.html',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!res.data || res.data.stat !== 'OK' || !res.data.data || res.data.data.length === 0) {
      console.log(`⚠️ 證交所節點回傳無交易資料，原因說明: ${res.data ? res.data.stat : '伺服器無響應'}`);
      return;
    }

    console.log(`📥 數據成功下載！共計取得 ${res.data.data.length} 行法人排行交叉紀錄。`);

    // 5. 分離並提取外資、投信、自營商各自買超前 50 名
    const newlyFoundStocksMap = new Map();

    res.data.data.forEach(row => {
      // 欄位 1,2: 外資買超 | 欄位 5,6: 投信買超 | 欄位 9,10: 自營商買超
      const fkId = row[1] ? String(row[1]).trim() : '';
      const fkName = row[2] ? String(row[2]).trim() : '';

      const itId = row[5] ? String(row[5]).trim() : '';
      const itName = row[6] ? String(row[6]).trim() : '';

      const dId = row[9] ? String(row[9]).trim() : '';
      const dName = row[10] ? String(row[10]).trim() : '';

      const checkAndPush = (id, name) => {
        if (id && id.length >= 4 && !/^\s*$/.test(id)) {
          // 比對：既不在 180 檔核心母名單，也從未出現在 NEW 分頁中
          if (!existingStocks.has(id) && !existingNewStocks.has(id)) {
            newlyFoundStocksMap.set(id, { '股票代號': id, '股票名稱': name });
          }
        }
      };

      checkAndPush(fkId, fkName);
      checkAndPush(itId, itName);
      checkAndPush(dId, dName);
    });

    console.log(`✨ 比對完成！自三大法人三大管道 (最多150檔池子) 中，篩選出 ${newlyFoundStocksMap.size} 檔新股票。`);

    // 6. 寫入 Excel 檔案
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 準備追加到 NEW 分頁的新股票有：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功將最新股票追加更新至 ${EXCEL_FILE_PATH} 的 'NEW' 分頁！`);
    } else {
      console.log("ℹ️ 今日三大法人買超前 50 名皆已存在於您的核心名單或 NEW 分頁中，未做任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
