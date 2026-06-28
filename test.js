// test.js
document.getElementById('startBtn').addEventListener('click', async () => {
    // 1. 取得使用者即時修改的參數
    const token = document.getElementById('tokenInput').value.trim();
    const startDate = document.getElementById('startDateInput').value.trim();
    const endDate = document.getElementById('endDateInput').value.trim();
    
    // 解析股票代號字串，轉為乾淨的陣列 (自動去除空格、過濾空值)
    const rawStocks = document.getElementById('stocksInput').value;
    const targetStocks = rawStocks.split(',')
                                  .map(s => s.trim())
                                  .filter(s => s.length > 0);

    const container = document.getElementById('panelsContainer');
    container.innerHTML = ''; // 清空舊的面板內容

    if (targetStocks.length === 0) {
        container.innerHTML = '<div style="color: red; text-align: center; font-weight: bold;">❌ 請至少輸入一檔股票代號！</div>';
        return;
    }

    // 2. 先為每檔股票動態畫出預備面板
    targetStocks.forEach(sId => {
        const panelHtml = `
            <div class="stock-panel" id="panel-${sId}">
                <div class="panel-title-bar">
                    <h2>📈 核心標的: ${sId}</h2>
                    <span id="badge-${sId}" class="badge">排隊連線中...</span>
                </div>
                <div id="log-${sId}" class="log-msg">等待管線啟動...</div>
                <pre id="dump-${sId}">// 正在等待發送網路請求...</pre>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', panelHtml);
    });

    // 3. 依序執行 API 查詢
    for (let sId of targetStocks) {
        const logElement = document.getElementById(`log-${sId}`);
        const badgeElement = document.getElementById(`badge-${sId}`);
        const dumpElement = document.getElementById(`dump-${sId}`);

        badgeElement.innerText = '連線中...';
        logElement.innerText = `📡 正在向網域 api.finmindtrade.com 索取 ${startDate} ~ ${endDate} 籌碼數據...`;

        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDate}&end_date=${endDate}&token=${token}`;

        try {
            const response = await axios.get(apiUrl, { headers: { 'accept': 'application/json' } });

            if (response.status === 200 && response.data) {
                const fmStatus = response.data.status;
                const fmMsg = response.data.msg || 'Success';
                const fmData = response.data.data;

                if (fmStatus === 200 && Array.isArray(fmData)) {
                    if (fmData.length > 0) {
                        badgeElement.className = 'badge success';
                        badgeElement.innerText = '成功取得';
                        logElement.innerText = `🟢 伺服器狀態碼: ${fmStatus} | 訊息: ${fmMsg} | 成功載入 ${fmData.length} 筆原始買賣紀錄！`;
                        dumpElement.innerText = JSON.stringify(fmData, null, 2);
                    } else {
                        badgeElement.className = 'badge error';
                        badgeElement.innerText = '空數據 []';
                        logElement.innerText = `⚠️ 伺服器成功回應，但該區間資料庫為「空陣列 []」。請嘗試將日期往過去調整（例如 2026-05-12）。`;
                        dumpElement.innerText = JSON.stringify(response.data, null, 2);
                    }
                } else {
                    badgeElement.className = 'badge error';
                    badgeElement.innerText = `API 內部錯誤: ${fmStatus}`;
                    logElement.innerText = `❌ FinMind 拒絕回應完整資料。警報原因: ${fmMsg}`;
                    dumpElement.innerText = JSON.stringify(response.data, null, 2);
                }
            } else {
                badgeElement.className = 'badge error';
                badgeElement.innerText = `HTTP ${response.status}`;
                logElement.innerText = `❌ 網路通訊協定層異常。`;
                dumpElement.innerText = '未取得合法的 JSON Body';
            }
        } catch (err) {
            badgeElement.className = 'badge error';
            badgeElement.innerText = '連線潰敗';
            logElement.innerText = `💥 系統崩潰: ${err.message}`;
            if (err.response) {
                dumpElement.innerText = `錯誤代碼: ${err.response.status}\n本體:\n${JSON.stringify(err.response.data, null, 2)}`;
            } else {
                dumpElement.innerText = err.stack;
            }
        }

        // 間隔 1.2 秒以保護 API
        await new Promise(r => setTimeout(r, 1200));
    }
});
