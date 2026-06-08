const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
  // ... (前面的撈取日期邏輯與原版一致)
  let allRawData = [];
  let page = 0;
  let hasMoreData = true;

  while (hasMoreData) {
    // 🔥 關鍵更新：強制包含 MACD 欄位
    const { data, error } = await supabase
      .from('stock_chips_daily')
      .select('*, macd_dif, macd_signal, macd_osc') 
      .gte('date', cutoffDate)
      .order('date', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error) return console.error("❌ 撈取失敗:", error);
    allRawData = allRawData.concat(data);
    if (data.length < 1000) hasMoreData = false;
    else page++;
  }
  // ... (後續寫檔邏輯與原版一致)
}
fetchData();
