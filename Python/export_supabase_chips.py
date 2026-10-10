import os
import json
from datetime import datetime
from supabase import create_client, Client

# ==================== 路徑嚴格鎖定 ====================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
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
    
    # 備援：若 2330 查無日期，以較大容量 limit 撈取
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
        
    recent_3_dates = all_dates[-3:]  # 由舊到新: [T-2, T-1, T]
    date_t2, date_t1, date_t = recent_3_dates[0], recent_3_dates[1], recent_3_dates[2]
    print(f"📌 成功鎖定近 3 個交易日: [T-2: {date_t2}, T-1: {date_t1}, T: {date_t}]")

    # 3. 分批撈取 231 檔在近 3 天的籌碼與指標 (每批 50 檔)
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

    print(f"📊 成功下載籌碼紀錄共 {len(all_chips)} 筆，開始計算多維度結構化籌碼...")

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
        
        # 今日融資增減與 MACD
        margin_net = (d_t.get('margin_buy') or 0) - (d_t.get('margin_sell') or 0)
        macd_osc = round(float(d_t.get('macd_osc') or 0), 2)

        # 土洋動態關係
        f_today, it_today = f_arr[2], it_arr[2]
        if f_today > 0 and it_today > 0:
            relation = "土洋同買"
        elif f_today < 0 and it_today < 0:
            relation = "土洋同賣"
        elif f_today * it_today < 0:
            relation = "土洋對作"
        else:
            relation = "分歧"

        # 連續買賣超判定
        is_consec_2_buy = (tot_arr[1] > 0 and tot_arr[2] > 0)
        is_consec_2_sell = (tot_arr[1] < 0 and tot_arr[2] < 0)
        is_consec_3_buy = all(x > 0 for x in tot_arr)
        is_consec_3_sell = all(x < 0 for x in tot_arr)

        records.append({
            'stock_id': sid,
            'stock_name': sname,
            'relation': relation,
            'today_total_net': tot_arr[2],
            'sum_2d_net': tot_arr[1] + tot_arr[2],
            'sum_3d_net': sum(tot_arr),
            'foreign_net_3d': f_arr,
            'investment_trust_net_3d': it_arr,
            'dealer_net_3d': d_arr,
            'total_institutional_net_3d': tot_arr,
            'margin_net_today': margin_net,
            'macd_osc_today': macd_osc,
            'is_consec_2_buy': is_consec_2_buy,
            'is_consec_2_sell': is_consec_2_sell,
            'is_consec_3_buy': is_consec_3_buy,
            'is_consec_3_sell': is_consec_3_sell
        })

    # 5. 結構化封裝各大榜單
    def clean_item(r, include_fields=None):
        base = {
            "stock_id": r["stock_id"],
            "stock_name": r["stock_name"],
            "relation": r["relation"],
            "today_total_net": r["today_total_net"],
            "foreign_net_3d": r["foreign_net_3d"],
            "investment_trust_net_3d": r["investment_trust_net_3d"],
            "dealer_net_3d": r["dealer_net_3d"],
            "margin_net_today": r["margin_net_today"],
            "macd_osc_today": r["macd_osc_today"]
        }
        if include_fields:
            for k in include_fields:
                base[k] = r[k]
        return base

    # 今日榜單
    top_buy_1d = [clean_item(r) for r in sorted(records, key=lambda x: x['today_total_net'], reverse=True)[:TOP_N]]
    top_sell_1d = [clean_item(r) for r in sorted(records, key=lambda x: x['today_total_net'])[:TOP_N]]

    # 連續兩日榜單
    consec_2_buys = sorted([r for r in records if r['is_consec_2_buy']], key=lambda x: x['sum_2d_net'], reverse=True)[:TOP_N]
    top_consec_2_buy = [clean_item(r, ["sum_2d_net"]) for r in consec_2_buys]

    consec_2_sells = sorted([r for r in records if r['is_consec_2_sell']], key=lambda x: x['sum_2d_net'])[:TOP_N]
    top_consec_2_sell = [clean_item(r, ["sum_2d_net"]) for r in consec_2_sells]

    # 連續三日榜單
    consec_3_buys = sorted([r for r in records if r['is_consec_3_buy']], key=lambda x: x['sum_3d_net'], reverse=True)[:TOP_N]
    top_consec_3_buy = [clean_item(r, ["sum_3d_net"]) for r in consec_3_buys]

    consec_3_sells = sorted([r for r in records if r['is_consec_3_sell']], key=lambda x: x['sum_3d_net'])[:TOP_N]
    top_consec_3_sell = [clean_item(r, ["sum_3d_net"]) for r in consec_3_sells]

    # 6. 組裝為最終 JSON 結構
    json_data = {
        "meta": {
            "target_date": date_t,
            "dates_analyzed": [date_t2, date_t1, date_t],
            "dates_format_explanation": "[T-2(前天), T-1(昨天), T(今天)]，單位均為張數",
            "total_watchlist_count": len(stock_ids),
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        },
        "top_institutional_buys_1d": top_buy_1d,
        "top_institutional_sells_1d": top_sell_1d,
        "consecutive_2_days_buys": top_consec_2_buy,
        "consecutive_2_days_sells": top_consec_2_sell,
        "consecutive_3_days_buys": top_consec_3_buy,
        "consecutive_3_days_sells": top_consec_3_sell
    }

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_file = os.path.join(OUTPUT_DIR, f"chips_{date_t}.json")
    
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
        
    print(f"🎉 成功輸出標準 JSON 籌碼分析檔至: {out_file}")
    return date_t

if __name__ == "__main__":
    fetch_and_process_chips()
