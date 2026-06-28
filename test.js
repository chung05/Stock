// test.js
document.getElementById('startBtn').addEventListener('click', async () => {
    const token = document.getElementById('tokenInput').value.trim();
    const targetStocks = ["2301", "6446"];
    const startDate = "2026-06-22";
    const endDate = "2026-06-25";

    // 清空上次測試狀態
    targetStocks.forEach(sId => {
        document.getElementById(`badge-${sId}`).className = 'badge';
        document.getElementById(`badge-${sId}`).innerText = '連線中...';
        document.getElementById(`log-${sId}`).innerText = '正在向 FinMind 伺服器發送請求...';
        document.getElementById(`dump-${sId}`).innerText = '// 等待資料回傳...';
    });

    for (let sId of targetStocks) {
        const logElement = document.getElementById(`log-${sId}`);
        const badgeElement = document.getElementById(`badge-${sId}`);
        const dumpElement = document.getElementById(`dump-${sId}`);

        // 組裝純粹的網頁端 GET URL
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDate}&end_date=${endDate}&token=${token}`;

        try {
            // 使用網頁 Axios 直連發送 GET 請求
            const response = await axios.get(apiUrl, {
                headers: {
                    'accept': 'application/json'
                }
            });

            console.log(`[探針回報] 股票 ${sId} 回應狀態:`, response);

            // 檢查回應結構
            if (response.status === 200 && response.data) {
                const fmStatus = response.data.status;
                const fmMsg = response.data.msg || 'Success';
                const fmData = response.data.data;

                if (fmStatus === 200 && Array.isArray(fmData)) {
                    if (fmData.length > 0) {
                        badgeElement.className = 'badge success';
                        badgeElement.innerText = '成功取得';
                        logElement.innerText = `📡 狀態: ${fmStatus} | 訊息: ${fmMsg} | 成功拿到 ${fmData.length} 筆原始列數據！`;
                        
                        // 將整包原始資料以 JSON 美化排版形式印在網頁畫面上
                        dumpElement.innerText = JSON.stringify(fmData, null, 2);
                    } else {
                        badgeElement.className = 'badge error';
                        badgeElement.innerText = '空陣列 []';
                        logElement.innerText = `⚠️ 伺服器回傳成功，但 data 欄位回傳空陣列 [] (可能觸發風控或無資料)`;
                        dumpElement.innerText = JSON.stringify(response.data, null, 2);
                    }
                } else {
                    badgeElement.className = 'badge error';
                    badgeElement.innerText = `FinMind 錯誤: ${fmStatus}`;
                    logElement.innerText = `❌ FinMind 內部警報: ${fmMsg}`;
                    dumpElement.innerText = JSON.stringify(response.data, null, 2);
                }
            } else {
                badgeElement.className = 'badge error';
                badgeElement.innerText = `HTTP ${response.status}`;
                logElement.innerText = `❌ 網路層回應異常`;
                dumpElement.innerText = '無有效回應本體';
            }

        } catch (err) {
            console.error(`[刺探失敗] ${sId} 發生崩潰:`, err);
            badgeElement.className = 'badge error';
            badgeElement.innerText = '網路潰敗';
            logElement.innerText = `💥 錯誤訊息: ${err.message}`;
            
            if (err.response) {
                // 如果伺服器有噴錯誤代碼 (例如之前的 405)
                dumpElement.innerText = `伺服器拒絕回應！\nHTTP Code: ${err.response.status}\n回應內容:\n${JSON.stringify(err.response.data, null, 2)}`;
            } else {
                dumpElement.innerText = `無法觸及 API 節點，請檢查網路連線或 CORS 跨網域設定。\n\n詳細追蹤:\n${err.stack}`;
            }
        }
        
        // 微型等待
        await new Promise(r => setTimeout(r, 1000));
    }
});
