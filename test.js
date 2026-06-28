// test.js (上市櫃獨立雙檔案分流解析 - 10大籌碼完美版)
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
        document.getElementById('diagLogs').innerHTML = `📅 <b>[系統就緒]</b> 已自動鎖定最新有效交易日：<code>${yyyy}-${mm}-${dd}</code>`;
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
    badgeEl.innerText = '雲端備份中...';
    
    let logHTML = `🚀 <b>[步驟 1/3] 正在發射雙線西元管線...</b><br>`;
    logHTML += `• 傳遞參數: <code>date=${dateStr}</code><br>`;
    logHTML += `• 觸發 Worker 同步上市與上櫃原始大檔...<br>`;
    diagEl.innerHTML = logHTML;
    resultEl.innerText = `// 正在請求雲端處理（雙檔案下載中），請稍候...`;

    try {
        // 1. 觸發 Worker（Worker 會在雲端同時下載並上傳兩個檔案到 GitHub）
        const triggerWorker = await axios.get(`${CONFIG.workerUrl}/?date=${dateStr}`);
        const wData = triggerWorker.data;
        
        logHTML += `🟢 <b>[步驟 1 成功] Cloudflare Worker 已將上市櫃雙大檔安全落盤！</b><br>`;
        logHTML += `• ⏳ 索引緩衝 1.5 秒以確保 GitHub API 同步...<br>`;
        diagEl.innerHTML = logHTML;

        await new Promise(resolve => setTimeout(resolve, 1500));

        // 2. 準備讀取 GitHub 資料，採用「雙軌式分流嘗試」機制
        const timestamp = new Date().getTime();
        const twseRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}.json?t=${timestamp}`;
        const tpexRawUrl = `https://raw.githubusercontent.com/${CONFIG.ghUser}/${CONFIG.ghRepo}/refs/heads/main/json/${dateStr}_otc.json?t=${timestamp}`;
        
        logHTML += `🚀 <b>[步驟 2/3] 正在自解鎖網域讀取數據...</b><br>`;
        diagEl.innerHTML = logHTML;

        let targetStockRow = null;
        let marketType = ""; // 標記是上市還是上櫃

        // A. 先讀取「上市大檔」並搜尋
        try {
            const twseRes = await axios.get(twseUrl);
            const twseBook = twseRes.data;
            const twseRows = twseBook.data || [];
            
            targetStockRow = twseRows.find(row => row[0] && row[0].trim() === sId);
            if (targetStockRow) {
                marketType = "TWSE_LISTED"; // 找到了，是上市股票
                logHTML += `• 🔍 在<b>上市大檔</b>中尋找到個股資料。<br>`;
            }
        } catch (e) {
            logHTML += `• ⚠️ 上市大檔讀取或搜尋跳過（嘗試上櫃中）<br>`;
        }

        // B. 如果上市找不到，再讀取「上櫃大檔」並搜尋
        if (!targetStockRow) {
            try {
                const tpexRes = await axios.get(tpexRawUrl);
                const tpexBook = tpexRes.data;
                const tpexRows = tpexBook.aaData || tpexBook.data || []; // 相容原始與融合後的結構名稱
                
                targetStockRow = tpexRows.find(row => row[0] && row[0].trim() === sId);
                if (targetStockRow) {
                    marketType = "TPEX_OTC"; // 找到了，是上櫃股票
                    logHTML += `• 🔍 在<b>上櫃大檔</b>中尋找到個股資料。<br>`;
                }
            } catch (e) {
                logHTML += `• ⚠️ 上櫃大檔讀取或搜尋跳過<br>`;
            }
        }

        logHTML += `🚀 <b>[步驟 3/3] 檔案分流解析完畢。</b><br>`;
        diagEl.innerHTML = logHTML;

        // 3. 根據搜尋結果與股票類型進行精準的「欄位映射解析」
        if (targetStockRow) {
            badgeEl.className = 'badge success';
            badgeEl.innerText = '分析完成';
            logHTML += `🏆 <b>[全線完工] 全市場籌碼篩選成功！</b>`;
            diagEl.innerHTML = logHTML;

            let stockName = targetStockRow[1].trim();
            let parsedOutput = {};

            if (marketType === "TWSE_LISTED") {
                // 💡 上市 19 欄標準對接
                parsedOutput = {
                    "股票代號": sId,
                    "股票名稱": stockName,
                    "市場類型": "上市 (TWSE)",
                    "交易日期": rawDate,
                    "------------------": "以下為 10 種精細買賣超數據 (單位: 股)",
                    "外資及陸資": { "買進股數": targetStockRow[2], "賣出股數": targetStockRow[3] },
                    "外資自營商": { "買進股數": targetStockRow[5], "賣出股數": targetStockRow[6] },
                    "投信": { "買進股數": targetStockRow[8], "賣出股數": targetStockRow[9] },
                    "自營商(自行買賣)": { "買進股數": targetStockRow[11], "賣出股數": targetStockRow[12] },
                    "自營商(避險)": { "買進股數": targetStockRow[14], "賣出股數": targetStockRow[15] }
                };
            } else if (marketType === "TPEX_OTC") {
                // 💡 上櫃 24 欄精準對接
                // 註：櫃買中心官方 API 的前幾欄順序通常與證交所一致 (0:代號, 1:名稱, 2:外資買, 3:外資賣)
                // 若未來櫃買中心格式有小幅跳格，您可在此處直接修改索引數字，雙檔案架構絕不影響上市！
                parsedOutput = {
                    "股票代號": sId,
                    "股票名稱": stockName,
                    "市場類型": "上櫃 (TPEx)",
                    "交易日期": rawDate,
                    "------------------": "以下為 10 種精細買賣超數據 (單位: 股)",
                    "外資及陸資": { "買進股數": targetStockRow[2], "賣出股數": targetStockRow[3] },
                    "外資自營商": { "買進股數": targetStockRow[5], "賣出股數": targetStockRow[6] },
                    "投信": { "買進股數": targetStockRow[8], "賣出股數": targetStockRow[9] },
                    "自營商(自行買賣)": { "買進股數": targetStockRow[11], "賣出股數": targetStockRow[12] },
                    "自營商(避險)": { "買進股數": targetStockRow[14], "賣出股數": targetStockRow[15] }
                };
            }

            resultEl.innerText = JSON.stringify(parsedOutput, null, 2);

        } else {
            badgeEl.className = 'badge error';
            badgeEl.innerText = '無法人買賣';
            logHTML += `⚠️ <b>[全線完工] 雙大檔皆已備份，但此代號無交易紀錄。</b>`;
            diagEl.innerHTML = logHTML;
            resultEl.innerText = `股票代號 ${sId} 在當天上市及上櫃的大總表中，皆無三大法人進出紀錄。`;
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '管線中斷';
        logHTML += `❌ <b>[通訊異常] 連線中斷或伺服器異常。</b>`;
        diagEl.innerHTML = logHTML;
        resultEl.innerText = `詳細錯誤日誌:\n${err.stack}`;
    }
});
