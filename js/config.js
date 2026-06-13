// js/config.js

export const SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2VzaXJzcWpia3JnYWlicmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY0MjUsImV4cCI6MjA5NDU5MjQyNX0.82wBFq-B8cxfK9h_gkJQgIpMEabke1EhB6Oacw2lonc";
export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const state = {
  currentSourceTab: '全部',
  currentMacdFilter: 'ALL', // 100% 綁定首頁 12 種黃金型態 Filter
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

// 💡 完美對齊您重新規劃的 12 種趨勢模型對照表 (全域唯一真理)
export const MACD_SIGNALS = {
  "1": "1. 強勢多頭加速（主升段）",
  "2": "2. 強勢多頭減速（仍漲，但動能下降）",
  "3": "3. 多頭回檔（上漲後修正）",
  "4": "4. 多頭再啟動（第二波上漲）",
  "5": "5. 強勢空頭加速（主跌段）",
  "6": "6. 強勢空頭減速（仍跌，但賣壓下降）",
  "7": "7. 空頭反彈（跌深反彈）",
  "8": "8. 空頭續跌（跌勢延續）",
  "9": "9. 底部築底（空頭衰竭）",
  "10": "10. 底部翻多（反轉向上）",
  "11": "11. 頂部鈍化（多頭衰竭）",
  "12": "12. 頂部翻空（反轉向下）"
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

// 🧠 12維度立體解碼晶片：100% 遵循您的「空間線 + 柱狀圖 + 0軸相對位置」規則
export function decodeMacdSignal(stockChips) {
  if (!stockChips || stockChips.length < 3) return "None"; 
  
  const dataset = [...stockChips]
    .filter(c => getValIgnoreCase(c, 'macd_dif') !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
    
  const count = dataset.length;
  if (count < 3) return "None";

  const t_latest = dataset[count - 1];  // 今日 (T)
  const t_minus_1 = dataset[count - 2]; // 昨日 (T-1)
  const t_minus_2 = dataset[count - 3]; // 前天 (T-2)

  let d_dif = getValIgnoreCase(t_latest, 'macd_dif');
  let d_dea = getValIgnoreCase(t_latest, 'macd_signal');
  let d_osc = getValIgnoreCase(t_latest, 'macd_osc');
  let d_price = t_latest.price || 0;
  
  let p_dif = getValIgnoreCase(t_minus_1, 'macd_dif');
  let p_dea = getValIgnoreCase(t_minus_1, 'macd_signal');
  let p_osc = getValIgnoreCase(t_minus_1, 'macd_osc');
  let p_price = t_minus_1.price || 0;

  let pp_dif = getValIgnoreCase(t_minus_2, 'macd_dif');
  let pp_osc = getValIgnoreCase(t_minus_2, 'macd_osc');
  let pp_price = t_minus_2.price || 0;

  if (d_dif === null || d_dea === null || d_osc === null || p_dif === null || p_dea === null || p_osc === null) return "None";

  // 核心微幅比對參數
  const is_gold_cross = (d_dif > d_dea);
  const was_gold_cross = (p_dif > p_dea);
  const just_gold_crossed = (d_dif > d_dea && p_dif <= p_dea);
  const just_death_crossed = (d_dif < d_dea && p_dif >= p_dea);

  // 🎛️ 第一大區：多頭區（0軸上）
  if (d_dif > 0 && d_dea > 0) {
    if (just_gold_crossed) return "4"; // 4. 多頭再啟動（出現黃金交叉）
    if (just_death_crossed) return "3"; // 3. 多頭回檔（出現死亡交叉）
    
    if (is_gold_cross) {
      if (d_osc > p_osc) return "1"; // 1. 強勢多頭加速（紅柱持續變長）
      if (d_osc < p_osc) return "2"; // 2. 強勢多頭減速（紅柱持續縮短）
    }
  }

  // 🎛️ 第二大區：空頭區（0軸下）
  if (d_dif < 0 && d_dea < 0) {
    if (just_gold_crossed) return "7"; // 7. 空頭反彈（出現黃金交叉）
    if (just_death_crossed) return "8"; // 8. 空頭續跌（出現死亡交叉）
    
    if (!is_gold_cross) {
      if (d_osc < p_osc) return "5"; // 5. 強勢空頭加速（綠柱持續變長/負值變小）
      if (d_osc > p_osc) return "6"; // 6. 強勢空頭減速（綠柱持續縮短/負值變大趨向0）
    }
  }

  // 🎛️ 第三大區：頂部轉折區 (多頭衰竭或面臨反轉向上/向下)
  if (d_osc > 0 || (p_osc > 0 && d_osc <= 0)) {
    // 12. 頂部翻空：出現死亡交叉，且具備頂背離特徵（今日股價高於前天，但今日DIF低於前天DIF）
    if (just_death_crossed && d_price > pp_price && d_dif < pp_dif) return "12";
    if (just_death_crossed) return "12"; // 基準死亡交叉轉折
    // 11. 頂部鈍化：紅柱持續縮短，DIF向DEA靠近，尚未死亡交叉
    if (is_gold_cross && d_osc < p_osc && d_dif < p_dif) return "11";
  }

  // 🎛️ 第四大區：底部轉折區 (空頭衰竭)
  if (d_osc < 0 || (p_osc < 0 && d_osc >= 0)) {
    // 10. 底部翻多：出現黃金交叉，且具備底背離特徵（今日股價低於前天，但今日DIF高於前天DIF）
    if (just_gold_crossed && d_price < pp_price && d_dif > pp_dif) return "10";
    if (just_gold_crossed) return "10"; // 基準黃金交叉轉折
    // 9. 底部築底：綠柱持續縮短(負值變大)，DIF向DEA靠近，尚未黃金交叉
    if (!is_gold_cross && d_osc > p_osc && d_dif > p_dif) return "9";
  }

  // 容錯防線：兜底回傳
  if (is_gold_cross) return "1";
  return "5";
}
