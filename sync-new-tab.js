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
    console.log(`🚀 【正式自動化更新版】全市場法人前 50 名比對流程啟動...`);
    console.log(`🎯 當前鎖定交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 1. 蒐集目前的核心 180 檔母名單
    const coreSheets = ['TW50', 'TW100', 'MSCI'];
    const existingStocksSet = new Set();
    coreSheets.forEach(sheetName => {
      if (workbook.SheetNames.includes(sheetName)) {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        json.forEach(row => {
          const sId = String(row['股票代號'] || row['代號'] || '').trim();
          if (sId) existingStocksSet.add(sId);
        });
      }
    });
    console.log(`📊 您定義的核心 180 檔母名單庫共有: ${existingStocksSet.size} 檔股票。`);

    // 2. 讀取現有 'NEW' 分頁裡的歷史股票（💡 僅用來增量追加時「防止完全同代號重複寫入」）
    const historicalNewStocksSet = new Set();
    let currentNewRows = [];
    if (workbook.SheetNames.includes('NEW')) {
      const newSheet = workbook.Sheets['NEW'];
      currentNewRows = XLSX.utils.sheet_to_json(newSheet);
      currentNewRows.forEach(row => {
        const sId = String(row['股票代號'] || row['代號'] || '').trim();
        if (sId) historicalNewStocksSet.add(sId);
      });
    }
    console.log(`📂 目前 'NEW' 分頁中已累積了 ${historicalNewStocksSet.size} 檔歷史篩選股。`);

    // 3. 直連下載證交所 T86 全市場大表
    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${tradeDate}&selectType=ALL&response=json`;
    console.log(`🌐 正在直連證交所下載全市場大表...`);

    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://www.twse.com.tw/zh/page/trading/foreign/t86.html'
      }
    });

    if (!res.data || res.data.stat !== 'OK' || !res.data.data || res.data.data.length === 0) {
      console.log(`⚠️ 提示：該日期 (${tradeDate}) 證交所尚未釋出資料或今日休市。`);
      return;
    }

    // 4. 洗淨過濾：僅保留 4 位數純個股
    const pureStocksPool = [];
    res.data.data.forEach(row => {
      const sId = String(row[0]).trim();
      const sName = String(row[1]).trim();

      if (/^\d{4}$/.test(sId)) {
        const parseNetVolume = (val) => {
          if (!val) return 0;
          return parseInt(String(val).replace(/,/g, ''), 10) || 0;
        };

        pureStocksPool.push({
          stock_id: sId,
          stock_name: sName,
          foreign_net: parseNetVolume(row[4]),
          trust_net: parseNetVolume(row[9]),
          dealer_net: parseNetVolume(row[10])
        });
      }
    });

    // 5. 【全市場純個股大排序】各自挑出前 50 名
    const top50Foreign = [...pureStocksPool].sort((a, b) => b.foreign_net - a.foreign_net).slice(0, 50);
    const top50Trust = [...pureStocksPool].sort((a, b) => b.trust_net - a.trust_net).slice(0, 50);
    const top50Dealer = [...pureStocksPool].sort((a, b) => b.dealer_net - a.dealer_net).slice(0, 50);

    // 6. 彙整今天上榜的所有法人最愛個股（在記憶體中先進行「今日代號去重」）
    // key: 股票代號, value: 股票資訊
    const todayCandidateMap = new Map();

    const collectMarketTop50 = (top50List, investorName) => {
      top50List.forEach((stock) => {
        const sId = stock.stock_id;
        
        let volume = 0;
        if (investorName === '外資') volume = stock.foreign_net;
        if (investorName === '投信') volume = stock.trust_net;
        if (investorName === '自營商') volume = stock.dealer_net;

        // 必須是有實質買超的股票
        if (volume > 0) {
          if (!todayCandidateMap.has(sId)) {
            todayCandidateMap.set(sId, {
              '股票代號': sId,
              '股票名稱': stock.stock_name,
              '主要買超法人': investorName,
              '當日買超張數': volume
            });
          } else {
            // 如果同時被多個法人買超，更新說明標記
            const existItem = todayCandidateMap.get(sId);
            if (!existItem['主要買超法人'].includes(investorName)) {
              existItem['主要買超法人'] += ` + ${investorName}`;
              // 張數累加
              existItem['當日買超張數'] += volume;
            }
          }
        }
      });
    };

    collectMarketTop50(top50Foreign, '外資');
    collectMarketTop50(top50Trust, '投信');
    collectMarketTop50(top50Dealer, '自營商');

    // 7. 核心交叉比對：必須不在 180 檔內，且「今天這批新發現」以前在 NEW 分頁沒被記錄過
    const newlyFoundStocksList = [];

    todayCandidateMap.forEach((stock, sId) => {
      // 💡 ✅ 修正Bug：只跟核心 180 檔比對！如果不在 180 檔內，且歷史 NEW 分頁也還沒記錄過，才是真正的今日新股！
      if (!existingStocksSet.has(sId) && !historicalNewStocksSet.has(sId)) {
        newlyFoundStocksList.push({
          '股票代號': sId,
          '股票名稱': stock['股票名稱'],
          '主要買超法人': stock['主要買超法人'],
          '當日買超張數': stock['當日買超張數'],
          '偵測日期': tradeDate
        });
      }
    });

    console.log(`✨ 比對完成！今日全市場法人最愛中，精準篩選出 ${newlyFoundStocksList.length} 檔全新黑馬股！`);

    // 8. 增量追加寫入 Excel 檔案
    if (newlyFoundStocksList.length > 0) {
      console.log("📋 準備追加寫入 NEW 分頁的新股有：", newlyFoundStocksList.map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      // 追加在舊歷史紀錄之後
      const finalNewList = [...currentNewRows, ...newlyFoundStocksList];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功！已將這 ${newlyFoundStocksList.length} 檔不重複的全新股票追加至 'NEW' 分頁！`);
    } else {
      console.log("ℹ️ 今日三大法人買超前 50 名經去重與 180 檔比對後，皆已在您的核心清單或歷史 NEW 紀錄中，未作任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生嚴重錯誤:", error.message);
    process.exit(1);
  }
}

run();
