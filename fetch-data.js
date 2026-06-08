const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  let uniqueDates = [], datePage = 0, hasMoreDates = true;
  while (hasMoreDates) {
    const { data: dateRows } = await supabase.from('stock_chips_daily').select('date').order('date', { ascending: false }).range(datePage * 1000, (datePage + 1) * 1000 - 1);
    uniqueDates = [...new Set([...uniqueDates, ...dateRows.map(item => item.date)])];
    if (dateRows.length < 1000 || uniqueDates.length >= 75) hasMoreDates = false;
    else datePage++;
  }
  const cutoffDate = uniqueDates[Math.min(70, uniqueDates.length) - 1];
  let allRawData = [], page = 0, hasMoreData = true;

  while (hasMoreData) {
    const { data } = await supabase
      .from('stock_chips_daily')
      .select('*, macd_dif, macd_signal, macd_osc') 
      .gte('date', cutoffDate)
      .order('date', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (data) allRawData = allRawData.concat(data);
    if (!data || data.length < 1000) hasMoreData = false;
    else page++;
  }
  
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  fs.writeFileSync('./data/raw_data.json', JSON.stringify(allRawData, null, 2));
  console.log("資料已成功匯出至 ./data/raw_data.json");
}
fetchData();
