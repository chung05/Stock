// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

// 讀取 GitHub Actions 環境變數
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;
const EXCEL_FILE_PATH = './Stock_list.xlsx'; // 本地檔案路徑

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getPastDates(daysCount = 5) {
  const dates = [];
  let d = new Date();
  while (dates.length < daysCount) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) { // 排除週六日
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

async function run() {
  try {
    console.log("🚀 開始執行【三大法人前50名比對，更新 Stock_list.xlsx 'NEW' 分頁】流程...");

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

    // 3. 讀取現有 'NEW' 分頁裡的股票（避免日後重疊）
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

    // 4. 呼叫 FinMind API 獲取最近幾天的法人籌碼
    const datesToCheck = getPastDates(5);
    const startDate = datesToCheck[datesToCheck.length - 1];
    
    console.log(`🌐 正在獲取 FinMind 法人買賣超資料 (自 ${startDate} 起)...`);
    const fmUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&start_date=${startDate}&token=${FINMIND_TOKEN}`;
    const fmRes = await axios.get(fmUrl);
    
    if (!fmRes.data || !fmRes.data.data || fmRes.data.data.length === 0) {
      throw new Error("未能從 FinMind API 獲取有效數據。");
    }

    const allData = fmRes.data.data;
    // 找出數據裡最新的實際交易日
    const latestDate = allData.reduce((max, item) => item.date > max ? item.date : max, allData[0].date);
    console.log(`📅 最新偵測交易日: ${latestDate}`);

    // 過濾出最新交易日的資料
    const latestData = allData.filter(item => item.date === latestDate);

    // 5. 分別對三大法人進行「淨買超 = 買進 - 賣出」排行並過濾
    const targetInvestors = ['Foreign_Investor', 'Investment_Trust', 'Dealer_Trading'];
    const newlyFoundStocksMap = new Map(); // 確保今天新加入的代號不重複

    targetInvestors.forEach(investor => {
      // 篩選特定法人
      const invData = latestData.filter(item => item.name.toLowerCase().includes(investor.toLowerCase()));

      // 聚合相同股票（如自營商拆成避險與自行買賣）
      const stockGroup = {};
      invData.forEach(item => {
        if (!stockGroup[item.stock_id]) {
          stockGroup[item.stock_id] = { stock_id: item.stock_id, stock_name: item.stock_name, net_buy: 0 };
        }
        stockGroup[item.stock_id].net_buy += (item.buy - item.sell);
      });

      // 排序取前 50 名
      const sortedTop50 = Object.values(stockGroup)
        .sort((a, b) => b.net_buy - a.net_buy)
        .slice(0, 50);

      // 比對是否符合新股資格
      sortedTop50.forEach(stock => {
        const sId = String(stock.stock_id).trim();
        // 條件：不在 180 檔核心 且 不在 現有的 NEW 分頁中
        if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
          newlyFoundStocksMap.set(sId, {
            '股票代號': sId,
            '股票名稱': stock.stock_name
          });
        }
      });
    });

    console.log(`✨ 今日比對完成！新增了 ${newlyFoundStocksMap.size} 檔不在核心名單內的新股票。`);

    // 6. 寫回 Excel 檔案
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

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
