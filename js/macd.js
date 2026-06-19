// ====== 以下為 100% 修正新聞卡死、改用高穩定跨網解鎖代理的更新區塊 ======
  const debugBox = document.getElementById("debugLogZone"), listZone = document.getElementById("newsListZone");
  if(debugBox) {
    debugBox.classList.remove("hidden");
    debugBox.innerHTML = `[系統診斷開始] 初始化 ${stockId} (${stockName}) 新聞獲取流...\n`;
  }
  if(listZone) listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-6 text-center animate-pulse">正在即時連線抓取最新財經新聞...</div>`;

  // 1. 建立標準 Google 新聞搜尋 RSS 網址
  const rawSearchKeyword = `"${stockId}" "${stockName}"`;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rawSearchKeyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  
  // 2. 使用專為前端跨網解鎖設計的 AllOrigins 免費高穩定代理 (繞過 api.rss2json.com 的過載限制)
  const apiUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

  try {
    if(debugBox) debugBox.innerHTML += `[網路對接] 正在發送免註冊高安全跨網請求...\n`;
    const res = await fetch(apiUrl);
    
    if (res.ok) {
      const resJson = await res.json();
      const xmlString = resJson.contents; // 取得原始 XML 字串

      // 3. 利用瀏覽器自帶的 DOMParser 進行極速原生 XML 解析 (完全免耗外部 API 流量)
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");
      const items = xmlDoc.getElementsByTagName("item");

      if (items && items.length > 0) {
        let listHtml = "";
        const maxNewsCount = Math.min(items.length, 10);

        for (let idx = 0; idx < maxNewsCount; idx++) {
          const item = items[idx];
          const title = item.getElementsByTagName("title")[0]?.textContent || "財經頭條新聞";
          const link = item.getElementsByTagName("link")[0]?.textContent || "#";
          const rawPubDate = item.getElementsByTagName("pubDate")[0]?.textContent;
          const source = item.getElementsByTagName("source")[0]?.textContent || "財經媒體";

          // 格式化日期為 YYYY-MM-DD
          let dateStr = "近期新聞";
          if (rawPubDate) {
            const pubDate = new Date(rawPubDate);
            if (!isNaN(pubDate.getTime())) {
              dateStr = `${pubDate.getFullYear()}-${String(pubDate.getMonth() + 1).padStart(2, '0')}-${String(pubDate.getDate()).padStart(2, '0')}`;
            }
          }

          // 拼接前端精美的 Tailwind 新聞卡片外殼
          listHtml += `
            <a href="${link}" target="_blank" rel="noopener noreferrer" class="block p-3 border border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50/50 flex flex-col gap-1.5 text-left group/item transition-colors">
              <div class="text-xs text-slate-400 font-bold flex items-center gap-2">
                <span>📅 ${dateStr}</span>
                <span class="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-black">${source}</span>
              </div>
              <h4 class="text-sm font-extrabold text-blue-700 leading-snug group-hover/item:text-blue-900 group-hover/item:underline">${title}</h4>
            </a>`;
        }

        if(listZone) listZone.innerHTML = listHtml;
        if(debugBox) debugBox.classList.add("hidden"); // 成功後自動隱藏診斷盒
        
      } else {
        if(listZone) listZone.innerHTML = `<div class="text-xs text-slate-400 font-medium py-8 text-center">查無相關新聞</div>`;
        if(debugBox) debugBox.innerHTML += `[警告] 伺服器回應成功但解析不到任何 item 節點。\n`;
      }
    } else {
      throw new Error(`伺服器回應錯誤代碼: ${res.status}`);
    }
  } catch (fetchErr) {
    console.error("💥 新聞聯線與解析發生嚴重異常:", fetchErr);
    if(listZone) listZone.innerHTML = `<div class="text-xs text-rose-500 font-medium py-8 text-center">新聞連線過載或被防火牆攔截。</div>`;
    if(debugBox) {
      debugBox.classList.remove("hidden");
      debugBox.innerHTML += `❌ [連線崩潰] 錯誤原因: ${fetchErr.message}\n`;
    }
  }
}
