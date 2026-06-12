// js/config.js

export const SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2VzaXJzcWpia3JnYWlicmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY0MjUsImV4cCI6MjA5NDU5MjQyNX0.82wBFq-B8cxfK9h_gkJQgIpMEabke1EhB6Oacw2lonc";
export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const state = {
  currentSourceTab: '全部',
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

// 6大狀態文字常數映射表 (供下拉選單與表格比對使用)
export const MACD_SIGNALS = {
  "A": "A. 趨勢正在加速",
  "B": "B. 趨勢仍多頭",
  "C": "C. 轉弱初期",
  "D": "D. 空頭開始",
  "E": "E. 空頭加速",
  "F": "F. 空頭衰退"
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

// 🧠 全新核心 Function：傳入單檔股票的所有晶片歷史，精準解碼出當前的 MACD 狀態代號 (A ~ F)
export function decodeMacdSignal(stockChips) {
  if (!stockChips || stockChips.length < 2) return "None";
  
  // 依照日期由舊到新排序
  const dataset = [...stockChips]
    .filter(c => getValIgnoreCase(c, 'macd_dif') !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
    
  const count = dataset.length;
  if (count < 2) return "None";

  const t_latest = dataset[count - 1];  
  const t_minus_1 = dataset[count - 2]; 

  let d_dif = getValIgnoreCase(t_latest, 'macd_dif');
  let d_dea = getValIgnoreCase(t_latest, 'macd_signal');
  let d_osc = getValIgnoreCase(t_latest, 'macd_osc');
  
  let p_dif = getValIgnoreCase(t_minus_1, 'macd_dif');
  let p_dea = getValIgnoreCase(t_minus_1, 'macd_signal');
  let p_osc = getValIgnoreCase(t_minus_1, 'macd_osc');

  if (d_dif === null || d_dea === null || d_osc === null || p_dif === null || p_dea === null || p_osc === null) return "None";

  let is_gold_cross = d_dif > d_dea;
  let dif_rising = d_dif > p_dif;
  let dif_bending_down = d_dif < p_dif;
  let dea_flat_or_rising = d_dea >= p_dea;

  let osc_neg_expanding = d_osc < 0 && (d_osc < p_osc);
  let osc_neg_shrinking = d_osc < 0 && (d_osc > p_osc);

  let sigA = is_gold_cross && dif_rising && (d_osc > p_osc);
  let sigB = is_gold_cross && (d_osc < p_osc);
  let sigC = dif_bending_down && dea_flat_or_rising && (d_osc < p_osc);
  let sigD = d_dif < d_dea && p_dif >= p_dea; 
  let sigE = d_dif < d_dea && d_dif < p_dif && osc_neg_expanding;
  let sigF = d_dif < d_dea && d_dif >= p_dif && osc_neg_shrinking;

  if (sigA) return "A";
  if (sigD) return "D";
  if (sigE) return "E";
  if (sigC) return "C";
  if (sigB) return "B";
  if (sigF) return "F";

  return is_gold_cross ? (d_osc > p_osc ? "A" : "B") : (d_osc > p_osc ? "F" : "E");
}
