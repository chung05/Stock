// test.js
const CONFIG = {
    // 💡 1. 您的專屬 Cloudflare Worker 網址
    workerUrl: "https://stock.chiu6-chung05.workers.dev", 
    
    // 💡 2. 根據您提供的真實網址，精準校正帳號與倉庫大小寫
    ghUser: "chung05",  // ⬅️ 已修正為 chung05
    ghRepo: "Stock"     // ⬅️ 已修正為大寫 S 的 Stock
};

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockId').value.trim();
    const rawDate = document.getElementById('targetDate').value;
    const badgeEl = document.getElementById('resultBadge');
    const logEl = document.getElementById('logMsg');
    const resultEl = document.getElementById('resultBlock');

    if (!sId || !rawDate) return alert("請輸入完整代號與日期");

    const dateStr = rawDate.replace(/-/g, ''); // 轉為 20250627
    
    badgeEl.className = 'badge';
    badgeEl.innerText = '雲端備份中...';
    logEl.innerText = `🔄 步驟 1: 正在命令 Cloudflare Worker 直連官方下載總表並儲存至 GitHub...`;
    resultEl.innerText = `// 正在請求您的 Cloudflare Worker 管線，請稍候 3~5 秒...`;

    try {
        // 1. 命令 Worker 去抓官方資料並存到 GitHub 檔案庫
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        
        logEl.innerText = `📥 步驟 2: 雲端備份成功！正在從 GitHub 載入全台大總表檔案...`;

        // 💡 3. 【核心網址修正】：完全對齊您手動抓出的 GitHub 最新真實 Raw 網址結構
        const githubRawUrl = `https://github.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/raw/refs/heads/main/json/${dateStr}.json`;
        
        console.log("🛠️ 程式目前正在讀取的真實網址為：", githubRawUrl);
        
        // 2. 發送請求讀取檔案
        const ghRes = await axios.get(githubRawUrl);
        
        const totalBook = ghRes.data;
        const allRows = totalBook.data || [];
        
        logEl.innerText = `🔍 步驟 3: 總表載入成功（共包含 ${allRows.length} 檔個股）。正在前端篩選 ${sId} ...`;
        
        // 3. 在網頁前端記憶體中過濾出單一檔個股
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logEl.innerText = `🟢 驗證成功！已成功從下載的大總表中提取出個股 [ ${sId} ] 的三大法人原始數據：`;
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "查詢日期": rawDate,
                "資料來源": "臺灣證券交易所 (Worker+GitHub 最新網址架構)",
                "外資買賣超股數(欄位4)": foundRow[4],
                "投信買賣超股數(欄位7)": foundRow[7],
                "自營商買賣超股數(欄位10)": foundRow[10],
                "GitHub 總表檔案中該股的完整原始 Row 陣列": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '總表內無資料';
            logEl.innerText = `⚠️ 總表下載成功，但檔案內找不到個股 ${sId}。`;
            resultEl.innerText = `💡 提示：請確認該日期是否為週六日或國定休市。如果當天是交易日，則代表該股三大法人當天進出皆為 0，未被計入總表。`;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線中斷';
        logEl.innerText = `❌ 錯誤：無法透過雲端管線獲取數據。`;
        
        // 再次建立一條動態除錯提示，方便您對比
        const currentTryUrl = `https://github.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/raw/refs/heads/main/json/${dateStr}.json`;
        resultEl.innerText = `【除錯對比資訊】\n您手動測試OK的網址：https://github.com/chung05/Stock/raw/refs/heads/main/json/20250625.json\n程式目前正在戳的網址：${currentTryUrl}\n\n詳細錯誤追蹤:\n${err.stack}`;
    }
});
