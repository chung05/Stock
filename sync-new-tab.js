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
    console.log(`🚀 【嚴格架構重構版】三大法人各自前50大個股比對程序啟動...`);
    console.log(`🎯 當前鎖定交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // ========================================================
    // 🧱 核心母名單收集：蒐集目前的核心 180 檔母名單
    // ========================================================
    const coreSheets = ['TW50', 'TW100', 'MSCI'];
    const coreStocksSet = new Set();
    coreSheets.forEach(sheetName => {
      if (workbook.SheetNames.includes(sheetName)) {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        json.forEach(row => {
          const sId = String(row['股票代號'] || row['代號'] || '').trim();
          if (sId) coreStocksSet.add(sId);
        });
      }
    });
    console.log(`📊 載入核心 180 檔母名單完畢，共計: ${coreStocksSet.size} 檔股票。`);

    // ========================================================
    // 🧹 1. 規則一：強制清空/更換舊的 NEW 分頁資料，不保留歷史
    // ========================================================
    console.log(`🧹 [執行規則一]：全面清空、重置 Excel 中的 'NEW' 分頁資料。`);
    let tempNewRowsPool = []; // 這是我們在步驟 2 用來存放各自比對完後的臨時池

    // ========================================================
    // 🌐 網絡數據下載：直連證交所下載全市場原始大表
    // ========================================================
    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${tradeDate}&selectType=ALL&response=json`;
    console.log(`🌐 正在直連證交所下載全市場原始大表...`);

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

    // ========================================================
    // 🧼 洗淨與分離：提取並將全市場「純個股」放入各自法人帳本
    // ========================================================
    const foreignBooks = [];
    const trustBooks = [];
    const dealerBooks = [];

    res.data.data.forEach(row => {
      const sId = String(row[0]).trim();
      const sName = String(row[1]).trim();

      // 強制濾網：只留 4 位數字純個股，排除所有 ETF、權證
      if (/^\d{4}$/.test(sId)) {
        const parseNetVolume = (val) => {
          if (!val) return 0;
          return parseInt(String(val).replace(/,/g, ''), 10) || 0;
        };

        const fNet = parseNetVolume(row[4]);  // 外資買賣超
        const tNet = parseNetVolume(row[9]);  // 投信買賣超
        const dNet = parseNetVolume(row[10]); // 自營商買賣超

        if (fNet > 0) foreignBooks.push({ sId, sName, volume: fNet });
        if (tNet > 0) trustBooks.push({ sId, sName, volume: tNet });
        if (dNet > 0) dealerBooks.push({ sId, sName, volume: dNet });
      }
    });

    // ========================================================
    // 📊 2. 規則二：各自挑出前 50 大，並「立即與 180 檔比對、刪除重複」
    // ========================================================
    
    // (A) 外資買超前 50 大個股資料
    const top50Foreign = foreignBooks.sort((a, b) => b.volume - a.volume).slice(0, 50);
    console.log(`🔍 [外資線] 全市場前 50 大個股篩選完畢，正在與 180 檔進行過濾比對...`);
    top50Foreign.forEach(stock => {
      // 💡 與 180 檔比對：如果不在 180 檔核心名單內，才允許保留放入池中
      if (!coreStocksSet.has(stock.sId)) {
        tempNewRowsPool.push({ '股票代號': stock.sId, '股票名稱': stock.sName, '買超張數': stock.volume, '來源法人': '外資' });
      }
    });

    // (B) 新增投信買超前 50 大個股資料
    const top50Trust = trustBooks.sort((a, b) => b.volume - a.volume).slice(0, 50);
    console.log(`🔍 [投信線] 全市場前 50 大個股篩選完畢，正在與 180 檔進行過濾比對...`);
    top50Trust.forEach(stock => {
      // 💡 與 180 檔比對：如果不在 180 檔核心名單內，才允許保留追加放入池中
      if (!coreStocksSet.has(stock.sId)) {
        tempNewRowsPool.push({ '股票代號': stock.sId, '股票名稱': stock.sName, '買超張數': stock.volume, '來源法人': '投信' });
      }
    });

    // (C) 新增自營商買超前 50 大個股資料
    const top50Dealer = dealerBooks.sort((a, b) => b.volume - a.volume).slice(0, 50);
    console.log(`🔍 [自營商線] 全市場前 50 大個股篩選完畢，正在與 180 檔進行過濾比對...`);
    top50Dealer.forEach(stock => {
      // 💡 與 180 檔比對：如果不在 180 檔核心名單內，才允許保留追加放入池中
      if (!coreStocksSet.has(stock.sId)) {
        tempNewRowsPool.push({ '股票代號': stock.sId, '股票名稱': stock.sName, '買超張數': stock.volume, '來源法人': '自營商' });
      }
    });

    console.log(`📋 三大法人各自前 50 大與 180 檔比對重疊過濾後，臨時池內目前共有 ${tempNewRowsPool.length} 筆資料。`);

    // ========================================================
    // 🧼 3. 規則三：最後將 NEW 池子中的個股代號進行自我比對，若重複，僅保留一筆
    // ========================================================
    console.log(`🧼 [執行規則三]：啟動個股代號自我比對去重機制，重複者僅保留一筆。`);
    
    const finalUniqueRowsSet = [];
    const uniqueCheckSet = new Set(); // 用來在記憶體中掃描是否重複出現過

    tempNewRowsPool.forEach(row => {
      const sId = row['股票代號'];
      // 💡 自我代號比對：如果這個代號在 NEW 池子前面「從來沒有出現過」，才准許保留寫入
      if (!uniqueCheckSet.has(sId)) {
        uniqueCheckSet.add(sId);
        finalUniqueRowsSet.push(row); // 僅保留第一筆看到的資料
      }
    });

    console.log(`✨ 自我比對完成！原本的 ${tempNewRowsPool.length} 筆資料經自我代號去重後，最終精煉出 ${finalUniqueRowsSet.length} 檔不重複個股！`);

    // ========================================================
    // 💾 寫入更新 Excel 檔案
    // ========================================================
    const newSheetWS = XLSX.utils.json_to_sheet(finalUniqueRowsSet);
    
    if (workbook.SheetNames.includes('NEW')) {
      workbook.Sheets['NEW'] = newSheetWS;
    } else {
      XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
    }

    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    console.log(`💾 成功！全新乾淨且嚴格合規的 ${finalUniqueRowsSet.length} 檔個股已全數更換寫入 'NEW' 分頁！`);

  } catch (error) {
    console.error("❌ 執行發生嚴重錯誤:", error.message);
    process.exit(1);
  }
}

run();
