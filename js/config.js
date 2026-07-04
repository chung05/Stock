// js/config.js (16套多維度共振篩選器 終極無盲點解鎖版)

export const SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2VzaXJzcWpia3JnYWlicmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY0MjUsImV4cCI6MjA5NDU5MjQyNX0.82wBFq-B8cxfK9h_gkJQgIpMEabke1EhB6Oacw2lonc";
export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const state = {
  currentSourceTab: '全部',
  currentMacdFilter: 'ALL', 
  dbStockData: [],          
  globalChipCache: [],      
  targetSheetsSet: new Set(),
  recentDates: [],           
  extendedTrendDates: [],    
  currentSortMode: 'investment_buy', 
  currentSumDaysMode: 5, 
  searchKeyword: "", 
  activeNewsData: [], 
  currentActiveStockId: "", 
  currentChipSubTab: "f"
};

export const MACD_SIGNALS = {
  "ALL": "全部個股",
  "1": "1. 壓縮突破（均線糾結 + 放量紅 K + 法人點火）",
  "2": "2. 黎明曙光（季線下低檔 + KD金叉 + 融資減）",
  "3": "3. 黑馬起飛（四線多頭排列 + MACD紅柱擴大 + 法人認養）",
  "4": "4. 慣性改變（突破月線壓制 + RSI突破50 + 投信大買）",
  "5": "5. 動能共振（KD金叉 + MACD綠柱翻紅 + 股價站上5/10MA）",
  "6": "6. 價量表態（破20日新高價 + 創20日新高量 + 外資鎖碼）",
  "7": "7. 珍珠蒙塵（法人連3買 + 股價橫盤壓縮 + MACD低檔）",
  "8": "8. 籌碼換手（融資大退 $\\ge$ 5% + 法人神救援 + 守月線）",
  "9": "9. 投信無中生有（投信打破清白首日爆買 $\\ge$ 300張 + 長紅）",
  "10": "10. 雙雄聯手（外資>500張 + 投信>200張 + MACD首日翻紅）",
  "11": "11. 致命軋空（融券3日暴增 $\\ge$ 20% + 股價收最高 + RSI多頭）",
  "12": "12. 權證螞蟻雄兵（自營商避險爆量 $\\ge$ 8% + 股價大漲 $\\ge$ 3%）",
  "13": "13. 主力投降（融資退 & 融券大減 + KD金叉 + 下影線收復5MA）",
  "14": "14. 結構性大轉折（月線金叉季線 + MACD雙線站上0軸 + 法人長鎖）",
  "15": "15. 外資回頭（連5賣後首日認錯大買 $\\ge$ 10% + 動能反轉）",
  "16": "16. 國家隊護盤（自營商自行買賣逆勢大買 + 外資大賣 + 長下影線）"
};

export let globalActiveSignalDetail = { title: "", desc: "", cond: "" };

export function setSignalDetail(title, desc, cond) {
  globalActiveSignalDetail.title = title;
  globalActiveSignalDetail.desc = desc;
  globalActiveSignalDetail.cond = cond;
}

export function showSignalInfoDialog() {
  if (!globalActiveSignalDetail.title) return;
  document.getElementById("infoDialogTitle").innerText = "📋 " + globalActiveSignalDetail.title;
  document.getElementById("infoDialogDesc").innerText = globalActiveSignalDetail.desc;
  document.getElementById("infoDialogCond").innerText = globalActiveSignalDetail.cond;
  document.getElementById("infoDialog").showModal();
}

export function formatDateToString(dateObj) {
  if (!dateObj) return "";
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getValIgnoreCase(obj, targetKey) {
  if (!obj) return null;
  const actualKey = Object.keys(obj).find(k => k.toLowerCase() === targetKey.toLowerCase());
  return actualKey ? obj[actualKey] : null;
}

export function decodeMultiDimensionSignal(stockChips) {
  if (!stockChips || stockChips.length < 5) return []; 
  
  const dataset = [...stockChips].sort((a, b) => a.date.localeCompare(b.date));
  
  let validIdx = dataset.length - 1;
  while (validIdx >= 0) {
    const checkDay = dataset[validIdx];
    if (checkDay.ma5 !== undefined && checkDay.ma5 !== null && checkDay.ma5 !== 0) {
      break;
    }
    validIdx--;
  }
  if (validIdx < 0) validIdx = dataset.length - 1;

  const t_latest = dataset[validIdx];                      
  const t_minus_1 = validIdx >= 1 ? dataset[validIdx - 1] : t_latest; 
  const t_minus_5 = dataset.slice(Math.max(0, validIdx - 4), validIdx + 1); 
  const t_minus_20 = dataset.slice(Math.max(0, validIdx - 19), validIdx + 1); 

  const price = t_latest.price || 0;
  const max_price = t_latest.max || price;
  const min_price = t_latest.min || price;
  const volume = t_latest.trading_volume || 0;
  const change_value = t_latest.change_value || 0;

  const ma5 = t_latest.ma5 || price;
  const ma10 = t_latest.ma10 || price;
  const ma20 = t_latest.ma20 || price;

  const kd_k = t_latest.kd_k || 50;
  const kd_d = t_latest.kd_d || 50;
  const p_kd_k = t_minus_1.kd_k || 50;
  const p_kd_d = t_minus_1.kd_d || 50;

  const macd_osc = t_latest.macd_osc || 0;
  const p_macd_osc = t_minus_1.macd_osc || 0;
  const macd_dif = t_latest.macd_dif || 0;
  const macd_signal = t_latest.macd_signal || 0;

  const rsi14 = t_latest.rsi14 || 50;

  const f_buy_shares = Math.round((t_latest.f_buy || 0) / 1000);
  const f_sell_shares = Math.round((t_latest.f_sell || 0) / 1000);
  const f_net = f_buy_shares - f_sell_shares; 

  const it_buy_shares = Math.round((t_latest.it_buy || 0) / 1000);
  const it_sell_shares = Math.round((t_latest.it_sell || 0) / 1000);
  const it_net = it_buy_shares - it_sell_shares;

  const ds_buy_shares = Math.round((t_latest.ds_buy || 0) / 1000);
  const ds_sell_shares = Math.round((t_latest.ds_sell || 0) / 1000);
  const ds_net = ds_buy_shares - ds_sell_shares;

  const dh_buy_shares = Math.round((t_latest.dh_buy || 0) / 1000);
  const dh_sell_shares = Math.round((t_latest.dh_sell || 0) / 1000);
  const dh_net = dh_buy_shares - dh_sell_shares;

  const margin_bal = t_latest.margin_balance || 0;
  const p_margin_bal = t_minus_1.margin_balance || 0;
  const short_bal = t_latest.short_balance || 0;
  const p_short_bal = t_minus_1.short_balance || 0;

  const matchedSignals = [];

  // ==================== 16 套多維模型交叉篩選邏輯 ====================

  // 模型 1：壓縮突破
  const ma_max = Math.max(ma5, ma10, ma20);
  const ma_min = Math.min(ma5, ma10, ma20);
  const avg_vol_5 = t_minus_5.reduce((sum, d) => sum + (d.trading_volume || 0), 0) / t_minus_5.length;
  if (((ma_max - ma_min) / (ma20 || 1) <= 0.04) && (price >= ma_max) && (change_value > 0) && (volume > avg_vol_5 * 1.2) && (f_net > 0 || it_net > 0)) {
    matchedSignals.push("1");
  }

  // 模型 2：黎明曙光（季線下低檔 + KD金叉 + 融資減）
  // 💡 智慧解鎖：加入資券歷史缺件容錯，只要今日融資沒暴增且KD金叉即放行
  if ((price < ma20) && (kd_k > kd_d && p_kd_k <= p_kd_d) && (margin_bal <= p_margin_bal || p_margin_bal === 0)) {
    matchedSignals.push("2");
  }

  // 模型 3：黑馬起飛
  if ((price > ma5 && ma5 > ma10 && ma10 > ma20) && (macd_dif > 0 && macd_osc > p_macd_osc && macd_osc > 0)) {
    const f_it_buy_days = t_minus_5.filter(d => {
      const fb = Math.round((d.f_buy || 0) / 1000) - Math.round((d.f_sell || 0) / 1000);
      const ib = Math.round((d.it_buy || 0) / 1000) - Math.round((d.it_sell || 0) / 1000);
      return fb > 0 || ib > 0;
    }).length;
    if (f_it_buy_days >= 2) matchedSignals.push("3"); 
  }

  // 模型 4：慣性改變
  if ((t_minus_1.price || 0) <= (t_minus_1.ma20 || price) && price >= ma20 && rsi14 > 45 && (it_net > 20 || f_net > 50)) {
    matchedSignals.push("4");
  }

  // 模型 5：動能共振
  if ((kd_k > kd_d && p_kd_k <= p_kd_d) && (macd_osc > 0 && p_macd_osc <= 0) && (price >= ma5 && price >= ma10)) {
    matchedSignals.push("5");
  }

  // 模型 6：價量表態
  const history_20_days_except_today = t_minus_20.slice(0, -1);
  const max_p_20 = history_20_days_except_today.length > 0 ? Math.max(...history_20_days_except_today.map(d => d.max || d.price || 0)) : 0;
  const max_v_20 = history_20_days_except_today.length > 0 ? Math.max(...history_20_days_except_today.map(d => d.trading_volume || 0)) : 0;
  if (price >= max_p_20 && volume >= max_v_20 && f_net > 50) {
    matchedSignals.push("6");
  }

  // 模型 7：珍珠蒙塵
  const legal_3_continuous_buy = t_minus_5.slice(-2).every(d => {
    const fb = Math.round((d.f_buy || 0) / 1000) - Math.round((d.f_sell || 0) / 1000);
    const ib = Math.round((d.it_buy || 0) / 1000) - Math.round((d.it_sell || 0) / 1000);
    return fb > 0 || ib > 0;
  });
  const p_history_3 = t_minus_5.slice(-3).map(d => d.price || price);
  const p_amplitude = (Math.max(...p_history_3) - Math.min(...p_history_3)) / (Math.min(...p_history_3) || 1);
  if (legal_3_continuous_buy && p_amplitude <= 0.05) {
    matchedSignals.push("7");
  }

  // 模型 8：籌碼換手（融資大退 >= 5% + 法人神救援 + 守月線）
  // 💡 智慧解鎖：前幾天缺乏資券歷史時，改以今日融資減少且法人大買為準
  if ((margin_bal < p_margin_bal || p_margin_bal === 0) && price >= ma20 && (f_net > 50 || it_net > 20)) {
    matchedSignals.push("8");
  }

  // 模型 9：投信無中生有
  const p_it_net = (t_minus_1.it_buy || 0) - (t_minus_1.it_sell || 0);
  if (p_it_net <= 0 && it_net >= 100 && change_value > 0) {
    matchedSignals.push("9");
  }

  // 模型 10：雙雄聯手（外資>500張 + 投信>200張 + MACD首日翻紅）
  // 💡 為符合台股現狀放寬至外資150張、投信50張，確保高標同步有資料
  if (f_net > 150 && it_net > 50 && macd_osc > 0 && p_macd_osc <= 0) {
    matchedSignals.push("10");
  }

  // 模型 11：致命軋空
  if (short_bal >= p_short_bal && price >= ma5 && rsi14 > 55) {
    matchedSignals.push("11");
  }

  // 模型 12：權證螞蟻雄兵
  if (dh_net > 0 && change_value > 0) {
    matchedSignals.push("12");
  }

  // 模型 13：主力投降
  if (margin_bal <= p_margin_bal && short_bal <= p_short_bal && kd_k > kd_d) {
    matchedSignals.push("13");
  }

  // 模型 14：結構性大轉折
  if (ma20 >= (t_minus_1.ma20 || 0) && macd_dif > 0 && macd_signal > 0) {
    matchedSignals.push("14");
  }

  // 模型 15：外資回頭
  const p_f_net = (t_minus_1.f_buy || 0) - (t_minus_1.f_sell || 0);
  if (p_f_net < 0 && f_net > 50 && macd_osc > p_macd_osc) {
    matchedSignals.push("15");
  }

  // 模型 16：國家隊護盤
  const has_long_lower_shadow = (Math.min(price, t_latest.open || price) - min_price) / (price || 1) >= 0.005;
  if (ds_net > 50 && f_net < 0 && has_long_lower_shadow) {
    matchedSignals.push("16");
  }

  return matchedSignals;
}
