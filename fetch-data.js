const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// 📈 技術指標計算核心 (支援歷史數據不足回傳 "None")
// ==========================================

// 1. 計算移動平均線 (MA)
function calculateMA(data, period) {
  let prices = data.map(d => d.price || 0);
  let ma = new Array(prices.length).fill("None");
  
  for (let i = period - 1; i < prices.length; i++) {
    // 雙重檢查：確保前面有足夠的歷史資料可供計算
    if (i - period + 1 < 0) {
      ma[i] = "None";
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - j];
    }
    ma[i] = Math.round((sum / period) * 100) / 100;
  }
  return ma;
}

// 2. 計算 相對強弱指標 (RSI 14)
function calculateRSI(data, period = 14) {
  let prices = data.map(d => d.price || 0);
  let rsi = new Array(prices.length).fill("None");
  
  // 歷史天數連一個週期都不夠時，直接全填 "None"
  if (prices.length <= period) return rsi;

  let gains = 0;
  let losses = 0;

  // 第一個 RSI 的基礎數據起始點
  for (let i = 1; i <= period; i++) {
    let diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;

  // 之後的交易日採用平滑移動平均法
  for (let i = period + 1; i < prices.length; i++) {
    let diff = prices[i] - prices[i - 1];
    let gain = diff > 0 ? diff : 0;
    let loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi[i] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  }
  return rsi;
}

// 3. 計算 MACD (12, 26, 9)
function calculateMACD(data) {
  let prices = data.map(d => d.price || 0);
  let len = prices.length;
  let dif = new Array(len).fill("None");
  let dea = new Array(len).fill("None");
  let macdHistogram = new Array(len).fill("None");

  // MACD 至少需要 26 天的基底來建立長週期 EMA
  if (len < 26) return { dif, dea, hist: macdHistogram };

  let ema12 = prices[0];
  let ema26 = prices[0];

  for (let i = 1; i < len; i++) {
    ema12 = (prices[i] * 2 + ema12 * 11) / 13;
    ema26 = (prices[i] * 2 + ema26 * 25) / 27;
    
    // 超過常規週期後才開始紀錄數值
    if (i >= 11) {
      dif[i] = Math.round((ema12 - ema26) * 100) / 100;
    }
  }

  // 尋找第一個有效的 DIF 開始計算 DEA
  let k = 0;
  while (k < len && dif[k] === "None") k++;
  
  if (k < len && (len - k) >= 9) {
    let currentEmaDif = dif[k];
    dea[k] = currentEmaDif;
    for (let i = k + 1; i < len; i++) {
      currentEmaDif = (dif[i] * 2 + currentEmaDif * 8) / 10;
      dea[i] = Math.round(currentEmaDif * 100) / 100;
      macdHistogram[i] = Math.round((dif[i] - dea[i]) * 2 * 100) / 100;
    }
  }

  return { dif, dea, hist: macdHistogram };
}

// ==========================================
// 📥 主程式
// ==========================================
async function fetchData() {
  console.log("📥 [步驟 1] 正在精準分析資料庫中的不重複交易日歷史...");

  let uniqueDates = [];
  let datePage = 0;
  const DATE_PAGE_SIZE = 1000;
  let hasMoreDates = true;

  while (hasMoreDates) {
    const from = datePage * DATE_PAGE_SIZE;
    const to = from + DATE_PAGE_SIZE - 1;

    const { data: dateRows, error: dateError } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .range(from, to);

    if (dateError) {
      console.error("❌ 無法取得日期清單:", dateError);
      return;
    }

    const currentBatchDates = dateRows.map(item => item.date);
    uniqueDates = [...new Set([...uniqueDates, ...currentBatchDates])];

    // 多預留緩衝天數（改為75天），確保能安全算出 60 天前的 MA60 扣抵值
    if (dateRows.length < DATE_PAGE_SIZE || uniqueDates.length >= 75) {
      hasMoreDates = false;
    } else {
      datePage++;
    }
  }

  uniqueDates.sort((a, b) => new Date(b) - new Date(a));

  if (uniqueDates.length === 0) {
    console.log("⚠️ 資料庫中沒有任何交易日資料。");
    return;
  }

  // 確實取出回推的歷史起點（最大取資料庫上限，通常鎖定在能提供緩衝的計算天數）
  const targetDays = Math.min(70, uniqueDates.length);
  const cutoffDate = uniqueDates[targetDays - 1]; 
  const latestDate = uniqueDates[0];

  console.log(`📅 成功穿透限制！最新交易日: ${latestDate}，歷史擷取邊界日: ${cutoffDate}`);
  console.log(`📥 [步驟 2] 開始分段擷取完整股票籌碼與價量資料（每次 1000 筆）...`);

  let allData = [];
  let page = 0;
  const PAGE_SIZE = 1000; 
  let hasMoreData = true;

  while (hasMoreData) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    console.log(`   正在擷取第 ${from + 1} 至 ${to + 1} 筆原始資料...`);

    const { data, error } = await supabase
      .from('stock_chips_daily')
      .select('*') // 包含 open, max, min, price, change_value, trading_volume 等
      .gte('date', cutoffDate) 
      .order('date', { ascending: false })
      .range(from, to); 

    if (error) {
      console.error("❌ 擷取資料失敗:", error);
      return;
    }

    allData = allData.concat(data);

    if (data.length < PAGE_SIZE) {
      hasMoreData = false;
    } else {
      page++;
    }
  }

  console.log(`⚙️ [步驟 3] 開始進行 AI 特徵工程與技術指標計算 (處理 "None" 機制)...`);

  // 將資料按股票代號進行群組分流
  const stockGroups = {};
  allData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    if (!stockGroups[id]) stockGroups[id] = [];
    stockGroups[id].push(row);
  });

  let finalAIReadyData = [];

  // 對每一檔股票單獨建立時間軸序列並計算指標
  Object.keys(stockGroups).forEach(stockId => {
    // 指標計算必須由「舊到新」排列（1/2 -> 5/25）
    let history = stockGroups[stockId].sort((a, b) => new Date(a.date) - new Date(b.date));

    const ma10 = calculateMA(history, 10);
    const ma20 = calculateMA(history, 20);
    const ma60 = calculateMA(history, 60);
    const rsi14 = calculateRSI(history, 14);
    const macd = calculateMACD(history);

    // 重新封裝成對 AI 高度友好的資料集
    history.forEach((item, index) => {
      const aiRow = {
        資料型態標記: "STOCK_DAILY_REPORT",
        股票代號: stockId,
        股票名稱: item.stock_name || item.name || "未提供",
        交易日期: item.date,
        
        // 價量數據欄位對接
        市場價量_開盤價: item.open || 0,
        市場價量_最高價: item.max || 0,
        市場價量_最低價: item.min || 0,
        市場價量_收盤價: item.price || 0,
        市場價量_當日漲跌金額: item.change_value || 0,
        市場價量_當日成交量_張: item.trading_volume || 0,
        
        // 籌碼數據欄位
        籌碼分佈_外資買賣超張數: item.foreign_net || item.foreign_investor_net || 0,
        籌碼分佈_投信買賣超張數: item.sitc_net || item.investment_trust_net || 0,
        籌碼分佈_自營商買賣超張數: item.dealer_net || 0,
        籌碼分佈_主力買賣超張數: item.major_net || 0,

        // 技術指標欄位 (不足天數自動為 "None")
        技術指標_MA10: ma10[index],
        技術指標_MA20: ma20[index],
        技術指標_MA60: ma60[index],
        技術指標_RSI14: rsi14[index],
        技術指標_MACD_DIF: macd.dif[index],
        技術指標_MACD_DEA: macd.dea[index],
        技術指標_MACD_柱狀圖: macd.hist[index]
      };
      finalAIReadyData.push(aiRow);
    });
  });

  // 篩選機制：只保留最新的 60 個交易日，切掉前端為了算指標而多抓的歷史緩衝
  const finalCutoffDate = uniqueDates[Math.min(60, uniqueDates.length) - 1];
  const filteredData = finalAIReadyData.filter(d => d.交易日期 >= finalCutoffDate);

  // 4. 輸出檔案
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  
  // 標準 JSON
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(filteredData, null, 2));
  
  // 大模型最愛的高檢索率 JSONL 格式 (每行一個股票節點)
  const jsonlLines = filteredData.map(d => JSON.stringify(d)).join('\n');
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlLines);

  // 輸出一個特製的第一列 meta 資訊，作為 AI 的解讀說明書（欄位說明定義）
  const aiDictionary = {
    說明: "本資料集為台灣股市籌碼與技術面特徵融合日報表。每行為單一股票當日完整特徵層。",
    欄位結構定義: {
      STOCK_DAILY_REPORT: "代表標準化個股日報",
      None標記說明: "若技術指標顯示為 'None'，代表該股票自起算日(1/2)至今的歷史交易天數不足以計算該週期指標，非錯誤數據。"
    }
  };
  fs.writeFileSync('./data/ai_dictionary.json', JSON.stringify(aiDictionary, null, 2));

  // 5. 終端報告
  const distinctDatesFetched = [...new Set(filteredData.map(item => item.date))].length;
  const distinctStocks = [...new Set(filteredData.map(item => item.股票代號))];

  console.log(`\n📊 === 升級版擷取報告 ===`);
  console.log(`✅ 完美沿用分頁安全機制，累計產出 AI 訓練級數據: ${filteredData.length} 筆`);
  console.log(`✅ 精準落點交易日天數: ${distinctDatesFetched} 天`);
  console.log(`✅ 涵蓋獨立標的數: ${distinctStocks.length} 檔`);
  console.log(`💾 結構化 JSON 已儲存: ./data/raw_data.json`);
  console.log(`💾 RAG 高效檢索流已儲存: ./data/ai_analysis.jsonl`);
}

fetchData();
