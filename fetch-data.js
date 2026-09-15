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
    
    if (dateRows.length < DATE_PAGE_SIZE || uniqueDates.length >= 90) {
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

  console.log(`📥 [步驟 2] 分批撈取完整原始資料（含融資券細項與技術指標）...`);
  let allRawData = [];
  let page = 0;
  let hasMoreData = true;

  while (hasMoreData) {
    const { data, error } = await supabase
      .from('stock_chips_daily')
      // 🔥 關鍵修正：明確列出所有融資券與指標欄位，防止 PostgREST 遺漏序列化
      .select('*, margin_buy, margin_sell, margin_balance, short_buy, short_sell, short_balance, macd_dif, macd_signal, macd_osc, rsv, kd_k, kd_d')
      .gte('date', cutoffDate)
      .order('date', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error) return console.error("❌ 撈取失敗:", error);
    allRawData = allRawData.concat(data);
    if (data.length < 1000) hasMoreData = false;
    else page++;
  }

  console.log(`💡 [步驟 3] 進行多天期（1日/3日/5日）法人買賣超前 50 名篩選與聯集去重...`);
  
  const stockStats = {};
  allRawData.forEach(row => {
    const id = row.stock_id || row.code;
    if (!id) return;

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

  const top1d_buy = stockList.sort((a, b) => b.sum1d - a.sum1d).slice(0, 50).map(s => s.id);
  const top1d_sell = stockList.sort((a, b) => a.sum1d - b.sum1d).slice(0, 50).map(s => s.id);

  const top3d_buy = stockList.sort((a, b) => b.sum3d - a.sum3d).slice(0, 50).map(s => s.id);
  const top3d_sell = stockList.sort((a, b) => a.sum3d - b.sum3d).slice(0, 50).map(s => s.id);

  const top5d_buy = stockList.sort((a, b) => b.sum5d - a.sum5d).slice(0, 50).map(s => s.id);
  const top5d_sell = stockList.sort((a, b) => a.sum5d - b.sum5d).slice(0, 50).map(s => s.id);

  const eliteStockIds = new Set([
    ...top1d_buy, ...top1d_sell,
    ...top3d_buy, ...top3d_sell,
    ...top5d_buy, ...top5d_sell
  ]);

  console.log(`🎯 篩選完成！全市場經去重後共有 ${eliteStockIds.size} 檔籌碼菁英股進入最終名單。`);

  const eliteStocksWithTags = {};
  eliteStockIds.forEach(id => {
    const tags = [];
    if (top1d_buy.includes(id)) tags.push("1D強勢買超");
    if (top1d_sell.includes(id)) tags.push("1D主力拋售");
    if (top3d_buy.includes(id)) tags.push("3D連續佈局");
    if (top3d_sell.includes(id)) tags.push("3D持續調節");
    if (top5d_buy.includes(id)) tags.push("5D波段主力");
    if (top5d_sell.includes(id)) tags.push("5D波段做空");
    eliteStocksWithTags[id] = tags;
  });

  // 🔥 關鍵防禦：篩選資料時，強制為融資券 6 個欄位賦予預設值 (0)，防止 JSON.stringify 拋棄 null/undefined 欄位
  const filteredRawData = allRawData
    .filter(row => {
      const id = row.stock_id || row.code;
      return eliteStockIds.has(id);
    })
    .map(row => {
      return {
        ...row,
        margin_buy: row.margin_buy ?? 0,
        margin_sell: row.margin_sell ?? 0,
        margin_balance: row.margin_balance ?? 0,
        short_buy: row.short_buy ?? 0,
        short_sell: row.short_sell ?? 0,
        short_balance: row.short_balance ?? 0
      };
    });

  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(filteredRawData, null, 2));
  fs.writeFileSync('./data/elite_tags.json', JSON.stringify(eliteStocksWithTags, null, 2));
  
  console.log(`💾 成功下載並精簡資料至 ./data/raw_data.json。請執行 node export-for-ai.js 進行轉換。`);
}

fetchData();
