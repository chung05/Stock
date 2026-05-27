const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 建立 Supabase 連線（用來查詢 stock_targets 對照表）
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// 📈 技術指標計算核心 (嚴格維持原有機制，完全不變)
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
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
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
  let dif = new Array(len).fill("None"), dea = new Array(len).fill("None"), hist = new Array(len).fill("None");
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
// ⚙️ 轉換主要邏輯
// ==========================================
async function exportForAI() {
  console.log("⚙️ 正在讀取原始資料並透過 stock_targets 建立名稱對照...");
  
  if (!fs.existsSync('./data/raw_data.json')) {
    console.error("❌ 找不到原始檔，請先執行 fetch-data.js");
    return;
  }

  // 1. 讀取本機下載好的原始籌碼價量資料
  const rawData = JSON.parse(fs.readFileSync('./data/raw_data.json', 'utf8'));

  // 2. 🛡️ 核心新增：向 stock_targets 獲取不重複的股票名稱對照表
  console.log("📡 正在自資料庫 stock_targets 表中取得股票名稱對照...");
  const { data: targetRows, error: targetError } = await supabase
    .from('stock_targets')
    .select('stock_id, stock_name'); // 📌 請確保您這張表的欄位名稱是 stock_id 與 stock_name (若非此名稱可微調)

  if (targetError) {
    console.error("⚠️ 無法讀取 stock_targets，將改用預設代碼標記。錯誤:", targetError);
  }

  // 將對照表轉為 key-value 快取物件，方便後面秒查
  const dbStockNameMap = {};
  if (targetRows) {
    targetRows.forEach(t => {
      if (t.stock_id) {
        dbStockNameMap[t.stock_id] = t.stock_name;
      }
    });
  }

  // 3. 按股票代號群組資料
  const stockGroups = {};
  rawData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    if (!stockGroups[id]) stockGroups[id] = [];
    stockGroups[id].push(row);
  });

  let dataRows = [];

  // 4. 計算指標並產生精簡的英文 Key 資料 (完全沿用原邏輯流程)
  Object.keys(stockGroups).forEach(stockId => {
    // 排序由舊到新以利指標計算
    let history = stockGroups[stockId].sort((a, b) => new Date(a.date) - new Date(b.date));

    const ma10 = calculateMA(history, 10);
    const ma20 = calculateMA(history, 20);
    const ma60 = calculateMA(history, 60);
    const rsi14 = calculateRSI(history, 14);
    const macd = calculateMACD(history);

    history.forEach((row, index) => {
      const currentFNet = row.f_net !== undefined ? row.f_net : ((row.f_buy || 0) - (row.f_sell || 0));
      const currentITNet = row.it_net !== undefined ? row.it_net : ((row.it_buy || 0) - (row.it_sell || 0));
      
      // 🌟 核心修正點：名稱優先從 stock_targets 的對照物件中取得
      const finalStockName = dbStockNameMap[stockId] || row.stock_name || row.name || `股票_${stockId}`;

      const aiRow = {
        d: row.date,
        id: stockId,
        id_name: finalStockName,
        open: row.open || 0,
        max: row.max || 0,
        min: row.min || 0,
        price: row.price || 0,
        change: row.change_value || 0,
        vol: row.trading_volume || 0,
        f_net: currentFNet,
        it_net: currentITNet,
        d_net: row.dealer_net || 0,
        m_net: row.major_net || 0,
        ma10: ma10[index],
        ma20: ma20[index],
        ma60: ma60[index],
        rsi14: rsi14[index],
        macd_dif: macd.dif[index],
        macd_dea: macd.dea[index],
        macd_hist: macd.hist[index]
      };
      dataRows.push(aiRow);
    });
  });

  // 5. 過濾出最新 60 天 (維持原有時間切片機制)
  const uniqueDates = [...new Set(rawData.map(row => row.date))].sort((a, b) => new Date(b) - new Date(a));
  const finalCutoffDate = uniqueDates[Math.min(60, uniqueDates.length) - 1];
  const filteredData = dataRows.filter(d => d.d >= finalCutoffDate);

  // 6. 建立「第一行：欄位標題定義範例列」
  const headerDefinitionRow = {
    d: "交易日期 (格式: YYYY-MM-DD)",
    id: "股票代號",
    id_name: "股票名稱",
    open: "當日開盤價",
    max: "當日最高價",
    min: "當日最低價",
    price: "當日收盤價",
    change: "當日漲跌金額",
    vol: "當日成交量 (張)",
    f_net: "外資買賣超張數",
    it_net: "投信買賣超張數",
    d_net: "自營商買賣超張數",
    m_net: "主力買賣超張數",
    ma10: "技術指標: 10日移動平均線 (若歷史天數不足顯示 None)",
    ma20: "技術指標: 20日移動平均線 (若歷史天數不足顯示 None)",
    ma60: "技術指標: 60日移動平均線 (若歷史天數不足顯示 None)",
    rsi14: "技術指標: 14日相對強弱指標 (範圍0-100, 超過70超買, 低於30超賣)",
    macd_dif: "技術指標: MACD 快線 DIF",
    macd_dea: "技術指標: MACD 慢線 DEA",
    macd_hist: "技術指標: MACD 柱狀圖 (DIF - DEA) * 2"
  };

  // 7. 組裝為 JSONL 格式並寫入檔案
  const finalOutputRows = [headerDefinitionRow, ...filteredData];
  const jsonlContent = finalOutputRows.map(obj => JSON.stringify(obj)).join('\n');
  
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlContent);
  
  console.log(`\n📊 === AI 專用極簡格式轉換完成 ===`);
  console.log(`✅ 已成功串接 stock_targets 動態查找股票名稱。`);
  console.log(`✅ 成功插入首行中文對照說明欄位`);
  console.log(`✅ 實體資料筆數: ${filteredData.length} 筆`);
  console.log(`💾 已成功寫入: ./data/ai_analysis.jsonl`);
}

exportForAI();
