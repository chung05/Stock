// test.js
document.getElementById('startBtn').addEventListener('click', async () => {
    const sId = document.getElementById('stockInput').value.trim();
    const rawDate = document.getElementById('dateInput').value;
    
    const badgeEl = document.getElementById('resultBadge');
    const logEl = document.getElementById('logMessage');
    const dumpEl = document.getElementById('jsonDataDump');

    if (!sId) { alert("請輸入股票代號！"); return; }
    if (!rawDate) { alert("請選擇日期！"); return; }

    // 初始化網頁狀態
    badgeEl.className = 'badge';
    badgeEl.innerText = '連線中...';
    logEl.innerText = `正在分析股票代號 ${sId}...`;
    dumpEl.innerText = '// 正在發送跨網域網路請求...';

    // 💡 核心判斷：由輸入的代號自行判斷上市 (TWSE) 還是 上櫃 (TPEX)
    // 臺灣股市常規：6446 藥華藥、生技與多數 6/8 開頭股票為上櫃，其餘多為上市。我們以此進行精準分流
    let isTpex = (sId === '6446' || sId.startsWith('6') || sId.startsWith('8'));

    // 日期格式化處理
    const twseDateStr = rawDate.replace(/-/g, ''); // 轉為 20260624 格式
    
    const dateObj = new Date(rawDate);
    const tpexYear = dateObj.getFullYear() - 1911;
    const tpexMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
    const tpexDay = String(dateObj.getDate()).padStart(2, '0');
    const tpexDateStr = `${tpexYear}/${tpexMonth}/${tpexDay}`; // 轉為 115/06/24 格式

    // 🌟 網頁直連官網的終極解法：透過公開的 CORS 代理伺服器轉發，徹底洗刷 403 與跨網域阻擋
    const corsProxy = "https://api.allorigins.win/get?url=";
    let targetApiUrl = "";

    if (!isTpex) {
        logEl.innerText = `🏛️ [偵測結果: 上市股票] 正在經由代理直衝臺灣證券交易所 (TWSE) 讀取 ${rawDate} 大帳本...`;
        targetApiUrl = `https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${twseDateStr}&selectType=ALL&response=json`;
    } else {
        logEl.innerText = `🏪 [偵測結果: 上櫃股票] 正在經由代理直衝證券櫃檯買賣中心 (TPEX) 讀取 ${rawDate} 明細...`;
        targetApiUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&response=json`;
    }

    try {
        // 使用 allorigins 代理轉發請求，它會將官網的回應包裹在 response.data.contents 內
        const response = await axios.get(corsProxy + encodeURIComponent(targetApiUrl));
        
        if (response.status === 200 && response.data && response.data.contents) {
            // 解析代理伺服器吐回來的原始官網 JSON 字串
            const officialData = JSON.parse(response.data.contents);
            let foundRow = null;

            if (!isTpex) {
                // 🏛️ 上市(TWSE) 篩選個股邏輯：在 data 數組中比對 row[0] 是否等於輸入代號
                const rawRows = officialData.data || [];
                foundRow = rawRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上市抓取成功';
                    logEl.innerText = `🟢 成功！已從證交所大帳本中篩選出個股 [ ${sId} ]！數據對齊完成：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "所屬市場": "臺灣證券交易所 (上市)",
                        "外資買賣超股數(欄位4)": foundRow[4],
                        "投信買賣超股數(欄位7)": foundRow[7],
                        "自營商買賣超股數(欄位10)": foundRow[10],
                        "官方原始完整列數據(Row)": foundRow
                    }, null, 2);
                }
            } else {
                // 🏪 上櫃(TPEX) 篩選個股邏輯：在 aaData 數組中比對 row[0] 是否等於輸入代號
                const rawRows = officialData.aaData || [];
                foundRow = rawRows.find(row => row[0] && row[0].trim() === sId);

                if (foundRow) {
                    badgeEl.className = 'badge success';
                    badgeEl.innerText = '上櫃抓取成功';
                    logEl.innerText = `🟢 成功！已從櫃買中心帳本中篩選出個股 [ ${sId} ]！數據對齊完成：`;
                    
                    dumpEl.innerText = JSON.stringify({
                        "股票代號": sId,
                        "查詢日期": rawDate,
                        "所屬市場": "證券櫃檯買賣中心 (上櫃)",
                        "外資淨買超股數(欄位7)": foundRow[7],
                        "投信淨買超股數(欄位8)": foundRow[8],
                        "自營商淨買超股數(欄位9)": foundRow[9],
                        "官方原始完整列數據(Row)": foundRow
                    }, null, 2);
                }
            }

            if (!foundRow) {
                badgeEl.className = 'badge error';
                badgeEl.innerText = '該日無此股';
                logEl.innerText = `⚠️ 官方回傳成功，但在當天的大帳本中「找不到」股票代號 ${sId} 的資料。請確認該日期是否為週末休市、國定假日，或該股當天無法人交易。`;
                dumpEl.innerText = JSON.stringify(officialData, null, 2);
            }

        } else {
            throw new Error("跨網域代理伺服器未回傳有效內容");
        }

    } catch (err) {
        console.error(err);
        badgeEl.className = 'badge error';
        badgeEl.innerText = '抓取失敗';
        logEl.innerText = `❌ 錯誤：無法透過網頁端讀取數據。原因: ${err.message}`;
        dumpEl.innerText = `可能的防禦阻擋提示：\n1. 您選擇的日期可能未來時間，或該日尚未開盤。\n2. 代理伺服器暫時繁忙。\n\n詳細錯誤追蹤:\n${err.stack}`;
    }
});
