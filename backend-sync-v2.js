// backend-sync-v2.js
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 🟢 取得今日日期 (依賴環境變數 TZ: Asia/Taipei)
function getTodayStr() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

async function run() {
  console.log("🚀 開始高效能同步流程...");
  
  try {
    // 1. 獲取股票清單
    const response = await axios.get(`https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/main/Stock_list.xlsx`, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const stockIds = new Set();
    workbook.SheetNames.forEach(name => {
      XLSX.utils.sheet_to_json(workbook.Sheets[name]).forEach(row => {
        const sId = String(row['股票代號'] || row['代號'] || '').trim();
        if (sId) stockIds.add(sId);
      });
    });

    const dateStr = getTodayStr();
    console.log(`📅 同步日期: ${dateStr}, 總股票數: ${stockIds.size}`);

    // 2. 一次性抓取當日三大 API (全量，極致省 Token)
    const [priceRes, chipRes, marginRes] = await Promise.all([
      axios.get(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&date=${dateStr}&token=${process.env.FINMIND_TOKEN}`),
      axios.get(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&date=${dateStr}&token=${process.env.FINMIND_TOKEN}`),
      axios.get(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&date=${dateStr}&token=${process.env.FINMIND_TOKEN}`)
    ]);

    // 3. 簡單檢查：若融資券資料完全沒回傳，拋出錯誤以觸發重試機制
    if (marginRes.data.data.length === 0) {
      throw new Error("融資券資料尚未上架，本次自動終止，等待下次執行。");
    }

    // 4. 合併組裝資料 (使用 Map 確保高效對齊)
    const combinedData = {};

    // 處理融資券 (你的核心需求)
    marginRes.data.data.forEach(row => {
      if (!stockIds.has(row.stock_id)) return;
      combinedData[row.stock_id] = { 
        stock_id: row.stock_id, 
        date: dateStr,
        margin_buy: row.MarginPurchaseBuy || 0,
        margin_sell: row.MarginPurchaseSell || 0,
        margin_balance: row.MarginPurchaseTodayBalance || 0,
        short_buy: row.ShortSaleBuy || 0,
        short_sell: row.ShortSaleSell || 0,
        short_balance: row.ShortSaleTodayBalance || 0
      };
    });

    // 5. 整批插入 (Upsert)
    const finalRows = Object.values(combinedData);
    if (finalRows.length > 0) {
      await supabase.from('stock_chips_daily').upsert(finalRows);
      console.log(`✅ 同步完成，成功寫入 ${finalRows.length} 檔個股資料`);
    }

  } catch (err) {
    console.error("💥 同步流程錯誤:", err.message);
    process.exit(1); // 讓 GitHub Action 判斷失敗，必要時可以觸發通知
  }
}

run();
