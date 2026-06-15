// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';
const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiQ2h1bmcwNSIsImVtYWlsIjoiY2hpdTYuY2h1bmcwNUBnbWFpbC5jb20iLCJ0b2tlbl92ZXJzaW9uIjowfQ.Jsmprys2d_Vz8x5eeXnLZRn9_MjWpNH7kp77gL3qRz0";

// 自動計算最新交易日
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
  return `${yyyy}-${mm}-${dd}`;
}

async function run() {
  try {
    const tradeDate = getLatestTradeDateStr();
    console.log(`🚀 【FinMind 寬表正統版】開始全市場法人三大管道前 50 名篩選流程...`);
    console.log(`🎯 當前鎖定交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 1. 蒐集目前的核心 180 檔母名單 (TW50, TW100, MSCI)
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
    console.log(`📊 您定義的核心 180 檔母名單共收集到: ${existingStocks.size} 檔股票。`);

    // 2. 讀取現有 'NEW' 分頁裡的股票
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

    // 3. 呼叫寬表接口
    // 💡 ✅ 終極修正：Wide 寬表接口依法不帶 end_date 參數，否則必噴 400 錯誤！
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySellWide&start_date=${tradeDate}&token=${FINMIND_TOKEN}`;
    
    console.log(`🌐 正在透過您的 Token 直連 FinMind 寬表數據分流接口...`);
    const res = await axios.get(url, {
      headers: { 'accept': 'application/json' }
    });

    if (!res.data || !res.data.data || res.data.data.length === 0) {
      console.log(`⚠️ 提示：該日期 (${tradeDate}) 寬表接口未回傳數據。`);
      return;
    }

    console.log(`📥 成功下載全市場寬表！總計收到 ${res.data.data.length} 檔全市場股票的整合籌碼紀錄。`);

    // 4. 針對全市場的所有個股，分別依據外資、投信、自營商計算「淨買超 = 買進 - 賣出」
    const marketStocks = res.data.data.map(item => {
      const sId = String(item.stock_id).trim();
      return {
        stock_id: sId,
        stock_name: item.stock_name ? item.stock_name.trim() : '未知',
        // 寬表標準 Schema 欄位對齊：
        foreign_net: (item.Foreign_Investor_buy || 0) - (item.Foreign_Investor_sell || 0),
        trust_net: (item.Investment_Trust_buy || 0) - (item.Investment_Trust_sell || 0),
        dealer_net: (item.Dealer_buy || 0) - (item.Dealer_sell || 0)
      };
    }).filter(x => x.stock_id.length === 4); // 僅保留 4 位數標準個股

    // 5. 【真正全市場大排序】各自精準挑出前 50 名
    const top50Foreign = [...marketStocks].sort((a, b) => b.foreign_net - a.foreign_net).slice(0, 50);
    const top50Trust = [...marketStocks].sort((a, b) => b.trust_net - a.trust_net).slice(0, 50);
    const top50Dealer = [...marketStocks].sort((a, b) => b.dealer_net - a.dealer_net).slice(0, 50);

    // 把三大法人的前 50 名放進同一個不重複的「當日強勢法人候選池」
    const candidatePool = new Map();
    top50Foreign.forEach(x => candidatePool.set(x.stock_id, x.stock_name));
    top50Trust.forEach(x => candidatePool.set(x.stock_id, x.stock_name));
    top50Dealer.forEach(x => candidatePool.set(x.stock_id, x.stock_name));

    console.log(`🎯 全市場三大法人前 50 名（去重後）共計 ${candidatePool.size} 檔股票進入比對程序。`);

    // 6. 核心交叉比對：必須不在 180 檔核心母名單，且 NEW 分頁以前沒記錄過
    const newlyFoundStocksMap = new Map();

    candidatePool.forEach((sName, sId) => {
      if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
        newlyFoundStocksMap.set(sId, {
          '股票代號': sId,
          '股票名稱': sName
        });
      }
    });

    console.log(`✨ 比對完成！發現共有 ${newlyFoundStocksMap.size} 檔法人前 50 名股票，不屬於您的 180 檔核心清單！`);

    // 7. 將新整理出來的股票「增量追加」加入到 NEW 分頁中
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 準備追加寫入 NEW 分頁的新個股：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 成功！已將最新比對出的新股票增量追加更新至 ${EXCEL_FILE_PATH} 的 'NEW' 分頁。`);
    } else {
      console.log("ℹ️ 今日全市場三大法人買超前 50名已全部包含在您的 180 檔或 NEW 分頁中，Excel 未作任何變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
