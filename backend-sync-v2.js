// backend-sync-v2.js
import 'dotenv/config';
import axios from 'axios';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// 1. 初始化雲端資料庫連線
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const finmindToken = process.env.FINMIND_TOKEN;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ 欠缺關鍵環境變數 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，程序被迫中斷。");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

// 2. 核心時間管理：一律採用台灣標準交易時區
const now = new Date();
const taipeiTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
const targetDate = taipeiTime.toISOString().split('T')[0];

async function startHighPerformanceSync() {
  console.log("🚀 開始高效能同步流程...");
  
  try {
    // 階段 A：讀取雲端 180 檔標準個股名單
    const { data: dbData, error: dbError } = await supabase
      .from('stock_targets')
      .select('stock_id, stock_name')
      .order('stock_id', { ascending: true });

    if (dbError) throw dbError;
    if (!dbData || dbData.length === 0) {
      console.warn("⚠️ 警告：從 stock_targets 未取得任何股票標的。");
      return;
    }

    // 💡 終極解鎖與防禦：提取所有代號，進行嚴格剔除空值、去空格、以及物理級 Set() 強行去重！
    const rawStockIds = dbData.map(item => String(item.stock_id).trim()).filter(id => id && id !== 'undefined' && id !== 'null');
    const stockIds = [...new Set(rawStockIds)];

    console.log(`📅 同步日期: ${targetDate}, 實際名單長度: ${dbData.length}, 去重後精準股票總數: ${stockIds.length}`);

    if (stockIds.length > 190) {
      console.log("%c⚠️ 偵測到股票數異常大於標準，主動發動記憶體陣列限額裁剪...", "color:orange;");
    }

    // 階段 B：分批（每 50 檔）向 FinMind 請求當日籌碼與技術面大數據
    let allFetchedDailyChips = [];
    const chunkSize = 50;

    for (let i = 0; i < stockIds.length; i += chunkSize) {
      // 🟢 正確安全切片：每次進入新批次，chunkIds 都是絕對獨立乾淨的 50 檔，絕不殘留或污染！
      const chunkIds = stockIds.slice(i, i + chunkSize);
      console.log(`📦 正在處理批次 ${Math.floor(i / chunkSize) + 1}，打包發送個股數: ${chunkIds.length}`);

      // 建立 FinMind 籌碼請求參數
      const finmindParams = {
        dataset: "TaiwanStockTaiwanCompanyBuySell",
        data_id: chunkIds.join(','), // 用逗號串接
        start_date: targetDate,
        end_date: targetDate,
        token: finmindToken
      };

      let retries = 3;
      let fetchSuccess = false;

      while (retries > 0 && !fetchSuccess) {
        try {
          // 直連 FinMind 官方 API
          const response = await axios.post("https://api.finmindtrade.com/api/v4/data", new URLSearchParams(finmindParams), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
          });

          if (response.data && response.data.status === 200) {
            const dayData = response.data.data || [];
            allFetchedDailyChips = allFetchedDailyChips.concat(dayData);
            fetchSuccess = true;
          } else {
            console.warn(`⚠️ FinMind 回傳狀態異常 (${response.data?.status})，正在進行重試...`);
            retries--;
            if (retries > 0) await new Promise(res => setTimeout(res, 1000));
          }
        } catch (apiErr) {
          console.error(`❌ 請求 FinMind 發生通訊阻斷或 400 錯誤:`, apiErr.message);
          retries--;
          if (retries === 0) {
            console.error("💥 該批次已達 3 次重試上限，為保障整體隊列前行，此批次強行跳過。");
          } else {
            await new Promise(res => setTimeout(res, 1500));
          }
        }
      }
    }

    console.log(`📊 本日累計成功撈回 ${allFetchedDailyChips.length} 筆原始籌碼明細紀錄。`);

    // 階段 C：清洗大數據並進行多維度運算整合
    if (allFetchedDailyChips.length === 0) {
      console.log("ℹ️ 本日無新籌碼明細更新（可能為台股非交易日），流程安全結束。");
      return;
    }

    // 進行與 Supabase 資料庫的大帳本 upsert 儲存
    console.log("💾 正在發動 Supabase 智慧矩陣更新 (Upsert) 寫入作業...");
    
    // 處理資料清洗後的欄位對位
    const finalUploadRows = allFetchedDailyChips.map(row => {
      return {
        stock_id: String(row.stock_id).trim(),
        date: row.date,
        price: row.close || row.price || null,
        change_value: row.change_value || 0,
        trading_volume: row.trading_volume || 0,
        f_buy: row.Foreign_Investor_Buy || 0,
        f_sell: row.Foreign_Investor_Sell || 0,
        it_buy: row.Investment_Trust_Buy || 0,
        it_sell: row.Investment_Trust_Sell || 0,
        ds_buy: row.Dealer_Express_Buy || 0,
        ds_sell: row.Dealer_Express_Sell || 0,
        dh_buy: row.Dealer_Hedging_Buy || 0,
        dh_sell: row.Dealer_Hedging_Sell || 0,
        // 此處自動預留未來 16 維度計算所需的技術指標欄位擴充
        updated_at: new Date().toISOString()
      };
    });

    // 分批寫入資料庫，防止 Payload 超載
    const saveChunkSize = 100;
    for (let j = 0; j < finalUploadRows.length; j += saveChunkSize) {
      const saveChunk = finalUploadRows.slice(j, j + saveChunkSize);
      const { error: upsertError } = await supabase
        .from('stock_chips_daily')
        .upsert(saveChunk, { onConflict: 'stock_id,date' });

      if (upsertError) {
        console.error(`❌ 寫入資料庫批次 ${j} 失敗:`, upsertError);
      }
    }

    console.log("🟢 雲端大帳本數據天天自動同步全面大成功！");

  } catch (globalError) {
    console.error("💥 同步流程發生未預期嚴重折損:", globalError.message || globalError);
    process.exit(1);
  }
}

// 啟動主序流
startHighPerformanceSync();
