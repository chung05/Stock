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
    console.log(`🚀 開始執行【全市場三大法人各自前 50 名 $\rightarrow$ 交叉比對 180 檔】流程...`);
    console.log(`🎯 當前鎖定全市場交易日: ${tradeDate}`);

    // 1. 檢查並讀取本地的 Stock_list.xlsx
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到檔案: ${EXCEL_FILE_PATH}，請確認專案路徑。`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 2. 蒐集您目前定義的核心 180 檔母名單
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
    console.log(`📊 您定義的核心母名單共有 ${existingStocks.size} 檔股票。`);

    // 3. 讀取現有 'NEW' 分頁裡的股票（避免日後重複塞入）
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

    // 4. 直連證交所官方不設防 CSV 下載節點（三大法人各自買超前 50 名大表）
    const csvUrl = `https://www.twse.com.tw/zh/fund/BFAM85U?date=${tradeDate}&response=csv`;
    console.log(`🌐 正在從證交所高速分流節點下載全市場法人排行 CSV 報表...`);

    const res = await axios.get(csvUrl, {
      responseType: 'text',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!res.data || res.data.includes("錯誤") || res.data.length < 500) {
      console.log(`⚠️ 該日期 (${tradeDate}) 證交所尚未釋出 CSV 報表，或今日為非交易日。`);
      return;
    }

    // 5. 解析 CSV 內容，精準提取「全市場」外資、投信、自營商買超前 50 名
    const lines = res.data.split('\n');
    const allMarketTop150Map = new Map(); // 用來存放全市場篩選出的法人最愛股票

    console.log(`📥 成功下載 CSV，正在掃描全市場三大法人各自前 50 名...`);

    lines.forEach(line => {
      // 移除引號並切分欄位
      const cleanLine = line.replace(/"/g, '');
      const columns = cleanLine.split(',');

      // 證交所 CSV 排行榜行數規則：前面有排名的才是我們要的個股數據
      const rank = parseInt(columns[0], 10);
      if (!isNaN(rank) && rank >= 1 && rank <= 50) {
        
        // 欄位 1, 2: 外資買超前50名個股代號與名稱
        const fkId = columns[1] ? columns[1].trim() : '';
        const fkName = columns[2] ? columns[2].trim() : '';

        // 欄位 5, 6: 投信買超前50名個股代號與名稱
        const itId = columns[5] ? columns[5].trim() : '';
        const itName = columns[6] ? columns[6].trim() : '';

        // 欄位 9, 10: 自營商買超前50名個股代號與名稱
        const dId = columns[9] ? columns[9].trim() : '';
        const dName = columns[10] ? columns[10].trim() : '';

        if (fkId && fkId.length >= 4) allMarketTop150Map.set(fkId, fkName);
        if (itId && itId.length >= 4) allMarketTop150Map.set(itId, itName);
        if (dId && dId.length >= 4) allMarketTop150Map.set(dId, dName);
      }
    });

    console.log(`🎯 成功從全市場中撈出三大法人各自前 50 名，去重後共計 ${allMarketTop150Map.size} 檔股票。`);

    // 6. 核心比對：如果這 150 檔池子裡的股票「不在您的 180 檔核心母名單內」，且「NEW分頁沒記錄過」，就抓出來！
    const newlyFoundStocksMap = new Map();

    allMarketTop150Map.forEach((sName, sId) => {
      if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
        newlyFoundStocksMap.set(sId, {
          '股票代號': sId,
          '股票名稱': sName
        });
      }
    });

    console.log(`✨ 比對完成！全市場法人最愛中，共有 ${newlyFoundStocksMap.size} 檔股票不在您的 180 檔核心名單內！`);

    // 7. 寫入 Excel 的 NEW 分頁
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 抓到符合條件的新股票：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功將全新法人股追加寫入 ${EXCEL_FILE_PATH} 的 'NEW' 分頁中！`);
    } else {
      console.log("ℹ️ 全市場三大法人買超前 50 名的個股，早已全部包含在您的 180 檔核心名單中，故未作任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
