// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

// 💡 您的專屬 FinMind Token
const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiQ2h1bmcwNSIsImVtYWlsIjoiY2hpdTYuY2h1bmcwNUBnbWFpbC5jb20iLCJ0b2tlbl92ZXJzaW9uIjowfQ.Jsmprys2d_Vz8x5eeXnLZRn9_MjWpNH7kp77gL3qRz0";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchInvestorTop50(dataset, date, dataId) {
  // 💡 完美的對齊您查到的正統參數：透過 data_id 直擊全市場單一法人
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&start_date=${date}&end_date=${date}&data_id=${dataId}&token=${FINMIND_TOKEN}`;
  
  console.log(`🌐 正在從 FinMind 獲取全市場 [${dataId}] 的當日數據...`);
  const res = await axios.get(url);
  
  if (!res.data || !res.data.data || res.data.data.length === 0) {
    console.log(`⚠️ 提示：[${dataId}] 未能取得數據。`);
    return [];
  }

  // 計算淨買超並排序
  const processed = res.data.data.map(item => {
    // 某些個股可能有多筆紀錄（如自營商拆開），進行基本格式化
    return {
      stock_id: String(item.stock_id).trim(),
      stock_name: item.stock_name ? item.stock_name.trim() : '未知',
      net_buy: (item.buy || 0) - (item.sell || 0) // 淨買超 = 買進 - 賣出
    };
  });

  // 按聚合邏輯，避免同股票拆多筆
  const groupMap = new Map();
  processed.forEach(x => {
    if (!groupMap.has(x.stock_id)) {
      groupMap.set(x.stock_id, { stock_id: x.stock_id, stock_name: x.stock_name, net_buy: 0 });
    }
    groupMap.get(x.stock_id).net_buy += x.net_buy;
  });

  // 排除權證與非4位數的代號，並由大到小排序取前 50 名
  return Object.values(Object.fromEntries(groupMap))
    .filter(x => x.stock_id.length === 4)
    .sort((a, b) => b.net_buy - a.net_buy)
    .slice(0, 50);
}

async function run() {
  try {
    // 鎖定上週五 6/12 進行全量數據驗證
    const targetDate = "2026-06-12"; 
    console.log(`🚀 【FinMind 正確參數進化版】開始提取全市場三大法人各自前 50 名...`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 1. 下載三大法人全市場大數據
    const dataset = "TaiwanStockInstitutionalInvestorsBuySell"; // 或者是您貼的 InstitutionalInvestorsBuySell
    
    // 依序抓取外資、投信、自營商
    const foreignTop50 = await fetchInvestorTop50(dataset, targetDate, "Foreign_Investor");
    await sleep(200); // 禮貌延遲
    const trustTop50 = await fetchInvestorTop50(dataset, targetDate, "Investment_Trust");
    await sleep(200);
    const dealerTop50 = await fetchInvestorTop50(dataset, targetDate, "Dealer_Trading");

    console.log(`📥 撈取排序完成！外資：${foreignTop50.length}檔，投信：${trustTop50.length}檔，自營商：${dealerTop50.length}檔。`);

    // 2. 彙整資料（💡 應您的要求：完全不跟 180 檔比對，全量塞入，方便您人工核對）
    const finalRowsForExcel = [];

    foreignTop50.forEach((x, idx) => {
      finalRowsForExcel.push({ '股票代號': x.stock_id, '股票名稱': x.stock_name, '淨買超(股/張)': x.net_buy, '來源法人': '外資', '法人內排名': idx + 1 });
    });
    trustTop50.forEach((x, idx) => {
      finalRowsForExcel.push({ '股票代號': x.stock_id, '股票名稱': x.stock_name, '淨買超(股/張)': x.net_buy, '來源法人': '投信', '法人內排名': idx + 1 });
    });
    dealerTop50.forEach((x, idx) => {
      finalRowsForExcel.push({ '股票代號': x.stock_id, '股票名稱': x.stock_name, '淨買超(股/張)': x.net_buy, '來源法人': '自營商', '法人內排名': idx + 1 });
    });

    console.log(`📊 準備將這 ${finalRowsForExcel.length} 筆原始排行資料強行寫入 NEW 分頁...`);

    // 3. 覆蓋寫入 Excel
    const newSheetWS = XLSX.utils.json_to_sheet(finalRowsForExcel);
    if (workbook.SheetNames.includes('NEW')) {
      workbook.Sheets['NEW'] = newSheetWS;
    } else {
      XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
    }

    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    console.log(`💾 【人工確認就緒】全市場真實的三大法人各自前 50 名已成功寫入 'NEW' 分頁！`);

  } catch (error) {
    console.error("❌ 執行發生嚴重錯誤:", error.message);
    process.exit(1);
  }
}

run();
