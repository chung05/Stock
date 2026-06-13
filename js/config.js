// js/config.js

export const SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2VzaXJzcWpia3JnYWlicmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY0MjUsImV4cCI6MjA5NDU5MjQyNX0.82wBFq-B8cxfK9h_gkJQgIpMEabke1EhB6Oacw2lonc";
export const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const state = {
  currentSourceTab: '全部',
  currentMacdFilter: 'ALL', // 串接首頁獨立 Filter 下拉選單的動態過濾變數
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

// 完美一對一精準定義 6 大波段層級的對照表
export const MACD_SIGNALS = {
  "A": "A. 趨勢持續續強",
  "B": "B. 初動剛轉強",
  "C": "C. 多頭降溫期",
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

// 🧠 終極量化解碼晶片：利用 3 日連續歷史縱向軌跡，將「初動剛轉強」與「慣性持續續強」進行神級分流判定
export function decodeMacdSignal(stockChips) {
  if (!stockChips || stockChips.length < 3) return "None"; // 連續比對機制：最少必須具備 3 天以上數據
  
  // 嚴格依照日期由舊到新排序 (陣列尾端依序為: [..., 前天, 昨日, 今日])
  const dataset = [...stockChips]
    .filter(c => getValIgnoreCase(c, 'macd_dif') !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
    
  const count = dataset.length;
  if (count < 3) return "None";

  const t_latest = dataset[count - 1];  // 最新今日 (T)
  const t_minus_1 = dataset[count - 2]; // 緊鄰昨日 (T-1)
  const t_minus_2 = dataset[count - 3]; // 黃金前天 (T-2)

  // 1. 提取今日最新數值
  let d_dif = getValIgnoreCase(t_latest, 'macd_dif');
  let d_dea = getValIgnoreCase(t_latest, 'macd_signal');
  let d_osc = getValIgnoreCase(t_latest, 'macd_osc');
  
  // 2. 提取昨日數值
  let p_dif = getValIgnoreCase(t_minus_1, 'macd_dif');
  let p_dea = getValIgnoreCase(t_minus_1, 'macd_signal');
  let p_osc = getValIgnoreCase(t_minus_1, 'macd_osc');

  // 3. 提取前天數值
  let pp_dif = getValIgnoreCase(t_minus_2, 'macd_dif');
  let pp_dea = getValIgnoreCase(t_minus_2, 'macd_signal');
  let pp_osc = getValIgnoreCase(t_minus_2, 'macd_osc');

  if (d_dif === null || d_dea === null || d_osc === null || p_dif === null || p_dea === null || p_osc === null || pp_dif === null || pp_dea === null || pp_osc === null) return "None";

  // 🌟【交叉點具有最高否決優先權】今日正式死叉，直接確立 D 狀態 (不需看 OSC)[cite: 8]
  if (d_dif < d_dea && p_dif >= p_dea) return "D"; 

  // 🟢 第一大軌：今日屬於多頭黃金交叉架構 (DIF > DEA)[cite: 8]
  if (d_dif > d_dea) {
    
    // 【層級一：初動剛轉強 (B狀態)】── 滿足以下任一，即代表這 1~2 天內是「第一天剛發動突破」
    // 條件(1): 昨天快線還在慢線下方，今天第一天完成黃金交叉[cite: 8]
    // 條件(2): 昨天動能柱還是負值綠柱，今天第一天由負翻正變紅柱 (d_osc > 0 且 p_osc <= 0)[cite: 8]
    let is_first_cross = (p_dif <= p_dea);
    let is_first_osc_positive = (d_osc > 0 && p_osc <= 0);
    if (is_first_cross || is_first_osc_positive) {
      return "B";
    }

    // 【層級二：多頭降溫期 (C狀態)】── 快線領先往下彎低頭，多頭慣性煞車[cite: 8]
    if (d_dif < p_dif) return "C";
    
    // 【層級三：趨勢持續續強 (A狀態)】── 排除初動與降溫後，動能紅柱呈現完美連續三天「階梯式放大」[cite: 8]
    if (d_dif > p_dif && d_osc > p_osc && p_osc > pp_osc) {
      return "A";
    }
    
    // 其餘多頭平穩慢速推進狀態，一律歸為 C (多頭降溫期)[cite: 8]
    return "C";
  }

  // 🔴 第二大軌：今日屬於空頭死亡交叉架構 (DIF < DEA)[cite: 8]
  if (d_dif < d_dea) {
    // 空方綠柱持續連續縮短衰退 (今日負值 < 昨日負值 < 前天負值，向零軸靠攏)，醞釀反彈 (F狀態)[cite: 8]
    if (d_osc > p_osc && p_osc > pp_osc) return "F";
    // 其餘空頭探底狀態，一律視為空頭主跌段 (E. 空頭加速)[cite: 8]
    return "E";
  }

  return "None";
}
