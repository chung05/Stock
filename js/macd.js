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
  if (listZone) { listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-6 text-center animate-pulse">正在透過網關讀取新聞...</div>`; }

  const rawSearchKeyword = `"${stockId}" OR "${stockName}"`;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rawSearchKeyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=10`;

  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const json = await res.json();
      if (json.status === 'ok' && json.items && json.items.length > 0) {
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
  } catch (e) {
    console.error("新聞抓取異常:", e);
  }

  if (debugBox) document.getElementById("debugLogZone").classList.add("hidden");
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

// ====================================================================================
// 🌟 1. 股價與均線走勢圖 (標準兩層框模式，14等分間距)
// ====================================================================================
export function renderPriceTrendLineChart(dates, chips) {
  const priceChartEl = document.getElementById("trendPriceChart");
  if (!priceChartEl || dates.length === 0) return;

  let cronDates = [...dates].sort((a, b) => a.localeCompare(b));
  if (cronDates.length > 15) { cronDates = cronDates.slice(-15); }

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
  
  const containerWidth = priceChartEl.clientWidth || 940;
  let usableWidth = containerWidth - 50; 
  let stepX = usableWidth / 14; 

  let polylinePrice = [], polylineMA5 = [], polylineMA10 = [], polylineMA20 = [];
  let svgCirclesHtml = "", svgDatesHtml = "";

  cronDates.forEach((d, idx) => {
    const price = pricePoints[idx];
    const ma5 = ma5Points[idx];
    const ma10 = ma10Points[idx];
    const ma20 = ma20Points[idx];
    const datePart = d.split('-')[1] + '/' + d.split('-')[2];
    
    let exactX = 25 + (idx * stepX);

    if (price !== null) {
      let yPercent = ((price - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82); 
      polylinePrice.push(`${exactX},${exactY}`);
      let midPrice = (maxP + minP) / 2, textY = price >= midPrice ? (exactY + 13) : (exactY - 5);
      svgCirclesHtml += `<g><circle cx="${exactX}" cy="${exactY}" r="3.5" fill="#1e40af" stroke="#ffffff" stroke-width="1.5" /><text x="${exactX}" y="${textY}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e3a8a" font-family="sans-serif">${price}</text></g>`;
    }
    if (ma5 !== null && state.visibleLines.ma5) {
      let yPercent = ((ma5 - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82);
      polylineMA5.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<g><circle cx="${exactX}" cy="${exactY}" r="2" fill="#ec4899" /><text x="${exactX}" y="${exactY + 9}" text-anchor="middle" font-weight="black" font-size="10" fill="#9d174d" font-family="sans-serif">${ma5.toFixed(1)}</text></g>`;
    }
    if (ma10 !== null && state.visibleLines.ma10) {
      let yPercent = ((ma10 - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82);
      polylineMA10.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<g><circle cx="${exactX}" cy="${exactY}" r="2" fill="#10b981" /><text x="${exactX}" y="${exactY - 5}" text-anchor="middle" font-weight="black" font-size="10" fill="#064e3b" font-family="sans-serif">${ma10.toFixed(1)}</text></g>`;
    }
    if (state.visibleLines.ma20 && ma20 !== null) {
      let yPercent = ((ma20 - minP) / rangeP) * 50 + 15; let exactY = 82 - ((yPercent / 100) * 82);
      polylineMA20.push(`${exactX},${exactY}`);
      svgCirclesHtml += `<g><circle cx="${exactX}" cy="${exactY}" r="2" fill="#f97316" /><text x="${exactX}" y="${exactY + 13}" text-anchor="middle" font-weight="black" font-size="10" fill="#7c2d12" font-family="sans-serif">${ma20.toFixed(1)}</text></g>`;
    }
    svgDatesHtml += `<text x="${exactX}" y="95" text-anchor="middle" font-weight="black" font-size="10" fill="#0f172a" font-family="sans-serif">${datePart}</text>`;
  });

  polylinePrice.sort((a,b) => parseFloat(a.split(',')[0]) - parseFloat(b.split(',')[0]));
  polylineMA5.sort((a,b) => parseFloat(a.split(',')[0]) - parseFloat(b.split(',')[0]));
  polylineMA10.sort((a,b) => parseFloat(a.split(',')[0]) - parseFloat(b.split(',')[0]));
  polylineMA20.sort((a,b) => parseFloat(a.split(',')[0]) - parseFloat(b.split(',')[0]));

  priceChartEl.innerHTML = `
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 h-[102px] relative overflow-hidden" style="width: 100%;">
      <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: 100%; height: 102px;">
        <line x1="0" y1="44" x2="100%" y2="44" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4" />
        <polyline points="${polylineMA5.join(' ')}" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${polylineMA10.length > 0 ? `<polyline points="${polylineMA10.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${polylineMA20.length > 0 ? `<polyline points="${polylineMA20.join(' ')}" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        <polyline points="${polylinePrice.join(' ')}" fill="none" stroke="#1e40af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${svgCirclesHtml}
        ${svgDatesHtml}
      </svg>
    </div>`;
  priceChartEl.style.width = "100%";
}

export function renderChipTrendChart() {
  const chipChartEl = document.getElementById("trendChipChart");
  if (!chipChartEl || !state.currentActiveStockId) return;

  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
  let localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b)); 

  if (localTrendDates.length > 15) { localTrendDates = localTrendDates.slice(-15); }

  const subTabConfigs = { f: { bKey: 'f_buy', sKey: 'f_sell', color: '#f43f5e', negColor: '#10b981' }, it: { bKey: 'it_buy', sKey: 'it_sell', color: '#f97316', negColor: '#14b8a6' }, ds: { bKey: 'ds_buy', sKey: 'ds_sell', color: '#ef4444', negColor: '#22c55e' } };
  const cfg = subTabConfigs[state.currentChipSubTab];
  
  let nets = localTrendDates.map(d => { 
    const row = myChipsRaw.find(c => String(c.date) === d); if (!row) return 0; 
    if (state.currentChipSubTab === "ds") return Math.round(((row.ds_buy || 0) + (row.dh_buy || 0)) / 1000) - Math.round(((row.ds_sell || 0) + (row.dh_sell || 0)) / 1000); 
    return Math.round((getValIgnoreCase(row, cfg.bKey) || 0) / 1000) - Math.round((getValIgnoreCase(row, cfg.sKey) || 0) / 1000); 
  });

  const containerWidth = chipChartEl.clientWidth || 940;
  let usableWidth = containerWidth - 50;
  let stepX = usableWidth / 14; 
  let absMax = Math.max(...nets.map(Math.abs), 1);
  
  let svgBarsHtml = `<line x1="0" y1="46" x2="100%" y2="46" stroke="#94a3b8" stroke-width="1" />`;

  localTrendDates.forEach((d, idx) => {
    const val = nets[idx];
    const datePart = d.split('-')[1] + '/' + d.split('-')[2];
    let exactX = 25 + (idx * stepX);
    
    if (val !== 0) {
      let barHeight = (Math.abs(val) / absMax) * 32;
      let barWidth = 14;
      let barX = exactX - (barWidth / 2);
      
      if (val > 0) {
        let barY = 46 - barHeight;
        svgBarsHtml += `
          <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="${cfg.color}" rx="1" />
          <text x="${exactX}" y="${barY - 3}" text-anchor="middle" font-weight="900" font-size="10" fill="#e11d48" font-family="sans-serif">+${val}</text>
        `;
      } else {
        svgBarsHtml += `
          <rect x="${barX}" y="46" width="${barWidth}" height="${barHeight}" fill="${cfg.negColor}" rx="1" />
          <text x="${exactX}" y="${46 + barHeight + 11}" text-anchor="middle" font-weight="900" font-size="10" fill="#047857" font-family="sans-serif">${val}</text>
        `;
      }
    } else {
      svgBarsHtml += `<text x="${exactX}" y="42" text-anchor="middle" font-weight="bold" font-size="10" fill="#94a3b8">0</text>`;
    }
    svgBarsHtml += `<text x="${exactX}" y="95" text-anchor="middle" font-weight="black" font-size="10" fill="#0f172a" font-family="sans-serif">${datePart}</text>`;
  });

  chipChartEl.innerHTML = `
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 h-[102px] relative overflow-hidden" style="width: 100%;">
      <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: 100%; height: 102px;">
        ${svgBarsHtml}
      </svg>
    </div>`;
  chipChartEl.style.width = "100%";
}

// ====================================================================================================
// 📊 MACD/KD分頁：3. MACD與KD指標群 (🎯 幾何最終對齊：日期文字精準定格在網格邊界上移 10px 的 92px 完美起跑線)
// ====================================================================================================
export function renderSeparatedMacdChartAndDecodeSignals(dates, chips) {
  const lineChartEl = document.getElementById("macdLineChart"), barChartEl = document.getElementById("macdBarChart");
  const lineDatesEl = document.getElementById("macdLineDates"), boardTitleEl = document.getElementById("macdSignalTitle");
  const bDWrapper = document.getElementById("macdBarDates");
  const kdChartEl = document.getElementById("kdLineChart"), kdDatesEl = document.getElementById("kdDatesEl");

  let cronDates = [...dates].sort((a, b) => a.localeCompare(b));
  if (cronDates.length > 15) { cronDates = cronDates.slice(-15); }

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
  
  const containerWidth = lineChartEl ? lineChartEl.clientWidth : 940;
  let usableWidth = containerWidth - 50; 
  let stepX = usableWidth / 14; 
  
  let difPoints = [], sigPoints = [], macdLineCirclesHtml = "";
  let barSvgHtml = `<line x1="0" y1="46" x2="100%" y2="46" stroke="#94a3b8" stroke-width="1.2" />`; 
  let lineChartHtml = `<div class="absolute left-0 right-0 h-[1px] bg-slate-200 pointer-events-none z-10" style="top: 42%;"></div>`; 
  let kdChartHtml = `<div class="absolute left-0 right-0 h-[1px] bg-rose-200/80 border-dashed pointer-events-none z-10" style="top: 16%;"></div><div class="absolute left-0 right-0 h-[1px] bg-slate-200/60 border-dashed pointer-events-none z-10" style="top: 42%;"></div><div class="absolute left-0 right-0 h-[1px] bg-emerald-200/80 border-dashed pointer-events-none z-10" style="top: 72%;"></div>`;
  let kPoints = [], dPoints = [], kdCirclesHtml = "";

  // 1. 🎯 幾何優化核心：應您的實測要求，將 Y 座標精準向上拉抬 10px，死鎖定格在 92px，落實絕對重合對齊
  let svgEmbeddedDatesHtml = "";
  dataset.forEach((d, idx) => {
    const datePart = d.date.split('-')[1] + '/' + d.date.split('-')[2];
    let dateX = 25 + (idx * stepX);
    svgEmbeddedDatesHtml += `<text x="${dateX}" y="92" text-anchor="middle" font-weight="black" font-size="10" fill="#0f172a" font-family="sans-serif">${datePart}</text>`;
  });

  // 2. 映射數據與幾何坐標
  dataset.forEach((d, idx) => {
    let exactX = 25 + (idx * stepX);
    
    let difY = ((maxLine - d.dif) / lineRange) * 60 + 12;
    let sigY = ((maxLine - d.sig) / lineRange) * 60 + 12;
    let exactDifY = (difY / 100) * 92; 
    let exactSigY = (sigY / 100) * 92; 

    if (d.dif !== null) { 
      difPoints.push({ x: exactX, y: exactDifY }); 
      macdLineCirclesHtml += `<g><circle cx="${exactX}" cy="${exactDifY}" r="3" fill="#3b82f6" /><text x="${exactX}" y="${exactDifY - 4}" text-anchor="middle" font-weight="black" font-size="10" fill="#1d4ed8" font-family="sans-serif">${d.dif.toFixed(2)}</text></g>`; 
    }
    if (d.sig !== null) { 
      sigPoints.push({ x: exactX, y: exactSigY }); 
      macdLineCirclesHtml += `<g><circle cx="${exactX}" cy="${exactSigY}" r="3" fill="#fb923c" /><text x="${exactX}" y="${exactSigY + 9}" text-anchor="middle" font-weight="black" font-size="10" fill="#c2410c" font-family="sans-serif">${d.sig.toFixed(2)}</text></g>`; 
    }

    if (d.osc !== null) {
      let barHeight = (Math.abs(d.osc) / maxOscAbs) * 36;
      let barWidth = 12;
      let barX = exactX - (barWidth / 2);
      let barColor = d.osc > 0 ? "#ef4444" : "#10b981";
      let barY = d.osc > 0 ? (46 - barHeight) : 46;
      let textOscY = d.osc >= 0 ? (barY - 3) : (46 + barHeight + 11);
      let textOscColor = d.osc >= 0 ? "#e11d48" : "#047857";

      barSvgHtml += `
        <g>
          <line x1="${exactX}" y1="0" x2="${exactX}" y2="92" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3" />
          <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="${barColor}" rx="1" />
          <text x="${exactX}" y="${textOscY}" text-anchor="middle" font-weight="black" font-size="10" fill="${textOscColor}" font-family="sans-serif">${d.osc.toFixed(2)}</text>
        </g>`;
    }

    if (d.kd_k !== null && d.kd_d !== null) {
      let kY = ((100 - d.kd_k) / 100) * 92; let dY = ((100 - d.kd_d) / 100) * 92;
      kPoints.push({ x: exactX, y: kY }); dPoints.push({ x: exactX, y: dY });
      
      kdCirclesHtml += `<g><circle cx="${exactX}" cy="${kY}" r="2.5" fill="#0ea5e9" /><circle cx="${exactX}" cy="${dY}" r="2.5" fill="#f59e0b" /><text x="${exactX}" y="${kY - 4}" text-anchor="middle" font-weight="black" font-size="10.5" fill="#0369a1" font-family="sans-serif">${Math.round(d.kd_k)}</text><text x="${exactX}" y="${dY + 9}" text-anchor="middle" font-weight="black" font-size="10.5" fill="#b45309" font-family="sans-serif">${Math.round(d.kd_d)}</text></g>`;
    }
  });

  difPoints.sort((a,b) => a.x - b.x); sigPoints.sort((a,b) => a.x - b.x);
  kPoints.sort((a,b) => a.x - b.x); dPoints.sort((a,b) => a.x - b.x);

  let dPath = difPoints.map(p => `${p.x},${p.y}`).join(' ');
  let sPath = sigPoints.map(p => `${p.x},${p.y}`).join(' ');
  let kPath = kPoints.map(p => `${p.x},${p.y}`).join(' ');
  let kdDPath = dPoints.map(p => `${p.x},${p.y}`).join(' ');

  // 3. 實體安全注入
  if (difPoints.length > 0 || sigPoints.length > 0) { lineChartHtml += `<svg class="absolute inset-0 w-full h-full pointer-events-auto z-10" style="width: 100%; height: 112px;"><polyline points="${dPath}" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none" /><polyline points="${sPath}" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none" />${macdLineCirclesHtml}${svgEmbeddedDatesHtml}</svg>`; }
  if (lineChartEl) { lineChartEl.innerHTML = lineChartHtml; lineChartEl.style.width = "100%"; }
  
  if (barChartEl) { 
    barChartEl.innerHTML = `
      <svg class="absolute inset-0 w-full h-full pointer-events-auto z-10" style="width: 100%; height: 112px;">
        ${barSvgHtml}${svgEmbeddedDatesHtml}
      </svg>`; 
    barChartEl.style.width = "100%"; 
  }
  
  if (kPoints.length > 0 || dPoints.length > 0) { kdChartHtml += `<svg class="absolute inset-0 w-full h-full pointer-events-auto z-10" style="width: 100%; height: 112px;"><polyline points="${kPath}" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none" /><polyline points="${kdDPath}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none" />${kdCirclesHtml}${svgEmbeddedDatesHtml}</svg>`; }
  if (kdChartEl) { kdChartEl.innerHTML = kdChartHtml; kdChartEl.style.width = "100%"; }

  // 4. 清洗安全外殼
  if (lineDatesEl) { lineDatesEl.innerHTML = ""; }
  if (bDWrapper) { bDWrapper.innerHTML = ""; }
  if (kdDatesEl) { kdDatesEl.innerHTML = ""; }

  const matchedCodes = decodeMultiDimensionSignal(chips);
  let targetCode = "ALL";
  let titleText = "正常盤整";

  if (matchedCodes && matchedCodes.length > 0) {
    if (state.currentMacdFilter !== "ALL" && matchedCodes.includes(state.currentMacdFilter)) {
      targetCode = state.currentMacdFilter;
    } else {
      targetCode = matchedCodes[0];
    }
    const fullText = MACD_SIGNALS[targetCode] || "";
    titleText = fullText.includes("（") ? fullText.split("（")[0].replace(/^\d+\.\s*/, '').replace(/^👑\s*/, '').replace(/^💎\s*/, '') : fullText;
  }

  const speechObj = WHITE_SPEECHES[targetCode] || {
    desc: "此個股目前處於多空平衡的橫盤箱型壓縮整理階段，未觸發特殊法人或資券共振訊號。",
    cond: "【正常盤整】(未達多維模型爆發點火臨界值，短線籌碼呈均衡對位狀態)"
  };

  setSignalDetail(titleText, speechObj.desc, speechObj.cond);
  
  if (boardTitleEl) {
    boardTitleEl.innerHTML = `
      <div class="flex items-center justify-center gap-1 min-w-0 max-w-[130px] sm:max-w-none">
        <span class="text-blue-600 font-black text-xs sm:text-sm truncate tracking-wide">${titleText}</span>
        <button id="macdInfoBtnInline" onclick="window.showSignalInfoDialog()" class="bg-white text-blue-600 border border-blue-200 rounded-md px-1.5 py-0.5 text-[9px] font-black shadow-3xs transition-all cursor-pointer shrink-0 hover:bg-slate-50">ℹ️ 條件</button>
      </div>
    `;
  }
}

// ==========================================================
// 🌟 4. 融資與信用餘額圖 (14 等分間距，首尾各保留 25px 邊距)
// ==========================================================
export function renderMarginTrendChart() {
  const marginChartEl = document.getElementById("trendMarginChart");
  if (!marginChartEl || !state.currentActiveStockId) return;

  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
  let localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => a.localeCompare(b));

  if (localTrendDates.length > 15) { localTrendDates = localTrendDates.slice(-15); }

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
  let usableWidth = containerWidth - 50;
  let stepX = usableWidth / 14;

  let upperSvgHtml = `<line x1="0" y1="42" x2="100%" y2="42" stroke="#94a3b8" stroke-width="1.5" />`; 
  let lowerSvgHtml = "";

  localTrendDates.forEach((d, idx) => {
    const netVal = marginNetPoints[idx];
    const balVal = marginBalancePoints[idx];
    const datePart = d.split('-')[1] + '/' + d.split('-')[2];
    
    let exactX = 25 + (idx * stepX);
    
    if (netVal !== 0) {
      let barHeight = (Math.abs(netVal) / maxNet) * 26; 
      let barWidth = 14; 
      let barX = exactX - (barWidth / 2);
      
      if (netVal > 0) {
        let barY = 42 - barHeight;
        upperSvgHtml += `
          <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="#e11d48" rx="1" />
          <text x="${exactX}" y="${barY - 4}" text-anchor="middle" font-weight="900" font-size="10" fill="#e11d48" font-family="sans-serif">+${netVal}</text>
        `;
      } else {
        upperSvgHtml += `
          <rect x="${barX}" y="42" width="${barWidth}" height="${barHeight}" fill="#065f46" rx="1" />
          <text x="${exactX}" y="${42 + barHeight + 11}" text-anchor="middle" font-weight="900" font-size="10" fill="#065f46" font-family="sans-serif">${netVal}</text>
        `;
      }
    } else {
      upperSvgHtml += `<text x="${exactX}" y="38" text-anchor="middle" font-weight="bold" font-size="10" fill="#94a3b8">0</text>`;
    }
    
    upperSvgHtml += `<text x="${exactX}" y="55" text-anchor="middle" font-weight="black" font-size="10" fill="#0f172a" font-family="sans-serif">${datePart}</text>`;

    let balHeight = (balVal / maxBal) * 62; 
    let balWidth = 18;
    let balX = exactX - (balWidth / 2);
    let balY = 82 - balHeight; 
    
    lowerSvgHtml += `
      <rect x="${balX}" y="${balY}" width="${balWidth}" height="${balHeight}" fill="#1e40af" rx="1.5" />
      <text x="${exactX}" y="${balY - 4}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e40af" font-family="sans-serif">${balVal}</text>
      <text x="${exactX}" y="${95}" text-anchor="middle" font-weight="black" font-size="10" fill="#0f172a" font-family="sans-serif">${datePart}</text>
    `;
  });

  marginChartEl.innerHTML = `
    <div class="flex flex-col gap-4 w-full overflow-visible">
      
      <div class="flex flex-col gap-1.5">
        <h4 class="text-xs font-black text-slate-500 flex items-center justify-between px-0.5">
          <span>🔹 融資當日增減 (張)</span>
          <div class="flex gap-2 text-xs font-black text-slate-400">
            <span class="flex items-center gap-0.5"><span class="w-2.5 h-2.5 bg-rose-600 inline-block rounded-xs"></span>資增</span>
            <span class="flex items-center gap-0.5"><span class="w-2.5 h-2.5 bg-emerald-500 inline-block rounded-xs"></span>資減</span>
          </div>
        </h4>
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 h-[102px] relative overflow-hidden" style="width: 100%;">
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: 100%; height: 102px;">
            ${upperSvgHtml}
          </svg>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <h4 class="text-xs font-black text-slate-500 flex items-center justify-between px-0.5">
          <span>🔹 累計融資餘額 (張)</span>
          <span class="text-xs font-black text-slate-400 flex items-center gap-0.5"><span class="w-2.5 h-2.5 bg-blue-800 inline-block rounded-xs"></span>資券水位</span>
        </h4>
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 h-[102px] relative overflow-hidden" style="width: 100%;">
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: 100%; height: 102px;">
            <line x1="0" y1="82" x2="100%" y2="82" stroke="#e2e8f0" stroke-width="1" />
            ${lowerSvgHtml}
          </svg>
        </div>
      </div>

    </div>`;
  marginChartEl.style.width = "100%";
}
