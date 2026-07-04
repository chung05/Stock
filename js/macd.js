// js/macd.js
// 🎯 智慧修正：頂部 Import 對齊新版 16 維度解碼晶片 `decodeMultiDimensionSignal`
import { state, getValIgnoreCase, setSignalDetail, decodeMultiDimensionSignal, MACD_SIGNALS } from './config.js';

if (!state.visibleLines) {
  state.visibleLines = { ma5: true, ma10: false, ma20: true };
}

// ==========================================================
// 🚨 終極救星：生命週期延時防禦晶片 (徹底解決早上修改資料庫導致的開局 DOM 未渲染死鎖)
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
        renderMarginTrendChart(); // 啟動最新治本純 SVG 圖表
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
  
  if (debugBox) { debugBox.classList.remove("hidden"); debugBox.innerHTML = `[系統新聞診斷] 啟動 ${stockId} RSS解析...\n`; }
  if (listZone) { listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-6 text-center animate-pulse">正在讀取最新新聞...</div>`; }

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
          <a href="https://tw.stock.yahoo.com/q/h?s=${stockId}" target="_blank" class="px-4 py-2.5 bg-purple-600 text-white text-xs font-black rounded-lg text-center">Yahoo 股市個股新聞</a>
          <a href="https://news.cnyes.com/news/id/${stockId}" target="_blank" class="px-4 py-2.5 bg-orange-500 text-white text-xs font-black rounded-lg text-center">Anue 鉅亨網即時新聞</a>
        </div>
      </div>`;
  }
}

export function renderPriceTrendLineChart(dates, chips) {
  const priceChartEl = document.getElementById("trendPriceChart");
  const priceDatesEl = document.getElementById("trendPriceDates");
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
  if (allValidValues.length === 0) { priceChartEl.innerHTML = `<div class="text-xs text-slate-400 m-auto">無近期股價趨勢資料</div>`; priceDatesEl.innerHTML = ""; return; }

  let maxP = Math.max(...allValidValues), minP = Math.min(...allValidValues), rangeP = maxP - minP === 0 ? 1 : maxP - minP;
  let containerWidth = priceChartEl.clientWidth || 940, count = cronDates.length, stepX = containerWidth / count; 
  
  let polylinePrice = [], polylineMA5 = [], polylineMA10 = [], polylineMA20 = [];
  let svgCirclesHtml = "", dateHtml = "";

  cronDates.forEach((d, idx) => {
    const price = pricePoints[idx];
    const ma5 = ma5Points[idx];
    const ma10 = ma10Points[idx];
    const ma20 = ma20Points[idx];
    const datePart = d.split('-')[1] + '/' + d.split('-')[2];
    let exactX = idx * stepX + (stepX / 2); 

    if (price !== null) {
      let yPercent = ((price - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96); 
      polylinePrice.push(`${exactX},${exactY}`);
      let midPrice = (maxP + minP) / 2, textY = price >= midPrice ? (exactY + 14) : (exactY - 6);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="3.5" fill="#1e40af" stroke="#ffffff" stroke-width="1.5" /><text x="${exactX}" y="${textY}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e3a8a" font-family="sans-serif">${price}</text>`;
    }
    if (ma5 !== null && state.visibleLines.ma5) {
      let yPercent = ((ma5 - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96);
      polylineMA5.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#ec4899" /><text x="${exactX}" y="${exactY + 9}" text-anchor="middle" font-weight="black" font-size="10" fill="#9d174d" font-family="sans-serif">${ma5.toFixed(1)}</text>`;
    }
    if (ma10 !== null && state.visibleLines.ma10) {
      let yPercent = ((ma10 - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96);
      polylineMA10.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#10b981" /><text x="${exactX}" y="${exactY - 5}" text-anchor="middle" font-weight="black" font-size="10" fill="#064e3b" font-family="sans-serif">${ma10.toFixed(1)}</text>`;
    }
    if (state.visibleLines.ma20 && ma20 !== null) {
      let yPercent = ((ma20 - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96);
      polylineMA20.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#f97316" /><text x="${exactX}" y="${exactY + 14}" text-anchor="middle" font-weight="black" font-size="10" fill="#7c2d12" font-family="sans-serif">${ma20.toFixed(1)}</text>`;
    }
    dateHtml += `<span class="flex-1 text-center font-black text-[10px] text-slate-950 truncate px-0.5">${datePart}</span>`;
  });

  priceChartEl.innerHTML = `
    <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 96px;">
      <line x1="0" y1="48" x2="${containerWidth}" y2="48" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4" />
      <polyline points="${polylineMA5.join(' ')}" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${polylineMA10.length > 0 ? `<polyline points="${polylineMA10.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${polylineMA20.length > 0 ? `<polyline points="${polylineMA20.join(' ')}" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      <polyline points="${polylinePrice.join(' ')}" fill="none" stroke="#1e40af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${svgCirclesHtml}
    </svg>`;
  priceDatesEl.innerHTML = dateHtml;
}

export function renderSeparatedMacdChartAndDecodeSignals(dates, chips) {
  const lineChartEl = document.getElementById("macdLineChart"), barChartEl = document.getElementById("macdBarChart");
  const lineDatesEl = document.getElementById("macdLineDates"), boardTitleEl = document.getElementById("macdSignalTitle");
  const barDatesEl = document.getElementById("macdBarDates");
  const kdChartEl = document.getElementById("kdLineChart"), kdDatesEl = document.getElementById("kdLineDates");

  let cronDates = [...dates].sort((a, b) => a.localeCompare(b));
  let dataset = cronDates.map(d => { 
    const row = chips.find(c => String(c.date) === d); 
    return { 
      date: d, 
      dif: row ? getValIgnoreCase(row, 'macd_dif') : null, 
      sig: row ? getValIgnoreCase(row, 'macd_signal') : null, 
      osc: row ? getValIgnoreCase(row, 'macd_osc') : null,
      kd_k: row ? getValIgnoreCase(row, 'kd_k') : null,
      kd_d: row ? getValIgnoreCase(row, 'kd_d') : null
    }; 
  });

  let lineValues = dataset.flatMap(d => [d.dif, d.sig]).filter(v => v !== null && !isNaN(v)), maxLine = Math.max(...lineValues, 0.01), minLine = Math.min(...lineValues, -0.01), lineRange = maxLine - minLine === 0 ? 1 : maxLine - minLine;
  let oscValues = dataset.map(d => d.osc).filter(v => v !== null && !isNaN(v)), maxOscAbs = Math.max(...oscValues.map(Math.abs), 0.01);
  let containerWidth = lineChartEl.clientWidth || 820, count = dataset.length, stepX = containerWidth / count; 
  
  let difPoints = [], sigPoints = [], macdLineCirclesHtml = "", barChartHtml = `<div class="absolute left-0 right-0 h-[1.5px] bg-slate-400 z-10" style="top: 50%;"></div>`;
  let lineChartHtml = `<div class="absolute left-0 right-0 h-[1px] bg-slate-200 z-10" style="top: 50%;"></div>`, lineDateHtml = "";
  let kdChartHtml = `<div class="absolute left-0 right-0 h-[1px] bg-rose-200/80 border-dashed z-10" style="top: 20%;"></div><div class="absolute left-0 right-0 h-[1px] bg-slate-200/60 border-dashed z-10" style="top: 50%;"></div><div class="absolute left-0 right-0 h-[1px] bg-emerald-200/80 border-dashed z-10" style="top: 80%;"></div>`;
  let kPoints = [], dPoints = [], kdCirclesHtml = "";

  dataset.forEach((d, idx) => {
    const datePart = d.date.split('-')[1] + '/' + d.date.split('-')[2];
    lineDateHtml += `<span class="flex-1 text-center font-bold tracking-tighter text-[10px] text-slate-400 px-0.5">${datePart}</span>`;
    let xPos = idx * stepX + (stepX / 2);
    let difY = ((maxLine - d.dif) / lineRange) * 70 + 15;
    let sigY = ((maxLine - d.sig) / lineRange) * 70 + 15;
    let exactDifY = (difY / 100) * 112;
    let exactSigY = (sigY / 100) * 112;

    if (d.dif !== null) { difPoints.push(`${xPos},${exactDifY}`); macdLineCirclesHtml += `<circle cx="${xPos}" cy="${exactDifY}" r="2" fill="#3b82f6" /><text x="${xPos}" y="${exactDifY - 4}" text-anchor="middle" font-weight="black" font-size="10" fill="#1d4ed8">${d.dif.toFixed(2)}</text>`; }
    if (d.sig !== null) { sigPoints.push(`${xPos},${exactSigY}`); macdLineCirclesHtml += `<circle cx="${xPos}" cy="${exactSigY}" r="2" fill="#fb923c" /><text x="${xPos}" y="${exactSigY + 8}" text-anchor="middle" font-weight="black" font-size="10" fill="#c2410c">${d.sig.toFixed(2)}</text>`; }

    lineChartHtml += `<div class="flex flex-col items-center flex-1 h-full relative min-w-0 z-20"><div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div></div>`;
    let oscHeightPct = d.osc !== null ? Math.min((Math.abs(d.osc) / maxOscAbs) * 45, 45) : 0;
    let oscBg = d.osc > 0 ? "bg-rose-500/90" : "bg-emerald-500/90";
    let oscTop = d.osc > 0 ? `calc(50% - ${oscHeightPct}%)` : "50%";
    let textOscY = d.osc >= 0 ? "top-[1px]" : "bottom-[1px]";
    let textOscColor = d.osc >= 0 ? "text-rose-600" : "text-emerald-700";

    barChartHtml += `
      <div class="flex flex-col items-center flex-1 h-full relative min-w-0 z-20">
        <div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div>
        <div class="absolute w-3.5 max-w-[12px] min-w-[4px] ${oscBg} rounded-xs shadow-3xs" style="top: ${oscTop}; height: ${oscHeightPct}%;"></div>
        ${d.osc !== null ? `<span class="absolute ${textOscY} text-[10.5px] font-black tracking-tighter ${textOscColor}">${d.osc.toFixed(2)}</span>` : ''}
      </div>`;

    if (d.kd_k !== null && d.kd_d !== null) {
      let kY = ((100 - d.kd_k) / 100) * 112; let dY = ((100 - d.kd_d) / 100) * 112;
      kPoints.push(`${xPos},${kY}`); dPoints.push(`${xPos},${dY}`);
      kdCirclesHtml += `<circle cx="${xPos}" cy="${kY}" r="2" fill="#0ea5e9" /><circle cx="${xPos}" cy="${dY}" r="2" fill="#f59e0b" /><text x="${xPos}" y="${kY - 4}" text-anchor="middle" font-weight="black" font-size="10.5" fill="#0369a1">${Math.round(d.kd_k)}</text><text x="${xPos}" y="${dY + 9}" text-anchor="middle" font-weight="black" font-size="10.5" fill="#b45309">${Math.round(d.kd_d)}</text>`;
    }
    kdChartHtml += `<div class="flex flex-col items-center flex-1 h-full relative z-20"><div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div></div>`;
  });

  if (difPoints.length > 0 || sigPoints.length > 0) { lineChartHtml += `<svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 112px;"><polyline points="${difPoints.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${sigPoints.join(' ')}" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${macdLineCirclesHtml}</svg>`; }
  if(lineChartEl) lineChartEl.innerHTML = lineChartHtml; if(barChartEl) barChartEl.innerHTML = barChartHtml;
  if(lineDatesEl) lineDatesEl.innerHTML = lineDateHtml; if(barDatesEl) barDatesEl.innerHTML = lineDateHtml;

  if (kPoints.length > 0 || dPoints.length > 0) { kdChartHtml += `<svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 112px;"><polyline points="${kPoints.join(' ')}" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${dPoints.join(' ')}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${kdCirclesHtml}</svg>`; }
  if (kdChartEl) kdChartEl.innerHTML = kdChartHtml; if (kdDatesEl) kdDatesEl.innerHTML = lineDateHtml;

  const matchedCodes = decodeMultiDimensionSignal(chips);
  let titleText = "正常盤整型態";
  if (matchedCodes && matchedCodes.length > 0) { titleText = matchedCodes.map(code => { const fullText = MACD_SIGNALS[code] || ""; return fullText.includes("。") || fullText.includes("（") ? fullText.split("（")[0].replace(/^\d+\.\s*/, '') : fullText; }).join(" + "); }
  if(boardTitleEl) { boardTitleEl.innerHTML = `<span class="text-blue-600 font-black text-xs sm:text-sm md:text-base tracking-wide whitespace-nowrap">${titleText}</span><button id="macdInfoBtnInline" onclick="window.showSignalInfoDialog()" class="bg-white text-blue-600 border border-blue-200 rounded-md px-1 py-0.5 text-[9px] font-black shadow-3xs cursor-pointer">ℹ️ 條件</button>`; }
}

export function renderChipTrendChart() {
  const chipChartEl = document.getElementById("trendChipChart");
  if (!chipChartEl || !state.currentActiveStockId) return;

  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
  const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b)); 

  const subTabConfigs = { f: { bKey: 'f_buy', sKey: 'f_sell', color: 'bg-rose-500', negColor: 'bg-emerald-500' }, it: { bKey: 'it_buy', sKey: 'it_sell', color: 'bg-orange-500', negColor: 'bg-teal-500' }, ds: { bKey: 'ds_buy', sKey: 'ds_sell', color: 'bg-red-500', negColor: 'bg-green-500' } };
  const cfg = subTabConfigs[state.currentChipSubTab];
  
  let nets = localTrendDates.map(d => { 
    const row = myChipsRaw.find(c => String(c.date) === d); if (!row) return 0; 
    if (state.currentChipSubTab === "ds") return Math.round(((row.ds_buy || 0) + (row.dh_buy || 0)) / 1000) - Math.round(((row.ds_sell || 0) + (row.dh_sell || 0)) / 1000); 
    return Math.round((getValIgnoreCase(row, cfg.bKey) || 0) / 1000) - Math.round((getValIgnoreCase(row, cfg.sKey) || 0) / 1000); 
  });

  let absMax = Math.max(...nets.map(Math.abs), 1), barsHtml = localTrendDates.map((d, i) => { 
    const val = nets[i], isPositive = val >= 0, heightPct = Math.min(Math.round((Math.abs(val) / absMax) * 80), 80), datePart = d.split('-')[1] + '/' + d.split('-')[2];
    return `<div class="flex flex-col flex-1 h-full min-w-0 relative items-center"><div class="w-full h-1/2 flex flex-col justify-end items-center relative">${isPositive && val > 0 ? `<span class="text-xs font-black text-rose-600 mb-1 tracking-tighter">+${val}</span><div class="w-full max-w-[20px] min-w-[4px] ${cfg.color} rounded-t-xs shadow-2xs" style="height: ${heightPct}%;"></div>` : ''}${val === 0 ? `<span class="text-xs font-bold text-slate-400 mb-1">0</span>` : ''}</div><div class="w-full h-1/2 flex flex-col justify-start items-center relative">${!isPositive ? `<div class="w-full max-w-[20px] min-w-[4px] ${cfg.negColor} rounded-b-xs shadow-2xs" style="height: ${heightPct}%;"></div><span class="text-xs font-black text-emerald-600 mt-1 tracking-tighter">${val}</span>` : ''}<span class="absolute top-[2px] text-[10px] text-slate-950 font-black tracking-tighter">${datePart}</span></div></div>`; 
  }).join('');

  chipChartEl.innerHTML = `<div class="bg-slate-50 border border-slate-200 rounded-xl p-1.5 w-full"><div class="w-full h-32 flex justify-between bg-white rounded-lg border border-slate-200 px-1 relative items-center"><div class="absolute left-0 right-0 h-[1.5px] bg-slate-400 z-10"></div>${barsHtml}</div></div>`;
}

// =========================================================================
// 🌟 終極完美修正版：全 SVG 純幾何圖表架構（融資增減基準線錨定 + 數值強制顯示 + 雙層底置日期）
// =========================================================================
export function renderMarginTrendChart() {
  const marginChartEl = document.getElementById("trendMarginChart");
  if (!marginChartEl || !state.currentActiveStockId) return;

  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
  const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b));

  let marginNetPoints = localTrendDates.map(d => {
    const row = myChipsRaw.find(c => String(c.date) === d);
    return row ? ((getValIgnoreCase(row, 'margin_buy') || 0) - (getValIgnoreCase(row, 'margin_sell') || 0)) : 0;
  });

  let marginBalancePoints = localTrendDates.map(d => {
    const row = myChipsRaw.find(c => String(c.date) === d);
    return row ? (getValIgnoreCase(row, 'margin_balance') || 0) : 0;
  });

  let maxNet = Math.max(...marginNetPoints.map(Math.abs), 1);
  let maxBal = Math.max(...marginBalancePoints, 1);

  const containerWidth = marginChartEl.clientWidth || 940;
  const count = localTrendDates.length;
  const stepX = containerWidth / count;

  // 1. 上圖：純 SVG 融資增減雙向對稱平衡圖 (基準線定格 Y=48，正值往上，負值往下)
  let upperSvgHtml = `<line x1="0" y1="48" x2="${containerWidth}" y2="48" stroke="#94a3b8" stroke-width="1.5" />`; // 實體基準線
  
  // 2. 下圖：純 SVG 融資餘額累積水柱圖
  let lowerSvgHtml = "";

  localTrendDates.forEach((d, idx) => {
    const netVal = marginNetPoints[idx];
    const balVal = marginBalancePoints[idx];
    const datePart = d.split('-')[1] + '/' + d.split('-')[2];
    
    let exactX = idx * stepX + (stepX / 2); // 當前交易日的 X 軸核心中線
    
    // --- 上圖 SVG 幾何編譯 ---
    if (netVal !== 0) {
      // 縮放配比高度（最高佔單側 34px，留出 14px 寫字空間）
      let barHeight = (Math.abs(netVal) / maxNet) * 32;
      let barWidth = Math.min(stepX * 0.45, 14); // 柱體寬度
      let barX = exactX - (barWidth / 2);
      
      if (netVal > 0) {
        // 融資增：由基準線 48 往上拉伸，Y 軸起點為 48 - barHeight
        let barY = 48 - barHeight;
        upperSvgHtml += `
          <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="#e11d48" rx="1" />
          <text x="${exactX}" y="${barY - 4}" text-anchor="middle" font-weight="900" font-size="10" fill="#e11d48" font-family="sans-serif">+${netVal}</text>
        `;
      } else {
        // 融資減：由基準線 48 往下拉伸，Y 軸起點為 48 直接向下延伸
        upperSvgHtml += `
          <rect x="${barX}" y="48" width="${barWidth}" height="${barHeight}" fill="#065f46" rx="1" />
          <text x="${exactX}" y="${48 + barHeight + 11}" text-anchor="middle" font-weight="900" font-size="10" fill="#065f46" font-family="sans-serif">${netVal}</text>
        `;
      }
    } else {
      // 0 軸標示
      upperSvgHtml += `<text x="${exactX}" y="45" text-anchor="middle" font-weight="bold" font-size="10" fill="#94a3b8">0</text>`;
    }
    // 上層獨立圖表底置日期刻度（放置在 Y=93 基準線最下方）
    upperSvgHtml += `<text x="${exactX}" y="93" text-anchor="middle" font-weight="black" font-size="10" fill="#64748b">${datePart}</text>`;

    // --- 下圖 SVG 幾何編譯 ---
    let balHeight = (balVal / maxBal) * 64; // 最高佔 64px，留出 14px 寫字
    let balWidth = Math.min(stepX * 0.55, 18);
    let balX = exactX - (balWidth / 2);
    let balY = 82 - balHeight; // 基底定格在 Y=82 處往上長
    
    lowerSvgHtml += `
      <rect x="${balX}" y="${balY}" width="${balWidth}" height="${balHeight}" fill="#1e40af" rx="1.5" />
      <text x="${exactX}" y="${balY - 4}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e40af" font-family="sans-serif">${balVal}</text>
      <text x="${exactX}" y="94" text-anchor="middle" font-weight="black" font-size="10" fill="#64748b">${datePart}</text>
    `;
  });

  marginChartEl.innerHTML = `
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 w-full mt-1">
      <div class="flex justify-between items-center mb-1.5 px-1">
        <div class="text-xs font-black text-slate-500">🔹 融資(張)</div>
        <div class="flex gap-3 text-xs font-black text-slate-400">
          <span class="flex items-center gap-0.5"><span class="w-2.5 h-2.5 bg-rose-600 inline-block rounded-xs"></span>融資增</span>
          <span class="flex items-center gap-0.5"><span class="w-2.5 h-2.5 bg-emerald-800 inline-block rounded-xs"></span>融資減</span>
          <span class="flex items-center gap-0.5"><span class="w-2.5 h-2.5 bg-blue-800 inline-block rounded-xs"></span>融資餘額</span>
        </div>
      </div>
      
      <div class="flex flex-col gap-3 w-full">
        <div class="w-full h-[102px] bg-white rounded-lg border border-slate-200 relative overflow-hidden shadow-3xs">
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 102px;">
            ${upperSvgHtml}
          </svg>
        </div>
        
        <div class="w-full h-[102px] bg-white rounded-lg border border-slate-200 relative overflow-hidden shadow-3xs">
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 102px;">
            <line x1="0" y1="82" x2="${containerWidth}" y2="82" stroke="#e2e8f0" stroke-width="1" />
            ${lowerSvgHtml}
          </svg>
        </div>
      </div>
    </div>`;
}
