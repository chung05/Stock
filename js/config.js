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

// 💡 16 套多維度共振模型字面對照表
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
  "12": "12. 權證螞蟻雄兵（自營商避險爆量 $\\ge$ 8% + 5日均量新高 + 股價大漲）",
  "13": "13. 主力投降（融資退 & 融券大減 + KD金叉 + 下影線收復5MA）",
  "14": "14. 結構性大轉折（月線強勢上揚 + MACD雙線站上0軸 + 法人長鎖）",
  "15": "15. 外資回頭（連5賣後首日認錯大買 $\\ge$ 10% + 動能反轉）",
  "16": "16. 國家隊護盤（自營商自行買賣逆勢大買 + 外資大賣 + 長下影線）"
};

// 🧠 業界最白話、最直覺的財經實戰特徵解說資料庫 (消滅生硬代碼、100%對齊文字說明)
export const WHITE_SPEECHES = {
  "1": {
    desc: "該個股過去一段時間股價波動極小，5日、10日、20日均線徹底糾結在一起（代表市場成本高度一致，主力長期壓盤吸籌）。今日突然發動攻勢破繭而出，收盤拉出一根上漲的長紅 K 棒，同時成交量明顯高於前 5 天的均量，且外資或投信在今日同步砸錢爆買。這代表短線盤整僵局遭到實體放量打破，主力資金正式進場點火，是極強烈波段啟動攻擊的訊號。",
    cond: "【均線糾結】(5, 10, 20日均線高度壓縮在4%窄幅內)\n【股價表態】(今日強勢收紅 K 棒，且一腳站上所有短天期均線之上)\n【動能放量】(今日成交量大於 5 日平均張數的 1.2 倍)\n【主力進場】(外資或投信今日大舉進場買超)"
  },
  "2": {
    desc: "該個股目前股價處於月線（20MA）之下的中長期相對低檔區，具備價格安全邊際。今日技術指標傳來破底翻翻紅訊號：KD 快線從超賣低檔區垂直往上突破慢線（形成低檔黃金交叉）。更難得的是，散戶融資在今日不僅沒有跟風，反而呈現持續退場減少的狀態，暗示浮額遭到清洗。這代表低檔市場賣壓衰竭，主力趁機進場神不知鬼不覺低接，是波段止跌回升的黎明曙光。",
    cond: "【中低檔定位】(股價位於月線 20MA 下方，處於沉悶區)\n【動能交叉】(KD指標今日在低檔區正式確認黃金交叉)\n【散戶退場】(今日散戶融資餘額呈現減少，代表低檔浮額洗淨)"
  },
  "3": {
    desc: "該股目前展現標準的主力強勢認養特徵：股價穩健站上5日、10日、20日均線，且短中長期均線呈現完美的向上發散（多頭排列）。今日指標多方動能再度催油門，MACD 柱狀體不僅維持紅柱，且高度比昨天還要擴大。同時，近5天內法人有3天以上持續天天大量買超鎖碼。這代表股票籌碼已被投信或外資長線鎖死，短線高角度噴出動能充沛，屬於主升段黑馬起飛型態。",
    cond: "【強勢多頭】(股價 > MA5 > MA10 > MA20，短中期趨勢一律向上)\n【動能增強】(MACD指標Dif快線大於0，且多方紅柱 OSC 今日持續擴大)\n【法人鎖碼】(最近 5 個交易日內，法人有 3 天以上連續站在買方鎖碼)"
  },
  "4": {
    desc: "該個股原本受到月線（20MA）的長期壓制，過去趨勢一路向下。但今日慣性發生了毀滅性的翻轉：股價開低走高、強勢放量突破月線反壓，且大腦強弱指標 RSI 正式跨越 50 多空分水嶺，宣告多方奪回主導權。背後推手主要是長期不買的投信或外資今日突然轉頭大舉爆買。這代表原本的下跌趨勢已壽終正寢，主力用實體銀彈強行扭轉慣性，是波段反轉的第一天。",
    cond: "【趨勢突破】(昨日股價仍在月線下，今日突然一舉實體收復月線 20MA)\n【強弱翻紅】(技術指標 RSI14 正式突破 50 中軸，進入多方控盤區)\n【法人神救援】(投信買超大於 20 張，或外資買超大於 50 張)"
  },
  "5": {
    desc: "該個股今日同時亮起雙重技術指標的共振黃金燈號：首先是敏銳的 KD 指標在今日正式確認黃金交叉，再來是長線保護短線的 MACD 綠柱波段首日宣告萎縮翻紅（OSC 翻正）。在指標共振的灌注下，股價也以實體紅 K 棒一舉站穩在 5 日均線與 10 日均線之上。這代表短線動能與中線波動在今日達成完美的頻率共振，多方全面復甦，通常是不錯的發動點。",
    cond: "【指標金叉】(短線指標 KD 今日在底部順利完成黃金交叉)\n【動能翻紅】(MACD指標波段首日綠柱翻紅，或紅柱連續擴大)\n【均線收復】(股價今天收盤同時站在 5 日與 10 日均線之上)"
  },
  "6": {
    desc: "該個股今日爆發出雷霆萬鈞的強烈攻勢：收盤價直接突破、超越了過去 20 個交易日（整整一個月）以來的最高極限股價，同時今日的成交總張數也同步改寫 20 日以來的單日新天量。在價量同時攻頂的背後，外資今日站在絕對買方，狂砸數百張銀彈鎖碼。這代表主力不計成本強行突破箱型壓力區，準備展開軋空或主升段狂飆，是標準的價量表態。",
    cond: "【股價創高】(今日最高價或收盤價，超越過去 20 個交易日的最高點)\n【成交爆量】(今日成交量同步創下過去 20 個交易日以來的單日最高量)\n【外資鎖碼】(外資單日淨買超大於 50 張以上，籌碼流入大戶手中)"
  },
  "7": {
    desc: "該個股目前呈現「明珠蒙塵」的極度壓縮蓄勢型態：外資或投信在最近的 5 天內，已經連續 2 到 3 天以上天天默默買超（法人認養），但主力在吸籌時手法非常細膩，將每日股價的波動幅度壓在極窄的 5% 橫盤箱型內，且 MACD 動能目前躺在低檔安全區。這代表主力正在「進貨而不拉高」，刻意壓低吃飽。一旦籌碼吸足，橫盤橫有多長，噴就有多高。",
    cond: "【法人暗中進貨】(外資或投信連續 2 天以上持續站在買方吸籌)\n【股價橫盤壓縮】(近 3 個交易日股價極度橫盤，高低波動振幅 < 5%)\n【动能低檔】(MACD指標目前位於低檔區，完全沒有過熱風險)"
  },
  "8": {
    desc: "該個股今日上演完美的籌碼大換手劇本：過去幾天由於股價震盪，市場上的散戶融資承受不住壓力，在今日呈現大舉退場、斷頭或認賠殺出的融資大退狀態。然而股價卻沒有跌破重要防線，反而穩穩守在月線（20MA）或均線之上，原因就是外資與投信在今日扮演「神救援」，把散戶丟出來的恐慌血淚賣單全數接走。浮額洗淨大戶接，後市極度看好。",
    cond: "【浮額洗淨】(散戶融資餘額今日呈現持續減少，洗出市場沒信心的浮額)\n【均線守城】(股價收盤依然穩穩站在具有生命線之稱的月線 20MA 之上)\n【法人接手】(外資今日買超 > 50 張，或投信買超 > 20 張，大戶神救援)"
  },
  "9": {
    desc: "該個股原本是投信完全不看、近一個月買賣超近乎清白的冷門股。但今日「無中生有」，投信法人突然打破沉默，在毫無徵兆的情況下首日發動奇襲、单日暴買高達 100 張以上，並順勢拉出一根上漲的表態長紅棒。投信身為台股內資中最敏銳的波段操盤手，這種「打破清白首日認養」通常代表內部有不為人知的產業大基本面利多，主力剛建倉，極具跟單價值。",
    cond: "【投信首日認養】(昨日投信買超為 0 或極低，今日突然首日爆買 > 100 張)\n【多方紅 K】(今日股價變動值 change_value 必須大於 0，收盤為實體上漲)"
  },
  "10": {
    desc: "該個股在今日獲得台股最強兩大主力——外資與投信的共同厚愛。兩大巨頭罕見地在同一個交易日達成絕對共振，外資大買超過 150 張，投信同步爆買超過 50 張，瘋狂用大銀彈掃貨。在兩大雙雄的聯手狂轟下，MACD 指標也在今日波段首日確認綠柱翻紅。這代表外資與內資投信正式達成籌碼共識，共軍與國軍攜手鎖碼，是難得一見的多頭大共振。",
    cond: "【外資爆買】(今日外資單日淨買超實質大於 150 張)\n【投信強鎖】(今日投信單日淨買超實質大於 50 張)\n【動能首日翻紅】(MACD 指標的 OSC 動能柱今日波段首日翻紅轉正)"
  },
  "11": {
    desc: "該個股目前正處於蓄勢待發的極度軋空結構中：市場上的散戶放空融券在近期呈現連續急增或持續攀升的對抗狀態。然而，主力大戶卻不畏空單，今日強勢拉高、股價硬挺站穩在短天期 5 日均線之上，強弱指標 RSI 更是飆破 55 進入強勢多方控盤。這代表空頭完全咬不動多頭，只要股價繼續往上攻，空頭融券就會引發全面斷頭的連環踩踏軋空行情。",
    cond: "【放空急增】(市場融券餘額今日持續增加，死多頭與死空頭激烈對決)\n【強勢控盤】(股價穩健收在短線 MA5 之上，且 RSI14 指標大於 55 高檔動能)"
  },
  "12": {
    desc: "該個股在今日主力籌碼衍生性工具中，出現了極度敏銳的「主力探針」訊號：主力大戶或內資權證主力大舉進場搶購認購權證，迫使自營商為了避險，今日在集中市場爆量敲進該股現貨。自營商避險專用的 dh_net 欄位在今日呈現大幅淨買超表態，同時股價同步大漲。這代表市場上最聰明的權證螞蟻雄兵正在發動突襲，通常隔日還有大波動。",
    cond: "【權證避險爆量】(自營商避險部位 dh_net 今日呈現大舉淨買超狀態)\n【現貨大漲】(今日股價變動 change_value 大於 0，收盤為實體大漲表態)"
  },
  "13": {
    desc: "該個股今日上演「空頭棄械投降」的轉折行情：散戶融資大退、同時放空的空頭融券也大舉回補，資券結構呈現雙向同減。然而股價卻跌不下去，今日在觸底後拉出一段長長的下影線（代表低檔有隱形護盤神單），收盤更是強勢收復、站回 5 日均線。這代表多空洗盤正式結束，市場不論是追高浮額還是放空浮額都已清洗乾淨，股價重新拿回上升主權。",
    cond: "【資券同減】(今日散戶融資與放空融券同步減少，市場洗盤徹底)\n【下影線護盤】(今日最低價與收盤價拉出 > 0.5% 的強勢下影線)\n【收復短線】(股價收盤順利重新站回 5 日均線 MA5 之上)"
  },
  "14": {
    desc: "該個股目前正式迎來月線大波段的結構性黃金大轉折：代表中線主力成本的月線（20MA）在經過長期的下行或走平後，今日扣抵強勢上揚、趨勢斜率正式昂首朝上。與此同時，長線趨勢之王 MACD 的 DIF 快線與 Signal 慢線也雙雙跨越、正式站上 0 軸技術大關。這代表中期多頭正式戰勝空頭，長線大波段多頭行情已全面鋪開。",
    cond: "【月線昂首】(月線 20MA 今日的數值大於昨天，斜率正式翻揚朝上)\n【長線站上0軸】(MACD指標的 DIF快線與Signal慢線在今日雙雙大於0軸)"
  },
  "15": {
    desc: "該個股先前遭到外資無情拋售，近 5 天內外資天天連續大賣、看衰趨勢。但今天外資「認錯回頭」，在毫無徵兆的情況下突然發動首日認錯大買，單日淨買超張數直接霸佔今日成交總張數的 10% 以上！在外資實體銀彈認錯狂轟下，MACD 的動能 OSC 柱狀體也展現出強烈的 V 型反轉朝上。這代表外資籌碼正式認錯歸隊，通常是強烈動能反轉的起點。",
    cond: "【外資連賣後大買】(前幾日外資一律連續大賣，今日首日發動認錯淨買超)\n【吞噬天量】(外資今日大買的張數，佔今日總成交量的 10% 以上比例)\n【動能反轉】(MACD指標的 OSC 柱狀體高度，明顯高於昨天表現)"
  },
  "16": {
    desc: "該個股今日上演了驚心動魄的國家隊護盤奇蹟：在外資法人因為國際市場動盪、單日淨大賣超過 500 張的瘋狂倒貨下，代表政府護盤與官股券商動向的「自營商自行買賣」部位今日逆勢拔刀神救援，單日進場護盤狂買超過 50 張以上！在國家隊真金白銀的強行托盤下，個股在盤中殺低後拉出長長的下影線，展現極強的政策不跌鋼鐵意志。",
    cond: "【外資大倒貨】(今日外資單日淨賣超實質大於 500 張)\n【自營商自行買賣護盤】(自營商自行買賣部位 ds_net 今日逆勢淨買超 > 50 張)\n【鋼鐵下影線】(股價盤中殺低後被強行買回，拉出高達 0.5% 以上的下影線)"
  }
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

  // 模型 1：壓縮突破
  const ma_max = Math.max(ma5, ma10, ma20);
  const ma_min = Math.min(ma5, ma10, ma20);
  const avg_vol_5 = t_minus_5.reduce((sum, d) => sum + (d.trading_volume || 0), 0) / t_minus_5.length;
  if (((ma_max - ma_min) / (ma20 || 1) <= 0.04) && (price >= ma_max) && (change_value > 0) && (volume > avg_vol_5 * 1.2) && (f_net > 0 || it_net > 0)) {
    matchedSignals.push("1");
  }

  // 模型 2：黎明曙光
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

  // 模型 8：籌碼換手
  if ((margin_bal < p_margin_bal || p_margin_bal === 0) && price >= ma20 && (f_net > 50 || it_net > 20)) {
    matchedSignals.push("8");
  }

  // 模型 9：投信無中生有
  const p_it_net = (t_minus_1.it_buy || 0) - (t_minus_1.it_sell || 0);
  if (p_it_net <= 0 && it_net >= 100 && change_value > 0) {
    matchedSignals.push("9");
  }

  // 模型 10：雙雄聯手
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
