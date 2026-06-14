const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// 📈 技術指標計算核心（精準計算歷史指標）
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
// ⚙️ 主要轉換邏輯：精細化三大法人多屬性寬表格
// ==========================================
async function exportRichChipsFormat() {
  console.log("⚙️ 開始將 60 天籌碼資料轉換為『超詳細三大法人中文寬表格（含MACD與KD）』...");
  
  if (!fs.existsSync('./data/raw_data.json')) {
    console.error("❌ 找不到原始檔，請先執行 fetch-data.js");
    return;
  }

  const rawData = JSON.parse(fs.readFileSync('./data/raw_data.json', 'utf8'));

  console.log("📡 正在自 stock_targets 表中取得股票中文名稱對照...");
  const { data: targetRows, error: targetError } = await supabase
    .from('stock_targets')
    .select('stock_id, stock_name');

  const dbStockNameMap = {};
  if (targetRows) {
    targetRows.forEach(t => { if (t.stock_id) dbStockNameMap[t.stock_id] = t.stock_name; });
  }

  // 1. 按股票代號進行分組，確保個別股票的時間序列正確
  const stockGroups = {};
  rawData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    if (!stockGroups[id]) stockGroups[id] = [];
    stockGroups[id].push(row);
  });

  let allFlattenedRows = [];

  // 2. 逐一計算每檔股票的技術指標與拆解法人欄位
  Object.keys(stockGroups).forEach(stockId => {
    // 時間由舊到新排序以利計算指標
    let history = stockGroups[stockId].sort((a, b) => new Date(a.date) - new Date(b.date));

    const ma10 = calculateMA(history, 10);
    const ma20 = calculateMA(history, 20);
    const ma60 = calculateMA(history, 60);
    const rsi14 = calculateRSI(history, 14);

    history.forEach((row, index) => {
      const stockName = dbStockNameMap[stockId] || row.stock_name || row.name || `股票_${stockId}`;
      const currentPrice = row.price || row.close_price || 0;
      
      let dailyChange = 0;
      if (index > 0) {
        const prevPrice = history[index - 1].price || history[index - 1].close_price || 0;
        dailyChange = Math.round((currentPrice - prevPrice) * 100) / 100;
      } else {
        dailyChange = row.change || 0;
      }

      // ──【三大法人原始細緻欄位對照與防呆保護】──
      const f_buy = row.f_buy || 0;
      const f_sell = row.f_sell || 0;
      const f_net = row.f_net !== undefined ? row.f_net : (f_buy - f_sell);
      
      const f_deal_buy = row.f_deal_buy || 0;
      const f_deal_sell = row.f_deal_sell || 0;
      const f_deal_net = row.f_deal_net !== undefined ? row.f_deal_net : (f_deal_buy - f_deal_sell);

      const it_buy = row.it_buy || 0;
      const it_sell = row.it_sell || 0;
      const it_net = row.it_net !== undefined ? row.it_net : (it_buy - it_sell);

      const d_prop_buy = row.d_prop_buy || row.d_own_buy || 0;
      const d_prop_sell = row.d_prop_sell || row.d_own_sell || 0;
      const d_prop_net = row.d_prop_net !== undefined ? row.d_prop_net : (d_prop_buy - d_prop_sell);

      const d_hedge_buy = row.d_hedge_buy || 0;
      const d_hedge_sell = row.d_hedge_sell || 0;
      const d_hedge_net = row.d_hedge_net !== undefined ? row.d_hedge_net : (d_hedge_buy - d_hedge_sell);

      const d_buy = d_prop_buy + d_hedge_buy;
      const d_sell = d_prop_sell + d_hedge_sell;
      const d_net = row.d_net !== undefined ? row.d_net : (d_buy - d_sell);

      const total_net = f_net + it_net + d_net;

      // ──【MACD 直接對接讀取】──
      const macd_dif = row.macd_dif !== undefined ? row.macd_dif : "None";
      const macd_signal = row.macd_signal !== undefined ? row.macd_signal : "None";
      const macd_osc = row.macd_osc !== undefined ? row.macd_osc : "None";

      // ──【🔥 新增 KD 直接對接讀取】──
      const rsv = row.rsv !== undefined ? row.rsv : "None";
      const kd_k = row.kd_k !== undefined ? row.kd_k : "None";
      const kd_d = row.kd_d !== undefined ? row.kd_d : "None";

      // 建立全新寬表格資料行物件
      const wideRow = {
        "日期": row.date,
        "股票代號": stockId,
        "股票名稱": stockName,
        "開盤價": row.open_price || row.open || 0,
        "最高價": row.high_price || row.high || 0,
        "最低價": row.low_price || row.low || 0,
        "收盤價": currentPrice,
        "漲跌": dailyChange,
        "成交量": row.trading_volume || row.volume || 0,
        
        // ── 外資細項 ──
        "外資買進張數": f_buy,
        "外資賣出張數": f_sell,
        "外資買賣超": f_net,
        "外資自營商買進": f_deal_buy,
        "外資自營商賣出": f_deal_sell,
        "外資自營商買賣超": f_deal_net,
        
        // ── 投信細項 ──
        "投信買進張數": it_buy,
        "投信賣出張數": it_sell,
        "投信買賣超": it_net,
        
        // ── 自營商細項 ──
        "自營商自行買進": d_prop_buy,
        "自營商自行賣出": d_prop_sell,
        "自營商自行買賣超": d_prop_net,
        "自營商避險買進": d_hedge_buy,
        "自營商避險賣出": d_hedge_sell,
        "自營商避險買賣超": d_hedge_net,
        "自營商總買買超": d_net,
        
        // ── 法人加總 ──
        "三大法人總買賣超": total_net,
        
        // ── 技術指標 ──
        "MA10均線": ma10[index],
        "MA20均線": ma20[index],
        "MA60均線": ma60[index],
        "RSI14指標": rsi14[index],
        
        // ── MACD 指標細項 ──
        "MACD_DIF快線": macd_dif,
        "MACD_Signal慢線": macd_signal,
        "MACD_OSC動能柱": macd_osc,

        // ── 🔥 新增 KD 指標細項 ──
        "KD_RSV值": rsv,
        "KD_K值": kd_k,
        "KD_D值": kd_d
      };

      allFlattenedRows.push(wideRow);
    });
  });

  // 3. 按日期最新到最舊排序
  allFlattenedRows.sort((a, b) => new Date(b.日期) - new Date(a.日期));

  // 4. 寫入為 JSON Lines 格式
  const jsonlContent = allFlattenedRows.map(obj => JSON.stringify(obj)).join('\n');
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlContent);
  
  console.log(`\n📊 === 頂級精細化中文寬表格轉換完成 ===`);
  console.log(`✅ 已補全技術指標：MA10, MA20, MA60, RSI14`);
  console.log(`✅ 已包含對接雲端 MACD 欄位：DIF快線、Signal慢線、OSC動能柱`);
  console.log(`✅ 🔥 新增對接雲端 KD 欄位：RSV值、K值、D值`);
  console.log(`💾 檔案已寫入: ./data/ai_analysis.jsonl`);
}

exportRichChipsFormat();
