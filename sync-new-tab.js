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
    console.log(`🚀 【證交所大數據直連版】全市場一次性下載流程啟動...`);
    console.log(`🎯 當前鎖定交易日 (自動對齊選單日期): ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 1. 蒐集您目前定義的核心 180 檔母名單
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
    console.log(`📊 母名單核心庫共收集到: ${existingStocks.size} 檔股票。`);

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

    // 3. 發送封包模擬網頁點選（ALL = 項目選全部 / response=json = 下載數據）
    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${tradeDate}&selectType=ALL&response=json`;
    console.log(`🌐 正在向證交所發送條件網址：${url}`);

    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://www.twse.com.tw/zh/page/trading/foreign/t86.html'
      }
    });

    if (!res.data || res.data.stat !== 'OK' || !res.data.data || res.data.data.length === 0) {
      console.log(`⚠️ 提示：證交所回應【${res.data ? res.data.stat : '無響應'}】，代表當天無有效資料，流程安全跳過。`);
      return;
    }

    console.log(`📥 成功擊穿網頁限制！全市場原始大表下載成功，共計 ${res.data.data.length} 筆資料。`);

    // 🔍 【透明化檢查點】直接印出第 1 筆股票的原始陣列，確保我們看得到欄位
    console.log("--------------------------------------------------");
    console.log("🔍 [Debug 檢查] 證交所原始數據第 1 筆欄位長相：");
    console.log(JSON.stringify(res.data.data[0]));
    console.log("--------------------------------------------------");

    // 4. 解析證交所 T86 個股籌碼欄位 (單位：張)
    // 依據官方最新定義：
    // [0]=代號, [1]=名稱, [4]=外資淨買超, [9]=投信淨買超, [10]=自營商淨買超
    const marketStocks = res.data.data.map(row => {
      const parseNet = (val) => {
        if (!val) return 0;
        return parseInt(String(val).replace(/,/g, ''), 10) || 0;
      };

      return {
        stock_id: String(row[0]).trim(),
        stock_name: String(row[1]).trim(),
        foreign_net: parseNet(row[4]),
        trust_net: parseNet(row[9]),
        dealer_net: parseNet(row[10])
      };
    }).filter(x => x.stock_id.length === 4); // 剔除權證、認購與 ETF 指數雜質

    // 5. 【記憶體全市場大排序】各自挑出前 50 名
    const top50Foreign = [...marketStocks].sort((a, b) => b.foreign_net - a.foreign_net).slice(0, 50);
    const top50Trust = [...marketStocks].sort((a, b) => b.trust_net - a.trust_net).slice(0, 50);
    const top50Dealer = [...marketStocks].sort((a, b) => b.dealer_net - a.dealer_net).slice(0, 50);

    // 彙整去重
    const candidatePool = new Map();
    top50Foreign.forEach(x => { if (x.foreign_net > 0) candidatePool.set(x.stock_id, x.stock_name); });
    top50Trust.forEach(x => { if (x.trust_net > 0) candidatePool.set(x.stock_id, x.stock_name); });
    top50Dealer.forEach(x => { if (x.dealer_net > 0) candidatePool.set(x.stock_id, x.stock_name); });

    console.log(`🎯 全市場排行前 50 名彙整完畢（扣除淨賣超），共有 ${candidatePool.size} 檔強勢股等待比對。`);

    // 6. 核心比對：必須不在 180 檔內，且 NEW 分頁以前沒記錄過
    const newlyFoundStocksMap = new Map();

    candidatePool.forEach((sName, sId) => {
      if (!existingStocks.has(sId) && !existingNewStocks.has(sId)) {
        newlyFoundStocksMap.set(sId, {
          '股票代號': sId,
          '股票名稱': sName
        });
      }
    });

    console.log(`✨ 比對完成！全市場法人最愛中，共有 ${newlyFoundStocksMap.size} 檔新黑馬股不在您的 180 檔清單內！`);

    // 7. 寫入增量至 NEW 分頁
    if (newlyFoundStocksMap.size > 0) {
      console.log("📋 準備追加至 NEW 分頁的新股：", Array.from(newlyFoundStocksMap.values()).map(x => `${x.股票代號} ${x.股票名稱}`).join(', '));

      const finalNewList = [...currentNewRows, ...Array.from(newlyFoundStocksMap.values())];
      const newSheetWS = XLSX.utils.json_to_sheet(finalNewList);

      if (workbook.SheetNames.includes('NEW')) {
        workbook.Sheets['NEW'] = newSheetWS;
      } else {
        XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
      }

      XLSX.writeFile(workbook, EXCEL_FILE_PATH);
      console.log(`💾 增量追加完畢，Stock_list.xlsx 已自動更新推送！`);
    } else {
      console.log("ℹ️ 今日全市場前 50 名已被核心 180 檔完全封鎖重疊，Excel 未作變更。");
    }

  } catch (error) {
    console.error("❌ 執行發生嚴重錯誤:", error.message);
    process.exit(1);
  }
}

run();
