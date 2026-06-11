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
  const modal = document.getElementById("loadingModal");
  const detailText = document.getElementById("loadingDetail");
  modal.classList.remove("hidden");

  try {
    detailText.innerText = "1. 載入雲端股票名單與成分分類...";
    const { data: dbData, error: targetError = null } = await supabaseClient
      .from('stock_targets')
      .select('*')
      .order('stock_id', { ascending: true });
          
    if (targetError) throw targetError;
    state.dbStockData = dbData || [];

    const todayStr = new Date().toLocaleDateString();
    if(document.getElementById("listUpdateTime")) document.getElementById("listUpdateTime").innerText = todayStr;
    if(document.getElementById("listUpdateTimeMob")) document.getElementById("listUpdateTimeMob").innerText = todayStr;

    state.targetSheetsSet.clear();
    state.dbStockData.forEach(item => { 
      if (Array.isArray(item.sheet_tags)) {
        item.sheet_tags.forEach(tag => state.targetSheetsSet.add(tag)); 
      }
    });
        
    updateTabSelectOptions(Array.from(state.targetSheetsSet));
    
    calculateTradeDaysLists();
    updateDisplayDates(state.recentDates[0]);
    renderTableHeader();

    detailText.innerText = "2. 正在讀取雲端籌碼與股價數據...";
    await fetchAllChipsFromSupabase();

    detailText.innerText = "3. 正在建立網頁表格視覺矩陣...";
    applyFilters();

  } catch (err) {
    console.error("讀取雲端快取資料流程發生異常:", err);
  } finally {
    modal.classList.add("hidden");
  }
}

export async function fetchAllChipsFromSupabase() {
  if (state.extendedTrendDates.length === 0 || state.dbStockData.length === 0) return;
  const detailText = document.getElementById("loadingDetail");
  
  let allChipsFetched = [];
  const stockIds = state.dbStockData.map(s => String(s.stock_id).trim());
  
  const chunkSize = 50; 
  for (let i = 0; i < stockIds.length; i += chunkSize) {
    const chunkIds = stockIds.slice(i, i + chunkSize);
    detailText.innerText = `2. 同步核心籌碼數據中 (${Math.min(i + chunkSize, stockIds.length)} / ${stockIds.length} 檔)...`;

    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
      const { data, error } = await supabaseClient
        .from('stock_chips_daily')
        .select('*, macd_dif, macd_signal, macd_osc') 
        .in('stock_id', chunkIds)
        .in('date', state.extendedTrendDates); 

      if (error) {
        retries--;
        if (retries === 0) console.error(`❌ 批次 ${i} 徹底失敗。`);
        else await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        if (data) allChipsFetched = allChipsFetched.concat(data);
        success = true;
      }
    }
  }

  state.globalChipCache = allChipsFetched;

  if (state.globalChipCache.length > 0) {
    const dbDates = Array.from(new Set(state.globalChipCache.map(c => String(c.date))))
                         .sort((a, b) => b.localeCompare(a)); 
        
    if (dbDates.length > 0) {
      state.extendedTrendDates = dbDates.slice(0, 20); 
      state.recentDates = dbDates.slice(0, 5); 
      updateDisplayDates(state.recentDates[0]);
      renderTableHeader();
    }
  }
}
