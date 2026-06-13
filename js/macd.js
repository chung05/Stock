// js/macd.js
import { state, getValIgnoreCase, setSignalDetail, decodeMacdSignal, MACD_SIGNALS } from './config.js';

// 💡 智慧新增：初始化 3 條均線的動態顯示 Toggle 狀態鎖 (開局預設皆顯示)
if (!state.visibleLines) {
  state.visibleLines = { ma5: true, ma10: true, ma20: true };
}

export function closeNewsModal() { 
  document.getElementById("newsModal").classList.add("hidden"); 
}

// 💡 智慧新增：外部 Toggle 改變時的唯一驅動中樞
export function toggleLine(lineKey, isChecked) {
  if (state.visibleLines) {
    state.visibleLines[lineKey] = isChecked;
  }
  // 即時重新觸發繪圖更新
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
        // 同步勾選狀態至 HTML 的 Checkbox
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
  document.getElementById("newsModalTitle").innerText = `${stockId} ${stockName} - 智慧過濾籌碼寬資版`;
  
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
      document.getElementById("modalInfoMA10").innerText = (latestDayData.ma10 !== undefined && latestDayData.ma10 !== null) ? latestDayData.ma10 : '--';
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
  // 💡 智慧對齊修改：精準呼叫已在 Supabase 補件成功的全新 ma5 欄位數據！
  let ma5Points = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.ma5 !== undefined && day.ma5 !== null) ? day.ma5 : null; });
  let ma10Points = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.ma10 !== undefined && day.ma10 !== null) ? day.ma10 : null; });
  let ma20Points = cronDates.map(d => { const day = chips.find(c => String(c.date) === d); return (day && day.ma20 !== undefined && day.ma20 !== null) ? day.ma20 : null; });

  // 混合判定最高/最低邊界
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
      let yPercent = ((price - minP) / rangeP) * 55 + 20;
      let exactY = 96 - ((yPercent / 100) * 96); 
      polylinePrice.push(`${exactX},${exactY}`);
      
      let midPrice = (maxP + minP) / 2, textY = price >= midPrice ? (exactY + 14) : (exactY - 8);
      svgCirclesHtml += `<circle cx="${exactX}" cy="${exactY}" r="3.5" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" /><text x="${exactX}" y="${textY}" text-anchor="middle" font-weight="900" font-size="10" fill="#1e3a8a" font-family="sans-serif">${price}</text>`;
    }
    
    // 💡 智慧新增：根據 Toggle 開關狀態決定是否生成各均線座標
    if (ma5 !== null && state.visibleLines.ma5) {
      let yPercent = ((ma5 - minP) / rangeP) * 55 + 20;
      polylineMA5.push(`${exactX},${96 - ((yPercent / 100) * 96)}`);
    }
    if (ma10 !== null && state.visibleLines.ma10) {
      let yPercent = ((ma10 - minP) / rangeP) * 55 + 20;
      polylineMA10.push(`${exactX},${96 - ((yPercent / 100) * 96)}`);
    }
    if (ma20 !== null && state.visibleLines.ma20) {
      let yPercent = ((ma20 - minP) / rangeP) * 55 + 20;
      polylineMA20.push(`${exactX},${96 - ((yPercent / 100) * 96)}`);
    }

    dateHtml += `<span class="flex-1 text-center font-black text-[10px] text-slate-950 truncate px-0.5">${datePart}</span>`;
  });

  // 渲染多軌動態 SVG 畫布
  priceChartEl.innerHTML = `
    <svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px; height: 96px;">
      <line x1="0" y1="48" x2="${containerWidth}" y2="48" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="4" />
      
      ${polylineMA5.length > 0 ? `<polyline points="${polylineMA5.join(' ')}" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      
      ${polylineMA10.length > 0 ? `<polyline points="${polylineMA10.join(' ')}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      
      ${polylineMA20.length > 0 ? `<polyline points="${polylineMA20.join(' ')}" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      
      <polyline points="${polylinePrice.join(' ')}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      
      ${svgCirclesHtml}
    </svg>`;
    
  priceDatesEl.innerHTML = dateHtml;
}

export function renderSeparatedMacdChartAndDecodeSignals(dates, chips) {
  const lineChartEl = document.getElementById("macdLineChart"), barChartEl = document.getElementById("macdBarChart");
  const lineDatesEl = document.getElementById("macdLineDates"), boardTitleEl = document.getElementById("macdSignalTitle");
  
  let cronDates = [...dates].sort((a, b) => a.localeCompare(b));

  let dataset = cronDates.map(d => { const row = chips.find(c => String(c.date) === d); return { date: d, dif: row ? getValIgnoreCase(row, 'macd_dif') : null, sig: row ? getValIgnoreCase(row, 'macd_signal') : null, osc: row ? getValIgnoreCase(row, 'macd_osc') : null }; });
  let lineValues = dataset.flatMap(d => [d.dif, d.sig]).filter(v => v !== null && !isNaN(v)), maxLine = Math.max(...lineValues, 0.01), minLine = Math.min(...lineValues, -0.01), lineRange = maxLine - minLine === 0 ? 1 : maxLine - minLine;
  let oscValues = dataset.map(d => d.osc).filter(v => v !== null && !isNaN(v)), maxOscAbs = Math.max(...oscValues.map(Math.abs), 0.01);
  let containerWidth = lineChartEl.clientWidth || 728, count = dataset.length, stepX = containerWidth / count; 
  let difPoints = [], sigPoints = [], lineChartHtml = `<div class="absolute left-0 right-0 h-[1px] bg-slate-200 z-10" style="top: 50%;"></div>`, barChartHtml = `<div class="absolute left-0 right-0 h-[1.5px] bg-slate-400 z-10" style="top: 50%;"></div>`, lineDateHtml = "";

  dataset.forEach((d, idx) => {
    const datePart = d.date.split('-')[1] + '/' + d.date.split('-')[2];
    lineDateHtml += `<span class="flex-1 text-center font-bold tracking-tighter text-[10px] text-slate-400">${datePart}</span>`;
    let xPos = idx * stepX + (stepX / 2), difTopPercent = d.dif !== null ? ((maxLine - d.dif) / lineRange) * 70 + 15 : 50, sigTopPercent = d.sig !== null ? ((maxLine - d.sig) / lineRange) * 70 + 15 : 50;
    if (d.dif !== null) difPoints.push(`${xPos},${(difTopPercent / 100) * 144}`); if (d.sig !== null) sigPoints.push(`${xPos},${(sigTopPercent / 100) * 144}`);

    lineChartHtml += `
      <div class="flex flex-col items-center flex-1 h-full relative group min-w-0 z-20">
        <div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div>
        <div class="absolute w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white" style="top: calc(${difTopPercent}% - 4px); left: calc(50% - 4px);"></div>
        <div class="absolute w-2 h-2 rounded-full bg-orange-400 ring-2 ring-white" style="top: calc(${sigTopPercent}% - 4px); left: calc(50% - 4px);"></div>
        <div class="hidden group-hover:flex flex-col absolute bg-slate-900/95 text-white text-[10px] p-2 rounded shadow-xl z-50 border border-slate-700 pointer-events-none -top-12 whitespace-nowrap font-bold leading-tight"><div>📅 日期: ${d.date}</div><div class="text-sky-400">DIF: ${d.dif !== null ? d.dif.toFixed(3) : '--'}</div><div class="text-orange-400">DEA: ${d.sig !== null ? d.sig.toFixed(3) : '--'}</div><div class="${d.osc >= 0 ? 'text-rose-400' : 'text-emerald-400'}">OSC: ${d.osc !== null ? d.osc.toFixed(3) : '--'}</div></div>
      </div>`;
    let oscHeightPct = d.osc !== null ? Math.min((Math.abs(d.osc) / maxOscAbs) * 45, 45) : 0, oscBg = d.osc > 0 ? "bg-rose-500/90" : "bg-emerald-500/90", oscTop = d.osc > 0 ? `calc(50% - ${oscHeightPct}%)` : "50%";
    barChartHtml += `<div class="flex flex-col items-center flex-1 h-full relative group min-w-0 z-20"><div class="absolute w-[1px] bg-slate-100 top-0 bottom-0 left-1/2 -translate-x-1/2 border-dashed pointer-events-none"></div><div class="absolute w-3.5 max-w-[14px] min-w-[5px] ${oscBg} rounded-xs shadow-3xs" style="top: ${oscTop}; height: ${oscHeightPct}%;"></div></div>`;
  });

  if (difPoints.length > 0 || sigPoints.length > 0) lineChartHtml += `<svg class="absolute inset-0 w-full h-full pointer-events-none z-10" style="width: ${containerWidth}px;"><polyline points="${difPoints.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${sigPoints.join(' ')}" fill="none" stroke="#fb923c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if(lineChartEl) lineChartEl.innerHTML = lineChartHtml; if(barChartEl) barChartEl.innerHTML = barChartHtml; if(lineDatesEl) lineDatesEl.innerHTML = lineDateHtml;

  const currentSignalCode = decodeMacdSignal(chips);
  const titleText = MACD_SIGNALS[currentSignalCode] || "未定義狀態";
  let descText = "", condText = "", bg = "";
  
  if (currentSignalCode === "1") { descText = "多頭趨勢強勁，上漲速度持續增加，屬於全市場最強勢的攻擊主升段。"; condText = "DIF > DEA 且 DIF > 0 且 DEA > 0 且 紅柱(OSC)持續變長"; bg = "bg-rose-600 text-rose-600"; }
  if (currentSignalCode === "2") { descText = "股價仍偏多，上漲趨勢未變，但買盤推推力道開始出現減弱，需防洗盤。"; condText = "DIF > DEA 且 DIF > 0 且 DEA > 0 且 紅柱(OSC)持續縮短"; bg = "bg-orange-500 text-orange-600"; }
  if (currentSignalCode === "3") { descText = "多頭結構尚未破壞，短期出現正常的獲利了結回檔，屬於良性波段修正。"; condText = "DIF 跌破 DEA (死亡交叉) 且 DIF > 0 且 DEA > 0"; bg = "bg-amber-500 text-amber-600"; }
  if (currentSignalCode === "4") { descText = "回檔整理結束，多頭重新掌控盤勢，常見於主升段行情的中繼再噴發。"; condText = "DIF 突破 DEA (黃金交叉) 且 DIF > 0 且 DEA > 0"; bg = "bg-red-600 text-red-600"; }
  if (currentSignalCode === "5") { descText = "空頭趨勢強勁，下跌速度持續增加，屬於窒息的多殺多主跌爆跌段。"; condText = "DIF < DEA 且 DIF < 0 且 DEA < 0 且 綠柱(OSC)持續變長"; bg = "bg-emerald-600 text-emerald-600"; }
  if (currentSignalCode === "6") { descText = "股價仍偏空，下跌慣性未變，幕後低檔賣壓與恐慌盤已開始減弱。"; condText = "DIF < DEA 且 DIF < 0 且 DEA < 0 且 綠柱(OSC)持續縮短"; bg = "bg-cyan-600 text-cyan-600"; }
  if (currentSignalCode === "7") { descText = "空頭波段中的短線深幅反彈，非正式翻多，需密切觀察是否能站上零軸。"; condText = "DIF 突破 DEA (黃金交叉) 且 DIF < 0 且 DEA < 0"; bg = "bg-blue-600 text-blue-600"; }
  if (currentSignalCode === "8") { descText = "跌深反彈遭遇解套壓力宣告失敗，空頭重新主導大局，下跌趨勢延續。"; condText = "DIF 跌破 DEA (死亡交叉) 且 DIF < 0 且 DEA < 0"; bg = "bg-slate-700 text-slate-800"; }
  if (currentSignalCode === "9") { descText = "下跌動能持續減弱，市場賣壓枯竭開始尋找底部支撐，為反轉重要前兆。"; condText = "綠柱(OSC)持續縮短 且 DIF向DEA靠近 且 尚未形成黃金交叉"; bg = "bg-teal-600 text-teal-600"; }
  if (currentSignalCode === "10") { descText = "空頭架構正式終結，中期多頭結構開始形成，為極具波段價值的翻多起漲訊號。"; condText = "DIF黃金交叉DEA 且 柱狀圖由綠轉紅 (可伴隨底背離特徵)"; bg = "bg-indigo-600 text-indigo-600"; }
  if (currentSignalCode === "11") { descText = "上漲高檔動能開始流失，追價意願顯著下降，主力籌碼分批調節撤離。"; condText = "紅柱(OSC)持續縮短 且 DIF向DEA靠近 且 尚未形成死亡交叉"; bg = "bg-fuchsia-600 text-fuchsia-600"; }
  if (currentSignalCode === "12") { descText = "多頭波段正式結束，空頭派對開始形成，中期趨勢反轉向下確立。"; condText = "DIF死亡交叉DEA 且 柱狀圖由紅轉綠 (可伴隨頂背離特徵)"; bg = "bg-purple-600 text-purple-600"; }
  
  const labelMap = {
    "1": "多頭加速", "2": "多頭減速", "3": "多頭回檔", "4": "多頭再啟",
    "5": "空頭加速", "6": "空頭減速", "7": "空頭反彈", "8": "空頭續跌",
    "9": "底部築底", "10": "底部翻多", "11": "頂部鈍化", "12": "頂部翻空"
  };
  
  let lbl = labelMap[currentSignalCode] || "未知趨勢";

  setSignalDetail(titleText, descText, condText);
  if(boardTitleEl) {
    boardTitleEl.innerHTML = `<span class="px-2 py-0.5 ${bg.split(' ')[0]} text-white rounded font-extrabold text-xs animate-pulse mr-1.5">${lbl}</span> <span class="${bg.split(' ')[1]} font-extrabold text-sm md:text-base">${titleText}</span>`;
  }
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
    return Math.round((row[cfg.bKey] || 0) / 1000) - Math.round((row[cfg.sKey] || 0) / 1000); 
  });

  let absMax = Math.max(...nets.map(Math.abs), 1), barsHtml = localTrendDates.map((d, i) => { 
    const val = nets[i], isPositive = val >= 0, heightPct = Math.min(Math.round((Math.abs(val) / absMax) * 80), 80), datePart = d.split('-')[1] + '/' + d.split('-')[2];
    return `<div class="flex flex-col flex-1 h-full min-w-0 relative items-center"><div class="w-full h-1/2 flex flex-col justify-end items-center relative">${isPositive && val > 0 ? `<span class="text-xs font-black text-rose-600 mb-1 tracking-tighter">+${val}</span><div class="w-full max-w-[20px] min-w-[4px] ${cfg.color} rounded-t-xs shadow-2xs" style="height: ${heightPct}%;"></div>` : ''}${val === 0 ? `<span class="text-xs font-bold text-slate-400 mb-1">0</span>` : ''}</div><div class="w-full h-1/2 flex flex-col justify-start items-center relative">${!isPositive ? `<div class="w-full max-w-[20px] min-w-[4px] ${cfg.negColor} rounded-b-xs shadow-2xs" style="height: ${heightPct}%;"></div><span class="text-xs font-black text-emerald-600 mt-1 tracking-tighter">${val}</span>` : ''}<span class="absolute top-[2px] text-[10px] text-slate-950 font-black tracking-tighter">${datePart}</span></div></div>`; 
  }).join('');

  chipChartEl.innerHTML = `<div class="bg-slate-50 border border-slate-200 rounded-xl p-1.5 w-full"><div class="w-full h-32 flex justify-between bg-white rounded-lg border border-slate-200 px-1 relative items-center"><div class="absolute left-0 right-0 h-[1.5px] bg-slate-400 z-10"></div>${barsHtml}</div></div>`;
}
export { toggleLine as uiToggleLine };
