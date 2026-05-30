const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// 📈 技術指標計算核心（確保均線、RSI精準度）
// ==========================================
function calculateMA(data, period) {
  let prices = data.map(d => d.price || d.close_price || 0);
  let ma = new Array(prices.length).fill("None");
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += prices[i - j];
    ma[i] = Math.round((sum / period) * 100) / 100;
  }
  return ma;
}

function calculateRSI(data, period = 14) {
  let prices = data.map(d => d.price || d.close_price || 0);
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

// ==========================================
// ⚙️ 主要轉換邏輯：全新直觀明瞭寬表格模式
// ==========================================
async function exportNewWideFormat() {
  console.log("⚙️ 開始進行全新完整版寬表格資料轉換...");
  
  if (!fs.existsSync('./data/raw_data.json')) {
    console.error("❌ 找不到原始檔，請先執行 fetch-data.js");
    return;
  }

  const rawData = JSON.parse(fs.readFileSync('./data/raw_data.json', 'utf8'));

  console.log("📡 正在自 stock_targets 表中取得股票名稱對照...");
  const { data: targetRows, error: targetError } = await supabase
    .from('stock_targets')
    .select('stock_id, stock_name');

  const dbStockNameMap = {};
  if (targetRows) {
    targetRows.forEach(t => { if (t.stock_id) dbStockNameMap[t.stock_id] = t.stock_name; });
  }

  // 1. 先依股票代號分組，以便按時間順序計算 MA、RSI 與漲跌
  const stockGroups = {};
  rawData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    if (!stockGroups[id]) stockGroups[id] = [];
    stockGroups[id].push(row);
  });

  let allFlattenedRows = [];

  // 2. 逐檔股票處理指標
  Object.keys(stockGroups).forEach(stockId => {
    // 確保由舊到新排列，指標才算得準
    let history = stockGroups[stockId].sort((a, b) => new Date(a.date) - new Date(b.date));

    const ma10 = calculateMA(history, 10);
    const ma20 = calculateMA(history, 20);
    const ma60 = calculateMA(history, 60);
    const rsi14 = calculateRSI(history, 14);

    // 3. 把計算好的指標與完整欄位，整合成人類、AI 都能輕鬆看懂的「全新寬版格式」
    history.forEach((row, index) => {
      const stockName = dbStockNameMap[stockId] || row.stock_name || row.name || `股票_${stockId}`;
      const currentPrice = row.price || row.close_price || 0;
      
      // 自動計算法人淨買賣超（若無直接欄位則用買減賣）
      const f_net = row.f_net !== undefined ? row.f_net : ((row.f_buy || 0) - (row.f_sell || 0));
      const it_net = row.it_net !== undefined ? row.it_net : ((row.it_buy || 0) - (row.it_sell || 0));
      // 擴充：自營商淨買賣超
      const d_net = row.d_net !== undefined ? row.d_net : ((row.d_buy || 0) - (row.d_sell || 0)); 
      
      // 自動計算每日漲跌（當天收盤價 - 前一天收盤價）
      let dailyChange = 0;
      if (index > 0) {
        const prevPrice = history[index - 1].price || history[index - 1].close_price || 0;
        dailyChange = Math.round((currentPrice - prevPrice) * 100) / 100;
      } else {
        dailyChange = row.change || 0; // 若沒前一天資料，嘗試取用資料庫內建的變動值
      }

      const wideRow = {
        日期: row.date,
        股票代號: stockId,
        股票名稱: stockName,
        開盤價: row.open_price || row.open || 0,
        最高價: row.high_price || row.high || 0,
        最低價: row.low_price || row.low || 0,
        收盤價: currentPrice,
        漲跌: dailyChange,
        成交量: row.trading_volume || row.volume || 0,
        外資買賣超: f_net,
        投信買賣超: it_net,
        自營商買賣超: d_net,
        三大法人總買賣超: f_net + it_net + d_net,
        MA10均線: ma10[index],
        MA20均線: ma20[index],
        MA60均線: ma60[index],
        RSI14指標: rsi14[index]
      };

      allFlattenedRows.push(wideRow);
    });
  });

  // 4. 依日期降序排序（最新交易日排在最前面，方便觀察）
  allFlattenedRows.sort((a, b) => new Date(b.日期) - new Date(a.日期));

  // 轉為 JSON Lines 輸出
  const jsonlContent = allFlattenedRows.map(obj => JSON.stringify(obj)).join('\n');
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlContent);
  
  console.log(`\n📊 === 全新直觀寬表格轉換完成 ===`);
  console.log(`✅ 已成功還原完整中文欄位名稱（拒絕不直觀的英文縮寫）`);
  console.log(`✅ 成功整合價量資訊：開盤/最高/最低/收盤/漲跌/成交量`);
  console.log(`✅ 成功補齊籌碼特徵：完整三大法人（外資、投信、自營商及總和）`);
  console.log(`✅ 成功載入技術指標：MA10, MA20, MA60, RSI14`);
  console.log(`💾 檔案已寫入: ./data/ai_analysis.jsonl`);
}

exportNewWideFormat();
