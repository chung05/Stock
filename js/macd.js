// js/macd.js
// 🎯 智慧修正：頂部 Import 對齊新版 16 維度解碼晶片 `decodeMultiDimensionSignal`
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
    const btn = document.getElementById(tabs[k]);
    if (btn) {
      btn.className = k === subKey ? "px-3 py-1 text-xs font-black bg-white text-slate-900 rounded-md shadow-2xs cursor-pointer transition-all" : "px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800 rounded-md cursor-pointer transition-all";
    }
  });
  renderChipTrendChart();
}

export function scrollToLatestTrend(tabMode = 'trend') {
  setTimeout(() => { 
    if (tabMode === 'trend') {
      const pWrapper = document.getElementById("priceScrollWrapper"); 
      const cWrapper = document.getElementById("chipScrollWrapper");
      const mWrapper = document.getElementById("marginScrollWrapper");
      if (pWrapper) pWrapper.scrollLeft = pWrapper.scrollWidth;
      if (cWrapper) cWrapper.scrollLeft = cWrapper.scrollWidth;
      if (mWrapper) mWrapper.scrollLeft = mWrapper.scrollWidth;
    } else if (tabMode === 'macd') {
      const mWrapper = document.getElementById("macdChartScrollWrapper");
      if (mWrapper) mWrapper.scrollLeft = mWrapper.scrollWidth;
    }
  }, 60);
}

function bindBiDirectionalScrollLinkage() {
  const pWrapper = document.getElementById("priceScrollWrapper");
  const cWrapper = document.getElementById("chipScrollWrapper");
  const mWrapper = document.getElementById("marginScrollWrapper");
  if (!pWrapper || !cWrapper || !mWrapper) return;

  let isSyncing = false;

  pWrapper.onscroll = () => {
    if (!isSyncing) {
      isSyncing = true;
      cWrapper.scrollLeft = pWrapper.scrollLeft;
      mWrapper.scrollLeft = pWrapper.scrollLeft;
      isSyncing = false;
    }
  };

  cWrapper.onscroll = () => {
    if (!isSyncing) {
      isSyncing = true;
      pWrapper.scrollLeft = cWrapper.scrollLeft;
      mWrapper.scrollLeft = cWrapper.scrollLeft;
      isSyncing = false;
    }
  };

  mWrapper.onscroll = () => {
    if (!isSyncing) {
      isSyncing = true;
      pWrapper.scrollLeft = mWrapper.scrollLeft;
      cWrapper.scrollLeft = mWrapper.scrollLeft;
      isSyncing = false;
    }
  };
}

export async function openCombinedModal(stockId, stockName) {
  state.currentActiveStockId = stockId; 
  document.getElementById("newsModal").classList.remove("hidden");
  document.getElementById("newsModalTitle").innerText = `${stockId} ${stockName}`;
  
  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(stockId).trim());
  const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b)); 

  setTimeout(() => {
    switchModalTab('trend');
    switchChipSubTab('f'); 
    renderPriceTrendLineChart(localTrendDates, myChipsRaw);
    renderChipTrendChart();
    renderMarginTrendChart(); 
    renderSeparatedMacdChartAndDecodeSignals(localTrendDates, myChipsRaw);
    bindBiDirectionalScrollLinkage();
    scrollToLatestTrend('trend');
  }, 35);

  if (state.recentDates.length > 0) {
    const latestDayData = myChipsRaw.find(c => String(c.date) === state.recentDates[0]);
    if (latestDayData) {
      document.getElementById("modalInfoPrice").innerText = latestDayData.price || '--';
      const cv = latestDayData.change_value || 0;
      if (cv > 0) document.getElementById("modalInfoChange").innerHTML = `<span class="text-rose-600">▲${cv}</span>`;
      else if (cv < 0) document.getElementById("modalInfoChange").innerHTML = `<span class="text-emerald-600">▼${Math.abs(cv)}</span>`;
      else document.getElementById("modalInfoChange").innerText = '0.0';
      document.getElementById("modalInfoMA10").innerText = (latestDayData.ma5 !== undefined && latestDayData.ma5 !== null) ? latestDayData.ma5 : '--';
      document.getElementById("modalInfoMA20").innerText = (latestDayData.ma20 !== undefined && latestDayData.ma20 !== null) ? latestDayData.ma20 : '--';
      document.getElementById("modalInfoRSI14").innerText = (latestDayData.rsi14 !== undefined && latestDayData.rsi14 !== null) ? latestDayData.rsi14 : '--';
      
      const rawMacd = getValIgnoreCase(latestDayData, 'macd_osc');
      if (rawMacd !== null && rawMacd !== undefined) {
        if (rawMacd > 0) document.getElementById("modalInfoMACD").innerHTML = `<span class="text-rose-600 font-bold">▲${rawMacd}</span>`;
        else if (rawMacd < 0) document.getElementById("modalInfoMACD").innerHTML = `<span class="text-emerald-600 font-bold">▼${Math.abs(rawMacd)}</span>`;
        else document.getElementById("modalInfoMACD").innerText = '0.0';
      } else { document.getElementById("modalInfoMACD").innerText = '--'; }
    }
  }

  fetchStockNewsBackground(stockId, stockName);
}

async function fetchStockNewsBackground(stockId, stockName) {
  const debugBox = document.getElementById("debugLogZone");
  const listZone = document.getElementById("newsListZone");
  
  if (debugBox) { debugBox.classList.remove("hidden"); debugBox.innerHTML = `[系統新聞診斷] 啟動 ${stockId} (${stockName}) RSS解析...\n`; }
  if (listZone) { listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-6 text-center animate-pulse">正在透過網關讀取最新新聞...</div>`; }

  const rawSearchKeyword = `"${stockId}" OR "${stockName}"`;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rawSearchKeyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=10`;

  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const json = await res.json();
      if (json.status === 'ok' && json.items.length > 0) {
        let listHtml = "";
        json.items.slice(0, 10).forEach(item => {
          const pubDate = new Date(item.pubDate);
          const dateStr = `${pubDate.getFullYear()}-${String(pubDate.getMonth() + 1).padStart(2, '0')}-${String(pubDate.getDate()).padStart(2, '0')}`;
          listHtml += `
            <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="block p-3 border border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50/50 flex flex-col gap-1.5 text-left group/item transition-colors">
              <div class="text-xs text-slate-400 font-bold">📅 ${dateStr} <span class="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-black">${item.author || "財經媒體"}</span></div>
              <h4 class="text-sm font-extrabold text-blue-700 leading-snug group-hover/item:text-blue-900 group-hover/item:underline">${item.title}</h4>
            </a>`;
        });
        if (listZone) listZone.innerHTML = listHtml;
        if (debugBox) debugBox.classList.add("hidden");
        return;
      }
    }
  } catch (e) {}

  if (debugBox) debugBox.classList.add("hidden");
  if (listZone) {
    listZone.innerHTML = `
      <div class="p-5 border border-amber-200 bg-amber-50 rounded-xl text-center flex flex-col items-center gap-3">
        <div class="text-sm font-black text-amber-800">⚠️ 雲端新聞同步忙碌</div>
        <div class="flex flex-wrap gap-3 justify-center mt-2 w-full">
          <a href="https://tw.stock.yahoo.com/q/h?s=${stockId}" target="_blank" class="px-4 py-2.5 bg-purple-600 text-white text-xs font-black rounded-lg text-center">Yahoo 股市新聞</a>
          <a href="https://news.cnyes.com/news/id/${stockId}" target="_blank" class="px-4 py-2.5 bg-orange-500 text-white text-xs font-black rounded-lg text-center">Anue 鉅亨網新聞</a>
        </div>
      </div>`;
  }
}

// ==========================================================
// 🌟 1. 股價與均線走勢圖 (完全動態化自適應，消滅右側空白與底部滾動條)
// ==========================================================
export function renderPriceTrendLineChart(dates, chips) {
  const priceChartEl = document.getElementById("trendPriceChart");
  if (!priceChartEl || dates.length === 0) return;

  let cronDates = [...dates].sort((a, b) => a.localeCompare(b));
  let pricePoints = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.price) ? day.price : null; });
  let ma5Points = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.ma5 !== undefined && day.ma5 !== null) ? day.ma5 : null; });
  let ma10Points = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.ma10 !== undefined && day.ma10 !== null) ? day.ma10 : null; });
  let ma20Points = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.ma20 !== undefined && day.ma20 !== null) ? day.ma20 : null; });

  let checkPool = [...pricePoints];
  if (state.visibleLines.ma5) checkPool.push(...ma5Points);
  if (state.visibleLines.ma10) checkPool.push(...ma10Points);
  if (state.visibleLines.ma20) checkPool.push(...ma20Points);

  let allValidValues = checkPool.filter(v => v !== null && !isNaN(v));
  if (allValidValues.length === 0) { priceChartEl.innerHTML = `<div class="text-xs text-slate-400 m-auto">無近期股價趨勢資料</div>`; return; }

  let maxP = Math.max(...allValidValues), minP = Math.min(...allValidValues), rangeP = maxP - minP === 0 ? 1 : maxP - minP;
  
  // 🎯 終極修復：即時讀取外部框容器的實際真實 clientWidth，容器多寬就完美畫滿多寬！
  const wrapper = document.getElementById("priceScrollWrapper");
  const containerWidth = wrapper ? wrapper.clientWidth : 940;
  
  let count = cronDates.length, stepX = containerWidth / count; 
  let polylinePrice = [], polylineMA5 = [], polylineMA10 = [], polylineMA20 = [];
  let svgCirclesHtml = "", svgDatesHtml = "";

  cronDates.forEach((d, idx) => {
    const price = pricePoints[idx];
    const ma5 = ma5Points[idx];
    const ma10 = ma10Points[idx];
    const ma20 = ma20Points[idx];
    const datePart = d.split('-')[1] + '/' + d.split('-')[2];
    
    let exactX = idx * stepX + (stepX / 2); 

    if (price !== null) {
      let yPercent = ((price - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82); 
      polylinePrice.push(`${exactX},${exactY}`);
      let midPrice = (maxP + minP) / 2, textY = price >= midPrice ? (exactY + 13) : (exactY - 5);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="3.5" fill="#1e40af" stroke="#ffffff" stroke-width="1.5" /><text x="${exactX}" y="${textY}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e3a8a" font-family="sans-serif">${price}</text>`;
    }
    if (ma5 !== null && state.visibleLines.ma5) {
      let yPercent = ((ma5 - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82);
      polylineMA5.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#ec4899" /><text x="${exactX}" y="${exactY + 9}" text-anchor="middle" font-weight="black" font-size="10" fill="#9d174d" font-family="sans-serif">${ma5.toFixed(1)}</text>`;
    }
    if (ma10 !== null && state.visibleLines.ma10) {
      let yPercent = ((ma10 - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82);
      polylineMA10.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#10b981" /><text x="${exactX}" y="${exactY - 5}" text-anchor="middle" font-weight="black" font-size="10" fill="#064e3b" font-family="sans-serif">${ma10.toFixed(1)}</text>`;
    }
    if (state.visibleLines.ma20 && ma20 !== null) {
      let yPercent = ((ma20 - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82);
      polylineMA20.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#f97316" /><text x="${exactX}" y="${exactY + 13}" text-anchor="middle" font-weight="black" font-size="10" fill="#7c2d12" font-family="sans-serif">${ma20.toFixed(1)}</text>`;
    }
    
    svgDatesHtml += `<text x="${exactX}" y="95" text-anchor="middle" font-weight="black" font-size="10" fill="#0f172a" font-family="sans-serif">${datePart}</text>`;
  });

  priceChartEl.innerHTML = `
    <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: 100%; height: 102px;">
      <line x1="0" y1="44" x2="100%" y2="44" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4" />
      <polyline points="${polylineMA5.join(' ')}" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${polylineMA10.length > 0 ? `<polyline points="${polylineMA10.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${polylineMA20.length > 0 ? `<polyline points="${polylineMA20.join(' ')}" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      <polyline points="${polylinePrice.join(' ')}" fill="none" stroke="#1e40af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${svgCirclesHtml}
      ${svgDatesHtml}
    </svg>`;
  priceChartEl.style.width = "100%";
  priceChartEl.style.height = "102px";
}

// ==========================================================
// 🌟 2. 三大法人籌碼圖 (自適應吃滿，框線尺寸與內襯與股價圖100%完美鏡像對齊)
// ==========================================================
export function renderChipTrendChart() {
  const chipChartEl = document.getElementById("trendChipChart");
  if (!chipChartEl || !state.currentActiveStockId) return;

  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
  const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b)); 

  const subTabConfigs = { f: { bKey: 'f_buy', sKey: 'f_sell', color: '#f43f5e', negColor: '#10b981' }, it: { bKey: 'it_buy', sKey: 'it_sell', color: '#f97316', negColor: '#14b8a6' }, ds: { bKey: 'ds_buy', sKey: 'ds_sell', color: '#ef4444', negColor: '#22c55e' } };
  const cfg = subTabConfigs[state.currentChipSubTab];
  
  let nets = localTrend
