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
    console.log(`🚀 【150檔全量驗證模式】證交所 T86 全市場數據下載與對照標記流程啟動...`);
    console.log(`🎯 當前鎖定交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 1. 蒐集目前的核心 180 檔母名單 (用來判斷是否重複)
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
    console.log(`📊 您定義的核心 180 檔母名單共有: ${existingStocksSet.size} 檔股票。`);

    // 2. 直連證交所下載全市場 T86 數據
    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${tradeDate}&selectType=ALL&response=json`;
    console.log(`🌐 正在從證交所下載全市場法人日報大表...`);

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

    // 3. 過濾 ETF 與權證，僅保留 4 位數純個股
    const pureStocksPool = [];
    res.data.data.forEach(row => {
      const sId = String(row[0]).trim();
      const sName = String(row[1]).trim();

      // 嚴格濾網：代號必須剛好是 4 位純數字
      if (/^\d{4}$/.test(sId)) {
        const parseNetVolume = (val) => {
          if (!val) return 0;
          return parseInt(String(val).replace(/,/g, ''), 10) || 0;
        };

        pureStocksPool.push({
          stock_id: sId,
          stock_name: sName,
          foreign_net: parseNetVolume(row[4]),  // 外資買賣超
          trust_net: parseNetVolume(row[9]),    // 投信買賣超
          dealer_net: parseNetVolume(row[10])   // 自營商買賣超
        });
      }
    });
    console.log(`洗淨完畢！全市場共篩選出 ${pureStocksPool.length} 檔純本土個股。`);

    // 4. 【全市場大排序】各自精準挑出前 50 名個股
    const top50Foreign = [...pureStocksPool].sort((a, b) => b.foreign_net - a.foreign_net).slice(0, 50);
    const top50Trust = [...pureStocksPool].sort((a, b) => b.trust_net - a.trust_net).slice(0, 50);
    const top50Dealer = [...pureStocksPool].sort((a, b) => b.dealer_net - a.dealer_net).slice(0, 50);

    // 5. 彙整這 150 檔資料，並進行核心 180 檔的比對與標記備註
    const final150Rows = [];

    const processAndTag = (top50List, investorName) => {
      top50List.forEach((stock, index) => {
        const sId = stock.stock_id;
        
        // 判定購買張數
        let volume = 0;
        if (investorName === '外資') volume = stock.foreign_net;
        if (investorName === '投信') volume = stock.trust_net;
        if (investorName === '自營商') volume = stock.dealer_net;

        // 💡 核心比對機制：檢查是否出現在原本的 180 檔母名單中
        const remark = existingStocksSet.has(sId) ? "重複的" : "新發現個股";

        final150Rows.push({
          '股票代號': sId,
          '股票名稱': stock.stock_name,
          '購買張數': volume,
          '來源法人': investorName,
          '法人內排名': index + 1,
          '比對備註': remark,
          '交易日期': tradeDate
        });
      });
    };

    // 依序全量灌入，不做任何刪減
    processAndTag(top50Foreign, '外資');
    processAndTag(top50Trust, '投信');
    processAndTag(top50Dealer, '自營商');

    console.log(`📊 150 檔法人最愛個股資料已全部處理完畢！`);
    
    // 計算一下統計數據印在 Log 上給您看
    const duplicateCount = final150Rows.filter(x => x['比對備註'] === '重複的').length;
    console.log(`💡 數據前瞻：這 150 筆紀錄中，有 ${duplicateCount} 筆與您的 180 檔重疊，有 ${150 - duplicateCount} 筆是核心外的新個股。`);

    // 6. 暴力直接覆蓋 Excel 的 'NEW' 分頁，不保留歷史，專供您此時人工核對
    const newSheetWS = XLSX.utils.json_to_sheet(final150Rows);
    
    if (workbook.SheetNames.includes('NEW')) {
      workbook.Sheets['NEW'] = newSheetWS;
    } else {
      XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
    }

    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    console.log(`💾 【全量對照表已就緒】150 行原始排行資料已寫入 ${EXCEL_FILE_PATH} 的 'NEW' 分頁！`);

  } catch (error) {
    console.error("❌ 執行發生嚴重錯誤:", error.message);
    process.exit(1);
  }
}

run();
