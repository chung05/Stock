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
    badgeEl.innerText = '大檔下載中...';
    logEl.innerText = `正在辨識股票 ${sId} 所屬市場市場...`;
    dumpEl.innerText = '// 正在發送指令下載當日全台灣完整總帳本檔案，請稍候 3~5 秒...';

    // 💡 1. 由輸入的代號自行判斷上市 (TWSE) 還是 上櫃 (TPEX)
    let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

    // 💡 2. 日期格式轉換
    const twseDateStr = rawDate.replace(/-/g, ''); // 20260624
    
    const dateObj = new Date(rawDate);
    const tpexYear = dateObj.getFullYear() - 1911;
    const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
    const tpexDay = String(dateObj.getDate()).padStart(2, '0');
    const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 115/06/24

    // 💡 3. 使用全新、防禦穿透性最高的專用大檔案高速下載跨網域網址
    const fileDownloaderProxy = "https://cors-anywhere.herokuapp.com/";
    let targetApiUrl = "";

    if (!isTpex) {
        logEl.innerText = `🏛️ [分流: 上市] 正在跨網域下載證交所 ${rawDate} 全台灣「所有上市股票」巨型總大帳本檔案...`;
        targetApiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${twseDateStr}&selectType=ALL&response=json`;
    } else {
        logEl.innerText = `🏪 [分流: 上櫃] 正在跨網域下載櫃買中心 ${rawDate} 全台灣「所有上櫃股票」巨型總大帳本檔案...`;
        targetApiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
    }

    try {
        // 💡 4. 先將全台一整包的原始 JSON 大檔案完整下載下來到網頁記憶體中
        const response = await axios.get(fileDownloaderProxy + targetApiUrl, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        
        if (response.status === 200 && response.data) {
            const fullBookFile = response.data;
            let foundRow = null;

            if (!isTpex) {
                // 🏛️ 上市大檔案過濾分析：在大檔案的 data 數組中，比對 row[0] 是否等於您的個股代號
                const allRows = fullBookFile.data || [];
                logEl.innerText = `📥 大檔案下載成功！今日總帳本共包含 ${allRows.length} 檔有三大法人交易的上市個股。正在進行前端過濾...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上市篩選成功';
                    logEl.innerText = `🟢 驗證成功！已成功從下載的大檔案中剝離出個股 [ ${sId} ] 的三大法人原始數據：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "所屬市場": "臺灣證券交易所 (上市股票)",
                        "外資買賣超股數(欄位4)": foundRow[4],
                        "投信買賣超股數(欄位7)": foundRow[7],
                        "自營商買賣超股數(欄位10)": foundRow[10],
                        "官方總帳本中該股的完整 Row 數組": foundRow
                    }, null, 2);
                }
            } else {
                // 🏪 上櫃大檔案過濾分析：在大檔案的 aaData 數組中，比對 row[0] 是否等於您的個股代號
                const allRows = fullBookFile.aaData || [];
                logEl.innerText = `📥 大檔案下載成功！今日總帳本共包含 ${allRows.length} 檔有三大法人交易的上櫃個股。正在進行前端過濾...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上櫃篩選成功';
                    logEl.innerText = `🟢 驗證成功！已成功從下載的大檔案中剝離出個股 [ ${sId} ] 的三大法人原始數據：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "所屬市場": "證券櫃檯買賣中心 (上櫃股票)",
                        "外資淨買超股數(欄位7)": foundRow[7],
                        "投信淨買超股數(欄位8)": foundRow[8],
                        "自營商淨買超股數(欄位9)": foundRow[9],
                        "官方總帳本中該股的完整 Row 數組": foundRow
                    }, null, 2);
                }
            }

            if (!foundRow) {
                badgeEl.className = 'badge error';
                badgeEl.innerText = '帳本內無此股';
                logEl.innerText = `⚠️ 總帳本檔案下載成功，但在整份檔案內「找不到」 ${sId} 的紀錄。請確認該日期是否為休市日（週末/連假）。`;
                dumpEl.innerText = `大檔案摘要：\n${JSON.stringify({ "狀態碼": fullBookFile.status, "回應訊息": fullBookFile.stat || "OK" }, null, 2)}`;
            }

        } else {
            throw new Error("大檔案內容載入失敗");
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '下載遭拒';
        logEl.innerText = `❌ 錯誤：無法透過網頁端讀取數據。主要原因為：公開代理下載接口目前拒絕了該大檔案的跨網域索取。`;
        dumpEl.innerText = `詳細追蹤錯誤回報 (Network Error 解決指南):\n${err.stack}`;
    }
});
