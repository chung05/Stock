// js/config.js (16套多維度共振篩選器終極版)

export const SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2VzaXJzcWpia3JnYWlicmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY0MjUsImV4cCI6MjA5NDU5MjQyNX0.82wBFq-B8cxfK9h_gkJQgIpMEabke1EhB6Oacw2lonc";
export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const state = {
  currentSourceTab: '全部',
  currentMacdFilter: 'ALL', // 綁定網頁 16 套多維型態 Filter
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

// 💡 16 套多維度共振模型對照表 (全域對照)
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

// 🧠 16維度立體解碼晶片：依據「價量 + 動能指標 + 主力籌碼 + 資券結構」進行交叉驗證
export function decodeMultiDimensionSignal(stockChips) {
  if (!stockChips || stockChips.length < 20) return []; 
  
  // 依日期由舊到新排序
  const dataset = [...stockChips].sort((a, b) => a.date.localeCompare(b.date));
  const count = dataset.length;

  // 🟢 頂級修正：將所有數據抓取標的，由原來的混亂 stockChips 一律修正為已排序的 dataset！
  const t_latest = dataset[count - 1];   // 今日 (T)
  const t_minus_1 = dataset[count - 2];  // 昨日 (T-1)
  const t_minus_5 = dataset.slice(-5);   // 近5日
  const t_minus_10 = dataset.slice(-10); // 近10日
  const t_minus_20 = dataset.slice(-20); // 近20日

  // 1. 基礎指標提取
  const price = t_latest.price || 0;
  const max_price = t_latest.max || price;
  const min_price = t_latest.min || price;
  const volume = t_latest.trading_volume || 0;
  const change_value = t_latest.change_value || 0;

  const ma5 = t_latest.ma5 || price;
  const ma10 = t_latest.ma10 || price;
  const ma20 = t_latest.ma20 || price;
  const ma60 = t_latest.ma60 || price;

  const kd_k = t_latest.kd_k || 50;
  const kd_d = t_latest.kd_d || 50;
  const p_kd_k = t_minus_1.kd_k || 50;
  const p_kd_d = t_minus_1.kd_d || 50;

  const macd_osc = t_latest.macd_osc || 0;
  const p_macd_osc = t_minus_1.macd_osc || 0;
  const macd_dif = t_latest.macd_dif || 0;
  const macd_signal = t_latest.macd_signal || 0;

  const rsi14 = t_latest.rsi14 || 50;

  // 籌碼提取
  const f_net = (t_latest.f_buy || 0) - (t_latest.f_sell || 0); 
  const it_net = (t_latest.it_buy || 0) - (t_latest.it_sell || 0);
  const ds_net = (t_latest.ds_buy || 0) - (t_latest.ds_sell || 0);
  const dh_net = (t_latest.dh_buy || 0) - (t_latest.dh_sell || 0);

  const margin_bal = t_latest.margin_balance || 0;
  const p_margin_bal = t_minus_1.margin_balance || 0;
  const short_bal = t_latest.short_balance || 0;
  const p_short_bal = t_minus_1.short_balance || 0;

  const matchedSignals = [];

  // ==================== 16 套多維模型交叉篩選邏輯 ====================

  // 模型 1：壓縮突破
  const ma_max = Math.max(ma5, ma10, ma20);
  const ma_min = Math.min(ma5, ma10, ma20);
  const avg_vol_5 = t_minus_5.reduce((sum, d) => sum + (d.trading_volume || 0), 0) / 5;
  if (((ma_max - ma_min) / ma20 <= 0.02) && (price > ma_max) && (volume > avg_vol_5 * 1.5) && (f_net > volume * 0.02 || it_net > volume * 0.02)) {
    matchedSignals.push("1");
  }

  // 模型 2：黎明曙光
  if ((price < ma60) && (p_kd_k < 20 && p_kd_d < 20) && (kd_k > kd_d) && (margin_bal <= p_margin_bal)) {
    matchedSignals.push("2");
  }

  // 模型 3：黑馬起飛
  if ((price > ma5 && ma5 > ma10 && ma10 > ma20 && ma20 > ma60) && (ma60 > t_minus_1.ma60 || ma60) && (macd_dif > 0 && macd_osc > p_macd_osc)) {
    const f_it_buy_days = t_minus_5.filter(d => ((d.f_buy || 0) - (d.f_sell || 0) > 0) || ((d.it_buy || 0) - (d.it_sell || 0) > 0)).length;
    if (f_it_buy_days >= 3) matchedSignals.push("3");
  }

  // 模型 4：慣性改變
  const under_ma20_days = t_minus_10.filter(d => (d.price || 0) < (d.ma20 || 0)).length;
  if (under_ma20_days >= 8 && price >= ma20 * 1.01 && rsi14 > 50 && (it_net > volume * 0.01 || f_net > volume * 0.01)) {
    matchedSignals.push("4");
  }

  // 模型 5：動能共振
  if ((kd_k > kd_d && p_kd_k <= p_kd_d) && (macd_osc > 0 && p_macd_osc <= 0) && (price > ma5 && price > ma10)) {
    matchedSignals.push("5");
  }

  // 模型 6：價量表態
  const max_p_20 = Math.max(...t_minus_20.map(d => d.max || d.price || 0));
  const max_v_20 = Math.max(...t_minus_20.map(d => d.trading_volume || 0));
  if (price >= max_p_20 && volume >= max_v_20 && f_net > 0) {
    matchedSignals.push("6");
  }

  // 模型 7：珍珠蒙塵
  const it_continuous_buy = t_minus_5.slice(-3).every(d => ((d.it_buy || 0) - (d.it_sell || 0)) > 0);
  const p_history_3 = t_minus_5.slice(-3).map(d => d.price || price);
  const p_amplitude = (Math.max(...p_history_3) - Math.min(...p_history_3)) / Math.min(...p_history_3);
  if (it_continuous_buy && p_amplitude <= 0.03 && Math.abs(macd_osc) < 0.5) {
    matchedSignals.push("7");
  }

  // 模型 8：籌碼換手
  const margin_3_days_ago = t_minus_5[0].margin_balance || margin_bal;
  const margin_drop_pct = (margin_3_days_ago - margin_bal) / margin_3_days_ago;
  if (margin_drop_pct >= 0.05 && price >= ma20) {
    matchedSignals.push("8");
  }

  // 模型 9：投信無中生有
  const it_was_clean = t_minus_20.slice(0, 19).every(d => (d.it_buy || 0) <= 5);
  if (it_was_clean && it_net >= 300 && change_value > 0) {
    matchedSignals.push("9");
  }

  // 模型 10：雙雄聯手
  if (f_net > 500 && it_net > 200 && macd_osc > 0 && p_macd_osc <= 0) {
    matchedSignals.push("10");
  }

  // 模型 11：致命軋空
  const short_3_days_ago = t_minus_5[0].short_balance || short_bal;
  const short_growth_pct = (short_bal - short_3_days_ago) / (short_3_days_ago || 1);
  if (short_growth_pct >= 0.20 && (max_price - price) / price < 0.005 && rsi14 > 65) {
    matchedSignals.push("11");
  }

  // 模型 12：權證螞蟻雄兵
  const max_dh_20 = Math.max(...t_minus_20.map(d => (d.dh_buy || 0) - (d.dh_sell || 0)));
  if (dh_net >= max_dh_20 && dh_net > volume * 0.08 && change_value / (price - change_value) >= 0.03) {
    matchedSignals.push("12");
  }

  // 模型 13：主力投降 (資券同減)
  if (margin_bal < p_margin_bal * 0.97 && short_bal < p_short_bal * 0.90 && kd_k > kd_d && (price - min_price)/price >= 0.015) {
    matchedSignals.push("13");
  }

  // 模型 14：結構性大轉折
  if ((ma20 > ma60 && t_minus_1.ma20 <= t_minus_1.ma60) && macd_dif > 0 && macd_signal > 0) {
    matchedSignals.push("14");
  }

  // 模型 15：外資回頭
  const f_continuous_sell = t_minus_5.every(d => ((d.f_buy || 0) - (d.f_sell || 0)) < 0);
  if (f_continuous_sell && f_net > volume * 0.10 && macd_osc > p_macd_osc) {
    matchedSignals.push("15");
  }

  // 模型 16：國家隊護盤
  if (ds_net >= 300 && f_net < -1000 && (price - min_price) / price >= 0.015) {
    matchedSignals.push("16");
  }

  return matchedSignals;
}
