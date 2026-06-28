// test.js
document.getElementById('startBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockInput').value.trim();
    const rawDate = document.getElementById('dateInput').value;
    
    const badgeEl = document.getElementById('resultBadge');
    const logEl = document.getElementById('logMessage');
    const dumpEl = document.getElementById('jsonDataDump');

    if (!sId) { alert("請輸入股票代號！"); return; }
    if (!rawDate) { alert("請選擇日期！"); return; }

    badgeEl.className = 'badge';
    badgeEl.innerText = '自動下載中...';
    logEl.innerText = `正在識別股票 ${sId} 所屬市場...`;
    dumpEl.innerText = '// 正在嘗試建立跨網域管線，後台自動下載全台官方大檔案中，請稍候...';

    // 💡 1. 自行判斷上市 (TWSE) 還是 上櫃 (TPEX)
    let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

    // 💡 2. 日期格式轉換
    const twseDateStr = rawDate.replace(/-/g, ''); // 20260624
    
    const dateObj = new Date(rawDate);
    const tpexYear = dateObj.getFullYear() - 1911;
    const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
    const tpexDay = String(dateObj.getDate()).padStart(2, '0');
    const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 115/06/24

    // 💡 3. 使用高相容性不鎖網址的公開 CORS 下載快取代理
    const fileDownloaderProxy = "https://api.allorigins.win/get?url=";
    let targetApiUrl = "";

    if (!isTpex) {
        logEl.innerText = `🏛️ [上市自動下載] 正在由後台為您向證交所索取 ${rawDate} 全台大帳本 JSON 檔案...`;
        targetApiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${twseDateStr}&selectType=ALL&response=json`;
    } else {
        logEl.innerText = `🏪 [上櫃自動下載] 正在由後台為您向櫃買中心索取 ${rawDate} 全台大帳本 JSON 檔案...`;
        targetApiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
    }

    try {
        // 💡 4. 使用 encodeURIComponent 將網址編碼，確保徹底避開 400 錯誤與 403 限制
        const response = await axios.get(fileDownloaderProxy + encodeURIComponent(targetApiUrl));
        
        if (response.status === 200 && response.data && response.data.contents) {
            // 讀取自動下載下來的整包大檔內容
            const fullBookFile = JSON.parse(response.data.contents);
            let foundRow = null;

            if (!isTpex) {
                // 上市大檔案篩選
                const allRows = fullBookFile.data || [];
                logEl.innerText = `📥 檔案自動下載成功！大帳本共包含 ${allRows.length} 檔個股。正在自動分析篩選 ${sId}...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '分析完成(上市)';
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "市場類型": "臺灣證券交易所 (自動分流下載)",
                        "外資買賣超股數(欄位4)": foundRow[4],
                        "投信買賣超股數(欄位7)": foundRow[7],
                        "自營商買賣超股數(欄位10)": foundRow[10],
                        "下載帳本中該股原始完整Row": foundRow
                    }, null, 2);
                }
            } else {
                // 上櫃大檔案篩選
                const allRows = fullBookFile.aaData || [];
                logEl.innerText = `📥 檔案自動下載成功！大帳本共包含 ${allRows.length} 檔個股。正在自動分析篩選 ${sId}...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '分析完成(上櫃)';
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "市場類型": "證券櫃檯買賣中心 (自動分流下載)",
                        "外資淨買超股數(欄位7)": foundRow[7],
                        "投信淨買超股數(欄位8)": foundRow[8],
                        "自營商淨買超股數(欄位9)": foundRow[9],
                        "下載帳本中該股原始完整Row": foundRow
                    }, null, 2);
                }
            }

            if (!foundRow) {
                badgeEl.className = 'badge error';
                badgeEl.innerText = '當日帳本無此股';
                logEl.innerText = `⚠️ 大檔案已自動下載，但搜尋全帳本後找不到股票代號 ${sId}。請確認當日是否休市。`;
                dumpEl.innerText = `大檔摘要狀態：\n${JSON.stringify({ "狀態碼": fullBookFile.status, "資料總檔數": (fullBookFile.data || fullBookFile.aaData || []).length }, null, 2)}`;
            }

        } else {
            throw new Error("無法解析自動下載的檔案內容");
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '下載被阻擋';
        logEl.innerText = `❌ 錯誤：後台全自動下載遭官方或代理拒絕。`;
        dumpEl.innerText = `錯誤詳細排查追蹤:\n${err.stack}`;
    }
});
