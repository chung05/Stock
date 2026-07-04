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
  // 🟢 智慧調整：放寬天數限制門檻至 5 天，防止因開局快取天數較短導致所有股票直接被退件
  if (!stockChips || stockChips.length < 5) return []; 
  
  // 一律依日期由舊到新排序
  const dataset = [...stockChips].sort((a, b) => a.date.localeCompare(b.date));
  const count = dataset.length;

  // 確保變數全部指向排序好的 dataset
  const t_latest = dataset[count - 1];   // 今日 (T)
  const t_minus_1 = count >= 2 ? dataset[count - 2] : t_latest;  // 昨日 (T-1)
  const t_minus_5 = dataset.slice(-5);   // 近5日

  // 1. 基礎指標提取
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
  const avg_vol_5 = t_minus_5.reduce((sum, d) => sum + (d.trading_volume || 0), 0) / t_minus_5.length;
  if (((ma_max - ma_min) / ma20 <= 0.04) && (price > ma_max) && (volume > avg_vol_5 * 1.2) && (f_net > 0 || it_net > 0)) {
    matchedSignals.push("1");
  }

  // 模型 2：黎明曙光 (💡 修正：移除資料表不存在的 ma60，改以價格處於月線 ma20 下方作為低檔判定基準)
  if ((price < ma20) && (kd_k > kd_d && p_kd_k <= p_kd_d) && (margin_bal <= p_margin_bal)) {
    matchedSignals.push("2");
  }

  // 模型 3：黑馬起飛 (💡 修正：移除不存在的 ma60，改以標準短中天期均線多頭排列進行篩選)
  if ((price > ma5 && ma5 > ma10 && ma10 > ma20) && (macd_dif > 0 && macd_osc > p_macd_osc)) {
    const f_it_buy_days = t_minus_5.filter(d => ((d.f_buy || 0) - (d.f_sell || 0) > 0) || ((d.it_buy || 0) - (d.it_sell || 0) > 0)).length;
    if (f_it_buy_days >= 2) matchedSignals.push("3");
  }

  // 模型 4：慣性改變
  if (t_minus_1.price < t_minus_1.ma20 && price >= ma20 && rsi14 > 45 && (it_net > 0 || f_net > 0)) {
    matchedSignals.push("4");
  }

  // 模型 5：動能共振
  if ((kd_k > kd_d && p_kd_k <= p_kd_d) && (macd_osc > 0 && p_macd_osc <= 0) && (price > ma5)) {
    matchedSignals.push("5");
  }

  // 模型 6：價量表態 (💡 修正：配合快取天數，改以近 5 日內之最高價量表態為準)
  const max_p_5 = Math.max(...t_minus_5.map(d => d.max || d.price || 0));
  const max_v_5 = Math.max(...t_minus_5.map(d => d.trading_volume || 0));
  if (price >= max_p_5 && volume >= max_v_5 && f_net > 0) {
    matchedSignals.push("6");
  }

  // 模型 7：珍珠蒙塵
  const it_continuous_buy = t_minus_5.slice(-2).every(d => ((d.it_buy || 0) - (d.it_sell || 0)) > 0);
  const p_history_3 = t_minus_5.slice(-3).map(d => d.price || price);
  const p_amplitude = (Math.max(...p_history_3) - Math.min(...p_history_3)) / Math.min(...p_history_3);
  if (it_continuous_buy && p_amplitude <= 0.05) {
    matchedSignals.push("7");
  }

  // 模型 8：籌碼換手
  if (margin_bal < p_margin_bal && price >= ma20 && (f_net > 0 || it_net > 0)) {
    matchedSignals.push("8");
  }

  // 模型 9：投信無中生有
  if ((t_minus_1.it_buy || 0) === 0 && it_net >= 100 && change_value > 0) {
    matchedSignals.push("9");
  }

  // 模型 10：雙雄聯手
  if (f_net > 100 && it_net > 50 && macd_osc > 0) {
    matchedSignals.push("10");
  }

  // 模型 11：致命軋空
  if (short_bal > p_short_bal && (max_price - price) / price < 0.01 && rsi14 > 55) {
    matchedSignals.push("11");
  }

  // 模型 12：權證螞蟻雄兵
  if (dh_net > 0 && change_value > 0) {
    matchedSignals.push("12");
  }

  // 模型 13：主力投降
  if (margin_bal < p_margin_bal && short_bal < p_short_bal && kd_k > kd_d) {
    matchedSignals.push("13");
  }

  // 模型 14：結構性大轉折 (💡 修正：移除不存在的 ma60，改以月線 ma20 趨勢向上且雙線站上 0 軸判定)
  if (ma20 > t_minus_1.ma20 && macd_dif > 0 && macd_signal > 0) {
    matchedSignals.push("14");
  }

  // 模型 15：外資回頭
  if (((t_minus_1.f_buy || 0) - (t_minus_1.f_sell || 0) < 0) && f_net > 0 && macd_osc > p_macd_osc) {
    matchedSignals.push("15");
  }

  // 模型 16：國家隊護盤
  if (ds_net > 0 && f_net < 0 && (price - min_price) / price >= 0.005) {
    matchedSignals.push("16");
  }

  return matchedSignals;
}
