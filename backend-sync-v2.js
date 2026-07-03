// backend-sync-v2.js
import 'dotenv/config';
import axios from 'axios';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

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

    const rawStockIds = dbData.map(item => String(item.stock_id).trim()).filter(id => id && id !== 'undefined' && id !== 'null');
    const stockIds = [...new Set(rawStockIds)];

    console.log(`📅 同步日期: ${targetDate}, 實際名單長度: ${dbData.length}, 去重後精準股票總數: ${stockIds.length}`);

    let allFetchedDailyChips = [];
    const chunkSize = 50;

    // 階段 B：分批（每 50 檔）向 FinMind 請求當日籌碼
    for (let i = 0; i < stockIds.length; i += chunkSize) {
      const chunkIds = stockIds.slice(i, i + chunkSize);
      console.log(`📦 正在處理批次 ${Math.floor(i / chunkSize) + 1}，打包發送個股數: ${chunkIds.length}`);

      const finmindParams = {
        dataset: "TaiwanStockTaiwanCompanyBuySell",
        data_id: chunkIds.join(','), 
        start_date: targetDate,
        end_date: targetDate,
        token: finmindToken
      };

      let retries = 3;
      let fetchSuccess = false;

      while (retries > 0 && !fetchSuccess) {
        try {
          // 💡 終極相容修正：改用標準 axios.get，並強行透過 URLSearchParams 打包參數，根除 405 與 400 參數阻擋錯誤！
          const response = await axios.get("https://api.finmindtrade.com/api/v4/data", {
            params: finmindParams,
            timeout: 20000,
            paramsSerializer: {
              serialize: (params) => {
                const searchParams = new URLSearchParams();
                Object.entries(params).forEach(([key, val]) => {
                  if (val !== undefined && val !== null) {
                    searchParams.append(key, String(val));
                  }
                });
                return searchParams.toString();
              }
            }
          });

          if (response.data && response.data.status === 200) {
            const dayData = response.data.data || [];
            allFetchedDailyChips = allFetchedDailyChips.concat(dayData);
            fetchSuccess = true;
          } else {
            console.warn(`⚠️ FinMind 回傳狀態異常 (${response.data?.status}: ${response.data?.msg || ''})，正在進行重試...`);
            retries--;
            if (retries > 0) await new Promise(res => setTimeout(res, 2000));
          }
        } catch (apiErr) {
          console.error(`❌ 請求 FinMind 發生通訊阻斷或 405/400 錯誤:`, apiErr.message);
          retries--;
          if (retries === 0) {
            console.error("💥 該批次已達 3 次重試上限，為保障整體隊列前行，此批次強行跳過。");
          } else {
            await new Promise(res => setTimeout(res, 2500));
          }
        }
      }
    }

    console.log(`📊 本日累計成功撈回 ${allFetchedDailyChips.length} 筆原始籌碼明細紀錄。`);

    if (allFetchedDailyChips.length === 0) {
      console.log("ℹ️ 本日無新籌碼明細更新（可能為台股非交易日或 API 未開盤），流程安全結束。");
      return;
    }

    // 階段 C：寫入 Supabase 資料庫大帳本
    console.log("💾 正在發動 Supabase 智慧矩陣更新 (Upsert) 寫入作業...");
    
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
        updated_at: new Date().toISOString()
      };
    });

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

startHighPerformanceSync();
