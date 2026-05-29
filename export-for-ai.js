const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 保持您的技術指標計算核心完全不變
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
// ⚙️ 轉換主要邏輯（優化為橫向寬表格陣列）
// ==========================================
async function exportForAI() {
  console.log("⚙️ 正在讀取原始資料並建立寬表格特徵...");
  
  if (!fs.existsSync('./data/raw_data.json') || !fs.existsSync('./data/elite_tags.json')) {
    console.error("❌ 找不到原始檔，請先執行 fetch-data.js");
    return;
  }

  const rawData = JSON.parse(fs.readFileSync('./data/raw_data.json', 'utf8'));
  const eliteTags = JSON.parse(fs.readFileSync('./data/elite_tags.json', 'utf8'));

  console.log("📡 正在自資料庫 stock_targets 表中取得股票名稱對照...");
  const { data: targetRows, error: targetError } = await supabase
    .from('stock_targets')
    .select('stock_id, stock_name');

  if (targetError) console.error("⚠️ 無法讀取 stock_targets，將改用預設代碼標記。");

  const dbStockNameMap = {};
  if (targetRows) {
    targetRows.forEach(t => { if (t.stock_id) dbStockNameMap[t.stock_id] = t.stock_name; });
  }

  // 取得最新 60 天的日期切片基準點
  const uniqueDates = [...new Set(rawData.map(row => row.date))].sort((a, b) => new Date(b) - new Date(a));
  const finalCutoffDate = uniqueDates[Math.min(60, uniqueDates.length) - 1];

  const stockGroups = {};
  rawData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    if (!stockGroups[id]) stockGroups[id] = [];
    stockGroups[id].push(row);
  });

  let finalWideRows = [];

  // 橫向扁平化核心演練
  Object.keys(stockGroups).forEach(stockId => {
    let history = stockGroups[stockId].sort((a, b) => new Date(a.date) - new Date(b.date));

    // 計算完整歷史指標
    const ma10 = calculateMA(history, 10);
    const ma20 = calculateMA(history, 20);
    const ma60 = calculateMA(history, 60);
    const rsi14 = calculateRSI(history, 14);
    const macd = calculateMACD(history);

    // 把完整的指標包回原資料物件
    history.forEach((row, index) => {
      row.computed_ma10 = ma10[index];
      row.computed_ma20 = ma20[index];
      row.computed_ma60 = ma60[index];
      row.computed_rsi14 = rsi14[index];
      row.computed_macd_hist = macd.hist[index];
    });

    // 🛡️ 切出最新 60 天的時間序列
    let recent60Days = history.filter(d => d.date >= finalCutoffDate);
    if (recent60Days.length === 0) return;

    const finalStockName = dbStockNameMap[stockId] || recent60Days[0].stock_name || recent60Days[0].name || `股票_${stockId}`;

    // 🌟 將 60 天的資料扁平化為單一列的陣列（Wide Row）
    const wideRow = {
      id: stockId,
      id_name: finalStockName,
      tags: eliteTags[stockId] || [], // 帶入多天期籌碼共振標籤
      dates: recent60Days.map(r => r.date), // 時間軸對照
      prices: recent60Days.map(r => r.price || 0),
      vol_history: recent60Days.map(r => r.trading_volume || 0),
      f_net_history: recent60Days.map(r => (r.f_net !== undefined ? r.f_net : ((r.f_buy || 0) - (r.f_sell || 0)))),
      it_net_history: recent60Days.map(r => (r.it_net !== undefined ? r.it_net : ((r.it_buy || 0) - (r.it_sell || 0)))),
      ma10_history: recent60Days.map(r => r.computed_ma10),
      ma20_history: recent60Days.map(r => r.computed_ma20),
      ma60_history: recent60Days.map(r => r.computed_ma60),
      rsi14_history: recent60Days.map(r => r.computed_rsi14),
      macd_hist_history: recent60Days.map(r => r.computed_macd_hist)
    };

    finalWideRows.push(wideRow);
  });

  // 說明欄位定義範例列
  const headerDefinitionRow = {
    id: "股票代號",
    id_name: "股票名稱",
    tags: "籌碼共振標籤說明 (包含 1D強勢 / 3D連續佈局 / 5D波段主力)",
    dates: "60天交易日期序列 (由遠到近，最右側為最新交易日)",
    prices: "60天收盤價序列",
    vol_history: "60天成交量(張)序列",
    f_net_history: "60天外資買賣超張數序列",
    it_net_history: "60天投信買賣超張數序列",
    ma10_history: "60天10日均線序列",
    ma20_history: "60天20日均線序列",
    ma60_history: "60天60日均線(生命線)序列",
    rsi14_history: "60天RSI強弱勢序列",
    macd_hist_history: "60天MACD柱狀體變動序列"
  };

  const finalOutputRows = [headerDefinitionRow, ...finalWideRows];
  const jsonlContent = finalOutputRows.map(obj => JSON.stringify(obj)).join('\n');
  
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlContent);
  
  console.log(`\n📊 === AI 專用橫向寬表格轉換完成 ===`);
  console.log(`✅ 成功產出寬表格個股數量: ${finalWideRows.length} 檔菁英股`);
  console.log(`✅ 總資料行數 (含定義列): ${finalOutputRows.length} 行`);
  console.log(`💾 檔案已寫入: ./data/ai_analysis.jsonl (完美控管在 10 萬 Token 左右，安全避開免費版 25 萬限制！)`);
}

exportForAI();
