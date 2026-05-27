const fs = require('fs');

// ==========================================
// 📈 技術指標計算核心 (不足天數自動標記為 "None")
// ==========================================

function calculateMA(data, period) {
  let prices = data.map(d => d.price || 0);
  let ma = new Array(prices.length).fill("None");
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += prices[i - j];
    ma[i] = Math.round((sum / period) * 100) / 100;
  }
  return ma;
}

function calculateRSI(data, period = 14) {
  let prices = data.map(d => d.price || 0);
  let rsi = new Array(prices.length).fill("None");
  if (prices.length <= period) return rsi;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    let diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;

  for (let i = period + 1; i < prices.length; i++) {
    let diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  }
  return rsi;
}

function calculateMACD(data) {
  let prices = data.map(d => d.price || 0);
  let len = prices.length;
  let dif = new Array(len).fill("None");
  let dea = new Array(len).fill("None");
  let hist = new Array(len).fill("None");

  if (len < 26) return { dif, dea, hist };

  let ema12 = prices[0], ema26 = prices[0];
  for (let i = 1; i < len; i++) {
    ema12 = (prices[i] * 2 + ema12 * 11) / 13;
    ema26 = (prices[i] * 2 + ema26 * 25) / 27;
    if (i >= 11) dif[i] = Math.round((ema12 - ema26) * 100) / 100;
  }

  let k = 0;
  while (k < len && dif[k] === "None") k++;
  if (k < len && (len - k) >= 9) {
    let currentEmaDif = dif[k];
    dea[k] = currentEmaDif;
    for (let i = k + 1; i < len; i++) {
      currentEmaDif = (dif[i] * 2 + currentEmaDif * 8) / 10;
      dea[i] = Math.round(currentEmaDif * 100) / 100;
      hist[i] = Math.round((dif[i] - dea[i]) * 2 * 100) / 100;
    }
  }
  return { dif, dea, hist };
}

// ==========================================
// ⚙️ 轉換主要逻辑
// ==========================================
function exportForAI() {
  console.log("⚙️ 正在讀取原始資料並轉換為 AI 語意化專用格式...");
  
  if (!fs.existsSync('./data/raw_data.json')) {
    console.error("❌ 找不到 ./data/raw_data.json，請先執行 fetch-data.js");
    return;
  }

  const rawData = JSON.parse(fs.readFileSync('./data/raw_data.json', 'utf8'));

  // 1. 按股票代號將數據群組分流
  const stockGroups = {};
  rawData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    if (!stockGroups[id]) stockGroups[id] = [];
    stockGroups[id].push(row);
  });

  let finalAIReadyData = [];

  // 2. 對每檔股票獨立計算技術指標
  Object.keys(stockGroups).forEach(stockId => {
    // 排序由舊到新以利指標計算
    let history = stockGroups[stockId].sort((a, b) => new Date(a.date) - new Date(b.date));

    const ma10 = calculateMA(history, 10);
    const ma20 = calculateMA(history, 20);
    const ma60 = calculateMA(history, 60);
    const rsi14 = calculateRSI(history, 14);
    const macd = calculateMACD(history);

    // 封裝為 AI 友好的中文自定義格式
    history.forEach((row, index) => {
      // 💡 沿用您原本程式碼中的法人計算邏輯：有 f_net 欄位就用，沒有就用 (buy - sell) 算出來
      const currentFNet = row.f_net !== undefined ? row.f_net : ((row.f_buy || 0) - (row.f_sell || 0));
      const currentITNet = row.it_net !== undefined ? row.it_net : ((row.it_buy || 0) - (row.it_sell || 0));

      const aiRow = {
        資料標記ID: "TAIWAN_STOCK_DAILY_REPORT",
        股票代號: stockId,
        股票名稱: row.stock_name || row.name || "未提供",
        交易日期: row.date,
        
        // 價量欄位對接 (使用您更正後的正確名稱)
        開盤價: row.open || 0,
        最高價: row.max || 0,
        最低價: row.min || 0,
        收盤價: row.price || 0,
        當日漲跌金額: row.change_value || 0,
        當日成交量_張: row.trading_volume || 0,
        
        // 籌碼欄位對接
        外資買賣超張數: currentFNet,
        投信買賣超張數: currentITNet,
        自營商買賣超張數: row.dealer_net || 0,
        主力買賣超張數: row.major_net || 0,

        // 技術指標欄位 (不足則填入 "None")
        指標_MA10: ma10[index],
        指標_MA20: ma20[index],
        指標_MA60: ma60[index],
        指標_RSI14: rsi14[index],
        指標_MACD_DIF: macd.dif[index],
        指標_MACD_DEA: macd.dea[index],
        指標_MACD_柱狀圖: macd.hist[index]
      };
      finalAIReadyData.push(aiRow);
    });
  });

  // 3. 找出最新 60 個交易日，切掉多抓的緩衝天數
  const uniqueDates = [...new Set(rawData.map(row => row.date))].sort((a, b) => new Date(b) - new Date(a));
  const finalCutoffDate = uniqueDates[Math.min(60, uniqueDates.length) - 1];
  
  const filteredData = finalAIReadyData.filter(d => d.交易日期 >= finalCutoffDate);

  // 💡 您可以在這裡設定目標標的，例如只分析 2330 台積電
  // const targetStock = "2330"; 
  // const outputData = filteredData.filter(row => row.股票代號 === targetStock);
  const outputData = filteredData; // 目前預設產出全部

  // 4. 轉為 JSON Lines 格式
  const jsonlLines = outputData.map(obj => JSON.stringify(obj)).join('\n');
  
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlLines);
  
  // 同步輸出第一行說明字典定義，方便丟給 AI 作 Prompt 字典
  const aiDictionary = {
    說明: "本資料為台股 AI 專用轉換格式。欄位皆轉換為中文語意標記。",
    提示: "若技術指標數值為 'None'，代表資料庫自 1/2 起算的天數尚不足以計算該週期（例如剛開年），並非異常值。"
  };
  fs.writeFileSync('./data/ai_dictionary.json', JSON.stringify(aiDictionary, null, 2));

  console.log(`\n📊 === AI 格式轉換完成 ===`);
  console.log(`✅ 轉換總筆數: ${outputData.length} 筆`);
  console.log(`💾 轉換成功！已寫入 AI 專用流檔案: ./data/ai_analysis.jsonl`);
}

exportForAI();
