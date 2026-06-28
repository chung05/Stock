// test.js
const CONFIG = {
    workerUrl: "https://stock.chiu6-chung05.workers.dev", 
    ghUser: "chung05",  
    ghRepo: "Stock"     
};

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockId').value.trim();
    const rawDate = document.getElementById('targetDate').value;
    const badgeEl = document.getElementById('resultBadge');
    const logEl = document.getElementById('logMsg');
    const resultEl = document.getElementById('resultBlock');

    if (!sId || !rawDate) return alert("請輸入完整代號與日期");

    const dateStr = rawDate.replace(/-/g, ''); // 轉為 20250625
    
    badgeEl.className = 'badge';
    badgeEl.innerText = '雲端下載中...';
    logEl.innerText = `🔄 步驟 1: 正在命令 Cloudflare Worker 向官方調閱並下載總表...`;
    resultEl.innerText = `// 正在請求您的 Cloudflare Worker 轉換民國日期並落地 GitHub，請稍候 3~5 秒...`;

    try {
        // 1. 命令 Worker 抓取資料 (Worker 會在背後自動轉成民國日期去戳官方 API)
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        
        logEl.innerText = `📥 步驟 2: 雲端大檔儲存成功！正在自 CORS 解鎖網域拉取 JSON 進行解碼...`;

        // 2. 從 GitHub 讀取完全屬於您自己的總表
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json`;
        const ghRes = await axios.get(githubRawUrl);
        
        const totalBook = ghRes.data;
        
        // 防呆機制：檢查官方是不是回傳「查無資料」的空檔案
        if (!totalBook.data || totalBook.data.length === 0) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '當日官方無資料';
            logEl.innerText = `⚠️ 檔案下載成功，但官方網站顯示該日期 [ ${rawDate} ] 沒有任何交易數據。`;
            resultEl.innerText = JSON.stringify({
                "提示": "請確認該日期是否為週六日、國定假日。或者是台股尚未開盤的未來時間。",
                "官方回傳狀態 (stat)": totalBook.stat || "未回傳"
            }, null, 2);
            return;
        }

        const allRows = totalBook.data;
        logEl.innerText = `🔍 步驟 3: 總表載入成功（共 ${allRows.length} 檔個股）。正在前端篩選 ${sId} ...`;
        
        // 3. 在網頁前端過濾個股
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logEl.innerText = `🟢 驗證成功！已成功從雲端總表中提取出個股 [ ${sId} ] 的三大法人原始數據：`;
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "查詢日期": rawDate,
                "資料來源": "臺灣證券交易所 (Worker 自動民國化轉換管線)",
                "外資買賣超股數(欄位4)": foundRow[4],
                "投信買賣超股數(欄位7)": foundRow[7],
                "自營商買賣超股數(欄位10)": foundRow[10],
                "GitHub 總表檔案中該股的完整原始 Row 陣列": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '總表內無此股';
            logEl.innerText = `⚠️ 總表下載成功，但大帳本內找不到個股 ${sId}。`;
            resultEl.innerText = `💡 提示：代表該股當天三大法人進出皆為 0，未被計入官方總表。`;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線中斷';
        logEl.innerText = `❌ 錯誤：無法透過雲端管線獲取數據。`;
        
        const currentTryUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json`;
        resultEl.innerText = `【除錯對比資訊】\n網頁嘗試讀取的網址：${currentTryUrl}\n\n詳細錯誤追蹤:\n${err.stack}`;
    }
});
