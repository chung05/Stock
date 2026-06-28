// test.js
const CONFIG = {
    workerUrl: "https://stock.chiu6-chung05.workers.dev", 
    ghUser: "chung05",  
    ghRepo: "Stock"     
};

// 💡 核心功能：動態初始化民國年下拉選單，並預設為最後一個交易日
function initDatePicker() {
    const yearSelect = document.getElementById('twYear');
    const monthSelect = document.getElementById('twMonth');
    const daySelect = document.getElementById('twDay');

    // 1. 計算最後一個有效交易日 (防呆：避開週末，若在下午5點前則抓前一天)
    let targetDate = new Date();
    if (targetDate.getHours() < 17) { 
        targetDate.setDate(targetDate.getDate() - 1); // 下午5點前先看昨天
    }
    // 遇週六退回週五，遇週日退回週五
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
        targetDate.setDate(targetDate.getDate() - 1);
    }

    const defaultWestYear = targetDate.getFullYear();
    const defaultTwYear = defaultWestYear - 1911;
    const defaultMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
    const defaultDay = String(targetDate.getDate()).padStart(2, '0');

    // 2. 生成民國年選單 (從 101 年到今年)
    const currentTwYear = new Date().getFullYear() - 1911;
    for (let y = currentTwYear; y >= 101; y--) {
        let opt = new Option(`民國 ${y} 年 (${y + 1911})`, y);
        if (y === defaultTwYear) opt.selected = true;
        yearSelect.add(opt);
    }

    // 3. 生成月份選单
    for (let m = 1; m <= 12; m++) {
        let mStr = String(m).padStart(2, '0');
        let opt = new Option(`${m} 月`, mStr);
        if (mStr === defaultMonth) opt.selected = true;
        monthSelect.add(opt);
    }

    // 4. 生成日期選單 (1~31)
    for (let d = 1; d <= 31; d++) {
        let dStr = String(d).padStart(2, '0');
        let opt = new Option(`${d} 日`, dStr);
        if (dStr === defaultDay) opt.selected = true;
        daySelect.add(opt);
    }

    document.getElementById('resultBadge').innerText = '等待指令';
    document.getElementById('logMsg').innerText = `📅 系統已自動預設最後有效交易日：民國 ${defaultTwYear} 年 ${defaultMonth} 月 ${defaultDay} 日`;
}

// 執行初始化
initDatePicker();

// 點擊按鈕觸發分析
document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockId').value.trim();
    const twY = document.getElementById('twYear').value;
    const mm = document.getElementById('twMonth').value;
    const dd = document.getElementById('twDay').value;
    
    const badgeEl = document.getElementById('resultBadge');
    const logEl = document.getElementById('logMsg');
    const resultEl = document.getElementById('resultBlock');

    if (!sId) return alert("請輸入股票代號");

    // 💡 統一格式化：轉回 Worker 需要的 8 碼西元字串 (例如民國115 -> 20260626)，確保檔名正常
    const westYear = parseInt(twY) + 1911;
    const dateStr = `${westYear}${mm}${dd}`; 
    const displayDate = `民國 ${twY}/${mm}/${dd}`;

    badgeEl.className = 'badge';
    badgeEl.innerText = '雲端同步中...';
    logEl.innerText = `🔄 步驟 1: 正在命令 Worker 下載官方總表並檢查環境變數...`;

    try {
        // 1. 呼叫 Worker (傳遞標準的 8 碼字串)
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        
        logEl.innerText = `⏳ 雲端寫入成功！正在等待 GitHub 生效...`;
        await new Promise(resolve => setTimeout(resolve, 1500));

        logEl.innerText = `📥 步驟 2: 正在自資料庫抓取 [ ${displayDate} ] 的完整大檔...`;

        // 2. 自 GitHub Raw 載入
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json`;
        const ghRes = await axios.get(githubRawUrl);
        const totalBook = ghRes.data;
        
        // 檢查證交所是否噴出警告
        if (totalBook.stat && totalBook.stat.includes("請重新查詢")) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '官方查詢錯誤';
            logEl.innerText = `❌ 證交所拒絕請求。`;
            resultEl.innerText = `官方回傳訊息：${totalBook.stat}\n💡 原因提示：選定日期可能為台股休市日（週末、端午、過年等國定假日）。`;
            return;
        }

        const allRows = totalBook.data || [];
        logEl.innerText = `🔍 步驟 3: 大檔載入成功（共 ${allRows.length} 檔）。正在過濾個股 ${sId} ...`;
        
        // 3. 前端過濾
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logEl.innerText = `🟢 成功提取 [ ${sId} ] 筹码數據：`;
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "交易日期": displayDate,
                "外資買賣超": foundRow[4],
                "投信買賣超": foundRow[7],
                "自營商買賣超": foundRow[10],
                "原始資料列": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '此股無三大法人進出';
            logEl.innerText = `⚠️ 總表有資料，但個股 [ ${sId} ] 當天無法人買賣。`;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '連線中斷';
        logEl.innerText = `❌ 錯誤：無法從雲端管道獲取數據。`;
        resultEl.innerText = `錯誤詳情:\n${err.stack}`;
    }
});
