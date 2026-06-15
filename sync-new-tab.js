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
    console.log(`🧪 【進入人工驗證模式】全市場三大法人各自前 50 名不比對直接寫入...`);
    console.log(`🎯 當前鎖定全市場交易日: ${tradeDate}`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`找不到檔案: ${EXCEL_FILE_PATH}`);
    }
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);

    // 直連證交所 CSV 排行大表
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

    const lines = res.data.split('\n');
    
    // 用一個 Map 收集所有上榜個股，並記錄它是被誰買進的
    const verificationMap = new Map();

    lines.forEach(line => {
      const cleanLine = line.replace(/"/g, '').trim();
      const columns = cleanLine.split(',');

      const rank = parseInt(columns[0], 10);
      // 只要排名在 1 到 50 之間，就是我們要的頂級籌碼股
      if (!isNaN(rank) && rank >= 1 && rank <= 50) {
        
        // 1. 外資買超前 50
        const fkId = columns[1] ? columns[1].trim() : '';
        const fkName = columns[2] ? columns[2].trim() : '';
        
        // 2. 投信買超前 50
        const itId = columns[5] ? columns[5].trim() : '';
        const itName = columns[6] ? columns[6].trim() : '';
        
        // 3. 自營商買超前 50
        const dId = columns[9] ? columns[9].trim() : '';
        const dName = columns[10] ? columns[10].trim() : '';

        const addToMap = (id, name, investorName) => {
          if (id && id.length >= 4) {
            if (!verificationMap.has(id)) {
              verificationMap.set(id, { '股票代號': id, '股票名稱': name, '來源法人': [] });
            }
            const item = verificationMap.get(id);
            if (!item['來源法人'].includes(investorName)) {
              item['來源法人'].push(investorName);
            }
          }
        };

        addToMap(fkId, fkName, '外資');
        addToMap(itId, itName, '投信');
        addToMap(dId, dName, '自營商');
      }
    });

    console.log(`📥 掃描完畢！全市場扣除重複後，三大法人共同堆疊出共 ${verificationMap.size} 檔個股。`);

    // 將資料格式化為準備寫入 Excel 的型態
    const finalVerificationList = Array.from(verificationMap.values()).map(item => ({
      '股票代號': item['股票代號'],
      '股票名稱': item['股票名稱'],
      '來源法人': item['來源法人'].join(' + ') // 例如：外資 + 投信
    }));

    // 💡 暴力覆蓋 'NEW' 分頁，不做任何與 180 檔的比對限制
    const newSheetWS = XLSX.utils.json_to_sheet(finalVerificationList);
    
    if (workbook.SheetNames.includes('NEW')) {
      workbook.Sheets['NEW'] = newSheetWS;
    } else {
      XLSX.utils.book_append_sheet(workbook, newSheetWS, 'NEW');
    }

    XLSX.writeFile(workbook, EXCEL_FILE_PATH);
    console.log(`💾 【驗證完成】已將無過濾的 ${finalVerificationList.length} 檔法人名單全數強行寫入 'NEW' 分頁！`);

  } catch (error) {
    console.error("❌ 執行發生錯誤:", error.message);
    process.exit(1);
  }
}

run();
