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

    # 2. 獲取資料庫最近的交易日期 (取最新不重複的 5 個交易日)
    print("📅 正在獲取最新 5 個交易日...")
    dates_res = (
        supabase.table('stock_chips_daily')
        .select('date')
        .eq('stock_id', '2330')
        .order('date', desc=True)
        .limit(15)
        .execute()
    )
    all_dates = sorted(list(set(item['date'] for item in (dates_res.data or []))))
    
    # 備援判斷
    if len(all_dates) < 5:
        dates_res = (
            supabase.table('stock_chips_daily')
            .select('date')
            .order('date', desc=True)
            .limit(2000)
            .execute()
        )
        all_dates = sorted(list(set(item['date'] for item in (dates_res.data or []))))

    if len(all_dates) < 5:
        print(f"⚠️ 交易天數不足 5 天 (僅找到 {len(all_dates)} 天: {all_dates})")
        return None
        
    recent_5_dates = all_dates[-5:]  # 由舊到新: [T-4, T-3, T-2, T-1, T]
    target_date = recent_5_dates[-1]
    print(f"📌 成功鎖定近 5 個交易日: {recent_5_dates}")

    # 3. 分批撈取 231 檔在近 5 天的所有籌碼與技術面欄位 (每批 50 檔)
    print("📦 正在分批同步 5 日完整大帳本...")
    chunk_size = 50
    all_chips = []
    
    for i in range(0, len(stock_ids), chunk_size):
        chunk_ids = stock_ids[i:i + chunk_size]
        chips_res = (
            supabase.table('stock_chips_daily')
            .select('*')
            .in_('stock_id', chunk_ids)
            .in_('date', recent_5_dates)
            .execute()
        )
        if chips_res.data:
            all_chips.extend(chips_res.data)

    print(f"📊 成功下載紀錄共 {len(all_chips)} 筆，開始計算整合量價與籌碼指標...")

    # 4. 依照 stock_id 分組建立五日序列
    chips_by_stock = {}
    for row in all_chips:
        sid = str(row.get('stock_id', '')).strip()
        if sid not in chips_by_stock:
            chips_by_stock[sid] = {}
        chips_by_stock[sid][row.get('date')] = row

    records = []
    for sid, sname in stock_map.items():
        daily_records = chips_by_stock.get(sid, {})
        # 依序取出 5 日資料 [T-4, T-3, T-2, T-1, T]
        days_data = [daily_records.get(d, {}) for d in recent_5_dates]
        d_today = days_data[-1]

        def get_val(data, key, default=0.0):
            v = data.get(key)
            if v is not None:
                try:
                    return round(float(v), 2)
                except (ValueError, TypeError):
                    pass
            return default

        # 法人淨買賣張數 (股轉張)
        def get_net(data, b_key, s_key):
            buy = round((data.get(b_key) or 0) / 1000)
            sell = round((data.get(s_key) or 0) / 1000)
            return buy - sell

        f_5d = [get_net(d, 'f_buy', 'f_sell') for d in days_data]
        it_5d = [get_net(d, 'it_buy', 'it_sell') for d in days_data]
        
        def get_dealer_net(data):
            ds = get_net(data, 'ds_buy', 'ds_sell')
            dh = round(((data.get('dh_buy') or 0) - (data.get('dh_sell') or 0)) / 1000)
            return ds + dh

        d_5d = [get_dealer_net(d) for d in days_data]
        tot_5d = [f_5d[i] + it_5d[i] + d_5d[i] for i in range(5)]

        # 土洋關係 (當日)
        f_today, it_today = f_5d[-1], it_5d[-1]
        if f_today > 0 and it_today > 0:
            relation = "土洋同買"
        elif f_today < 0 and it_today < 0:
            relation = "土洋同賣"
        elif f_today * it_today < 0:
            relation = "土洋對作"
        else:
            relation = "分歧"

        # 價格序列 (Fields_: price, open, max, min, change_value)
        close_5d = [get_val(d, 'price') for d in days_data]
        open_today = get_val(d_today, 'open')
        high_today = get_val(d_today, 'max')
        low_today = get_val(d_today, 'min')
        close_today = close_5d[-1]
        change_val = get_val(d_today, 'change_value')
        ref_price = round(close_today - change_val, 2) if close_today > 0 else 0.0
        change_pct = round((change_val / ref_price * 100), 2) if ref_price > 0 else 0.0

        # 成交量序列 (Fields_: trading_volume)
        vol_5d = [int(get_val(d, 'trading_volume')) for d in days_data]
        today_vol = vol_5d[-1]
        avg_5d_vol = round(sum(vol_5d) / len(vol_5d)) if vol_5d else 0
        vol_ratio_5d = round(today_vol / avg_5d_vol, 2) if avg_5d_vol > 0 else 1.0

        # 法人籌碼佔比 (%)
        inst_net_today = tot_5d[-1]
        inst_ratio_pct = round((abs(inst_net_today) / today_vol * 100), 2) if today_vol > 0 else 0.0

        # 均線數值 (Fields_: ma5, ma10, ma20)
        ma5 = get_val(d_today, 'ma5')
        ma10 = get_val(d_today, 'ma10')
        ma20 = get_val(d_today, 'ma20')

        ma_status = "均線糾結"
        if close_today > 0 and ma5 > 0 and ma10 > 0 and ma20 > 0:
            if close_today > ma5 > ma10 > ma20:
                ma_status = "多頭排列(站上所有均線)"
            elif close_today < ma5 < ma10 < ma20:
                ma_status = "空頭排列(均線反壓)"
            elif close_today > ma20:
                ma_status = "站上月線(MA20)"
            else:
                ma_status = "跌破月線(MA20)"

        # 技術指標 (Fields_: rsi14, kd_k, kd_d, macd_osc)
        rsi_5d = [get_val(d, 'rsi14') for d in days_data]
        k_today = get_val(d_today, 'kd_k')
        d_today_val = get_val(d_today, 'kd_d')
        macd_osc = get_val(d_today, 'macd_osc')

        # 信用交易 (Fields_: margin_buy, margin_sell, margin_balance, short_buy, short_sell, short_balance)
        margin_net = (d_today.get('margin_buy') or 0) - (d_today.get('margin_sell') or 0)
        margin_bal = d_today.get('margin_balance') or 0
        short_net = (d_today.get('short_buy') or 0) - (d_today.get('short_sell') or 0)
        short_bal = d_today.get('short_balance') or 0

        # 連續買賣超判定 (近 2、3 日)
        is_consec_2_buy = (tot_5d[-2] > 0 and tot_5d[-1] > 0)
        is_consec_2_sell = (tot_5d[-2] < 0 and tot_5d[-1] < 0)
        is_consec_3_buy = all(x > 0 for x in tot_5d[-3:])
        is_consec_3_sell = all(x < 0 for x in tot_5d[-3:])

        records.append({
            'stock_id': sid,
            'stock_name': sname,
            'relation': relation,
            'today_total_net': inst_net_today,
            'sum_2d_net': tot_5d[-2] + tot_5d[-1],
            'sum_3d_net': sum(tot_5d[-3:]),
            'sum_5d_net': sum(tot_5d),
            'foreign_net_5d': f_5d,
            'investment_trust_net_5d': it_5d,
            'dealer_net_5d': d_5d,
            'total_institutional_net_5d': tot_5d,
            'inst_ratio_pct': inst_ratio_pct,
            # 完整量價數據
            'price_data': {
                'close_5d': close_5d,
                'today_close': close_today,
                'open': open_today,
                'high': high_today,
                'low': low_today,
                'change_value': change_val,
                'change_pct': change_pct,
                'volume_5d': vol_5d,
                'today_volume': today_vol,
                'avg_5d_volume': avg_5d_vol,
                'vol_ratio_5d': vol_ratio_5d
            },
            'ma_data': {
                'ma5': ma5,
                'ma10': ma10,
                'ma20': ma20,
                'status': ma_status
            },
            'tech_data': {
                'rsi_5d': rsi_5d,
                'kd': {'k': k_today, 'd': d_today_val},
                'macd_osc': macd_osc
            },
            'credit_data': {
                'margin_net_today': margin_net,
                'margin_balance': margin_bal,
                'short_net_today': short_net,
                'short_balance': short_bal
            },
            'is_consec_2_buy': is_consec_2_buy,
            'is_consec_2_sell': is_consec_2_sell,
            'is_consec_3_buy': is_consec_3_buy,
            'is_consec_3_sell': is_consec_3_sell
        })

    def clean_item(r, include_fields=None):
        base = {
            "stock_id": r["stock_id"],
            "stock_name": r["stock_name"],
            "relation": r["relation"],
            "today_total_net": r["today_total_net"],
            "foreign_net_5d": r["foreign_net_5d"],
            "investment_trust_net_5d": r["investment_trust_net_5d"],
            "dealer_net_5d": r["dealer_net_5d"],
            "inst_ratio_pct": r["inst_ratio_pct"],
            "price_data": r["price_data"],
            "ma_data": r["ma_data"],
            "tech_data": r["tech_data"],
            "credit_data": r["credit_data"]
        }
        if include_fields:
            for k in include_fields:
                base[k] = r[k]
        return base

    top_buy_1d = [clean_item(r) for r in sorted(records, key=lambda x: x['today_total_net'], reverse=True)[:TOP_N]]
    top_sell_1d = [clean_item(r) for r in sorted(records, key=lambda x: x['today_total_net'])[:TOP_N]]

    consec_2_buys = sorted([r for r in records if r['is_consec_2_buy']], key=lambda x: x['sum_2d_net'], reverse=True)[:TOP_N]
    top_consec_2_buy = [clean_item(r, ["sum_2d_net"]) for r in consec_2_buys]

    consec_2_sells = sorted([r for r in records if r['is_consec_2_sell']], key=lambda x: x['sum_2d_net'])[:TOP_N]
    top_consec_2_sell = [clean_item(r, ["sum_2d_net"]) for r in consec_2_sells]

    consec_3_buys = sorted([r for r in records if r['is_consec_3_buy']], key=lambda x: x['sum_3d_net'], reverse=True)[:TOP_N]
    top_consec_3_buy = [clean_item(r, ["sum_3d_net"]) for r in consec_3_buys]

    consec_3_sells = sorted([r for r in records if r['is_consec_3_sell']], key=lambda x: x['sum_3d_net'])[:TOP_N]
    top_consec_3_sell = [clean_item(r, ["sum_3d_net"]) for r in consec_3_sells]

    json_data = {
        "meta": {
            "target_date": target_date,
            "dates_analyzed": recent_5_dates,
            "dates_format_explanation": "[T-4, T-3, T-2, T-1, T]，數列依此排序 (單位: 張/元)",
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
    out_file = os.path.join(OUTPUT_DIR, f"chips_{target_date}.json")
    
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
        
    print(f"🎉 成功輸出包含 5 日量價、信用與技術面指標之籌碼分析檔至: {out_file}")
    return target_date

if __name__ == "__main__":
    fetch_and_process_chips()
