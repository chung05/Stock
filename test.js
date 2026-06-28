// test.js
document.getElementById('startBtn').addEventListener('click', async () => {
    const rawDate = document.getElementById('dateInput').value;
    const rawStocks = document.getElementById('stocksInput').value;
    
    if (!rawDate) { alert("請選擇日期！"); return; }
    
    const targetStocks = rawStocks.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const container = document.getElementById('panelsContainer');
    container.innerHTML = ''; // 清空

    // 日期格式轉換
    // 證交所(TWSE)格式: YYYYMMDD (例如 20260624)
    const twseDateStr = rawDate.replace(/-/g, ''); 
    
    // 櫃買中心(TPEX)格式: 民國年/MM/DD (例如 115/06/24)
    const dateObj = new Date(rawDate);
    const tpexYear = dateObj.getFullYear() - 1911;
    const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
    const tpexDay = String(dateObj.getDate()).padStart(2, '0');
    const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`;

    // 先畫出基本面板
    targetStocks.forEach(sId => {
        container.insertAdjacentHTML('beforeend', `
            <div class="panel" id="panel-${sId}">
                <div class="title-bar">
                    <h2>🎯 標的: ${sId}</h2>
                    <span id="badge-${sId}" class="badge">排隊等待冷卻...</span>
                </div>
                <div id="log-${sId}" class="log">管線就緒，等待連線安全時間點...</div>
                <pre id="dump-${sId}">// 官方數據將在此即時 Dump</pre>
            </div>
        `);
    });

    // 依序爬取官網
    for (let sId of targetStocks) {
        const logEl = document.getElementById(`log-${sId}`);
        const badgeEl = document.getElementById(`badge-${sId}`);
        const dumpEl = document.getElementById(`dump-${sId}`);

        badgeEl.className = 'badge';
        badgeEl.innerText = '讀取官網中...';

        // 💡 關鍵分流：判斷是上市(TWSE)還是上櫃(TPEX)
        // 簡單規則：藥華藥 6446、或是4碼且非特定上市區段的多為上櫃。這裡我們用最標準的刺探行為
        let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8')); 
        
        let apiUrl = '';
        if (!isTpex) {
            logEl.innerText = `🏛️ [分流: 上市] 正在呼叫臺灣證券交易所 (TWSE) 當日所有法人大帳本，並從中精準篩選 ${sId}...`;
            apiUrl = `https://cors-anywhere.herokuapp.com/https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${twseDateStr}&selectType=ALL&response=json`;
        } else {
            logEl.innerText = `🏪 [分流: 上櫃] 正在呼叫證券櫃檯買賣中心 (TPEX) 當日三大法人明細，個股對齊 ${sId}...`;
            apiUrl = `https://cors-anywhere.herokuapp.com/https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
        }

        try {
            // 注意：網頁端直連官網通常會有 CORS 跨網域限制，這裡加上代理或直連刺探
            const res = await axios.get(apiUrl, { headers: { 'accept': 'application/json' } });
            
            if (res.status === 200 && res.data) {
                let foundData = null;

                if (!isTpex) {
                    // TWSE 證交所解析邏輯
                    const rawRows = res.data.data || [];
                    // 證交所的個股代號通常在第一個欄位 row[0]
                    foundData = rawRows.find(row => row[0].trim() === sId);
                    
                    if (foundData) {
                        badgeEl.className = 'badge success';
                        badgeEl.innerText = '上市官網成功';
                        logEl.innerText = `🟢 成功在證交所大帳本中抓到 ${sId}！原始欄位對照：[2]=外資買進, [3]=外資賣出, [4]=外資買賣超...`;
                        dumpEl.innerText = JSON.stringify({
                            "股票代號": sId,
                            "證交所完整列數據": foundData,
                            "說明": "欄位順序依證交所官網 T86 報表為準"
                        }, null, 2);
                    }
                } else {
                    // TPEX 櫃買中心解析邏輯
                    const rawRows = res.data.aaData || [];
                    // 櫃買中心的個股代號通常在第一個欄位 row[0]
                    foundData = rawRows.find(row => row[0].trim() === sId);

                    if (foundData) {
                        badgeEl.className = 'badge success';
                        badgeEl.innerText = '上櫃官網成功';
                        logEl.innerText = `🟢 成功在櫃買中心帳本中抓到 ${sId}！原始欄位對照：[7]=外資淨買賣超, [8]=投信淨買賣超...`;
                        dumpEl.innerText = JSON.stringify({
                            "股票代號": sId,
                            "櫃買中心完整列數據": foundData,
                            "說明": "欄位順序依櫃買中心官網三大法人買賣超日報為準"
                        }, null, 2);
                    }
                }

                if (!foundData) {
                    badgeEl.className = 'badge error';
                    badgeEl.innerText = '查無個股';
                    logEl.innerText = `⚠️ 官網有回應，但該日大帳本中「找不到」股票 ${sId} 的紀錄。請確認該日是否休市，或代號是否正確。`;
                    dumpEl.innerText = JSON.stringify(res.data, null, 2);
                }

            } else {
                throw new Error("官網拒絕或回傳非預期格式");
            }
        } catch (err) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '直連失敗';
            logEl.innerText = `💥 失敗原因: 官網防爬蟲阻擋或 CORS 限制。錯誤: ${err.message}`;
            dumpEl.innerText = `提示：若出現 CORS 阻擋，代表您的瀏覽器目前不允許直連官網介面，必須在 Node.js 後端環境執行此邏輯才能徹底避開限制。`;
        }

        // 🌟 核心天條：每檔股票之間絕對要強制冷卻 4 秒鐘，保護您的 IP 不被交易所封鎖
        logEl.innerText += `\n⏳ 啟動反封鎖安全防禦，強制進入 4 秒鐘冷卻時間...`;
        await new Promise(r => setTimeout(r, 4000));
    }
});
