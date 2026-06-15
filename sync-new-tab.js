// sync-new-tab.js
const fs = require('fs');
const axios = require('axios');
const XLSX = require('xlsx');

const EXCEL_FILE_PATH = './Stock_list.xlsx';

// 💡 您的專屬 FinMind Token
const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiQ2h1bmcwNSIsImVtYWlsIjoiY2hpdTYuY2h1bmcwNUBnbWFpbC5jb20iLCJ0b2tlbl92ZXJzaW9uIjowfQ.Jsmprys2d_Vz8x5eeXnLZRn9_MjWpNH7kp77gL3qRz0";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchInvestorTop50(dataset, date, dataId, chName) {
  // 💡 ✅ 完美對齊您指正的正確 API 組合規則
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&start_date=${date}&end_date=${date}&data_id=${dataId}&token=${FINMIND_TOKEN}`;
  
  console.log(`🌐 正在連線 FinMind 獲取全市場 [${chName} - ${dataId}] 的當日大表...`);
  const res = await axios.get(url);
  
  if (!res.data || !res.data.data || res.data.data.length === 0) {
    console.log(`⚠️ 提示：[${chName}] 未能取得數據，請檢查當天是否開盘。`);
    return [];
  }

  // 格式化數據並計算淨買超
  const processed = res.data.data.map(item => {
    return {
      stock_id: String(item.stock_id).trim(),
      stock_name: item.stock_name ? item.stock_name.trim() : '未知',
      // FinMind 欄位通常為 buy 買進股數, sell 賣出股數 (淨買超 = 買 - 賣)
      net_buy: (item.buy || 0) - (item.sell || 0) 
    };
  });

  // 聚合相同股票（防止有拆單或多類型紀錄）
  const groupMap = new Map();
  processed.forEach(x => {
    if (!groupMap.has(x.stock_id)) {
      groupMap.set(x.stock_id, { stock_id: x.stock_id, stock_name: x.stock_name, net_buy: 0 });
    }
    groupMap.get(x.stock_id).net_buy += x.net_buy;
  });

  // 篩選標準 4 位數個股，並按淨買超從大到小排序，精準提取前 50 名
  return Object.values(Object.fromEntries(groupMap))
    .filter(x => x.stock_id.length === 4)
    .sort((a, b) => b.net_buy - a.net_buy)
    .slice(0, 50);
}

async function run() {
  try {
    // 鎖定上週五 6/12 進行數據人工驗證
    const targetDate = "2026-06-12"; 
    console.log(`🚀 【FinMind 正確參數修正版】開始提取全市場三大法人各自前 50 名...`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到 Excel 檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 💡 ✅ 修正問題一：必須是 InstitutionalInvestorsBuySell
    const dataset = "InstitutionalInvestorsBuySell"; 
    
    // 💡 ✅ 修正問題二：自營商精準對齊為 Dealer
    const foreignTop50 = await fetchInvestorTop50(dataset, targetDate, "Foreign_Investor", "外資");
    await sleep(200); // 禮貌延遲防頻繁
    const trustTop50 = await fetchInvestorTop50(dataset, targetDate, "Investment_Trust", "投信");
    await sleep(200);
    const dealerTop50 = await fetchInvestorTop50(dataset, targetDate, "Dealer", "自營商");

    console.log(`📥 下載排序成功！外資：${foreignTop50.length}檔，投信：${trustTop50.length}檔，自營商：${dealerTop50.length}檔。`);

    // 2. 彙整這 150 檔法人最愛（完全不做 180 檔比對過濾，全量寫入方便您人工核對）
    const finalRowsForExcel = [];

    foreignTop50.forEach((x, idx) => {
      finalRowsForExcel.push({ '股票代號': x.stock_id, '股票名稱': x.stock_name, '淨買超(股/張)': x.net_buy, '來源法人': '外資', '排名': idx + 1 });
    });
    trustTop50.forEach((x, idx) => {
      finalRowsForExcel.push({ '股票代號': x.stock_id, '股票名稱': x.stock_name, '淨買超(股/張)': x.net_buy, '來源法人': '投信', '排名': idx + 1 });
    });
    dealerTop50.forEach((x, idx) => {
      finalRowsForExcel.push({ '股票代號': x.stock_id, '股票名稱': x.stock_name, '淨買超(股/張)': x.net_buy, '來源法人': '自營商', '排名': idx + 1 });
    });

    console.log(`📊 正在將這 ${finalRowsForExcel.length} 筆最真實的全市場排行資料寫入 NEW 分頁...`);

    // 3. 覆蓋寫入 Excel
    const newSheetWS = XLSX.utils.json_to_sheet(finalRowsForExcel);
    if (workbook.SheetNames.includes('NEW')) {
      workbook.Sheets['NEW'] = newSheetWS;
    } else {
      XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
    }

    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    console.log(`💾 【驗證數據已就緒】全市場三大法人 6/12 各自前 50 名已全數寫入 'NEW' 分頁，請進行人工查驗！`);

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
