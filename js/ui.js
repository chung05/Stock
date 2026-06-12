// js/ui.js
import { state, getValIgnoreCase, MACD_SIGNALS, decodeMacdSignal } from './config.js';
import { renderPriceTrendLineChart, renderSeparatedMacdChartAndDecodeSignals, renderChipTrendChart, scrollToLatestTrend } from './macd.js';

export function updateDisplayDates(startDateStr) {
  const el = document.getElementById("chipUpdateTime");
  const elMob = document.getElementById("chipUpdateTimeMob");
  if (el) el.innerText = startDateStr || "--";
  if (elMob) elMob.innerText = startDateStr || "--";
}

// 💡 終極修正：拔除一切外部 DOM 延遲干擾，100% 實打實強行注入 6 大指標型態選項至頂部 tabSelect
export function updateTabSelectOptions(sheets) {
  const select = document.getElementById("tabSelect");
  if (!select) return;
  
  let html = `<option value="全部">🌐 全部成分股</option>`;
  
  // 🧠 核心注入：在選單中追加 6 大 MACD 趨勢型態篩選群組
  html += `<optgroup label="🎯 MACD 趨勢型態篩選">`;
  Object.keys(MACD_SIGNALS).forEach(key => {
    html += `<option value="MACD_${key}">📈 ${MACD_SIGNALS[key]}</option>`;
  });
  html += `</optgroup>`;

  // 注入原本的 Excel 分類頁籤
  html += `<optgroup label="📁 雲端標的分群">`;
  sheets.forEach(sheet => { if (sheet) html += `<option value="${sheet}">📁 ${sheet}</option>`; });
  html += `</optgroup>`;
  
  select.innerHTML = html;
  select.value = state.currentSourceTab;
}

export function switchTab(sheetName) { 
  state.currentSourceTab = sheetName; 
  applyFilters(); 
}
export function changeSortMode(val) { state.currentSortMode = val; applyFilters(); }
export function changeSumDaysMode(val) { state.currentSumDaysMode = parseInt(val, 10); applyFilters(); }
export function handleSearchKeyup(e) { const clearBtn = document.getElementById("clearSearchBtn"); if (document.getElementById("keywordInput").value.trim() !== "") { clearBtn.classList.remove("hidden"); } else { clearBtn.classList.add("hidden"); } if (e.key === "Enter") executeStockSearch(); }
export function executeStockSearch() { state.searchKeyword = document.getElementById("keywordInput").value.trim().toLowerCase(); applyFilters(); }
export function clearSearchField() { document.getElementById("keywordInput").value = ""; document.getElementById("clearSearchBtn").classList.add("hidden"); state.searchKeyword = ""; applyFilters(); }

export function renderTableHeader() {
  const headerDates = document.getElementById("tableHeaderDates"), headerSub = document.getElementById("tableHeaderSub");
  if (!headerDates || !headerSub || state.recentDates.length === 0) return;

  let datesHtml = `
    <th rowspan="2" class="px-1 py-2 bg-slate-200 sticky left-0 z-40 w-[112px] min-w-[112px] max-w-[112px] align-middle text-center border-r border-slate-300">
      <div class="flex flex-col items-center gap-1">
        <span class="font-extrabold text-[11px] text-slate-900 whitespace-nowrap tracking-tighter">標的</span>
        <select id="headerSortSelect" class="text-[11px] border border-slate-400 rounded px-0.5 py-0.5 bg-white font-bold cursor-pointer focus:outline-none w-full text-slate-800 tracking-tighter">
          <option value="stock_id" ${state.currentSortMode==='stock_id'?'selected':''}>🔢 代號排序</option>
          <option value="foreign_buy" ${state.currentSortMode==='foreign_buy'?'selected':''}>🔺 外資買超前列</option>
          <option value="foreign_dealer_buy" ${state.currentSortMode==='foreign_dealer_buy'?'selected':''}>🔺 外陸資自營買超</option>
          <option value="investment_buy" ${state.currentSortMode==='investment_buy'?'selected':''}>🔺 投信買超前列</option>
          <option value="dealer_self_buy" ${state.currentSortMode==='dealer_self_buy'?'selected':''}>🔺 自營商自行買超</option>
          <option value="dealer_hedging_buy" ${state.currentSortMode==='dealer_hedging_buy'?'selected':''}>🔺 自營商避險買超</option>
        </select>
      </div>
    </th>
    <th rowspan="2" class="px-1 py-2 bg-slate-100 font-extrabold text-xs text-slate-800 sticky left-[112px] z-40 w-[52px] min-w-[52px] max-w-[52px] align-middle whitespace-nowrap border-r border-slate-300 text-center">法人</th>
    <th rowspan="2" class="px-1 py-1 bg-rose-50 sticky left-[164px] z-40 w-[74px] min-w-[74px] max-w-[74px] align-middle border-r border-slate-300 text-center sticky-col-shadow">
      <select id="headerSumDaysSelect" class="text-[11px] border border-slate-400 rounded px-0.5 py-0.5 bg-white font-black cursor-pointer focus:outline-none w-full text-rose-600 tracking-tighter text-center">
        <option value="5" ${state.currentSumDaysMode===5?'selected':''}>5日結</option>
        <option value="3" ${state.currentSumDaysMode===3?'selected':''}>3日結</option>
      </select>
    </th>`;
  let subHtml = "";

  state.recentDates.forEach((dateStr, index) => {
    const parts = dateStr.split('-'), formattedDate = parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateStr, borderClass = index === state.recentDates.length - 1 ? "" : "border-r border-slate-300";
    datesHtml += `<th colspan="3" class="px-2 py-2 ${borderClass} text-sm bg-slate-100 text-slate-900 font-bold whitespace-nowrap">${formattedDate}</th>`;
    subHtml += `<th class="py-1.5 border-r border-slate-200 w-[55px] min-w-[55px] text-sm font-bold text-blue-600">買</th><th class="py-1.5 border-r border-slate-200 w-[55px] min-w-[55px] text-sm font-bold text-emerald-600">賣</th><th class="py-1.5 ${index === state.recentDates.length - 1 ? "" : "border-r border-slate-300"} w-[65px] min-w-[65px] text-sm font-extrabold text-rose-600">結</th>`;
  });
  headerDates.innerHTML = datesHtml; headerSub.innerHTML = subHtml;

  document.getElementById("headerSortSelect").addEventListener("change", (e) => changeSortMode(e.target.value));
  document.getElementById("headerSumDaysSelect").addEventListener("change", (e) => changeSumDaysMode(e.target.value));
}

export function applyFilters() {
  let filteredStocks = [...state.dbStockData];
  const tab = state.currentSourceTab;

  // 智慧篩選過濾判定
  if (tab !== '全部') {
    if (tab.startsWith("MACD_")) {
      const targetSignalCode = tab.replace("MACD_", ""); // 提取出 A, B, C, D, E, F 代號
      filteredStocks = state.dbStockData.filter(item => {
        if (!item) return false;
        const myChips = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(item.stock_id).trim());
        return decodeMacdSignal(myChips) === targetSignalCode;
      });
    } else {
      // 傳統頁籤分類過濾
      filteredStocks = state.dbStockData.filter(item => item && Array.isArray(item.sheet_tags) && item.sheet_tags.includes(tab));
    }
  }

  if (state.searchKeyword !== "") {
    filteredStocks = filteredStocks.filter(item => {
      if (!item) return false;
      return String(item.stock_id).toLowerCase().includes(state.searchKeyword) || String(item.stock_name || '').toLowerCase().includes(state.searchKeyword);
    });
  }
  
  // 🧠 核心動能加壓排序：如果下拉選單切換至 MACD 型態，自動強制改為「依今日最新動能 OSC 柱狀體由大到小排序」
  if (tab.startsWith("MACD_")) {
    filteredStocks.sort((a, b) => {
      const chipsA = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(a.stock_id).trim()).sort((x,y) => y.date.localeCompare(x.date));
      const chipsB = state.globalChipCache.filter(c => String(c.stock_id).trim() === String(b.stock_id).trim()).sort((x,y) => y.date.localeCompare(x.date));
      const oscA = chipsA.length > 0 ? (getValIgnoreCase(chipsA[0], 'macd_osc') || 0) : -999;
      const oscB = chipsB.length > 0 ? (getValIgnoreCase(chipsB[0], 'macd_osc') || 0) : -999;
      return oscB - oscA; 
    });
  } else {
    // 傳統三大法人籌碼加總排行
    filteredStocks.sort((a, b) => {
      const idA = String(a.stock_id).trim(), idB = String(b.stock_id).trim();
      if (state.currentSortMode === 'stock_id') return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });

      const getSumForStock = (stockId, buyField, sellField) => {
        const chips = state.globalChipCache.filter(c => String(c.stock_id).trim() === stockId), sumDates = state.recentDates.slice(0, state.currentSumDaysMode);
        return chips.reduce((acc, row) => { if (!sumDates.includes(String(row.date))) return acc; return acc + (Math.round((row[buyField] || 0) / 1000) - Math.round((row[sellField] || 0) / 1000)); }, 0);
      };

      let valA = 0, valB = 0; const m = state.currentSortMode;
      if (m==='foreign_buy') { valA = getSumForStock(idA, 'f_buy', 'f_sell'); valB = getSumForStock(idB, 'f_buy', 'f_sell'); return valB - valA; }
      if (m==='foreign_dealer_buy') { valA = getSumForStock(idA, 'fd_buy', 'fd_sell'); valB = getSumForStock(idB, 'fd_buy', 'fd_sell'); return valB - valA; }
      if (m==='investment_buy') { valA = getSumForStock(idA, 'it_buy', 'it_sell'); valB = getSumForStock(idB, 'it_buy', 'it_sell'); return valB - valA; }
      if (m==='dealer_self_buy') { valA = getSumForStock(idA, 'ds_buy', 'ds_sell'); valB = getSumForStock(idB, 'ds_buy', 'ds_sell'); return valB - valA; }
      if (m==='dealer_hedging_buy') { valA = getSumForStock(idA, 'dh_buy', 'dh_sell'); valB = getSumForStock(idB, 'dh_buy', 'dh_sell'); return valB - valA; }
      return 0;
    });
  }

  renderMatrixTableFromCache(filteredStocks);
}

export function renderMatrixTableFromCache(stocks) {
  document.getElementById("recordCount").innerText = stocks.length;
  const tbody = document.getElementById("stockTableBody"); if (!tbody) return;
  if (stocks.length === 0) { tbody.innerHTML = `<tr><td colspan="${3 + state.recentDates.length * 3}" class="py-8 text-slate-400 font-medium text-center">無符合條件的股票資料</td></tr>`; return; }

  let htmlString = ""; const sumDates = state.recentDates.slice(0, state.currentSumDaysMode);
  stocks.forEach(item => {
    if (!item) return; const currentIdStr = String(item.stock_id).trim(), myChips = state.globalChipCache.filter(c => String(c.stock_id).trim() === currentIdStr);
    let currentPrice = "--", changeValue = 0, mainMA10 = "--", mainMA20 = "--", mainRSI14 = "--", mainMACDOsc = "--";
    if (state.recentDates.length > 0) {
      const latestDayData = myChips.find(c => String(c.date) === state.recentDates[0]);
      if (latestDayData) {
        if (latestDayData.price !== undefined && latestDayData.price !== null) currentPrice = latestDayData.price;
        changeValue = latestDayData.change_value || 0;
        if (latestDayData.ma10 !== undefined && latestDayData.ma10 !== null) mainMA10 = latestDayData.ma10;
        if (latestDayData.ma20 !== undefined && latestDayData.ma20 !== null) mainMA20 = latestDayData.ma20;
        if (latestDayData.rsi14 !== undefined && latestDayData.rsi14 !== null) mainRSI14 = latestDayData.rsi14;
        const rawMacd = getValIgnoreCase(latestDayData, 'macd_osc'); if (rawMacd !== null && rawMacd !== undefined) mainMACDOsc = rawMacd;
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

    let sumF = 0, sumFD = 0, sumIT = 0, sumDS = 0, sumDH = 0, fRow = "", fdRow = "", iRow = "", dsRow = "", dhRow = "";
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
        <td rowspan="5" onclick="window.openCombinedModal('${item.stock_id}', '${item.stock_name || ''}')" class="px-1 py-3 border-r border-slate-300 font-mono bg-slate-100 sticky left-0 z-20 text-center leading-tight w-[112px] max-w-[112px] overflow-hidden cursor-pointer hover:bg-blue-50 transition-colors">
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
            <div class="flex items-center"><span class="text-teal-600 font-bold">MACD:</span>${macdHtml}</div>
          </div>
        </td>
        <td class="py-3 border-r border-slate-300 bg-slate-50 font-extrabold text-xs text-slate-700 whitespace-nowrap sticky left-[112px] z-20 text-center w-[52px]">外資</td>
        ${getSumCell(sumF, false)}${fRow}
      </tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-100 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">外陸資自營商</td>${getSumCell(sumFD, true)}${fdRow}</tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-50 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">投信</td>${getSumCell(sumIT, false)}${iRow}</tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-100 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">自營商(自行)</td>${getSumCell(sumDS, true)}${dsRow}</tr>
      <tr class="border-t border-slate-200 hover:bg-slate-50/50 text-center"><td class="py-3 border-r border-slate-300 bg-slate-100 font-extrabold text-xs text-slate-700 sticky left-[112px] z-20 text-center w-[52px]">自營商(避險)</td>${getSumCell(sumDH, false)}${dhRow}</tr>`;
  });
  tbody.innerHTML = htmlString;
}

export { closeNewsModal, switchModalTab, switchChipSubTab, openCombinedModal } from './macd.js';
