const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  console.log("📥 [步驟 1] 正在撈取不重複的交易日歷史...");

  let uniqueDates = [];
  let datePage = 0;
  const DATE_PAGE_SIZE = 1000;
  let hasMoreDates = true;

  while (hasMoreDates) {
    const { data: dateRows, error } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .range(datePage * DATE_PAGE_SIZE, (datePage + 1) * DATE_PAGE_SIZE - 1);

    if (error) return console.error("❌ 取得日期失敗:", error);
    uniqueDates = [...new Set([...uniqueDates, ...dateRows.map(item => item.date)])];
    
    if (dateRows.length < DATE_PAGE_SIZE || uniqueDates.length >= 75) {
      hasMoreDates = false;
    } else {
      datePage++;
    }
  }

  uniqueDates.sort((a, b) => new Date(b) - new Date(a));
  if (uniqueDates.length === 0) return console.log("⚠️ 資料庫中沒有任何交易日資料。");

  const latest1Days = uniqueDates.slice(0, 1);
  const latest3Days = uniqueDates.slice(0, 3);
  const latest5Days = uniqueDates.slice(0, 5);
  
  const cutoffDate = uniqueDates[Math.min(70, uniqueDates.length) - 1];

  console.log(`📥 [步驟 2] 分批撈取完整原始資料以利全局排行計算...`);
  let allRawData = [];
  let page = 0;
  let hasMoreData = true;

  while (hasMoreData) {
    const { data, error } = await supabase
      .from('stock_chips_daily')
      // 🔥 關鍵修正：明確要求 API 提供新增的 MACD 三個欄位
      .select('*, macd_dif, macd_signal, macd_osc')
      .gte('date', cutoffDate)
      .order('date', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error) return console.error("❌ 撈取失敗:", error);
    allRawData = allRawData.concat(data);
    if (data.length < 1000) hasMoreData = false;
    else page++;
  }

  console.log(`💡 [步驟 3] 進行多天期（1日/3日/5日）法人買賣超前30名篩選與聯集去重...`);
  
  const stockStats = {};
  allRawData.forEach(row => {
    const id = row.stock_id || row.code || 'unknown';
    const fNet = row.f_net !== undefined ? row.f_net : ((row.f_buy || 0) - (row.f_sell || 0));
    const itNet = row.it_net !== undefined ? row.it_net : ((row.it_buy || 0) - (row.it_sell || 0));
    const totalNet = fNet + itNet;

    if (!stockStats[id]) {
      stockStats[id] = { id, sum1d: 0, sum3d: 0, sum5d: 0 };
    }

    if (latest1Days.includes(row.date)) stockStats[id].sum1d += totalNet;
    if (latest3Days.includes(row.date)) stockStats[id].sum3d += totalNet;
    if (latest5Days.includes(row.date)) stockStats[id].sum5d += totalNet;
  });

  const stockList = Object.values(stockStats);
  const top1d = new Set(stockList.sort((a, b) => b.sum1d - a.sum1d).slice(0, 30).map(s => s.id));
  const top3d = new Set(stockList.sort((a, b) => b.sum3d - a.sum3d).slice(0, 30).map(s => s.id));
  const top5d = new Set(stockList.sort((a, b) => b.sum5d - a.sum5d).slice(0, 30).map(s => s.id));

  const eliteStockIds = new Set([...top1d, ...top3d, ...top5d]);
  console.log(`🎯 篩選完成！全市場經去重後共有 ${eliteStockIds.size} 檔籌碼菁英股進入最終名單。`);

  const eliteStocksWithTags = {};
  eliteStockIds.forEach(id => {
    const tags = [];
    if (top1d.has(id)) tags.push("1D強勢");
    if (top3d.has(id)) tags.push("3D連續佈局");
    if (top5d.has(id)) tags.push("5D波段主力");
    eliteStocksWithTags[id] = tags;
  });

  const filteredRawData = allRawData.filter(row => eliteStockIds.has(row.stock_id || row.code));

  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(filteredRawData, null, 2));
  fs.writeFileSync('./data/elite_tags.json', JSON.stringify(eliteStocksWithTags, null, 2));
  
  console.log(`💾 成功下載並精簡資料至 ./data/raw_data.json。請執行 node export-for-ai.js 進行轉換。`);
}

fetchData();
