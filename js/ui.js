// js/ui.js
import { state, getValIgnoreCase, setSignalDetail } from './config.js';
import { fetchLiveGoogleNews } from './api.js';

export function updateDisplayDates(startDateStr) {
  const el = document.getElementById("chipUpdateTime");
  const elMob = document.getElementById("chipUpdateTimeMob");
  if (el) el.innerText = startDateStr || "--";
  if (elMob) elMob.innerText = startDateStr || "--";
}

export function updateTabSelectOptions(sheets) {
  const select = document.getElementById("tabSelect");
  if (!select) return;
  select.innerHTML = `<option value="全部">🌐 全部成分股</option>`;
  sheets.forEach(sheet => {
    if (sheet) select.innerHTML += `<option value="${sheet}">📁 ${sheet}</option>`;
  });
  select.value = state.currentSourceTab;
}

export function applyFilters() {
  let filteredStocks = [...state.dbStockData];
  if (state.currentSourceTab !== '全部') {
    filteredStocks = state.dbStockData.filter(item => item && Array.isArray(item.sheet_tags) && item.sheet_tags.includes(state.currentSourceTab));
  }
  if (state.searchKeyword !== "") {
    filteredStocks = filteredStocks.filter(item => {
      if (!item) return false;
      return String(item.stock_id).toLowerCase().includes(state.searchKeyword) || String(item.stock_name || '').toLowerCase().includes(state.searchKeyword);
    });
  }
  
  filteredStocks.sort((a, b) => {
    const idA = String(a.stock_id).trim();
    const idB = String(b.stock_id).trim();
    if (state.currentSortMode === 'stock_id') return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });

    const getSumForStock = (stockId, buyField, sellField) => {
      const chips = state.globalChipCache.filter(c => String(c.stock_id).trim() === stockId);
      const sumDates = state.recentDates.slice(0, state.currentSumDaysMode);
      return chips.reduce((acc, row) => {
        if (!sumDates.includes(String(row.date))) return acc; 
        return acc + (Math.round((row[buyField] || 0) / 1000) - Math.round((row[sellField] || 0) / 1000));
      }, 0);
    };

    let valA = 0, valB = 0;
    const m = state.currentSortMode;
    if (m==='foreign_buy') { valA = getSumForStock(idA, 'f_buy', 'f_sell'); valB = getSumForStock(idB, 'f_buy', 'f_sell'); return valB - valA; }
    if (m==='foreign_dealer_buy') { valA = getSumForStock(idA, 'fd_buy', 'fd_sell'); valB = getSumForStock(idB, 'fd_buy', 'fd_sell'); return valB - valA; }
    if (m==='investment_buy') { valA = getSumForStock(idA, 'it_buy', 'it_sell'); valB = getSumForStock(idB, 'it_buy', 'it_sell'); return valB - valA; }
    if (m==='dealer_self_buy') { valA = getSumForStock(idA, 'ds_buy', 'ds_sell'); valB = getSumForStock(idB, 'ds_buy', 'ds_sell'); return valB - valA; }
    if (m==='dealer_hedging_buy') { valA = getSumForStock(idA, 'dh_buy', 'dh_sell'); valB = getSumForStock(idB, 'dh_buy', 'dh_sell'); return valB - valA; }
    return 0;
  });

  renderMatrixTableFromCache(filteredStocks);
}

export function renderMatrixTableFromCache(stocks) {
  document.getElementById("recordCount").innerText = stocks.length;
  const tbody = document.getElementById("stockTableBody");
  if (!tbody) return;
  if (stocks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${3 + state.recentDates.length * 3}" class="py-8 text-slate-400 font-medium text-center">無符合條件的股票資料</td></tr>`;
    return;
  }

  let htmlString = "";
  const sumDates = state.recentDates.slice(0, state.currentSumDaysMode);

  stocks.forEach(item => {
    if (!item) return;
    const currentIdStr = String(item.stock_id).trim();
    const myChips = state.globalChipCache.filter(c => String(c.stock_id).trim() === currentIdStr);

    let currentPrice = "--", changeValue = 0, mainMA10 = "--", mainMA20 = "--", mainRSI14 = "--", mainMACDOsc = "--";
    if (state.recentDates.length > 0) {
      const latestDayData = myChips.find(c => String(c.date) === state.recentDates[0]);
      if (latestDayData) {
        if (latestDayData.price !== undefined && latestDayData.price !== null) currentPrice = latestDayData.price;
        changeValue = latestDayData.change_value || 0;
        if (latestDayData.ma10 !== undefined && latestDayData.ma10 !== null) mainMA10 = latestDayData.ma10;
        if (latestDayData.ma20 !== undefined && latestDayData.ma20 !== null) mainMA20 = latestDayData.ma20;
        if (latestDayData.rsi14 !== undefined && latestDayData.rsi14 !== null) mainRSI14 = latestDayData.rsi14;
        const rawMacd = getValIgnoreCase(latestDayData, 'macd_osc');
        if (rawMacd !== null && rawMacd !== undefined) mainMACDOsc = rawMacd;
      }
    }

    let priceChangeHtml = `<span class="text-slate-500 font-medium">0.0</span>`;
    if (changeValue > 0) priceChangeHtml = `<span class="text-rose-600 font-bold">▲${changeValue}</span>`;
    else if (changeValue < 0) priceChangeHtml = `<span class="text-emerald-600 font-bold">▼${Math.abs(changeValue)}</span>`;

    let macdHtml = `<span class="text-slate-950 ml-1 grow text-right">${mainMACDOsc}</span>`;
    if (mainMACDOsc !== "--") {
      if (mainMACDOsc > 0) macdHtml = `<span class="text-rose-600 ml-1 grow text-right font-black">▲${mainMACDOsc}</span>`;
      else if (mainMACDOsc < 0) macdHtml = `<span class="text-emerald-600 ml-1 grow text-right font-black">▼${Math.abs(mainMACDOsc)}</span>`;
    }

    let sumF = 0, sumFD = 0, sumIT = 0, sumDS = 0, sumDH = 0;
    let fRow = "", fdRow = "", iRow = "", dsRow = "", dhRow = "";

    const getCell = (b, s) => {
      const buy = Math.round((b || 0) / 1000), sell = Math.round((s || 0) / 1000), net = buy - sell;
      let netHtml = `<td class="py-2.5 border-r border-slate-300 text-slate-400 font-medium text-sm">0</td>`;
      if (net > 0) netHtml = `<td class="py-2.5 border-r border-slate-300 font-black text-rose-600 text-sm">+${net}</td>`;
      if (net < 0) netHtml = `<td class="py-2.5 border-r border-slate-300 font-black text-emerald-600 text-sm">${net}</td>`;
      return `<td class="py-2.5 border-r border-slate-200 text-blue-600 font-bold text-xs">${buy}</td><td class="py-2.5 border-r border-slate-200 text-emerald-600 font-bold text-xs">${sell}</td>${netHtml}`;
    };

    state.recentDates.forEach(d => {
      const dayData = myChips.find(c => String(c.date) === d) || { f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0 };
      if (sumDates.includes(d)) {
        sumF += (Math.round((dayData.f_buy||0)/1000) - Math.round((dayData.f_sell||0)/1000));
        sumFD += (Math.round((dayData.fd_buy||0)/1000) - Math.round((dayData.fd_sell||0)/1000));
        sumIT += (Math.round((dayData.it_buy||0)/1000) - Math.round((dayData.it_sell||0)/1000));
        sumDS += (Math.round((dayData.ds_buy||0)/1000) - Math.round((dayData.ds_sell||0)/1000));
        sumDH += (Math.round((dayData.dh_buy||0)/1000) - Math.round((dayData.dh_sell||0)/1000));
      }
      fRow += getCell(dayData.f_buy, dayData.f_sell); fdRow += getCell(dayData.fd_buy, dayData.fd_sell); iRow += getCell(dayData.it_buy, dayData.it_sell); dsRow += getCell(dayData.ds_buy, dayData.ds_sell); dhRow += getCell(dayData.dh_buy, dayData.dh_sell);
    });

    const getSumCell = (val, isDarkRow) => {
      const bgClass = isDarkRow ? 'bg-slate-100' : 'bg-white';
      return val > 0 ? `<td class="py-2.5 border-r border-slate-300 font-black text-rose-600 text-sm sticky left-[164px] z-20 ${bgClass} sticky-col-shadow text-center">+${val}</td>` : (val < 0 ? `<td class="py-2.5 border-r border-slate-300 font-black text-emerald-600 text-sm sticky left-[164px] z-20 ${bgClass} sticky-col-shadow text-center">${val}</td>` : `<td class="py-2.5 border-r border-slate-300 font-bold text-slate-400 text-sm sticky left-[164px] z-20 ${bgClass} sticky-col-shadow text-center">0</td>`);
    };

    htmlString += `
      <tr class="border-t-2 border-slate-300 hover:bg-slate-50/50">
        <td rowspan="5" data-stockid="${item.stock_id}" data-stockname="${item.stock_name || ''}" class="stock-target-cell px-1 py-3 border-r border-slate-300 font-mono bg-slate-100 sticky left-0 z-20 text-center leading-tight w-[112px] max-w-[112px] overflow-hidden cursor-pointer hover:bg-blue-50 transition-colors">
          <div class="text-base font-black tracking-tighter text-blue-700 underline decoration-2 underline-offset-2 decoration-blue-700">${item.stock_id}</div>
          <div class="text-sm font-extrabold mt-0.5 truncate tracking-tighter text-blue-700 underline decoration-2 underline-offset-2 decoration-blue-700">${item.stock_name || ''}</div>
          <div class="mt-1 tracking-tighter flex flex-col items-center gap-0.5 whitespace-nowrap">
            <div class="text-sm text-slate-900 font-bold">${currentPrice}</div>
            <div class="text-xs mt-0.5">${priceChangeHtml}</div>
          </div>
          <div class="mt-2 mx-0.5 p-1 bg-slate-200/80 rounded border border-slate-300/60 flex flex-col gap-0.5 text-[14px] font-black text-left tracking-tighter leading-none">
            <div class="flex items-center"><span class="text-blue-600 shrink-0 font-bold">M10:</span><span class="text-slate-950 ml-1 grow text-right">${mainMA10}</span></div>
            <div class="flex items-center"><span class="text-orange-600 shrink-0 font-bold">M20:</span><span class="text-slate-950 ml-1 grow text-right">${mainMA20}</span></div>
            <div class="flex items-center"><span class="text-purple-600 shrink-0 font-bold">RSI:</span><span class="text-slate-950 ml-1 grow text-right">${mainRSI14}</span></div>
            <div class="flex items-center"><span class="text-teal-600 shrink-0 font-bold">MACD:</span>${macdHtml}</div>
          </div>
        </td>
        <td class="py-3 border-r border-slate-300 bg-slate-50 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">外資</td>
        ${getSumCell(sumF, false)}${fRow}
      </tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-100 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">外陸資自營商</td>${getSumCell(sumFD, true)}${fdRow}</tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-50 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">投信</td>${getSumCell(sumIT, false)}${iRow}</tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-100 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">自營商(自行)</td>${getSumCell(sumDS, true)}${dsRow}</tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-100 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">自營商(避險)</td>${getSumCell(sumDH, false)}${dhRow}</tr>
    `;
  });
  tbody.innerHTML = htmlString;
}

export function switchModalTab(tabMode) {
  const tabs = { trend: { btn: 'tabBtnTrend', zone: 'trendZone' }, macd: { btn: 'tabBtnMacd', zone: 'macdZone' }, news: { btn: 'tabBtnNews', zone: 'newsZone' } };
  Object.keys(tabs).forEach(k => {
    const b = document.getElementById(tabs[k].btn), z = document.getElementById(tabs[k].zone);
    if (k === tabMode) {
      b.className = "py-1.5 px-4 text-sm font-black border-b-2 border-blue-600 text-blue-600 focus:outline-none cursor-pointer transition-all";
      z.classList.replace("hidden", "block");
    } else {
      b.className = "py-1.5 px-4 text-sm font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 focus:outline-none cursor-pointer transition-all";
      z.classList.replace("block", "hidden");
    }
  });
  
  setTimeout(() => {
    if (state.currentActiveStockId) {
      const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(state.currentActiveStockId).trim());
      const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => b.localeCompare(a));
      if (tabMode === 'macd') {
        renderSeparatedMacdChartAndDecodeSignals(localTrendDates, myChipsRaw);
      } else if (tabMode === 'trend') {
        renderPriceTrendLineChart(localTrendDates, myChipsRaw);
        renderChipTrendChart();
      }
    }
  }, 30);
}

export function switchChipSubTab(subKey) {
  state.currentChipSubTab = subKey;
  const tabs = { f: 'subTabF', it: 'subTabIT', ds: 'subTabDS' };
  Object.keys(tabs).forEach(k => {
    document.getElementById(tabs[k]).className = k === subKey ? "px-3 py-1 text-xs font-black bg-white text-slate-900 rounded-md shadow-2xs cursor-pointer transition-all" : "px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800 rounded-md cursor-pointer transition-all";
  });
  renderChipTrendChart();
}

export async function openCombinedModal(stockId, stockName) {
  state.currentActiveStockId = stockId; 
  document.getElementById("newsModal").classList.remove("hidden");
  document.getElementById("newsModalTitle").innerText = `${stockId} ${stockName} - 智慧指標與籌碼數據庫`;
  
  const myChipsRaw = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(stockId).trim());
  const localTrendDates = [...state.extendedTrendDates].filter(d => myChipsRaw.some(c => String(c.date) === d)).sort((a, b) => b.localeCompare(a)); 

  setTimeout(() => {
    switchModalTab('trend');
    switchChipSubTab('f'); 
    renderPriceTrendLineChart(localTrendDates, myChipsRaw);
    renderChipTrendChart();
    renderSeparatedMacdChartAndDecodeSignals(localTrendDates, myChipsRaw);
    setTimeout(() => { const p = document.getElementById("priceScrollWrapper"); if (p) p.scrollLeft = 0; }, 60);
  }, 35);

  if (state.recentDates.length > 0) {
    const latestDayData = myChipsRaw.find(c => String(c.date) === state.recentDates[0]);
    if (latestDayData) {
      document.getElementById("modalInfoPrice").innerText = latestDayData.price || '--';
      const cv = latestDayData.change_value || 0;
      document.getElementById("modalInfoChange").innerHTML = cv > 0 ? `<span class="text-rose-600">▲${cv}</span>` : (cv < 0 ? `<span class="text-emerald-600">▼${Math.abs(cv)}</span>` : '0.0');
      document.getElementById("modalInfoMA10").innerText = latestDayData.ma10 || '--';
      document.getElementById("modalInfoMA20").innerText = latestDayData.ma20 || '--';
      document.getElementById("modalInfoRSI14").innerText = latestDayData.rsi14 || '--';
      const rawMacd = getValIgnoreCase(latestDayData, 'macd_osc');
      document.getElementById("modalInfoMACD").innerHTML = rawMacd !== null && rawMacd !== undefined ? (rawMacd > 0 ? `<span class="text-rose-600 font-bold">▲${rawMacd}</span>` : (rawMacd < 0 ? `<span class="text-emerald-600 font-bold">▼${Math.abs(rawMacd)}</span>` : '0.0')) : '--';
    }
  }

  const debugBox = document.getElementById("debugLogZone"), listZone = document.getElementById("newsListZone");
  debugBox.classList.remove("hidden"); listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-6 text-center animate-pulse">正在即時連線抓取最新財經新聞...</div>`;
  debugBox.innerHTML = `[系統診斷開始] 初始化 ${stockId} (${stockName}) 新聞獲取流...\n`;

  const { successFetch, resJson } = await fetchLiveGoogleNews(stockId, stockName, debugBox, listZone);
  if (successFetch && resJson) {
    const fetchedItems = resJson.items || [];
    if (fetchedItems.length > 0) {
      let listHtml = "";
      fetchedItems.slice(0, 10).forEach(item => {
        const pubDate = new Date(item.pubDate), dStr = `${pubDate.getFullYear()}-${String(pubDate.getMonth()+1).padStart(2,'0')}-${String(pubDate.getDate()).padStart(2,'0')}`;
        listHtml += `<a href="${item.link}" target="_blank" rel="noopener noreferrer" class="block p-3 border border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50/50 flex flex-col gap-1.5 text-left group/item"><div class="text-xs text-slate-400 font-bold flex items-center gap-2"><span>📅 ${dStr}</span><span class="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-black">${item.author || "財經媒體"}</span></div><h4 class="text-sm font-extrabold text-blue-700 leading-snug group-hover/item:text-blue-900 group-hover/item:underline">${item.title}</h4></a>`;
      });
      listZone.innerHTML = listHtml; debugBox.classList.add("hidden");
    } else listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-8 text-center">查無相關新聞</div>`;
  } else listZone.innerHTML = `<div class="text-xs text-rose-500 font-medium py-8 text-center">新聞連線過載。</div>`;
}

// 🟢 智慧型 1:1 線點合一高精度 SVG 走勢圖引擎
export function renderPriceTrendLineChart(dates, chips) {
  const priceChartEl = document.getElementById("trendPriceChart");
  const priceDatesEl = document.getElementById("trendPriceDates");
  if (!priceChartEl || dates.length === 0) return;

  let pricePoints = dates.map(d => {
    const day = chips.find(c => String(c.date) === d);
    return (day && day.price) ? day.price : null;
  });

  let validPrices = pricePoints.filter(p => p !== null);
  if (validPrices.length === 0) {
    priceChartEl.innerHTML = `<div class="text-xs text-slate-400 m-auto">無近期股價趨勢資料</div>`;
    priceDatesEl.innerHTML = "";
    return;
  }

  let maxP = Math.max(...validPrices), minP = Math.min(...validPrices), rangeP = maxP - minP === 0 ? 1 : maxP - minP;
  let containerWidth = priceChartEl.clientWidth || 940, count = dates.length, stepX = containerWidth / count; 
  let polylinePoints = [], svgCirclesHtml = "", dateHtml = "";

  dates.forEach((d, idx) => {
    const price = pricePoints[idx], datePart = d.split('-')[1] + '/' + d.split('-')[2];
    const heightPercent = price !== null ? ((price - minP) / rangeP) * 55 + 20 : 50;
    let exactX = idx * stepX + (stepX / 2), exactY = 96 - ((heightPercent / 100) * 96); 

    if (price !== null) {
      polylinePoints.push(`${exactX},${exactY}`);
      let textY = price >= ((maxP + minP) / 2) ? (exactY + 15) : (exactY - 9);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="4" fill="#2563eb" stroke="#ffffff" stroke-width="2" /><text x="${exactX}" y="${textY}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e3a8a" font-family="sans-serif">${price}</text>`;
    }
    dateHtml += `<span class="flex-1 text-center font-black text-[10px] text-slate-950 truncate px-0.5">${datePart}</span>`;
  });

  priceChartEl.innerHTML = `<svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 96px;"><line x1="0" y1="48" x2="${containerWidth}" y2="48" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4" /><polyline points="${polylinePoints.join(' ')}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${svgCirclesHtml}</svg>`;
  priceDatesEl.innerHTML = dateHtml;
}

// 🟢 三大法人圖表繪製 (舊到新流動校正)
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
    return Math.round((row[cfg.bKey] || 0) / 1000) - Math.round((row[cfg.sKey] || 0) / 1000); 
  });

  let absMax = Math.max(...nets.map(Math.abs), 1), barsHtml = localTrendDates.map((d, i) => { 
    const val = nets[i], isPositive = val >= 0, heightPct = Math.min(Math.round((Math.abs(val) / absMax) * 80), 80), datePart = d.split('-')[1] + '/' + d.split('-')[2];
    return `<div class="flex flex-col flex-1 h-full min-w-0 relative items-center"><div class="w-full h-1/2 flex flex-col justify-end items-center relative">${isPositive && val > 0 ? `<span class="text-xs font-black text-rose-600 mb-1 tracking-tighter">+${val}</span><div class="w-full max-w-[20px] min-w-[4px] ${cfg.color} rounded-t-xs shadow-2xs" style="height: ${heightPct}%;"></div>` : ''}${val === 0 ? `<span class="text-xs font-bold text-slate-400 mb-1">0</span>` : ''}</div><div class="w-full h-1/2 flex flex-col justify-start items-center relative">${!isPositive ? `<div class="w-full max-w-[20px] min-w-[4px] ${cfg.negColor} rounded-b-xs shadow-2xs" style="height: ${heightPct}%;"></div><span class="text-xs font-black text-emerald-600 mt-1 tracking-tighter">${val}</span>` : ''}<span class="absolute top-[2px] text-[10px] text-slate-950 font-black tracking-tighter">${datePart}</span></div></div>`; 
  }).join('');

  chipChartEl.innerHTML = `<div class="bg-slate-50 border border-slate-200 rounded-xl p-1.5 w-full"><div class="w-full h-32 flex justify-between bg-white rounded-lg border border-slate-200 px-1 relative items-center"><div class="absolute left-0 right-0 h-[1.5px] bg-slate-400 z-10"></div>${barsHtml}</div></div>`;
}

// 🟢 MACD 專業雙層圖表引擎
export function renderSeparatedMacdChartAndDecodeSignals(dates, chips) {
  const lineChartEl = document.getElementById("macdLineChart"), barChartEl = document.getElementById("macdBarChart");
  const lineDatesEl = document.getElementById("macdLineDates"), barDatesEl = document.getElementById("macdBarDates"), boardTitleEl = document.getElementById("macdSignalTitle");
  
  let dataset = dates.map(d => { const row = chips.find(c => String(c.date) === d); return { date: d, dif: row ? getValIgnoreCase(row, 'macd_dif') : null, sig: row ? getValIgnoreCase(row, 'macd_signal') : null, osc: row ? getValIgnoreCase(row, 'macd_osc') : null }; });
  let lineValues = dataset.flatMap(d => [d.dif, d.sig]).filter(v => v !== null && !isNaN(v)), maxLine = Math.max(...lineValues, 0.01), minLine = Math.min(...lineValues, -0.01), lineRange = maxLine - minLine === 0 ? 1 : maxLine - minLine;
  let oscValues = dataset.map(d => d.osc).filter(v => v !== null && !isNaN(v)), maxOscAbs = Math.max(...oscValues.map(Math.abs), 0.01);
  let containerWidth = lineChartEl.clientWidth || 728, count = dataset.length, stepX = containerWidth / count; 
  let difPoints = [], sigPoints = [], lineChartHtml = `<div class="absolute left-0 right-0 h-[1px] bg-slate-200 z-10" style="top: 50%;"></div>`, barChartHtml = `<div class="absolute left-0 right-0 h-[1.5px] bg-slate-400 z-10" style="top: 50%;"></div>`, lineDateHtml = "", barDateHtml = "";

  dataset.forEach((d, idx) => {
    const datePart = d.date.split('-')[1] + '/' + d.date.split('-')[2];
    lineDateHtml += `<span class="flex-1 text-center font-bold tracking-tighter text-[10px] text-slate-400">${datePart}</span>`;
    barDateHtml += `<span class="flex-1 text-center font-bold tracking-tighter text-[10px] text-slate-400">${datePart}</span>`;
    let xPos = idx * stepX + (stepX / 2), difTopPercent = d.dif !== null ? ((maxLine - d.dif) / lineRange) * 70 + 15 : 50, sigTopPercent = d.sig !== null ? ((maxLine - d.sig) / lineRange) * 70 + 15 : 50;
    if (d.dif !== null) difPoints.push(`${xPos},${(difTopPercent / 100) * 144}`); if (d.sig !== null) sigPoints.push(`${xPos},${(sigTopPercent / 100) * 144}`);

    lineChartHtml += `<div class="flex flex-col items-center flex-1 h-full relative group min-w-0 z-20"><div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div><div class="absolute w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white" style="top: calc(${difTopPercent}% - 4px); left: calc(50% - 4px);"></div><div class="absolute w-2 h-2 rounded-full bg-orange-400 ring-2 ring-white" style="top: calc(${sigTopPercent}% - 4px); left: calc(50% - 4px);"></div><div class="hidden group-hover:flex flex-col absolute bg-slate-900/95 text-white text-[10px] p-2 rounded shadow-xl z-50 border border-slate-700 pointer-events-none -top-12 whitespace-nowrap font-bold leading-tight"><div>📅 日期: ${d.date}</div><div class="text-sky-400">DIF: ${d.dif !== null ? d.dif.toFixed(3) : '--'}</div><div class="text-orange-400">DEA: ${d.sig !== null ? d.sig.toFixed(3) : '--'}</div><div class="${d.osc >= 0 ? 'text-rose-400' : 'text-emerald-400'}">OSC: ${d.osc !== null ? d.osc.toFixed(3) : '--'}</div></div></div>`;
    let oscHeightPct = d.osc !== null ? Math.min((Math.abs(d.osc) / maxOscAbs) * 45, 45) : 0, oscBg = d.osc > 0 ? "bg-rose-500/90" : "bg-emerald-500/90", oscTop = d.osc > 0 ? `calc(50% - ${oscHeightPct}%)` : "50%";
    barChartHtml += `<div class="flex flex-col items-center flex-1 h-full relative group min-w-0 z-20"><div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div><div class="absolute w-3.5 max-w-[14px] min-w-[5px] ${oscBg} rounded-xs shadow-3xs" style="top: ${oscTop}; height: ${oscHeightPct}%;"></div></div>`;
  });

  if (difPoints.length > 0 || sigPoints.length > 0) lineChartHtml += `<svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px;"><polyline points="${difPoints.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${sigPoints.join(' ')}" fill="none" stroke="#fb923c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  lineChartEl.innerHTML = lineChartHtml; barChartEl.innerHTML = barChartHtml; lineDatesEl.innerHTML = lineDateHtml; barDatesEl.innerHTML = barDateHtml;

  let t_minus_2 = dataset[count - 3], t_minus_1 = dataset[count - 2], t_latest = dataset[count - 1];  
  if (t_latest && t_minus_1) {
    let d_dif = t_latest.dif, d_dea = t_latest.sig, d_osc = t_latest.osc, p_dif = t_minus_1.dif, p_dea = t_minus_1.sig, p_osc = t_minus_1.osc;
    let is_gold_cross = d_dif > d_dea, dif_rising = d_dif > p_dif, dif_bending_down = d_dif < p_dif, dea_flat_or_rising = p_dea !== null ? (d_dea >= p_dea) : true;
    let osc_neg_to_pos_and_expanding = (p_osc <= 0 && d_osc > 0) || (d_osc > 0 && d_osc > p_osc), osc_shrinking_but_positive = d_osc > 0 && d_osc < (p_osc !== null ? p_osc : 0), osc_neg_expanding = d_osc < 0 && (p_osc === null || d_osc < p_osc), osc_neg_shrinking = d_osc < 0 && p_osc !== null && d_osc > p_osc;
    let sigA = is_gold_cross && dif_rising && osc_neg_to_pos_and_expanding, sigB = is_gold_cross && osc_shrinking_but_positive, sigC = dif_bending_down && dea_flat_or_rising && d_osc < (p_osc||0), sigD = d_dif < d_dea && p_dif >= p_dea, sigE = d_dif < d_dea && d_dif < p_dif && osc_neg_expanding, sigF = d_dif < d_dea && d_dif >= p_dif && osc_neg_shrinking;
    let m = "None"; if (sigA) m = "A"; else if (sigD) m = "D"; else if (sigE) m = "E"; else if (sigC) m = "C"; else if (sigB) m = "B"; else if (sigF) m = "F"; if (m === "None") m = d_dif > d_dea ? (d_osc > p_osc ? "A" : "B") : (d_osc > p_osc ? "F" : "E");

    if (m === "A") setSignalDetail("A. 趨勢正在加速 (最強多頭狀態)", "市場呈現極強多頭特徵，快線持續上攻，多方量能柱全面爆發擴大，代表多頭買盤源源不絕，有利漲勢延續。", "DIF > DEA 且 DIF 持續上升 且 OSC 動能柱翻正或正值放大");
    if (m === "B") setSignalDetail("B. 趨勢仍多頭，但開始降溫", "目前仍處於多頭格局之中，但快線向上挺進斜率走平，多方柱狀體出現連續收縮，需慎防獲利洗盤賣壓。", "DIF > DEA 且 DIF 上升變慢 且 OSC 柱狀圖連續縮小但維持正值");
    if (m === "C") setSignalDetail("C. 轉弱初期 (關鍵觀察區)", "多空關鍵防守位置。快線已領先出現向下彎頭回檔，慢線走平，動能柱正快速向零軸收斂，暗示高檔主力籌碼分批調節。", "DIF 開始下彎 且 DEA 仍上升或走平 且 OSC 柱狀圖收斂向0");
    if (m === "D") setSignalDetail("D. 空頭開始 (真正轉折點成立)", "趨勢發生高檔向下扭轉。快線正式下穿慢線形成死亡交叉，動能柱翻黑轉負，波段轉空確立，多單宜全面避險。", "DIF 跌破 DEA (死亡交叉) 且 DIF 下彎 且 OSC 轉負");
    if (m === "E") setSignalDetail("E. 空頭加速 (下跌最強主跌段)", "完全進入窒息的主跌段，快慢線同步於零軸下方加速下滑，空方負向柱狀體急速放大，下跌動能強勁，不可目盲摸底。", "DIF < DEA 且 DIF 持續下滑 且 負值柱狀體負值放大");
    if (m === "F") setSignalDetail("F. 空頭衰退 (反彈準備段)", "雖然屬空頭架構，但快線下跌斜率已收斂並開始底部走平，空方柱狀體連續縮短（負值變小），暗示低檔反彈醖釀。", "DIF < DEA 且 負向柱狀圖持續縮短 且 DIF 開始走平");
    boardTitleEl.innerHTML = `<span class="px-2 py-0.5 ${m==='A'||m==='B'?'bg-rose-600':(m==='C'||m==='D'?'bg-amber-500':'bg-purple-600')} text-white rounded font-extrabold text-xs animate-pulse mr-1.5">動能判讀</span> <span class="${m==='A'||m==='B'?'text-rose-600':(m==='C'||m==='D'?'text-amber-600':'text-purple-600')} font-extrabold text-sm md:text-base">${state.globalActiveSignalDetail?.title || ''}</span>`;
  }
}
