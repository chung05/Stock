// test.js
const CONFIG = {
    workerUrl: "https://stock.chiu6-chung05.workers.dev", 
    ghUser: "chung05",  
    ghRepo: "Stock"     
};

function initDatePicker() {
    const yearSelect = document.getElementById('twYear');
    const monthSelect = document.getElementById('twMonth');
    const daySelect = document.getElementById('twDay');

    let targetDate = new Date();
    if (targetDate.getHours() < 17) { 
        targetDate.setDate(targetDate.getDate() - 1); 
    }
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
        targetDate.setDate(targetDate.getDate() - 1);
    }

    const defaultWestYear = targetDate.getFullYear();
    const defaultTwYear = defaultWestYear - 1911;
    const defaultMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
    const defaultDay = String(targetDate.getDate()).padStart(2, '0');

    const currentTwYear = new Date().getFullYear() - 1911;
    for (let y = currentTwYear; y >= 101; y--) {
        let opt = new Option(`民國 ${y} 年 (${y + 1911})`, y);
        if (y === defaultTwYear) opt.selected = true;
        yearSelect.add(opt);
    }
    for (let m = 1; m <= 12; m++) {
        let mStr = String(m).padStart(2, '0');
        let opt = new Option(`${m} 月`, mStr);
        if (mStr === defaultMonth) opt.selected = true;
        monthSelect.add(opt);
    }
    for (let d = 1; d <= 31; d++) {
        let dStr = String(d).padStart(2, '0');
        let opt = new Option(`${d} 日`, dStr);
        if (dStr === defaultDay) opt.selected = true;
        daySelect.add(opt);
    }

    document.getElementById('resultBadge').innerText = '系統就緒';
    document.getElementById('diagLogs').innerHTML = `📅 <b>[初始化成功]</b> 預設台股最後有效交易日：民國 ${defaultTwYear} 年 ${defaultMonth} 月 ${defaultDay} 日`;
}

initDatePicker();

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockId').value.trim();
    const twY = document.getElementById('twYear').value;
    const mm = document.getElementById('twMonth').value;
    const dd = document.getElementById('twDay').value;
    
    const badgeEl = document.getElementById('resultBadge');
    const diagEl = document.getElementById('diagLogs');
    const resultEl = document.getElementById('resultBlock');

    if (!sId) return alert("請輸入股票代號");

    const westYear = parseInt(twY) + 1911;
    const dateStr = `${westYear}${mm}${dd}`; 
    const displayDate = `民國 ${twY}/${mm}/${dd}`;

    badgeEl.className = 'badge';
    badgeEl.innerText = '連線中...';
    
    // 💡 實時更新介面進度
    let logHTML = `🚀 <b>[步驟 1/3] 開始觸發雲端管線...</b><br>`;
    logHTML += `• 前端請求參數: <code>date=${dateStr}</code> (西元 ${westYear} 年)<br>`;
    logHTML += `• 正在呼叫您的 Cloudflare Worker 網址: <a href="${CONFIG.workerUrl}/?date=${dateStr}" target="_blank" style="color:#7fdbff">${CONFIG.workerUrl}/?date=${dateStr}</a><br>`;
    diagEl.innerHTML = logHTML;
    resultEl.innerText = `// 正在等待 Cloudflare Worker 落地儲存，請稍候...`;

    try {
        // 1. 呼叫 Worker
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        const wData = triggerWorker.data;
        
        logHTML += `🟢 <b>[步驟 1 成功] Cloudflare Worker 回應接單！</b><br>`;
        logHTML += `• 雲端運算訊息: <span style="color:#2ecc71">${JSON.stringify(wData)}</span><br>`;
        logHTML += `• ⏳ 啟動防禦性索引緩衝 1.5 秒，確保 GitHub 檔案庫完成落盤...<br>`;
        diagEl.innerHTML = logHTML;

        await new Promise(resolve => setTimeout(resolve, 1500));

        // 2. 準備讀取 GitHub 檔案
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json`;
        logHTML += `🚀 <b>[步驟 2/3] 正在自解鎖網域拉取您專屬的雲端 JSON 總表...</b><br>`;
        logHTML += `• 目標 GitHub 下載路徑: <a href="${githubRawUrl}" target="_blank" style="color:#7fdbff">${githubRawUrl}</a><br>`;
        diagEl.innerHTML = logHTML;

        const ghRes = await axios.get(githubRawUrl);
        const totalBook = ghRes.data;
        
        // 3. 檢查證交所是否噴出 101 年等查無資料警告
        if (totalBook.stat && (totalBook.stat.includes("請重新查詢") || totalBook.stat.includes("查無資料"))) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '官方查無資料';
            logHTML += `❌ <b>[管線中斷] 臺灣證券交易所拒绝了該日期的請求。</b><br>`;
            logHTML += `• 證交所官方公告原因: <span style="color:#e74c3c; font-weight:bold;">${totalBook.stat}</span><br>`;
            diagEl.innerHTML = logHTML;
            resultEl.innerText = `💡 診斷提示：\n1. 民國 2026/06/26 目前尚未開盤（未來時間），請選擇過去已收盤的日期。\n2. 如果是過去的日期，則代表當天為台股休市日（如週六、週日或國定假日）。`;
            return;
        }

        const allRows = totalBook.data || [];
        logHTML += `🚀 <b>[步驟 3/3] 檔案下載解碼完畢！</b><br>`;
        logHTML += `• 總表完整大小: 成功載入共計 ${allRows.length} 檔上市個股的三大法人原始明細數據。<br>`;
        logHTML += `• 正在執行前端記憶體局部過濾，抽離個股 [ ${sId} ] ...<br>`;
        diagEl.innerHTML = logHTML;
        
        // 篩選
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logHTML += `🏆 <b>[全線完工] 成功在 0.001 秒內篩選出個股籌碼！</b>`;
            diagEl.innerHTML = logHTML;
            
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "交易日期": displayDate,
                "外資買賣超股數": foundRow[4],
                "投信買賣超股數": foundRow[7],
                "自營商買賣超股數": foundRow[10],
                "該日期在GitHub上的備份檔名": `${dateStr}.json`,
                "證交所大帳本完整原始Row陣列": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '無法人進出';
            logHTML += `⚠️ <b>[全線完工] 大檔已完整備份，但個股篩選無數據。</b>`;
            diagEl.innerHTML = logHTML;
            resultEl.innerText = `個股代號 [ ${sId} ] 在 ${displayDate} 當天，三大法人（外資、投信、自營商）皆無任何買進或賣出交易，因此官方大帳本內未將其列入。`;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線異常';
        logHTML += `❌ <b>[通訊崩潰] 無法順利完成雲端管線對接。</b><br>`;
        logHTML += `• 偵測到異常資訊: <span style="color:#e74c3c">${err.message}</span><br>`;
        diagEl.innerHTML = logHTML;
        resultEl.innerText = `詳細系統報錯追蹤:\n${err.stack}`;
    }
});
