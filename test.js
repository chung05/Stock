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
    badgeEl.innerText = '連線下載中...';
    logEl.innerText = `正在分析股票 ${sId} 所屬市場...`;
    dumpEl.innerText = '// 正在從台灣官方伺服器下載當日全台總大帳本檔案，請稍候...';

    // 💡 規則一：由輸入代號自行判定上市(TWSE)或上櫃(TPEX)
    let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

    // 💡 規則二：時間格式轉換準備
    const twseDateStr = rawDate.replace(/-/g, ''); // 20260624
    
    const dateObj = new Date(rawDate);
    const tpexYear = dateObj.getFullYear() - 1911;
    const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
    const tpexDay = String(dateObj.getDate()).padStart(2, '0');
    const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 115/06/24

    // 💡 規則三：改用最純粹且最寬容的下載代理，先將全台一整包的 JSON 檔案完整下載下來
    const fileDownloaderProxy = "https://api.allorigins.win/get?url=";
    let targetApiUrl = "";

    if (!isTpex) {
        logEl.innerText = `🏛️ [上市分流] 正在遠端下載證交所 ${rawDate} 全台灣一千多檔股票的超級法人總大帳本...`;
        targetApiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${twseDateStr}&selectType=ALL&response=json`;
    } else {
        logEl.innerText = `🏪 [上櫃分流] 正在遠端下載櫃買中心 ${rawDate} 全台灣數百檔上櫃股票的法人總大帳本...`;
        targetApiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
    }

    try {
        // 先下載全部資料的檔案內容到網頁記憶體中
        const response = await axios.get(fileDownloaderProxy + encodeURIComponent(targetApiUrl));
        
        if (response.status === 200 && response.data && response.data.contents) {
            // 💡 規則四：將整份全台檔案在網頁端解開並轉成可分析對象
            const fullBookFile = JSON.parse(response.data.contents);
            let foundRow = null;

            if (!isTpex) {
                // 上市總帳本大檔案分析：逐列比對第一個欄位 row[0] 是否為您的股票
                const allRows = fullBookFile.data || [];
                logEl.innerText = `📥 檔案下載完成！當日上市總大帳本共計 ${allRows.length} 檔。正在為您篩選個股 ${sId}...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上市分析成功';
                    logEl.innerText = `🟢 成功取得！已在下載的大檔案中找到個股 [${sId}] 當日的原始三大法人買賣超數據：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "所屬市場": "臺灣證券交易所 (上市)",
                        "外資買賣超股數(欄位4)": foundRow[4],
                        "投信買賣超股數(欄位7)": foundRow[7],
                        "自營商買賣超股數(欄位10)": foundRow[10],
                        "該股在總帳本中的原始陣列資料": foundRow
                    }, null, 2);
                }
            } else {
                // 上櫃總帳本大檔案分析：逐列比對第一個欄位 row[0] 是否為您的股票
                const allRows = fullBookFile.aaData || [];
                logEl.innerText = `📥 檔案下載完成！當日上櫃總大帳本共計 ${allRows.length} 檔。正在為您篩選個股 ${sId}...`;
                
                foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上櫃分析成功';
                    logEl.innerText = `🟢 成功取得！已在下載的大檔案中找到個股 [${sId}] 當日的原始三大法人買賣超數據：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "所屬市場": "證券櫃檯買賣中心 (上櫃)",
                        "外資淨買超股數(欄位7)": foundRow[7],
                        "投信淨買超股數(欄位8)": foundRow[8],
                        "自營商淨買超股數(欄位9)": foundRow[9],
                        "該股在總帳本中的原始陣列資料": foundRow
                    }, null, 2);
                }
            }

            if (!foundRow) {
                badgeEl.className = 'badge error';
                badgeEl.innerText = '帳本查無個股';
                logEl.innerText = `⚠️ 大檔案下載成功，但過濾後發現帳本內「沒有」 ${sId}。請確認該日期是否為非開盤假日。`;
                dumpEl.innerText = `官方完整總檔案摘要內容：\n${JSON.stringify({ "狀態碼": fullBookFile.status, "資料總筆數": (fullBookFile.data || fullBookFile.aaData || []).length }, null, 2)}`;
            }

        } else {
            throw new Error("遠端大檔案回傳格式不正確");
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '連線失敗';
        logEl.innerText = `❌ 無法讀取數據。主要原因為：遠端伺服器臨時拒絕該日期大檔案的跨網域索取。`;
        dumpEl.innerText = `詳細追蹤錯誤回報:\n${err.stack}`;
    }
});
