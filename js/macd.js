// js/macd.js
import { state, getValIgnoreCase, setSignalDetail, decodeMacdSignal, MACD_SIGNALS } from './config.js';

if (!state.visibleLines) {
  state.visibleLines = { ma5: true, ma10: false, ma20: true };
}

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
      if (pWrapper) pWrapper.scrollLeft = pWrapper.scrollWidth;
      if (cWrapper) cWrapper.scrollLeft = cWrapper.scrollWidth;
    } else if (tabMode === 'macd') {
      const mWrapper = document.getElementById("macdChartScrollWrapper");
      if (mWrapper) mWrapper.scrollLeft = mWrapper.scrollWidth;
    }
  }, 60);
}

function bindBiDirectionalScrollLinkage() {
  const pWrapper = document.getElementById("priceScrollWrapper");
  const cWrapper = document.getElementById("chipScrollWrapper");
  if (!pWrapper || !cWrapper) return;

  let isSyncingPriceScroll = false;
  let isSyncingChipScroll = false;

  pWrapper.onscroll = () => {
    if (!isSyncingChipScroll) {
      isSyncingPriceScroll = true;
      cWrapper.scrollLeft = pWrapper.scrollLeft;
    }
    isSyncingChipScroll = false;
  };

  cWrapper.onscroll = () => {
    if (!isSyncingPriceScroll) {
      isSyncingChipScroll = true;
      pWrapper.scrollLeft = cWrapper.scrollLeft;
    }
    isSyncingPriceScroll = false;
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

  const debugBox = document.getElementById("debugLogZone"), listZone = document.getElementById("newsListZone");
  if(debugBox) {
    debugBox.classList.remove("hidden");
    debugBox.innerHTML = `[系統診斷開始] 初始化 ${stockId} (${stockName}) 新聞獲取流...\n`;
  }
  if(listZone) listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-6 text-center animate-pulse">正在即時連線抓取最新財經新聞...</div>`;

  const rawSearchKeyword = `"${stockId}" OR "${stockName}"`;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rawSearchKeyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=10`;

  let maxRetries = 3, currentRetry = 0, successFetch = false, resJson = null;
  while (currentRetry < maxRetries && !successFetch) {
    currentRetry++;
    try {
      const res = await fetch(apiUrl);
      if (res.ok) { const json = await res.json(); if (json.status === 'ok') { resJson = json; successFetch = true; break; } }
    } catch (fetchErr) { console.error(fetchErr); }
  }

  if (successFetch && resJson) {
    const fetchedItems = resJson.items || [];
    if (fetchedItems.length > 0) {
      let listHtml = "";
      fetchedItems.slice(0, 10).forEach(item => {
        const pubDate = new Date(item.pubDate), dateStr = `${pubDate.getFullYear()}-${String(pubDate.getMonth()+1).padStart(2,'0')}-${String(pubDate.getDate()).padStart(2,'0')}`;
        listHtml += `<a href="${item.link}" target="_blank" rel="noopener noreferrer" class="block p-3 border border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50/50 flex flex-col gap-1.5 text-left group/item"><div class="text-xs text-slate-400 font-bold flex items-center gap-2"><span>📅 ${dateStr}</span><span class="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-black">${item.author || "財經媒體"}</span></div><h4 class="text-sm font-extrabold text-blue-700 leading-snug group-hover/item:text-blue-900 group-hover/item:underline">${item.title}</h4></a>`;
      });
      if(listZone) listZone.innerHTML = listHtml; if(debugBox) debugBox.classList.add("hidden");
    } else { if(listZone) listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-8 text-center">查無相關新聞</div>`; }
  } else { if(listZone) listZone.innerHTML = `<div class="text-xs text-rose-500 font-medium py-8 text-center">新聞連線過載。</div>`; }
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
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="3.5" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" /><text x="${exactX}" y="${textY}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e3a8a" font-family="sans-serif">${price}</text>`;
    }
    
    if (ma5 !== null && state.visibleLines.ma5) {
      let yPercent = ((ma5 - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96);
      polylineMA5.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#a855f7" /><text x="${exactX}" y="${exactY + 9}" text-anchor="middle" font-weight="black" font-size="10" fill="#581c87" font-family="sans-serif">${ma5.toFixed(1)}</text>`;
    }
    if (ma10 !== null && state.visibleLines.ma10) {
      let yPercent = ((ma10 - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96);
      polylineMA10.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#10b981" /><text x="${exactX}" y="${exactY - 5}" text-anchor="middle" font-weight="black" font-size="10" fill="#064e3b" font-family="sans-serif">${ma10.toFixed(1)}</text>`;
    }
    if (ma20 !== null && state.visibleLines.ma20) {
      let yPercent = ((ma20 - minP) / rangeP) * 55 + 20; let exactY = 96 - ((yPercent / 100) * 96);
      polylineMA20.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="2" fill="#f97316" /><text x="${exactX}" y="${exactY + 14}" text-anchor="middle" font-weight="black" font-size="10" fill="#7c2d12" font-family="sans-serif">${ma20.toFixed(1)}</text>`;
    }
    dateHtml += `<span class="flex-1 text-center font-black text-[10px] text-slate-950 truncate px-0.5">${datePart}</span>`;
  });

  priceChartEl.innerHTML = `
    <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 96px;">
      <line x1="0" y1="48" x2="${containerWidth}" y2="48" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4" />
      ${polylineMA5.length > 0 ? `<polyline points="${polylineMA5.join(' ')}" fill="none" stroke="#a855f
