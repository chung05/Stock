// test.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// =========================================================================
// ⚙️ 【使用者自訂驗證區】設定日期與個股，本機會全自動下載並分析
// =========================================================================
const CONFIG = {
  stockId: "2301",       // 🎯 您要查找的單一檔個股代號 (例如 "2301" 或 "6446")
  targetDate: "2025-06-27" // 📅 您想下載總表的日期 (YYYY-MM-DD)
};
// =========================================================================

async function run() {
  const sId = CONFIG.stockId.trim();
  const rawDate = CONFIG.targetDate.trim();

  console.log(`====================================================`);
  console.log(`🚀 啟動本機全自動下載暨個股籌碼分析系統`);
  console.log(`📅 核心指令日期：${rawDate} | 🎯 目標個股：${sId}`);
  console.log(`====================================================\n`);

  // 1. 自動判斷上市 (TWSE) 還是 上櫃 (TPEX)
  let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

  // 2. 日期格式轉換
  const twseDateStr = rawDate.replace(/-/g, ''); // 轉為 20250627
  const dateObj = new Date(rawDate);
  const tpexYear = dateObj.getFullYear() - 1911;
  const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
  const tpexDay = String(dateObj.getDate()).padStart(2, '0');
  const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 轉為 114/06/27

  // 3. 設定下載到本機的檔名與路徑
  const localStorageDir = path.join(__dirname, 'downloaded_charts');
  if (!fs.existsSync(localStorageDir)) {
    fs.mkdirSync(localStorageDir); // 自動建立儲存總表的資料夾
  }
  
  const localFileName = isTpex ? `tpex_total_${twseDateStr}.json` : `twse_total_${twseDateStr}.json`;
  const localFilePath = path.join(localStorageDir, localFileName);

  let targetApiUrl = "";
  if (!isTpex) {
    targetApiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${twseDateStr}&selectType=ALLBUT0999&response=json`;
  } else {
    targetApiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
  }

  // 偽裝成常規本機瀏覽器標頭，確保 100% 不被阻擋
  const nativeHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': isTpex ? 'https://www.tpex.org.tw/' : 'https://www.twse.com.tw/'
  };

  let totalBookData = null;

  // 💡 核心機制：檢查本機是否已經下載過這一天的總表？如果有，直接讀取；如果沒有，自動下載存檔！
  if (fs.existsSync(localFilePath)) {
    console.log(`💾 [本地快取命中] 偵測到本機已存在 ${rawDate} 總表檔案，直接讀取進行分析...`);
    totalBookData = JSON.parse(fs.readFileSync(localFilePath, 'utf8'));
  } else {
    console.log(`🌐 [本地尚未存檔] 開始從官方伺服器直連下載 ${rawDate} 全台法人進出總表大明細...`);
    try {
      const response = await axios.get(targetApiUrl, { headers: nativeHeaders, timeout: 10000 });
      if (response.status === 200 && response.data) {
        totalBookData = response.data;
        // 💡 立即將檔案寫入本地存檔，下次查詢同一天其他股票時，一秒都用不用等，直接秒開！
        fs.writeFileSync(localFilePath, JSON.stringify(totalBookData, null, 2), 'utf8');
        console.log(`📥 成功！總表已全自動下載並存檔至本地：${localFilePath}`);
      } else {
        throw new Error("官方回應成功，但內容為空。");
      }
    } catch (downloadErr) {
      console.error(`❌ 下載總表失敗。原因: ${downloadErr.message}`);
      console.log(`💡 提示：請確認該日期是否為週末休市、未來時間，或當天官方網站正在維護。`);
      return;
    }
  }

  // 4. 開始自總表中抽取出指定個股資料
  console.log(`🔍 正在從本地總表中篩選股票代號 [ ${sId} ] ...`);
  let foundRow = null;

  if (!isTpex) {
    // 上市總表過濾 (比對 row[0])
    const allRows = totalBookData.data || [];
    foundRow = allRows.find(row => row[0] && row[0].trim() === sId);
    
    if (foundRow) {
      console.log(`\n🎉 【上市個股分析成功】`);
      console.log(`------------------------------------------------`);
      console.log(`📊 股票名稱：${foundRow[1].trim()}`);
      console.log(`📅 交易日期：${rawDate}`);
      console.log(`🏢 外資買賣超股數：${foundRow[4]}`);
      console.log(`🚀 投信買賣超股數：${foundRow[7]}`);
      console.log(`⚖️  自營商買賣超股數：${foundRow[10]}`);
      console.log(`------------------------------------------------`);
      console.log(`📦 官方原始列數據 (Row Dump)：`, JSON.stringify(foundRow));
    }
  } else {
    // 上櫃總表過濾 (比對 row[0])
    const allRows = totalBookData.aaData || [];
    foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

    if (foundRow) {
      console.log(`\n🎉 【上櫃個股分析成功】`);
      console.log(`------------------------------------------------`);
      console.log(`📊 股票名稱：${foundRow[1].trim()}`);
      console.log(`📅 交易日期：${rawDate}`);
      console.log(`🏢 外資淨買超股數：${foundRow[7]}`);
      console.log(`🚀 投信淨買超股數：${foundRow[8]}`);
      console.log(`⚖️  自營商淨買超股數：${foundRow[9]}`);
      console.log(`------------------------------------------------`);
      console.log(`📦 官方原始列數據 (Row Dump)：`, JSON.stringify(foundRow));
    }
  }

  if (!foundRow) {
    console.log(`\n⚠️  【篩選結束：查無資料】總表已成功下載，但在大帳本中找不到代號 ${sId}。`);
    console.log(`💡 這通常代表該個股在當天「三大法人均無任何進出交易」，所以未被列入官方總表中。`);
  }
}

run();
