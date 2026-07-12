// backend-sync-part1-price-chip.js
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const FINMIND_TOKEN = process.env.FINMIND_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { global: false, isRealtimeEnabled: false }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatDateToString(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function run() {
  try {
    console.log("🚀 [第一階段] 啟動【231檔全量主力股 - 價量與三大法人籌碼】同步程序...");

    console.log("📥 正在從雲端 stock_targets 表載入核心主力成分股名單...");
    const { data: targetsData, error: targetError } = await supabase.from('stock_targets').select('stock_id');
    if (targetError) throw targetError;
    
    const rawStockIds = (targetsData || []).map(item => String(item.stock_id).trim()).filter(id => id && id !== 'undefined' && id !== 'null');
    const stockIds = [...new Set(rawStockIds)];
    console.log(`📊 成功獲取核心去重名單總計: ${stockIds.length} 檔。`);
    if (stockIds.length === 0) return;

    // 自動尋找大帳本當前的最晚日期，自適應推導增量時間區間
    const { data: lastRecord, error: dateErr } = await supabase.from('stock_chips_daily').select('date').order('date', { ascending: false }).limit(1);
    let startDate = new Date('2026-01-02');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      const lastDate = new Date(lastRecord[0].date);
      lastDate.setDate(lastDate.getDate() + 1);
      startDate = lastDate;
    }
    
    const now = new Date();
    const taipeiHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: '2-digit', hour12: false }), 10);
    let endDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    if (taipeiHour < 16) {
      console.log("🕒 未滿 16:00，同步終點限制在【昨天】。");
      endDate.setDate(endDate.getDate() - 1);
    }

    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(endDate);
    if (startDate > endDate) {
      console.log(`💡 大帳本已是最新狀態（至 ${formatDateToString(endDate)}），暫不更新。`);
      return;
    }

    console.log(`📅 增量抓取區間: ${startDateStr} 至 ${endDateStr}`);
    const commonHeaders = { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

    for (let i = 0; i < stockIds.length; i++) {
      const sId = stockIds[i];
      // 頻率控制：每 15 檔休息 10 秒，完美拉長間距保護限流
      if (i > 0 && i % 15 === 0) {
        console.log(`⏳ 已同步 ${i} 檔，強制休息 10 秒...`);
        await sleep(10000);
      }

      console.log(`[第一階段：下載籌碼與價量] (${i + 1}/${stockIds.length}) 標的: ${sId}`);

      try {
        const dateMap = {};

        // (A) 下載三大法人籌碼 (API 呼叫 1)
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const res = await axios.get(apiUrl, { headers: commonHeaders, timeout: 15000 });
        if (res.data.status === 200 && Array.isArray(res.data.data)) {
          res.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              dateMap[d] = { stock_id: sId, date: d, price: null, change_value: 0, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0, open:0, max:0, min:0, trading_volume:0 };
            }
            if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
            else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
            else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
            else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
            else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
          });
        }

        // (B) 下載收盤K線價量 (API 呼叫 2)
        const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${FINMIND_TOKEN}`;
        const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders, timeout: 15000 });
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
          priceRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) {
              dateMap[d] = { stock_id: sId, date: d, price: null, change_value: 0, f_buy:0, f_sell:0, fd_buy:0, fd_sell:0, it_buy:0, it_sell:0, ds_buy:0, ds_sell:0, dh_buy:0, dh_sell:0, open:0, max:0, min:0, trading_volume:0 };
            }
            dateMap[d].price = pRow.close; dateMap[d].open = pRow.open; dateMap[d].max = pRow.max; dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume; dateMap[d].change_value = pRow.spread || 0;
          });
        }

        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert, { onConflict: 'stock_id,date' });
          if (upsertErr) throw upsertErr;
        }
      } catch (err) {
        console.error(`❌ 下載 ${sId} 發生異常: ${err.message}`);
      }
      await sleep(120);
    }
    console.log("🟢 [第一階段完成] 籌碼與價量數據已全數安全入庫。");
  } catch (error) {
    console.error("💥 第一階段發生嚴重錯誤:", error.message);
  }
}
run();
