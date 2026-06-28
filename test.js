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
    badgeEl.innerText = '下載總表中...';
    logEl.innerText = `正在分析股票 ${sId} 所屬市場市場分流...`;
    dumpEl.innerText = '// 正在請求公共代理管線下載當日官方總表，請稍候 2~4 秒...';

    // 💡 1. 根據輸入的代號自行辨識上市 (TWSE) 或 上櫃 (TPEX)
    let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

    // 💡 2. 轉換出官方接受的日期字串
    const twseDateStr = rawDate.replace(/-/g, ''); // 轉為 20250627
    
    const dateObj = new Date(rawDate);
    const tpexYear = dateObj.getFullYear() - 1911;
    const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
    const tpexDay = String(dateObj.getDate()).padStart(2, '0');
    const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 轉為 114/06/27

    // 💡 3. 您提到的手動測試網址（使用最穩定的 JSONP/CorsBridge 線上解鎖接口）
    const proxyUrl = "https://api.allorigins.win/get?url=";
    let targetApiUrl = "";

    if (!isTpex) {
        logEl.innerText = `🏛️ [上市自動下載] 正在由後台為您下載證交所 ${rawDate} 當日全台巨型總表...`;
        // 採用您手動測試成功的全新格式網址 (T86)
        targetApiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${twseDateStr}&selectType=ALLBUT0999&response=json`;
    } else {
        logEl.innerText = `🏪 [上櫃自動下載] 正在由後台為您下載櫃買中心 ${rawDate} 當日全台上櫃總表...`;
        targetApiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
    }

    try {
        // 💡 4. 【核心關鍵修正】：必須使用 encodeURIComponent 將整個網址進行百分比編碼
        // 這樣傳給代理伺服器時，裡面的 ? 與 & 符號才不會錯亂，徹底修正 HTTP 400 與 Network Error 錯誤
        const response = await axios.get(proxyUrl + encodeURIComponent(targetApiUrl));
        
        if (response.status === 200 && response.data && response.data.contents) {
            // 從代理包裹中將官方的 JSON 總表內容解鎖出來
            const officialTotalBook = JSON.parse(response.data.contents);
            let foundRow = null;

            if (!isTpex) {
                // 🏛️ 上市總表分析：直接過濾 data 數組
                const allRows = officialTotalBook.data || [];
                logEl.innerText = `📥 總表自動下載成功！今日上市共有 ${allRows.length} 檔股票。正在為您過濾出 ${sId}...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上市分析完成';
                    logEl.innerText = `🟢 成功！已從官方下載的當日總表中，精準剝離出個股 [ ${sId} ] 的籌碼數據：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "股票名稱": foundRow[1].trim(),
                        "查詢日期": rawDate,
                        "資料來源": "臺灣證券交易所 (T86 總表自動過濾)",
                        "外資買賣超股數": foundRow[4],
                        "投信買賣超股數": foundRow[7],
                        "自營商買賣超股數": foundRow[10],
                        "官方總表當日該股原始完整Row數組": foundRow
                    }, null, 2);
                }
            } else {
                // 🏪 上櫃總表分析：直接過濾 aaData 數組
                const allRows = officialTotalBook.aaData || [];
                logEl.innerText = `📥 總表自動下載成功！今日上櫃共有 ${allRows.length} 檔股票。正在為您過濾出 ${sId}...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上櫃分析完成';
                    logEl.innerText = `🟢 成功！已從官方下載的當日總表中，精準剝離出個股 [ ${sId} ] 的籌碼數據：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "股票名稱": foundRow[1].trim(),
                        "查詢日期": rawDate,
                        "資料來源": "證券櫃檯買賣中心 (上櫃總表自動過濾)",
                        "外資淨買超股數": foundRow[7],
                        "投信淨買超股數": foundRow[8],
                        "自營商淨買超股數": foundRow[9],
                        "官方總表當日該股原始完整Row數組": foundRow
                    }, null, 2);
                }
            }

            if (!foundRow) {
                badgeEl.className = 'badge error';
                badgeEl.innerText = '總表內無此股';
                logEl.innerText = `⚠️ 官方當日總表已成功下載，但在全數股票中找不到代號 ${sId}。`;
                dumpEl.innerText = `官方總表狀態摘要：\n${JSON.stringify({ "回應狀態": officialTotalBook.stat || "OK", "總表內有進出之股票總數": (officialTotalBook.data || officialTotalBook.aaData || []).length }, null, 2)}\n\n💡 原因提示：請確認該日期是否為週六日、國定連假休市。若為交易日，代表該股票當天三大法人進出均為0，因此未列入總表。`;
            }

        } else {
            throw new Error("代理伺服器回傳內容解碼失敗");
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '安全防禦阻擋';
        logEl.innerText = `❌ 錯誤：雖然您在網址列可以直接看，但瀏覽器前端執行時遭 CORS / 代理拒絕。`;
        dumpEl.innerText = `詳細追蹤錯誤回報:\n${err.stack}`;
    }
});
