// test.js (加上時間緩衝防禦)
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

    const dateStr = rawDate.replace(/-/g, ''); // "20260626"
    
    badgeEl.className = 'badge';
    badgeEl.innerText = '雲端下載中...';
    logEl.innerText = `🔄 步驟 1: 正在命令 Cloudflare Worker 向官方調閱並下載總表...`;
    resultEl.innerText = `// 正在請求您的 Cloudflare Worker 轉換民國日期並落地 GitHub，請稍候 3~5 秒...`;

    try {
        // 1. 觸發 Worker 下載大表
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        console.log("Worker 回應資料:", triggerWorker.data);
        
        logEl.innerText = `⏳ 雲端已接單！等待 GitHub 伺服器檔案庫建立索引中...`;
        // 💡 這裡加上 1.5 秒的暫停，確保 GitHub Raw 網址完全生效，不再噴 404
        await new Promise(resolve => setTimeout(resolve, 1500));

        logEl.innerText = `📥 步驟 2: 正在自解鎖網域拉取 JSON 檔案進行分析...`;

        // 2. 讀取 GitHub 檔案
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json`;
        const ghRes = await axios.get(githubRawUrl);
        
        const totalBook = ghRes.data;
        
        if (!totalBook.data || totalBook.data.length === 0) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '當日官方無資料';
            logEl.innerText = `⚠️ 檔案下載成功，但官方網站顯示該日期 [ ${rawDate} ] 沒有任何交易數據。`;
            resultEl.innerText = JSON.stringify({ "提示": "請確認該日期是否為週六日、國定假日。" }, null, 2);
            return;
        }

        const allRows = totalBook.data;
        logEl.innerText = `🔍 步驟 3: 總表載入成功（共 ${allRows.length} 檔）。正在前端篩選 ${sId} ...`;
        
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logEl.innerText = `🟢 驗證成功！個股 [ ${sId} ] 籌碼數據已解析：`;
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "查詢日期": rawDate,
                "資料來源": "臺灣證券交易所",
                "外資買賣超股數": foundRow[4],
                "投信買賣超股數": foundRow[7],
                "自營商買賣超股數": foundRow[10],
                "完整原始Row": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '總表內無此股';
            logEl.innerText = `⚠️ 總表下載成功，但大帳本內找不到個股 ${sId}。`;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線中斷';
        logEl.innerText = `❌ 錯誤：無法透過雲端管線獲取數據。`;
        
        const currentTryUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json`;
        resultEl.innerText = `【除錯提示】\n網頁嘗試讀取的網址：${currentTryUrl}\n\n請確認您的 GitHub 上 json/ 資料夾內是否有產生該檔案。如果沒有，代表 Worker 在連證交所下載時就失敗了（例如當天是未來的日期、尚未開盤）。\n\n詳細錯誤追蹤:\n${err.stack}`;
    }
});
