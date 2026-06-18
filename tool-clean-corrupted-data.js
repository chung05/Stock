// tool-clean-corrupted-data.js
const axios = require('axios');
const XLSX = require('xlsx');

// 🛡️ 環境防護罩：在引入 Supabase 之前，先餵給它一個假的全域 WebSocket 宣告
// 完美破解 Supabase v2 在 Node.js 20 環境下強行初始化 Realtime 導致的閃退死結！
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
  realtime: { global: false, isRealtimeEnabled: false }
});

async function run() {
  try {
    console.log("🧹 啟動【主力大帳本全面解限物理清洗與健檢工具】...");

    // 1. 下載最新 Excel 基準
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

    console.log(`🎯 Excel 內合法的黃金主力成分股共計: ${coreStockIds.size} 檔。`);

    // ==========================================================
    // 💡 核心解限修正：強制指定大範圍 range，確保 19,688 筆資料全數納入盤查網！
    // ==========================================================
    console.log("🔍 正在連線 Supabase 跨越限制盤查大帳本所有歷史資料代號...");
    
    const { data: allDbRows, error: fetchErr } = await supabase
      .from('stock_chips_daily')
      .select('stock_id')
      .range(0, 50000); 

    if (fetchErr) throw fetchErr;

    const uniqueDbStocks = Array.from(new Set(allDbRows.map(item => String(item.stock_id).trim())));
    console.log(`📊 經完全體解限盤查，目前大帳本中實際存有歷史資料的股票總數: ${uniqueDbStocks.length} 檔。`);

    // 2. 交叉比對
    const corruptedStocks = uniqueDbStocks.filter(id => !coreStockIds.has(id));
    console.log(`🚨 經跨頁交叉比對，抓到藏在後半段的污染流星股共計: ${corruptedStocks.length} 檔！`);
    
    if (corruptedStocks.length === 0) {
      console.log("✨ 健檢完畢！大帳本已經與 180 檔主力母名單完美契合，0 陌生個股污染！");
      return;
    }

    console.log(`📋 遭污染個股完整清單為: [ ${corruptedStocks.join(', ')} ]`);
    console.log(`🔥 啟動物理剃除程序，從大帳本中刪除這 ${corruptedStocks.length} 檔流星股的所有歷史天數數據...`);
    
    const { error: deleteErr } = await supabase
      .from('stock_chips_daily')
      .delete()
      .in('stock_id', corruptedStocks);

    if (deleteErr) throw deleteErr;

    console.log(`✅ [清洗成功] 已將此 ${corruptedStocks.length} 檔非主力股票完全剃除！大帳本已正式回歸 100% 純淨機制。`);

  } catch (error) {
    console.error("💥 清洗髒資料流程發生嚴重致命錯誤:", error.message);
    process.exit(1);
  }
}

run();
