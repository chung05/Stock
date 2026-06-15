// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

async function run() {
  try {
    console.log(`🚀 開始執行【極速明朗版：證交所法人前50名比對】流程...`);

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
    console.log(`📊 目前核心 180 檔名單共有 ${existingStocks.size} 檔股票。`);

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

    // 4. 呼叫政府開放資料庫（移除 ?date= 參數，永遠拿最新交易日）
    const url = `https://openapi.twse.com.tw/v1/fund/TWT38U`;
    console.log(`🌐 正在從開放資料庫下載最新交易日法人排行數據...`);
    
    const res = await axios.get(url, { timeout: 15000 });

    if (!res.data || !Array.isArray(res.data) || res.data.length === 0) {
      console.log(`⚠️ 證交所未回傳任何資料，請確認是否為開盤日。`);
      return;
    }

    console.log(`📥 成功下載法人排行數據，總計拿到 ${res.data.length} 筆資料。`);
    
    // 🔍 【Debug 檢查點】印出前 3 筆原始資料，讓我們知道政府 API 給了什麼欄位
    console.log("----------------------------------------");
    console.log("🔍 [Debug] 證交所回傳的前 3 筆原始資料樣貌：");
    console.log(JSON.stringify(res.data.slice(0, 3), null, 2));
    console.log("----------------------------------------");

    // 5. 解析政府開放資料欄位 (精準對齊標準欄位 Code, Name)
    const newlyFoundStocksMap = new Map();

    res.data.forEach((item, index) => {
      // 政府 OpenAPI 的三大法人合計買超排行欄位固定為 Code (代號) 與 Name (名稱)
      const sId = String(item.Code || '').trim();
      const sName = String(item.Name || '').trim();

      if (sId) {
        // 比對條件：不在核心 180 檔，且不在目前的 NEW 分頁中
        if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
          newlyFoundStocksMap.set(sId, {
            '股票代號': sId,
            '股票名稱': sName
          });
        }
      } else {
        if (index === 0) console.log("⚠️ 警告：無法從欄位 item.Code 取得股票代號，請檢查上方的 Debug 資料。");
      }
    });

    console.log(`✨ 比對完成！在三大法人買超前 50 名中，發現 ${newlyFoundStocksMap.size} 檔不在核心名單內的新股票。`);

    // 6. 如果有新股票，才需要重寫 Excel 檔案
    if (newlyFoundStocksMap.size > 0) {
      // 打印出準備要塞進 Excel 的新股票清單
      console.log("📋 準備加入 NEW 分頁的新股票：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

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
      console.log("ℹ️ 三大法人買超前 50 名皆已在您的核心 180 檔或 NEW 清單中，故 Excel 未做任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
