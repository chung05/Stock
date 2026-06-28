// test.js (西元對接修正版)
const CONFIG = {
    workerUrl: "https://stock.chiu6-chung05.workers.dev", 
    ghUser: "chung05",  
    ghRepo: "Stock"     
};

// 自動預設為最後一個開盤交易日 (西元格式)
function initDefaultDate() {
    let targetDate = new Date();
    // 💡 防呆：如果現在是下午 5 點前，先看昨天
    if (targetDate.getHours() < 17) targetDate.setDate(targetDate.getDate() - 1);
    
    // 💡 防呆：遇週六或週日，自動退回週五
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
        targetDate.setDate(targetDate.getDate() - 1);
    }
    
    // 格式化為 YYYY-MM-DD
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    
    const dateInput = document.getElementById('targetDate');
    if (dateInput) {
        dateInput.value = `${yyyy}-${mm}-${dd}`;
        document.getElementById('resultBadge').innerText = '系統就緒';
        document.getElementById('resultBadge').className = 'badge success';
        document.getElementById('diagLogs').innerHTML = `📅 <b>[系統就緒]</b> 已自動為您鎖定台股最新有效交易日：<code>${yyyy}-${mm}-${dd}</code>`;
    }
}

// 確保網頁所有標籤都好了再執行初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDefaultDate);
} else {
    initDefaultDate();
}

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockId').value.trim();
    const rawDate = document.getElementById('targetDate').value; // 抓到 "2026-06-26"
    
    const badgeEl = document.getElementById('resultBadge');
    const diagEl = document.getElementById('diagLogs');
    const resultEl = document.getElementById('resultBlock');

    if (!sId || !rawDate) return alert("請輸入完整股票代號與日期");

    // 清洗格式：把 2026-06-26 變成純 8 碼西元 "20260626"
    const dateStr = rawDate.replace(/-/g, ''); 

    badgeEl.className = 'badge';
    badgeEl.innerText = '雲端同步中...';
    
    let logHTML = `🚀 <b>[步驟 1/3] 正在發射西元管線...</b><br>`;
    logHTML += `• 傳遞西元參數: <code>date=${dateStr}</code><br>`;
    logHTML += `• 呼叫 Worker 網址: <a href="${CONFIG.workerUrl}/?date=${dateStr}" target="_blank" style="color:#7fdbff">${CONFIG.workerUrl}/?date=${dateStr}</a><br>`;
    diagEl.innerHTML = logHTML;
    resultEl.innerText = `// 正在請求雲端處理，請稍候...`;

    try {
        // 1. 觸發 Worker
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        const wData = triggerWorker.data;
        
        logHTML += `🟢 <b>[步驟 1 成功] Cloudflare Worker 已將證交所大檔存入 GitHub！</b><br>`;
        logHTML += `• 原始證交所西元請求網址: <a href="${wData.calledTwseUrl}" target="_blank" style="color:#2ecc71; text-decoration:underline;">點此開啟官方 JSON 連結</a><br>`;
        logHTML += `• ⏳ 索引緩衝 1.5 秒中...<br>`;
        diagEl.innerHTML = logHTML;

        await new Promise(resolve => setTimeout(resolve, 1500));

        // 2. 拉取 GitHub 檔案
        const timestamp = new Date().getTime();
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json?t=${timestamp}`;
        
        logHTML += `🚀 <b>[步驟 2/3] 正在自解鎖網域拉取專屬西元大檔...</b><br>`;
        logHTML += `• 雲端路徑: <a href="${githubRawUrl}" target="_blank" style="color:#7fdbff">${githubRawUrl}</a><br>`;
        diagEl.innerHTML = logHTML;

        const ghRes = await axios.get(githubRawUrl);
        const totalBook = ghRes.data;
        
        // 3. 檢查證交所報表狀態
        if (totalBook.stat && (totalBook.stat.includes("請重新查詢") || totalBook.stat.includes("查無資料"))) {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '官方無交易資料';
            logHTML += `❌ <b>[管線中斷] 證交所判定該日期無資料。</b><br>`;
            logHTML += `• 官方回報原因: <span style="color:#e74c3c">${totalBook.stat}</span><br>`;
            diagEl.innerHTML = logHTML;
            resultEl.innerText = `💡 提示：請確認選擇的西元日期是否為週末或台股國定休市日。`;
            return;
        }

        const allRows = totalBook.data || [];
        logHTML += `🚀 <b>[步驟 3/3] 檔案解析完畢，共計 ${allRows.length} 檔個股。</b><br>`;
        diagEl.innerHTML = logHTML;
        
        const foundRow = allRows.find(row => row[0] && row[0].trim() === sId);

        if (foundRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logHTML += `🏆 <b>[全線完工] 籌碼篩選成功！</b>`;
            diagEl.innerHTML = logHTML;
            
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "交易日期(西元)": rawDate,
                "外資買賣超股數": foundRow[4],
                "投信買賣超股數": foundRow[7],
                "自營商買賣超股數": foundRow[10],
                "GitHub 備份檔名": `${dateStr}.json`,
                "證交所完整原始資料列": foundRow
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '無法人買賣';
            logHTML += `⚠️ <b>[全線完工] 大檔已備份，但個股無交易紀錄。</b>`;
            diagEl.innerHTML = logHTML;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線中斷';
        logHTML += `❌ <b>[通訊異常] 連線中斷。</b>`;
        diagEl.innerHTML = logHTML;
        resultEl.innerText = `詳細錯誤日誌:\n${err.stack}`;
    }
});
