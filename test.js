// test.js (10大籌碼細緻過濾版)
const CONFIG = {
    workerUrl: "https://stock.chiu6-chung05.workers.dev", 
    ghUser: "chung05",  
    ghRepo: "Stock"     
};

// 自動預設為最後一個開盤交易日 (西元格式)
function initDefaultDate() {
    let targetDate = new Date();
    if (targetDate.getHours() < 17) targetDate.setDate(targetDate.getDate() - 1);
    
    while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
        targetDate.setDate(targetDate.getDate() - 1);
    }
    
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDefaultDate);
} else {
    initDefaultDate();
}

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockId').value.trim();
    const rawDate = document.getElementById('targetDate').value; 
    
    const badgeEl = document.getElementById('resultBadge');
    const diagEl = document.getElementById('diagLogs');
    const resultEl = document.getElementById('resultBlock');

    if (!sId || !rawDate) return alert("請輸入完整股票代號與日期");

    const dateStr = rawDate.replace(/-/g, ''); 

    badgeEl.className = 'badge';
    badgeEl.innerText = '雲端同步中...';
    
    let logHTML = `🚀 <b>[步驟 1/3] 正在發射西元管線...</b><br>`;
    logHTML += `• 傳遞西元參數: <code>date=${dateStr}</code><br>`;
    logHTML += `• 呼叫 Worker 網址: <a href="${CONFIG.workerUrl}/?date=${dateStr}" target="_blank" style="color:#7fdbff">${CONFIG.workerUrl}/?date=${dateStr}</a><br>`;
    diagEl.innerHTML = logHTML;
    resultEl.innerText = `// 正在請求雲端處理，請稍候...`;

    try {
        // 1. 觸發 Worker 下載與落盤
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        const wData = triggerWorker.data;
        
        logHTML += `🟢 <b>[步驟 1 成功] Cloudflare Worker 已成功取得證交所原始西元大檔！</b><br>`;
        logHTML += `• ⏳ 索引緩衝 1.5 秒中...<br>`;
        diagEl.innerHTML = logHTML;

        await new Promise(resolve => setTimeout(resolve, 1500));

        // 2. 拉取 GitHub 檔案
        const timestamp = new Date().getTime();
        const githubRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json?t=${timestamp}`;
        
        logHTML += `🚀 <b>[步驟 2/3] 正在自解鎖網域拉取專屬西元大檔...</b><br>`;
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
            logHTML += `🏆 <b>[全線完工] 10大細項籌碼篩選成功！</b>`;
            diagEl.innerHTML = logHTML;
            
            // 💡 這裡精準對接 5 大機構的【買進】與【賣出】各欄位
            resultEl.innerText = JSON.stringify({
                "股票代號": sId,
                "股票名稱": foundRow[1].trim(),
                "交易日期": rawDate,
                "------------------": "以下為您要求的 10 種精細買賣超數據",
                "外資及陸資": {
                    "買進股數": foundRow[2],
                    "賣出股數": foundRow[3]
                },
                "外資自營商": {
                    "買進股數": foundRow[5],
                    "賣出股數": foundRow[6]
                },
                "投信": {
                    "買進股數": foundRow[8],
                    "賣出股數": foundRow[9]
                },
                "自營商(自行買賣)": {
                    "買進股數": foundRow[11],
                    "賣出股數": foundRow[12]
                },
                "自營商(避險)": {
                    "買進股數": foundRow[14],
                    "賣出股數": foundRow[15]
                }
            }, null, 2);
        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '無法人買賣';
            logHTML += `⚠️ <b>[全線完工] 大檔已備份，但個股無交易紀錄。</b>`;
            diagEl.innerHTML = logHTML;
            resultEl.innerText = `股票代號 ${sId} 在當天沒有任何三大法人進出紀錄。`;
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
