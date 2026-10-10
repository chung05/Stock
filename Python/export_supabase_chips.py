import os
import math
from datetime import datetime
from supabase import create_client, Client

# ==================== 路徑嚴格鎖定 ====================
# 當前檔案絕對路徑: .../Python/export_supabase_chips.py 或 .../Stock/Python/export_supabase_chips.py
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# 鎖定上一層的 docs: .../docs/ 或 .../Stock/docs/
OUTPUT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", "docs"))

# ==================== Supabase 設定 ====================
SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZla2VzaXJzcWpia3JnYWlicmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY0MjUsImV4cCI6MjA5NDU5MjQyNX0.82wBFq-B8cxfK9h_gkJQgIpMEabke1EhB6Oacw2lonc"

TOP_N = 30

def get_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

def fetch_and_process_chips():
    supabase = get_supabase_client()
    print("🚀 連線 Supabase 讀取 stock_targets 名單...")
    
    # 1. 讀取目標 231 檔觀察名單
    targets_res = supabase.table('stock_targets').select('stock_id, stock_name').execute()
    targets = targets_res.data or []
    if not targets:
        print("❌ 未取得任何觀察股名單！")
        return None
        
    stock_map = {str(item['stock_id']).strip(): item.get('stock_name', '') for item in targets}
    stock_ids = list(stock_map.keys())
    print(f"✅ 取得觀察名單共 {len(stock_ids)} 檔")

    # 2. 獲取資料庫最近的交易日期 (取最新不重複的 3 個交易日)
    print("📅 正在獲取最新交易日...")
    dates_res = (
        supabase.table('stock_chips_daily')
        .select('date')
        .eq('stock_id', '2330')
        .order('date', desc=True)
        .limit(10)
        .execute()
    )
    all_dates = sorted(list(set(item['date'] for item in (dates_res.data or []))))
    
    # 備援機制：若 2330 查無日期，以較大容量 limit 跨多日撈取
    if len(all_dates) < 3:
        dates_res = (
            supabase.table('stock_chips_daily')
            .select('date')
            .order('date', desc=True)
            .limit(1000)
            .execute()
        )
        all_dates = sorted(list(set(item['date'] for item in (dates_res.data or []))))

    if len(all_dates) < 3:
        print(f"⚠️ 交易天數不足 3 天 (僅找到 {len(all_dates)} 天: {all_dates})")
        return None
        
    recent_3_dates = all_dates[-3:]  # 由舊到新排序: [T-2, T-1, T]
    date_t2, date_t1, date_t = recent_3_dates[0], recent_3_dates[1], recent_3_dates[2]
    print(f"📌 成功鎖定近 3 個交易日: [T-2: {date_t2}, T-1: {date_t1}, T: {date_t}]")

    # 3. 分批撈取這 231 檔在近 3 天的籌碼與技術指標
    print("📦 正在分批同步 3 日籌碼與技術面數據...")
    chunk_size = 50
    all_chips = []
    
    for i in range(0, len(stock_ids), chunk_size):
        chunk_ids = stock_ids[i:i + chunk_size]
        chips_res = (
            supabase.table('stock_chips_daily')
            .select('*')
            .in_('stock_id', chunk_ids)
            .in_('date', recent_3_dates)
            .execute()
        )
        if chips_res.data:
            all_chips.extend(chips_res.data)

    print(f"📊 成功下載籌碼紀錄共 {len(all_chips)} 筆，開始計算多維度籌碼...")

    # 4. 依照 stock_id 分組建立三日序列
    chips_by_stock = {}
    for row in all_chips:
        sid = str(row.get('stock_id', '')).strip()
        if sid not in chips_by_stock:
            chips_by_stock[sid] = {}
        chips_by_stock[sid][row.get('date')] = row

    records = []
    for sid, sname in stock_map.items():
        daily_records = chips_by_stock.get(sid, {})
        d_t2 = daily_records.get(date_t2, {})
        d_t1 = daily_records.get(date_t1, {})
        d_t = daily_records.get(date_t, {})

        # 淨買賣張數計算 (股轉張並四捨五入)
        def get_net(data, b_key, s_key):
            buy = round((data.get(b_key) or 0) / 1000)
            sell = round((data.get(s_key) or 0) / 1000)
            return buy - sell

        # 外資近 3 日數列 [T-2, T-1, T]
        f_arr = [
            get_net(d_t2, 'f_buy', 'f_sell'),
            get_net(d_t1, 'f_buy', 'f_sell'),
            get_net(d_t, 'f_buy', 'f_sell')
        ]
        # 投信近 3 日數列
        it_arr = [
            get_net(d_t2, 'it_buy', 'it_sell'),
            get_net(d_t1, 'it_buy', 'it_sell'),
            get_net(d_t, 'it_buy', 'it_sell')
        ]
        # 自營商 (自行 + 避險) 近 3 日數列
        def get_dealer_net(data):
            ds = get_net(data, 'ds_buy', 'ds_sell')
            dh = round((data.get('dh_net') or ((data.get('dh_buy') or 0) - (data.get('dh_sell') or 0))) / 1000)
            return ds + dh

        d_arr = [get_dealer_net(d_t2), get_dealer_net(d_t1), get_dealer_net(d_t)]

        # 三大法人合計近 3 日 [T-2, T-1, T]
        tot_arr = [f_arr[i] + it_arr[i] + d_arr[i] for i in range(3)]
        
        # 今日技術指標與融資增減
        margin_net = (d_t.get('margin_buy') or 0) - (d_t.get('margin_sell') or 0)
        macd_osc = d_t.get('macd_osc', 0) or 0

        # 土洋動態關係 (當日)
        f_today, it_today = f_arr[2], it_arr[2]
        if f_today > 0 and it_today > 0:
            relation = "土洋同買"
        elif f_today < 0 and it_today < 0:
            relation = "土洋同賣"
        elif f_today * it_today < 0:
            relation = "土洋對作"
        else:
            relation = "分歧"

        # 連續買賣超判定：
        # 連續 2 日: tot_arr[1] > 0 且 tot_arr[2] > 0
        is_consec_2_buy = (tot_arr[1] > 0 and tot_arr[2] > 0)
        is_consec_2_sell = (tot_arr[1] < 0 and tot_arr[2] < 0)
        # 連續 3 日: 三天皆同向
        is_consec_3_buy = all(x > 0 for x in tot_arr)
        is_consec_3_sell = all(x < 0 for x in tot_arr)

        records.append({
            'stock_id': sid,
            'stock_name': sname,
            'tot_t': tot_arr[2],
            'tot_sum2': tot_arr[1] + tot_arr[2],
            'tot_sum3': sum(tot_arr),
            'f_arr': f_arr,
            'it_arr': it_arr,
            'd_arr': d_arr,
            'tot_arr': tot_arr,
            'margin_net': margin_net,
            'macd_osc': macd_osc,
            'is_consec_2_buy': is_consec_2_buy,
            'is_consec_2_sell': is_consec_2_sell,
            'is_consec_3_buy': is_consec_3_buy,
            'is_consec_3_sell': is_consec_3_sell,
            'relation': relation
        })

    # 5. 排序與產出各大榜單
    top_buy_1d = sorted(records, key=lambda x: x['tot_t'], reverse=True)[:TOP_N]
    top_sell_1d = sorted(records, key=lambda x: x['tot_t'])[:TOP_N]
    
    # 連續兩日買超榜 (依 2 日累計買超排序)
    consec_2_buys = [r for r in records if r['is_consec_2_buy']]
    top_consec_2_buy = sorted(consec_2_buys, key=lambda x: x['tot_sum2'], reverse=True)[:TOP_N]

    # 連續兩日賣超榜 (依 2 日累計賣超排序)
    consec_2_sells = [r for r in records if r['is_consec_2_sell']]
    top_consec_2_sell = sorted(consec_2_sells, key=lambda x: x['tot_sum2'])[:TOP_N]

    # 連續三日買超榜 (依 3 日累計買超排序)
    consec_3_buys = [r for r in records if r['is_consec_3_buy']]
    top_consec_3_buy = sorted(consec_3_buys, key=lambda x: x['tot_sum3'], reverse=True)[:TOP_N]
    
    # 連續三日賣超榜 (依 3 日累計賣超排序)
    consec_3_sells = [r for r in records if r['is_consec_3_sell']]
    top_consec_3_sell = sorted(consec_3_sells, key=lambda x: x['tot_sum3'])[:TOP_N]

    # 日期標籤 (例如 [10/06, 10/07, 10/08])
    d_labels = [datetime.strptime(d, "%Y-%m-%d").strftime("%m/%d") if "-" in d else d for d in recent_3_dates]
    date_header_str = f"[{d_labels[0]}, {d_labels[1]}, {d_labels[2]}]"

    def format_row(r, extra_info=None):
        macd_str = f"MACD柱:{r['macd_osc']:+.2f}"
        margin_str = f"資:{r['margin_net']:+d}張"
        extra_str = f" ({extra_info})" if extra_info else ""
        return (
            f"- {r['stock_id']} {r['stock_name']} [{r['relation']}] | 今日三大法人:{r['tot_t']:+d}張{extra_str} ({margin_str}, {macd_str})\n"
            f"  外資:{r['f_arr']} | 投信:{r['it_arr']} | 自營:{r['d_arr']}"
        )

    output_lines = [
        f"【核心觀察股 (231檔) 三大法人籌碼與動能監控】",
        f"※ 數據陣列格式統一為 {date_header_str}，由左至右分別為前天、昨天、今天之數值（單位：張）\n",
        
        f"### 1. 今日三大法人買超前 {TOP_N} 名：",
        "\n".join([format_row(r) for r in top_buy_1d]),
        "",
        f"### 2. 今日三大法人賣超前 {TOP_N} 名：",
        "\n".join([format_row(r) for r in top_sell_1d]),
        "",
        f"### 3. 連續兩日買超前 {TOP_N} 名（短線發動/轉買點火）：",
        "\n".join([format_row(r, f"2日累計:{r['tot_sum2']:+d}張") for r in top_consec_2_buy]) if top_consec_2_buy else "無符合連續兩日買超個股",
        "",
        f"### 4. 連續兩日賣超前 {TOP_N} 名（短線初跌/轉賣調節）：",
        "\n".join([format_row(r, f"2日累計:{r['tot_sum2']:+d}張") for r in top_consec_2_sell]) if top_consec_2_sell else "無符合連續兩日賣超個股",
        "",
        f"### 5. 連續三日買超前 {TOP_N} 名（波段買盤強勢鎖碼）：",
        "\n".join([format_row(r, f"3日累計:{r['tot_sum3']:+d}張") for r in top_consec_3_buy]) if top_consec_3_buy else "無符合連續三日買超個股",
        "",
        f"### 6. 連續三日賣超前 {TOP_N} 名（波段持續拋售壓力）：",
        "\n".join([format_row(r, f"3日累計:{r['tot_sum3']:+d}張") for r in top_consec_3_sell]) if top_consec_3_sell else "無符合連續三日賣超個股"
    ]

    result_text = "\n".join(output_lines)
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_file = os.path.join(OUTPUT_DIR, f"chips_{date_t}.txt")
    
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(result_text)
        
    print(f"🎉 成功輸出包含【連2日與連3日】之籌碼分析檔至: {out_file}")
    return date_t

if __name__ == "__main__":
    fetch_and_process_chips()
