// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

async function run() {
  try {
    console.log(`🚀 開始執行【FinMind 正統回歸版：三大法人各自前50名比對】流程...`);

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

    // 4. 呼叫 FinMind 籌碼 API
    // 💡 注意：對齊 sync-data.js 成功模式，故意不帶任何 token，走純免費額度通道，防止 400/403 阻擋
    // 鎖定 2026-06-12 (上週五)
    const targetDate = "2026-06-12";
    console.log(`🌐 正在從 FinMind 免費分流接口下載 ${targetDate} 的法人籌碼數據...`);
    
    const fmUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&start_date=${targetDate}&end_date=${targetDate}`;
    const res = await axios.get(fmUrl);

    if (!res.data || !res.data.data || res.data.data.length === 0) {
      console.log(`⚠️ FinMind 未回傳任何數據，可能該日期無交易或額度受限。`);
      return;
    }

    console.log(`📥 成功取得 FinMind 籌碼資料，總計 ${res.data.data.length} 筆原始記錄。`);

    // 5. 將資料按【外資、投信、自營商】分開計算各自的「淨買超 = 買進 - 賣出」
    const investors = {
      'Foreign_Investor': {}, // 外資
      'Investment_Trust': {}, // 投信
      'Dealer_Trading': {}    // 自營商
    };

    res.data.data.forEach(item => {
      const name = item.name;
      const sId = String(item.stock_id).trim();
      const sName = item.stock_name;
      const netBuy = item.buy - item.sell; // 淨買超張數/股數

      // 分類歸檔
      Object.keys(investors).forEach(invType => {
        if (name && name.toLowerCase().includes(invType.toLowerCase())) {
          if (!investors[invType][sId]) {
            investors[invType][sId] = { stock_id: sId, stock_name: sName, net_buy: 0 };
          }
          investors[invType][sId].net_buy += netBuy;
        }
      });
    });

    // 提取三大法人各自前 50 名，並放入比對池中
    const newlyFoundStocksMap = new Map();

    Object.keys(investors).forEach(invType => {
      const sortedTop50 = Object.values(investors[invType])
        .sort((a, b) => b.net_buy - a.net_buy)
        .slice(0, 50);

      sortedTop50.forEach(stock => {
        const sId = stock.stock_id;
        // 核心比對條件：不在核心 180 檔，且目前的 NEW 分頁也沒有過
        if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
          newlyFoundStocksMap.set(sId, {
            '股票代號': sId,
            '股票名稱': stock.stock_name
          });
        }
      });
    });

    console.log(`✨ 比對完成！三大法人各自前 50 名（總計最多150檔池子）比對後，共有 ${newlyFoundStocksMap.size} 檔新股票。`);

    // 6. 寫入 Excel 檔案
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 準備追加到 NEW 分頁的新股票：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功將最新股票寫入 ${EXCEL_FILE_PATH} 的 'NEW' 分頁！`);
    } else {
      console.log("ℹ️ 三大法人各自買超前 50 名經去重與比對後，皆已在您的核心名單中，Excel 未做任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
