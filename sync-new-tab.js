// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

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
    console.log(`🚀 【純個股篩選版】證交所全市場 T86 數據一次性抓取與交叉比對流程啟動...`);
    console.log(`🎯 當前鎖定交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 1. 蒐集目前的核心 180 檔母名單
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
    console.log(`📊 您定義的核心 180 檔母名單共有: ${existingStocks.size} 檔股票。`);

    // 2. 讀取現有 'NEW' 分頁裡的股票（增量追加保護機制）
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
    console.log(`📂 目前 'NEW' 分頁中已有 ${existingNewStocks.size} 檔歷史過濾股票。`);

    // 3. 模擬瀏覽器直連下載證交所 T86 大數據
    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${tradeDate}&selectType=ALL&response=json`;
    console.log(`🌐 正在下載全市場法人日報大表...`);

    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://www.twse.com.tw/zh/page/trading/foreign/t86.html'
      }
    });

    if (!res.data || res.data.stat !== 'OK' || !res.data.data || res.data.data.length === 0) {
      console.log(`⚠️ 提示：該日期 (${tradeDate}) 證交所尚未釋出有效開盤數據。`);
      return;
    }

    console.log(`📥 下載成功！全市場共收到 ${res.data.data.length} 筆原始證券紀錄。`);

    // 4. 解析並精準【過濾 ETF 與權證】，僅保留純個股
    const pureStocksPool = [];

    res.data.data.forEach(row => {
      const sId = String(row[0]).trim();
      const sName = String(row[1]).trim();

      // 💡 核心濾網：使用正則表達式，強制規定代號必須剛好是「4位數字」，完美剔除所有 ETF (6位/英文) 與權證！
      if (/^\d{4}$/.test(sId)) {
        
        const parseNetVolume = (val) => {
          if (!val) return 0;
          return parseInt(String(val).replace(/,/g, ''), 10) || 0;
        };

        pureStocksPool.push({
          stock_id: sId,
          stock_name: sName,
          foreign_net: parseNetVolume(row[4]),  // 外資買賣超張數
          trust_net: parseNetVolume(row[9]),    // 投信買賣超張數
          dealer_net: parseNetVolume(row[10])   // 自營商買賣超張數
        });
      }
    });

    console.log(`🧼 過濾完畢！剔除 ETF、存託憑證與權證雜質後，共計有 ${pureStocksPool.length} 檔純本土個股進入大排行...`);

    // 5. 【全市場純個股大排序】各自挑出前 50 名
    const top50Foreign = [...pureStocksPool].sort((a, b) => b.foreign_net - a.foreign_net).slice(0, 50);
    const top50Trust = [...pureStocksPool].sort((a, b) => b.trust_net - a.trust_net).slice(0, 50);
    const top50Dealer = [...pureStocksPool].sort((a, b) => b.dealer_net - a.dealer_net).slice(0, 50);

    // 6. 彙整與「180 檔母名單 + 歷史NEW名單」交叉比對
    // 用一個 Map 收集今天篩選出來、且符合資格的新股票
    const newlyFoundStocksMap = new Map();

    const checkAndCollect = (top50List, investorName) => {
      top50List.forEach((stock, index) => {
        // 規則：淨買超必須大於 0
        if (stock.foreign_net > 0 || stock.trust_net > 0 || stock.dealer_net > 0) {
          const sId = stock.stock_id;
          
          // 💡 核心比對：必須不在 180 檔母名單，且舊的 NEW 分頁也從未重複記錄過！
          if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
            
            // 決定要記錄的張數
            let volume = 0;
            if (investorName === '外資') volume = stock.foreign_net;
            if (investorName === '投信') volume = stock.trust_net;
            if (investorName === '自營商') volume = stock.dealer_net;

            newlyFoundStocksMap.set(sId, {
              '股票代號': sId,
              '股票名稱': stock.stock_name,
              '買超張數': volume,
              '來源法人': investorName,
              '法人內排名': index + 1,
              '抓取日期': tradeDate
            });
          }
        }
      });
    };

    // 依序丟入三大法人池進行交叉比對
    checkAndCollect(top50Foreign, '外資');
    checkAndCollect(top50Trust, '投信');
    checkAndCollect(top50Dealer, '自營商');

    console.log(`✨ 比對完成！全市場法人最愛中，共有 ${newlyFoundStocksMap.size} 檔全新個股不在您的 180 檔核心名單內！`);

    // 7. 將新整理出來的個股增量追加加入 NEW 分頁
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 準備追加寫入 NEW 分頁的新個股：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}(${x.來源法人}:${x.買超張數}張)`).join(', '));

      // 轉換成資料陣列並與原有 NEW 分頁合併
      const newRows = Array.from(newlyFoundStocksMap.values());
      const finalNewList = [...currentNewRows, ...newRows];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 增量追加完畢！已成功將 ${newRows.length} 檔全新黑馬股追加更新至 ${EXCEL_FILE_PATH} 的 'NEW' 分頁！`);
    } else {
      console.log("ℹ️ 今日全台灣前 50 名個股已被核心 180 檔名單完全覆蓋，Excel 未作任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生嚴重錯誤:", error.message);
    process.exit(1);
  }
}

run();
