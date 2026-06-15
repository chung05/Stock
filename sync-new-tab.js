// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

/**
 * 自動判定最新交易日
 * 週末或假期自動回溯至上週五（例如 6/12）
 */
function getLatestTradeDateStr() {
  const now = new Date();
  // 轉成台灣時區 (UTC+8)
  const twTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = twTime.getDay();
  const hour = twTime.getHours();
  const minute = twTime.getMinutes();

  let targetDate = new Date(twTime);

  if (day === 6) { // 週六 -> 拿週五
    targetDate.setDate(twTime.getDate() - 1);
  } else if (day === 0) { // 週日 -> 拿週五
    targetDate.setDate(twTime.getDate() - 2);
  } else if (day === 1 && (hour < 17 || (hour === 17 && minute < 30))) {
    // 週一傍晚 17:30 前執行 -> 拿上週五
    targetDate.setDate(twTime.getDate() - 3);
  } else if (hour < 17 || (hour === 17 && minute < 30)) {
    // 週二至週五傍晚 17:30 前 -> 拿前一天
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
    console.log(`🚀 開始執行【三大法人各自前50名比對】流程...`);
    console.log(`🎯 系統鎖定抓取交易日: ${tradeDate} (若在週末或週一白天執行，會自動鎖定上週五 6/12)`);

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

    // 4. 連線證交所：三大法人各自買賣超前 50 名日報表 (BFAM85U)
    const targetUrl = `https://www.twse.com.tw/rwd/zh/fund/BFAM85U?date=${tradeDate}&response=json`;
    
    // 💡 使用高級公開分流代理，避免海外 IP 被證交所直接防火牆 Timeout 阻擋
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    console.log(`🌐 正在透過高速分流下載 ${tradeDate} 的三大法人各自排行數據...`);
    const res = await axios.get(proxyUrl, { timeout: 15000 });

    if (!res.data || res.data.stat !== 'OK') {
      console.log(`⚠️ 證交所未回傳有效數據，原因: ${res.data ? res.data.stat : '網路無回應'}`);
      return;
    }

    const newlyFoundStocksMap = new Map();

    // 5. 解析數據
    // 證交所 BFAM85U 的資料格式：
    // 外資買超前50名、外資賣超前50名、投信買超前50名... 依序排列
    // 欄位結構：[排名, 外資買超代號, 名稱, 外資賣超代號, 名稱, 投信買超代號, 名稱...]
    // 這裡我們精確捕捉：外資買超(欄位1)、投信買超(欄位5)、自營商買超(欄位9)
    
    if (res.data.data && res.data.data.length > 0) {
      console.log(`📥 成功取得原始日報表，正在提取三大法人買超各前 50 名股票...`);
      
      res.data.data.forEach(row => {
        // 欄位 1: 外資買超代號, 欄位 2: 外資買超名稱
        const fkId = row[1] ? String(row[1]).trim() : '';
        const fkName = row[2] ? String(row[2]).trim() : '';

        // 欄位 5: 投信買超代號, 欄位 6: 投信買超名稱
        const itId = row[5] ? String(row[5]).trim() : '';
        const itName = row[6] ? String(row[6]).trim() : '';

        // 欄位 9: 自營商買超代號, 欄位 10: 自營商買超名稱
        const dId = row[9] ? String(row[9]).trim() : '';
        const dName = row[10] ? String(row[10]).trim() : '';

        // 彙整處理函式
        const checkAndAdd = (sId, sName) => {
          if (sId && sId.length >= 4 && !/^\s*$/.test(sId)) {
            // 核心比對：必須不在 180 檔，且目前 NEW 分頁也還沒記錄過
            if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
              newlyFoundStocksMap.set(sId, { '股票代號': sId, '股票名稱': sName });
            }
          }
        };

        checkAndAdd(fkId, fkName);
        checkAndAdd(itId, itName);
        checkAndAdd(dId, dName);
      });
    }

    console.log(`✨ 比對完成！自三大法人各自買超前 50 名中，共篩選出 ${newlyFoundStocksMap.size} 檔全新黑馬股。`);

    // 6. 寫入 Excel 檔案
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 準備加入 NEW 分頁的新股票有：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功將新發現的股票追加寫入 ${EXCEL_FILE_PATH} 的 'NEW' 分頁中！`);
    } else {
      console.log("ℹ️ 三大法人各自買超前 50 名（扣除重複）皆已包含在您的核心清單中，故 Excel 未作變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
