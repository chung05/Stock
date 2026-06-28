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
    
    let logHTML = `🚀 <b>[步驟 1/3] 開始觸發雲端管線...</b><br>`;
    logHTML += `• 前端原始請求: <code>date=${dateStr}</code> (西元 8 碼標準格式)<br>`;
    logHTML += `• 正在呼叫您的 Cloudflare Worker: <a href="${CONFIG.workerUrl}/?date=${dateStr}" target="_blank" style="color:#7fdbff">${CONFIG.workerUrl}/?date=${dateStr}</a><br>`;
    diagEl.innerHTML = logHTML;
    resultEl.innerText = `// 正在調用 Cloudflare Worker，請稍候...`;

    try {
        // 1. 呼叫 Worker
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        const wData = triggerWorker.data;
        
        logHTML += `🟢 <b>[步驟 1 成功] Cloudflare Worker 已成功向證交所索取資料並落盤！</b><br>`;
        logHTML += `• 🔍 <b>Worker 內部向證交所索取參數對照：</b><br>`;
        logHTML += `&nbsp;&nbsp;&nbsp;&nbsp;- 接收西元 8 碼: <code>${wData.inputDateWest}</code><br>`;
        logHTML += `&nbsp;&nbsp;&nbsp;&nbsp;- 轉為民國 7 碼: <code>${wData.queryDateTw}</code><br>`;
        logHTML += `&nbsp;&nbsp;&nbsp;&nbsp;- 證交所原始請求 URL: <a href="${wData.calledTwseUrl}" target="_blank" style="color:#2ecc71; text-decoration:underline;">點此新視窗檢視證交所原始 JSON</a><br>`;
        logHTML += `• ⏳ 啟動防禦性索引緩衝 1.5 秒，排除快取干擾...<br>`;
        diagEl.innerHTML = logHTML;

        await new Promise(resolve => setTimeout(resolve, 1500));

        // 2. 準備讀取 GitHub 檔案 (加上時間戳防快取殘留)
        const timestamp = new Date().getTime();
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json?t=${timestamp}`;
        logHTML += `🚀 <b>[步驟 2/3] 正在拉取您專屬的雲端 JSON 總表 (已開啟防快取刷新)...</b><br>`;
        diagEl.innerHTML = logHTML;

        const ghRes = await axios.get(githubRawUrl);
        const totalBook = ghRes.data;
        
        // 3. 檢查內容
        if (totalBook.stat && (totalBook.stat.includes("請重新查詢") || totalBook.stat.includes("查無資料"))) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '官方查無資料';
            logHTML += `❌ <b>[管線中斷] 雖然下載成功，但該日期官方回傳空報表。</b><br>`;
            logHTML += `• 證交所原因: <span style="color:#e74c3c; font-weight:bold;">${totalBook.stat}</span><br>`;
            diagEl.innerHTML = logHTML;
            resultEl.innerText = `提示：請確認該日期是否為台股開盤交易日。`;
            return;
        }

        const allRows = totalBook.data || [];
        logHTML += `🚀 <b>[步驟 3/3] 檔案下載解碼完畢！</b><br>`;
        logHTML += `• 總表個股總數: ${allRows.length} 檔。<br>`;
        diagEl.innerHTML = logHTML;
        
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logHTML += `🏆 <b>[全線完工] 個股數據篩選成功！</b>`;
            diagEl.innerHTML = logHTML;
            
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "交易日期": displayDate,
                "外資買賣超股數": foundRow[4],
                "投信買賣超股數": foundRow[7],
                "自營商買賣超股數": foundRow[10],
                "原始資料列": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '無法人進出';
            logHTML += `⚠️ <b>[全線完工] 大檔已備份，但個股無數據。</b>`;
            diagEl.innerHTML = logHTML;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線異常';
        logHTML += `❌ <b>[通訊崩潰] 傳輸中斷。</b><br>`;
        diagEl.innerHTML = logHTML;
        resultEl.innerText = `錯誤追蹤:\n${err.stack}`;
    }
});
