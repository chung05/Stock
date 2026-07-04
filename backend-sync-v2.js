// backend-sync-v2.js
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const finmindToken = process.env.FINMIND_TOKEN;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ 欠缺關鍵環境變數 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，程序被迫中斷。");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
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

async function startHighPerformanceSync() {
  console.log("🚀 啟動【主力成分股 v2 - 雙核心 API 智慧自適應版】同步程序...");
  
  try {
    // 1. 從真理母名單讀取股票並嚴格去重
    const { data: targetsData, error: targetError } = await supabase
      .from('stock_targets')
      .select('stock_id');
          
    if (targetError) throw targetError;
    const rawStockIds = (targetsData || []).map(item => String(item.stock_id).trim()).filter(id => id && id !== 'undefined' && id !== 'null');
    const stockIds = [...new Set(rawStockIds)];
    console.log(`📊 成功獲取核心去重名單總計: ${stockIds.length} 檔。`);

    if (stockIds.length === 0) return;

    // 2. 自動尋找大帳本當前的最晚日期，自適應推導增量時間區間
    const { data: lastRecord, error: dateErr } = await supabase
      .from('stock_chips_daily')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
      
    if (dateErr) console.log("⚠️ 偵測大帳本最大日期異常:", dateErr.message);

    let startDate = new Date('2026-01-02');
    if (lastRecord && lastRecord.length > 0 && lastRecord[0].date) {
      const lastDate = new Date(lastRecord[0].date);
      lastDate.setDate(lastDate.getDate() + 1);
      startDate = lastDate;
    }
    
    // 3. 🛡️ 下午 16:00 盤後防護機制
    const now = new Date();
    const taipeiHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: '2-digit', hour12: false }), 10);
    let endDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    
    if (taipeiHour < 16) {
      console.log("🕒 目前時間未滿台灣下午 16:00，今日盤後籌碼尚未 Ready。安全機制啟動：同步終點限制在【昨天】。");
      endDate.setDate(endDate.getDate() - 1);
    } else {
      console.log("🕒 目前時間已過台灣下午 16:00，今日盤後數據已 Ready。同步終點允許至【今天】。");
    }

    const startDateStr = formatDateToString(startDate);
    const endDateStr = formatDateToString(endDate);
    
    if (startDate > endDate) {
      console.log(`💡 檢查完畢：大帳本已是最新狀態（已同步至 ${formatDateToString(endDate)}）。今日新資料尚未釋出，暫不更新。`);
      return;
    }

    console.log(`📅 大帳本實質增量抓取區間: ${startDateStr} 至 ${endDateStr}`);

    const commonHeaders = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // 4. 逐檔增量同步核心（完全對齊您原本能執行的舊版 API 結構）
    for (let i = 0; i < stockIds.length; i++) {
      const sId = stockIds[i];
      
      if (i > 0 && i % 15 === 0) {
        console.log(`⏳ 已同步 ${i} 檔，保護 API 流量強制休息 10 秒...`);
        await sleep(10000);
      }

      console.log(`[下載籌碼與K線] (${i + 1}/${stockIds.length}) ${sId}`);

      try {
        const dateMap = {};

        // (A) 正確下載三大法人籌碼接口
        const apiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${finmindToken}`;
        const res = await axios.get(apiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (res.data.status === 200 && Array.isArray(res.data.data)) {
          res.data.data.forEach(row => {
            const d = row.date;
            if (!dateMap[d]) {
              dateMap[d] = { 
                stock_id: sId, date: d, price: null, change_value: 0, 
                f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
                open: 0, max: 0, min: 0, trading_volume: 0, updated_at: new Date().toISOString()
              };
            }
            if (row.name === 'Foreign_Investor') { dateMap[d].f_buy = row.buy; dateMap[d].f_sell = row.sell; }
            else if (row.name === 'Foreign_Dealer_Self') { dateMap[d].fd_buy = row.buy; dateMap[d].fd_sell = row.sell; }
            else if (row.name === 'Investment_Trust') { dateMap[d].it_buy = row.buy; dateMap[d].it_sell = row.sell; }
            else if (row.name === 'Dealer_self') { dateMap[d].ds_buy = row.buy; dateMap[d].ds_sell = row.sell; }
            else if (row.name === 'Dealer_Hedging') { dateMap[d].dh_buy = row.buy; dateMap[d].dh_sell = row.sell; }
          });
        }

        // (B) 正確下載每日收盤K線價量接口
        const priceApiUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${sId}&start_date=${startDateStr}&end_date=${endDateStr}&token=${finmindToken}`;
        const priceRes = await axios.get(priceApiUrl, { headers: commonHeaders, timeout: 15000 });
        
        if (priceRes.data.status === 200 && Array.isArray(priceRes.data.data)) {
          priceRes.data.data.forEach(pRow => {
            const d = pRow.date;
            if (!dateMap[d]) {
              dateMap[d] = { 
                stock_id: sId, date: d, price: null, change_value: 0, 
                f_buy: 0, f_sell: 0, fd_buy: 0, fd_sell: 0, it_buy: 0, it_sell: 0, ds_buy: 0, ds_sell: 0, dh_buy: 0, dh_sell: 0,
                open: 0, max: 0, min: 0, trading_volume: 0, updated_at: new Date().toISOString()
              };
            }
            
            dateMap[d].price = pRow.close;
            dateMap[d].open = pRow.open;
            dateMap[d].max = pRow.max;
            dateMap[d].min = pRow.min;
            dateMap[d].trading_volume = pRow.Trading_Volume;
            dateMap[d].change_value = pRow.spread || 0;
          });
        }

        // 聚合完畢後寫入 Supabase 大帳本
        const rowsToUpsert = Object.values(dateMap);
        if (rowsToUpsert.length > 0) {
          const { error: upsertErr } = await supabase.from('stock_chips_daily').upsert(rowsToUpsert, { onConflict: 'stock_id,date' });
          if (upsertErr) throw upsertErr;
        }

      } catch (err) {
        console.error(`❌ 下載 ${sId} 發生異常: ${err.message}`);
      }
      await sleep(200);
    }

    console.log("🟢 雲端大帳本數據天天自動同步全面大成功！");

  } catch (globalError) {
    console.error("💥 同步流程發生未預期嚴重折損:", globalError.message || globalError);
    process.exit(1);
  }
}

startHighPerformanceSync();
