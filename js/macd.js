// js/macd.js
import { state, getValIgnoreCase, setSignalDetail, decodeMultiDimensionSignal, MACD_SIGNALS, WHITE_SPEECHES } from './config.js';

if (!state.visibleLines) {
  state.visibleLines = { ma5: true, ma10: false, ma20: true };
}

// ==========================================================
// 🚨 終極救星：生命週期延時防禦晶片 (徹底解決開局 DOM 未渲染死鎖)
// ==========================================================
setTimeout(async () => {
  if (!state.globalChipCache || state.globalChipCache.length === 0) {
    console.log("%c⏳ 偵測到開局非同步流定格，主動啟動延時防禦補件程序...", "color:yellow; font-weight:bold;");
    const select = document.getElementById("tabSelect");
    
    if (select) {
      const { forceSyncFlow } = await import('./api.js');
      if (forceSyncFlow) {
        console.log("%c🟢 HTML 外殼安全對齊！重新發動雲端大帳本下載流...", "color:lime; font-weight:bold;");
        await forceSyncFlow(); 
      }
    }
  }
}, 500);

export function closeNewsModal() { 
  document.getElementById("newsModal").classList.add("hidden"); 
}

export function toggleLine(lineKey, isChecked) {
  if (state.visibleLines) {
    state.visibleLines[lineKey] = isChecked;
  }
  if (state.currentActiveStockId) {
    const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
    const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b));
    renderPriceTrendLineChart(localTrendDates, myChipsRaw);
  }
}

export function switchModalTab(tabMode) {
  const btnTrend = document.getElementById("tabBtnTrend");
  const btnMacd = document.getElementById("tabBtnMacd");
  const btnNews = document.getElementById("tabBtnNews");
  const zoneTrend = document.getElementById("trendZone");
  const zoneMacd = document.getElementById("macdZone");
  const zoneNews = document.getElementById("newsZone");

  const tabs = { trend: { btn: btnTrend, zone: zoneTrend }, macd: { btn: btnMacd, zone: zoneMacd }, news: { btn: btnNews, zone: zoneNews } };
  Object.keys(tabs).forEach(k => {
    const b = tabs[k].btn, z = tabs[k].zone;
    if (k === tabMode) {
      if(b) b.className = "py-1.5 px-4 text-sm font-black border-b-2 border-blue-600 text-blue-600 focus:outline-none cursor-pointer transition-all";
      if(z) z.classList.replace("hidden", "block");
    } else {
      if(b) b.className = "py-1.5 px-4 text-sm font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 focus:outline-none cursor-pointer transition-all";
      if(z) z.classList.replace("block", "hidden");
    }
  });
  
  setTimeout(() => {
    if (state.currentActiveStockId) {
      const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
      const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b));
      if (tabMode === 'macd') {
        renderSeparatedMacdChartAndDecodeSignals(localTrendDates, myChipsRaw);
      } else if (tabMode === 'trend') {
        if (document.getElementById("toggleMA5")) document.getElementById("toggleMA5").checked = state.visibleLines.ma5;
        if (document.getElementById("toggleMA10")) document.getElementById("toggleMA10").checked = state.visibleLines.ma10;
        if (document.getElementById("toggleMA20")) document.getElementById("toggleMA20").checked = state.visibleLines.ma20;
        
        renderPriceTrendLineChart(localTrendDates, myChipsRaw);
        renderChipTrendChart();
        renderMarginTrendChart(); 
        bindBiDirectionalScrollLinkage();
      }
      scrollToLatestTrend(tabMode);
    }
  }, 30);
}

export function switchChipSubTab(subKey) {
  state.currentChipSubTab = subKey;
  const tabs = { f: 'subTabF', it: 'subTabIT', ds: 'subTabDS' };
  Object.keys(tabs).forEach(k => {
    const btn
