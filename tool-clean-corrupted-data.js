// tool-clean-corrupted-data.js
const axios = require('axios');
const XLSX = require('xlsx');

// ==========================================================
// 🛡️ 終極環境防護罩：在引入 Supabase 之前，先餵給它一個假的全域 WebSocket 宣告
// 完美破解 Supabase v2 在 Node.js 20 環境下強行初始化 Realtime 導致的閃退死結！
// ==========================================================
if (!global.WebSocket) {
  global.WebSocket = class {}; 
}

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const EXCEL_SOURCE_URL = "https://raw.githubusercontent.com/" + process.env.GITHUB_REPOSITORY + "/main/Stock_list.xlsx"; 

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false }
});

async function run() {
  try {
    console.log(" Clean-up: 啟動【主力大帳本髒資料物理清洗與健檢工具】...");

    console.log("📥 正在從 GitHub 下載最新版 Stock_list.xlsx 名單基準...");
    const response = await axios.get(EXCEL_SOURCE_URL, { responseType: 'arraybuffer' });
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const coreStockIds = new Set();
    
    const allowedCoreSheets = ['TW50', 'TW100', 'MSCI'];

    allowedCoreSheets.forEach(name => {
      if (!workbook.SheetNames.includes(name)) return;
      const sheet = workbook.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet);
      json.forEach(row => {
        const sId = String(row['股票代號'] || row['代號'] || '').trim();
        if (sId) coreStockIds.add(sId);
      });
    });

    const coreArray = Array.from(coreStockIds);
    console.log(`🎯 經審查，Excel 內合法的黃金主力成分股共計: ${coreArray.length} 檔。`);
    if (coreArray.length === 0) {
      console.log("❌ 錯誤：未能從 Excel 中讀取到任何核心股票代號，終止執行以保護資料庫。");
      return;
    }

    console.log("🔍 正在連線 Supabase 盤查大帳本 (stock_chips_daily) 現存個股清單...");
    
    const { data: allDbStocks, error: fetchErr } = await supabase
      .from('stock_chips_daily')
      .select('stock_id');

    if (fetchErr) throw fetchErr;

    const uniqueDbStocks = Array.from(new Set(allDbStocks.map(item => String(item.stock_id).trim())));
    console.log(`📊 目前資料庫大帳本中，實際上存有資料的股票總數: ${uniqueDbStocks.length} 檔。`);

    const corruptedStocks = uniqueDbStocks.filter(id => !coreStockIds.has(id));
    console.log(`🚨 經交叉比對，抓到非主力成分股（遭受污染的陌生流星股）共計: ${corruptedStocks.length} 檔！`);
    if (corruptedStocks.length > 0) {
      console.log(`📋 遭污染個股清單為: [ ${corruptedStocks.join(', ')} ]`);
    }

    if (corruptedStocks.length === 0) {
      console.log("✨ 健檢完畢！您的核心大帳本非常純淨，0 陌生個股污染，不需要進行任何刪除動作！");
      return;
    }

    console.log(`🔥 啟動軍事級物理剃除程序，準備從 stock_chips_daily 中撤銷這 ${corruptedStocks.length} 檔流星股...`);
    
    const { error: deleteErr } = await supabase
      .from('stock_chips_daily')
      .delete()
      .in('stock_id', corruptedStocks);

    if (deleteErr) throw deleteErr;

    console.log(`✅ [清洗成功] 已將此 ${corruptedStocks.length} 檔污染股票的所有歷史天數數據完全蒸發，大帳本已回復純淨機制！`);
    console.log("🌟 目前大帳本 stock_chips_daily 中已 100% 僅保留合法的主力個股資料。");

  } catch (error) {
    console.error("💥 清洗髒資料流程發生嚴重致命錯誤:", error.message);
    process.exit(1);
  }
}

run();
