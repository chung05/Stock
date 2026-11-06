// js/api.js
import { state, supabaseClient, formatDateToString } from './config.js';
import { updateDisplayDates, updateTabSelectOptions, renderTableHeader, applyFilters } from './ui.js';

export function calculateTradeDaysLists() {
  let dates20 = [];
  let d = new Date();
  while(dates20.length < 20) {
    let day = d.getDay();
    if (day !== 0 && day !== 6) { 
      dates20.push(formatDateToString(d));
    }
    d.setDate(d.getDate() - 1);
  }
  state.extendedTrendDates = dates20; 
  state.recentDates = dates20.slice(0, 5); 
}

export async function forceSyncFlow() {
  // 防禦機制：如果已經在同步中，避免重複執行
  if (state.isSyncing) {
    console.log("⏳ 核心同步已在進行中，跳過重複觸發。");
    return;
  }
  state.isSyncing = true;

  const modal = document.getElementById("loadingModal");
  const detailText = document.getElementById("loadingDetail");
  if (modal) modal.classList.remove("hidden");

  try {
    if (detailText) detailText.innerText = "1. 載入雲端股票名單與成分分類...";
    console.log("🚀 啟動階段 1：讀取 stock_targets 資料表...");
    
    const { data: dbData, error: targetError = null } = await supabaseClient
      .from('stock_targets')
      .select('*')
      .order('stock_id', { ascending: true });
          
    if (targetError) {
      console.error("❌ 讀取 stock_targets 失敗:", targetError);
      throw targetError;
    }
    
    state.dbStockData = dbData || [];
    console.log(`✅ 成功載入股票名單，共 ${state.dbStockData.length} 檔。`);

    const todayStr = new Date().toLocaleDateString();
    if(document.getElementById("listUpdateTime")) document.getElementById("listUpdateTime").innerText = todayStr;
    if(document.getElementById("listUpdateTimeMob")) document.getElementById("listUpdateTimeMob").innerText = todayStr;

    state.targetSheetsSet.clear();
    state.dbStockData.forEach(item => { 
      if (Array.isArray(item.sheet_tags)) {
        item.sheet_tags.forEach(tag => {
          // 🔥 嚴格防禦：過濾掉空字串或可能殘留的不明標籤，確保下拉選單完美純淨
          if (tag && String(tag).trim() !== "") {
            state.targetSheetsSet.add(String(tag).trim());
          }
        }); 
      }
    });
        
    updateTabSelectOptions(Array.from(state.targetSheetsSet));
    
    calculateTradeDaysLists();
    updateDisplayDates(state.recentDates[0]);
    renderTableHeader();

    if (detailText) detailText.innerText = "2. 正在讀取雲端籌碼與股價數據...";
    console.log("🚀 啟動階段 2：開始分批讀取 stock_chips_daily 數據...");
    
    await fetchAllChipsFromSupabase();

    if (detailText) detailText.innerText = "3. 正在建立網頁表格視覺矩陣...";
    console.log("🚀 啟動階段 3：套用過濾器並渲染網頁矩陣...");
    applyFilters();

  } catch (err) {
    console.error("💥 讀取雲端快取資料流程發生嚴重異常:", err);
    if (detailText) detailText.innerText = `❌ 錯誤: ${err.message || "連線異常"}`;
  } finally {
    state.isSyncing = false;
    if (modal) modal.classList.add("hidden");
  }
}

export async function fetchAllChipsFromSupabase() {
  if (state.extendedTrendDates.length === 0 || state.dbStockData.length === 0) {
    console.warn("⚠️ 日期或股票名單為空，跳過籌碼下載。");
    return;
  }
  const detailText = document.getElementById("loadingDetail");
  
  let allChipsFetched = [];
  const stockIds = state.dbStockData.map(s => String(s.stock_id).trim());
  
  const chunkSize = 50; 
  for (let i = 0; i < stockIds.length; i += chunkSize) {
    const chunkIds = stockIds.slice(i, i + chunkSize);
    if (detailText) {
      detailText.innerText = `2. 同步核心籌碼數據中 (${Math.min(i + chunkSize, stockIds.length)} / ${stockIds.length} 檔)...`;
    }
    console.log(`📦 正在處理批次 ${i / chunkSize + 1}，下載 檔數: ${chunkIds.length}`);

    let retries = 3;
    let success = false;

    // 修正安全機制：防止 Supabase 回傳異常時進入死鎖無窮迴圈
    while (retries > 0 && !success) {
      try {
        const { data, error } = await supabaseClient
          .from('stock_chips_daily')
          .select('*, macd_dif, macd_signal, macd_osc') 
          .in('stock_id', chunkIds)
          .in('date', state.extendedTrendDates); 

        if (error) {
          console.error(`⚠️ 批次 ${i} 請求時 Supabase 回傳錯誤:`, error);
          retries--;
          if (retries === 0) {
            console.error(`❌ 批次 ${i} 嘗試 3 次後徹底失敗。`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } else {
          if (data && data.length > 0) {
            allChipsFetched = allChipsFetched.concat(data);
          } else {
            console.warn(`⚠️ 批次 ${i} 回傳成功，但沒有對應日期的籌碼資料。`);
          }
          success = true; // 確保只要有回應（無論有無資料）就中斷迴圈，絕不卡死
        }
      } catch (catchErr) {
        console.error(`💥 批次 ${i} 網路層級或未知錯誤:`, catchErr);
        retries--;
        if (retries === 0) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  state.globalChipCache = allChipsFetched;
  console.log(`📊 籌碼大帳本下載完成，共取得 ${state.globalChipCache.length} 筆每日明細紀錄。`);

  if (state.globalChipCache.length > 0) {
    const dbDates = Array.from(new Set(state.globalChipCache.map(c => String(c.date))))
                         .sort((a, b) => b.localeCompare(a)); 
        
    if (dbDates.length > 0) {
      state.extendedTrendDates = dbDates.slice(0, 20); 
      state.recentDates = dbDates.slice(0, 5); 
      updateDisplayDates(state.recentDates[0]);
      renderTableHeader();
    }
  } else {
    console.error("❌ 警告：未從 stock_chips_daily 取得任何有效資料！請檢查 RLS 或資料表內容。");
  }
}
