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
    console.log(`🧪 【進入人工驗證模式】拋棄所有比對邏輯，直接全量下載全市場前 50 名...`);
    console.log(`🎯 當前鎖定全市場交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 直連證交所官方 CSV 下載通道
    const csvUrl = `https://www.twse.com.tw/zh/fund/BFAM85U?date=${tradeDate}&response=csv`;
    console.log(`🌐 正在下載全市場法人排行 CSV 報表...`);

    const res = await axios.get(csvUrl, {
      responseType: 'text',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!res.data || res.data.includes("錯誤") || res.data.length < 500) {
      console.log(`⚠️ 報表未釋出或今日非交易日。`);
      return;
    }

    // 💡 印出前 500 個字元，確認我們到底從證交所下載到了什麼，徹底透明化！
    console.log("--------------------------------------------------");
    console.log("🔍 [CSV 頂部前瞻預覽]：");
    console.log(res.data.substring(0, 500));
    console.log("--------------------------------------------------");

    const lines = res.data.split('\n');
    const allInsertedStocks = [];

    // 💡 強力正則表達式：精準捕捉 CSV 行中包含的四位數字台股股票代號 (例: "2330","台積電")
    // 這可以完美繞過所有中文字說明的干擾
    const stockRegex = /"(\d{4})"\s*,\s*"([^"]+)"/g;

    lines.forEach((line) => {
      let match;
      // 逐行掃描，只要發現符合 (代號, 名稱) 結構的，一網打盡！
      while ((match = stockRegex.exec(line)) !== null) {
        const sId = match[1].trim();
        const sName = match[2].trim();
        
        // 排除非個股的純數字雜質
        if (sId && sId.length === 4) {
          allInsertedStocks.push({
            '股票代號': sId,
            '股票名稱': sName,
            '紀錄說明': '全市場三大法人前50名原始提取'
          });
        }
      }
    });

    console.log(`📥 掃描完畢！成功從證交所原始 CSV 報表中，強行提取出 ${allInsertedStocks.length} 筆排行紀錄。`);

    // 去除重複的股票代號，確保寫入 Excel 時乾淨漂亮
    const uniqueMap = new Map();
    allInsertedStocks.forEach(item => {
      uniqueMap.set(item['股票代號'], item);
    });
    const finalWriteList = Array.from(uniqueMap.values());
    
    console.log(`📊 去除重複上榜股票後，共有 ${finalWriteList.length} 檔不重複的個股準備寫入。`);

    // 💡 暴力直接覆蓋 'NEW' 分頁，不做任何與 180 檔的核心比對！
    const newSheetWS = XLSX.utils.json_to_sheet(finalWriteList);
    
    if (workbook.SheetNames.includes('NEW')) {
      workbook.Sheets['NEW'] = newSheetWS;
    } else {
      XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
    }

    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    console.log(`💾 【驗證存檔】已將這 ${finalWriteList.length} 檔全市場法人最愛，全數塞入 'NEW' 分頁！`);

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
