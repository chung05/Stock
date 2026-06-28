// test-official.js
const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =========================================================================
// ⚙️ 【網頁端驗證轉後端直連：自訂核心測試區】
// =========================================================================
const CONFIG = {
  stockId: "2301",       // 🎯 請在此輸入您當前想單獨測試的「一檔個股」 (例如 "2301" 或 "6446")
  targetDate: "2026-06-24" // 📅 請輸入您要驗證的開盤工作日 (YYYY-MM-DD)
};
// =========================================================================

async function run() {
  const sId = CONFIG.stockId.trim();
  const rawDate = CONFIG.targetDate.trim();

  console.log(`🏛️  ====================================================`);
  console.log(`🏛️  【交易所官方大帳本 - 獨立個股單次查詢驗證】`);
  console.log(`📅 查詢日期：${rawDate}`);
  console.log(`🎯 標的股號：${sId}`);
  console.log(`🏛️  ====================================================\n`);

  // 💡 模擬最真實的瀏覽器 Headers，直接由 Node.js 直連官方，完美避開 403 阻擋與網頁 CORS 限制
  const fakeBrowserHeaders = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'referer': 'https://www.twse.com.tw/'
  };

  // 1. 自動判斷上市 (TWSE) 還是 上櫃 (TPEX)
  let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

  // 2. 日期格式轉換
  const twseDateStr = rawDate.replace(/-/g, ''); // 轉為 20260624
  const dateObj = new Date(rawDate);
  const tpexYear = dateObj.getFullYear() - 1911;
  const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
  const tpexDay = String(dateObj.getDate()).padStart(2, '0');
  const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 轉為 115/06/24

  let apiUrl = "";
  if (!isTpex) {
    console.log(`📡 [分流判定：上市股票] -> 開始下載臺灣證券交易所 (TWSE) 當日全台巨型總帳本...`);
    apiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${twseDateStr}&selectType=ALL&response=json`;
  } else {
    console.log(`📡 [分流判定：上櫃股票] -> 開始下載證券櫃檯買賣中心 (TPEX) 當日全台巨型總帳本...`);
    apiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
  }

  try {
    // 直連下載總大帳本
    const response = await axios.get(apiUrl, { headers: fakeBrowserHeaders });
    
    if (response.status === 200 && response.data) {
      let foundRow = null;

      if (!isTpex) {
        // 🏛️ 上市解析：從大帳本中過濾出您要的這「一檔」個股
        const rawRows = response.data.data || [];
        console.log(`📥 成功下載上市總帳本！今日共有 ${rawRows.length} 檔股票有法人進出紀錄。`);
        foundRow = rawRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
          console.log(`\n🎉 【驗證成功！】已在官方大帳本中精準尋獲 ${sId} 的籌碼行數據：`);
          console.log(`================================================================`);
          console.log(`📊 股票名稱: ${foundRow[1].trim()}`);
          console.log(`外資買賣超股數: ${foundRow[4]}`);
          console.log(`投信買賣超股數: ${foundRow[7]}`);
          console.log(`自營商買賣超股數: ${foundRow[10]}`);
          console.log(`================================================================`);
          console.log(`\n📦 官方原始列數組 (Row Array) DUMP:`);
          console.log(JSON.stringify(foundRow, null, 2));
        }
      } else {
        // 🏪 上櫃解析：從大帳本中過濾出您要的這「一檔」個股
        const rawRows = response.data.aaData || [];
        console.log(`📥 成功下載上櫃總帳本！今日共有 ${rawRows.length} 檔股票有法人進出紀錄。`);
        foundRow = rawRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
          console.log(`\n🎉 【驗證成功！】已在櫃買中心帳本中精準尋獲 ${sId} 的籌碼行數據：`);
          console.log(`================================================================`);
          console.log(`📊 股票名稱: ${foundRow[1].trim()}`);
          console.log(`外資淨買超股數: ${foundRow[7]}`);
          console.log(`投信淨買超股數: ${foundRow[8]}`);
          console.log(`自營商淨買超股數: ${foundRow[9]}`);
          console.log(`================================================================`);
          console.log(`\n📦 官方原始列數組 (Row Array) DUMP:`);
          console.log(JSON.stringify(foundRow, null, 2));
        }
      }

      if (!foundRow) {
        console.log(`\n⚠️  【查無資料】官網今日總帳本下載成功，但裡面「沒有」股票 ${sId} 的紀錄。`);
        console.log(`💡 原因提示：請檢查該日期是否為週六日或連假。若非假日，代表該股當天沒有任何三大法人進出進而未列入帳本。`);
      }

    } else {
      console.log(`❌ 伺服器回應成功，但未包含正確的帳本資料體。`);
    }

  } catch (err) {
    console.log(`\n💥 直連官網崩潰！錯誤原因: ${err.message}`);
    if (err.response) {
      console.log(`   HTTP 狀態碼: ${err.response.status}`);
    }
  }
}

run();
