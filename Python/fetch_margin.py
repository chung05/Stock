import os
import sys
import json
import time
import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

try:
    from supabase import create_client, Client
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False

TW_TZ = ZoneInfo("Asia/Taipei")
DEFAULT_SUPABASE_URL = "https://fekesirsqjbkrgaibrjf.supabase.co"
HISTORY_LOOKBACK_CALENDAR_DAYS = 95

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
}

def get_supabase_client():
    supabase_url = os.environ.get("SUPABASE_URL", "").strip() or DEFAULT_SUPABASE_URL
    supabase_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_KEY", "").strip()
    )
    if not HAS_SUPABASE or not supabase_key:
        return None
    try:
        return create_client(supabase_url, supabase_key)
    except Exception as e:
        print(f"❌ Supabase 初始化失敗: {e}", flush=True)
        return None

def get_twse_margin(date_str):
    url = f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={date_str}&response=json"
    try:
        res = requests.get(url, headers=COMMON_HEADERS, timeout=15)
        if res.status_code != 200:
            return None
        data = res.json()
        if data.get("stat") != "OK":
            return None
            
        for table in data.get("tables", []):
            if "信用交易統計" in table.get("title", ""):
                for row in table.get("data", []):
                    if "融資金額(仟元)" in row[0]:
                        today_val = int(row[5].replace(",", ""))
                        prev_val = int(row[4].replace(",", ""))
                        buy_val = int(row[1].replace(",", ""))
                        sell_val = int(row[2].replace(",", ""))
                        repay_val = int(row[3].replace(",", ""))
                        diff_val = today_val - prev_val
                        change_rate = round((diff_val / prev_val) * 100, 2) if prev_val else 0.0

                        return {
                            "今日融資餘額_億元": round(today_val / 100000, 2),
                            "前日融資餘額_億元": round(prev_val / 100000, 2),
                            "單日增減_億元": round(diff_val / 100000, 2),
                            "單日增減幅_百分比": change_rate,
                            "本日融資買進_億元": round(buy_val / 100000, 2),
                            "本日融資賣出_億元": round(sell_val / 100000, 2),
                            "現金償還_億元": round(repay_val / 100000, 2),
                            "今日融資餘額_千元": today_val
                        }
        return None
    except Exception as e:
        print(f"  ⚠️ TWSE ({date_str}) 抓取異常: {e}", flush=True)
        return None

def get_tpex_margin(roc_date_str):
    clean_date = roc_date_str.replace("{", "").replace("}", "").strip()
    headers = dict(COMMON_HEADERS)
    headers["Referer"] = "https://www.tpex.org.tw/"

    url_official_html = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=htm&d={clean_date}"
    try:
        res = requests.get(url_official_html, headers=headers, timeout=15)
        if res.status_code == 200 and ("融資" in res.text or "tfoot" in res.text.lower()):
            soup = BeautifulSoup(res.text, "html.parser")
            tfoot = soup.find("tfoot")
            if tfoot:
                rows = tfoot.find_all("tr")
                target_nums = None
                for row in rows:
                    row_text = row.get_text(strip=True)
                    cells = [td.get_text(strip=True).replace(",", "") for td in row.find_all(["td", "th"])]
                    num_cells = [c for c in cells if re.match(r'^-?\d+$', c)]
                    if len(num_cells) >= 5:
                        target_nums = num_cells
                        if "金額" in row_text or "仟元" in row_text:
                            break
                
                if target_nums:
                    prev_bal = int(target_nums[0])
                    today_bal = int(target_nums[4])
                    diff_bal = today_bal - prev_bal
                    change_rate = round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0
                    return {
                        "今日融資餘額_億元": round(today_bal / 100000, 2),
                        "前日融資餘額_億元": round(prev_bal / 100000, 2),
                        "單日增減_億元": round(diff_bal / 100000, 2),
                        "單日增減幅_百分比": change_rate,
                        "本日融資買進_億元": round(int(target_nums[1]) / 100000, 2),
                        "本日融資賣出_億元": round(int(target_nums[2]) / 100000, 2),
                        "現金償還_億元": round(int(target_nums[3]) / 100000, 2),
                        "今日融資餘額_千元": today_bal
                    }
    except Exception as e:
        print(f"  ⚠️ TPEx ({clean_date}) 抓取異常: {e}", flush=True)

    return None

def analyze_margin_dynamics(history_rows, balance_key, change_key):
    """
    從資料庫讀出的歷史序列 (由舊到新排序) 動態推算：
    1. 近 3 / 7 / 10 / 20 日的累計增減、增減天數結構與每日變化序列
    2. 跨週期動能轉折定性結論（比對近3日、7日、10日、20日方向）
    3. 近 20 日 / 60 日波段最高點日期、峰值金額與自高點回落幅度
    """
    if not history_rows:
        return {}

    latest = history_rows[-1]
    curr_bal = float(latest.get(balance_key, 0))

    def build_period_stats(n):
        subset = history_rows[-n:]
        actual_days = len(subset)
        changes = [round(float(r.get(change_key, 0)), 2) for r in subset]
        net_chg = round(sum(changes), 2)
        inc_days = sum(1 for c in changes if c > 0)
        dec_days = sum(1 for c in changes if c < 0)
        
        first_bal = float(subset[0].get(balance_key, 0))
        first_chg = float(subset[0].get(change_key, 0))
        base_bal = round(first_bal - first_chg, 2)
        net_pct = round((net_chg / base_bal) * 100, 2) if base_bal else 0.0

        if inc_days == actual_days:
            pattern = f"連續{actual_days}日全面增加"
        elif dec_days == actual_days:
            pattern = f"連續{actual_days}日全面減少"
        elif net_chg > 0 and dec_days >= inc_days:
            pattern = f"震盪偏多（{inc_days}增{dec_days}減，受單日大增拉抬）"
        elif net_chg < 0 and inc_days >= dec_days:
            pattern = f"震盪偏空（{inc_days}增{dec_days}減，受單日大減拖累）"
        elif net_chg > 0:
            pattern = f"多數時間增加（{inc_days}增{dec_days}減）"
        else:
            pattern = f"多數時間減少（{inc_days}增{dec_days}減）"

        return {
            "統計交易日數": actual_days,
            "累計淨增減_億元": net_chg,
            "累計增減幅_百分比": net_pct,
            "增減天數分布": f"{inc_days}天增加 / {dec_days}天減少",
            "區間結構特徵": pattern,
            "每日增減序列_億元": changes
        }

    p3 = build_period_stats(3)
    p7 = build_period_stats(7)
    p10 = build_period_stats(10)
    p20 = build_period_stats(20)

    c3 = p3["累計淨增減_億元"]
    c7 = p7["累計淨增減_億元"]
    c10 = p10["累計淨增減_億元"]
    c20 = p20["累計淨增減_億元"]

    # 跨週期動能轉折定性判斷（納入近3日、7日、10日、20日綜合對照）
    if c3 > 0 and (c7 < 0 or c10 < 0):
        momentum_signal = f"🔄 止跌回溫（近7日 {c7:+.2f}億 / 近10日 {c10:+.2f}億 仍屬去槓桿，但近3日已轉為淨增 {c3:+.2f}億，短線槓桿開始回補）"
    elif c3 < 0 and (c7 > 0 or c10 > 0):
        momentum_signal = f"⚠️ 動能降溫（近7日 {c7:+.2f}億 / 近10日 {c10:+.2f}億 雖為增加，但近3日已轉為淨減 {c3:+.2f}億，短線浮額開始退場）"
    elif c3 > 0 and c7 >= 0 and c10 >= 0 and c20 > 0:
        momentum_signal = f"🔥 全面擴張（近3日 {c3:+.2f}億、7日 {c7:+.2f}億、10日 {c10:+.2f}億、20日 {c20:+.2f}億 同步增加，散戶追價積極）"
    elif c3 < 0 and c7 <= 0 and c10 <= 0 and c20 < 0:
        momentum_signal = f"❄️ 持續去槓桿（近3日 {c3:+.2f}億、7日 {c7:+.2f}億、10日 {c10:+.2f}億、20日 {c20:+.2f}億 同步縮減，籌碼持續沉澱）"
    elif c3 > 0:
        momentum_signal = f"📈 短線偏多（近3日淨增 {c3:+.2f}億，近10日 {c10:+.2f}億，短線買盤回流）"
    else:
        momentum_signal = f"📉 短線偏空（近3日淨減 {c3:+.2f}億，近10日 {c10:+.2f}億，短線持續調節）"

    def calc_peak_drawdown(n):
        subset = history_rows[-n:]
        peak_row = max(subset, key=lambda r: (float(r.get(balance_key, 0)), r.get("trade_date", "")))
        peak_bal = float(peak_row.get(balance_key, 0))
        peak_date = peak_row.get("trade_date", "")
        peak_idx = subset.index(peak_row)
        days_since_peak = len(subset) - 1 - peak_idx

        diff_from_peak = round(curr_bal - peak_bal, 2)
        pct_from_peak = round((diff_from_peak / peak_bal) * 100, 2) if peak_bal else 0.0

        return {
            "區間實際交易日數": len(subset),
            "高點日期": peak_date,
            "高點餘額_億元": peak_bal,
            "自高點增減_億元": diff_from_peak,
            "自高點回落幅_百分比": pct_from_peak,
            "距高點交易日數": days_since_peak
        }

    return {
        "動能轉折總評": momentum_signal,
        "近3日動態": p3,
        "近7日動態": p7,
        "近10日動態": p10,
        "近20日動態": p20,
        "近20日波段高點分析": calc_peak_drawdown(20),
        "近60日波段高點分析": calc_peak_drawdown(60)
    }

def main():
    print("🚀 fetch_margin.py 啟動執行...", flush=True)
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    is_weekend = now_tw.weekday() in [5, 6]

    if is_weekend or current_hour < 20:
        end_date = now_tw - timedelta(days=1)
    else:
        end_date = now_tw

    start_date = end_date - timedelta(days=HISTORY_LOOKBACK_CALENDAR_DAYS)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    supabase = get_supabase_client()
    existing_dates = set()

    if supabase:
        try:
            res = (
                supabase.table("margin_daily")
                .select("trade_date")
                .gte("trade_date", start_str)
                .lte("trade_date", end_str)
                .execute()
            )
            existing_dates = {str(r["trade_date"]) for r in (res.data or [])}
            print(f"📖 Supabase 區間 ({start_str} ~ {end_str}) 已有 {len(existing_dates)} 個交易日紀錄。", flush=True)
        except Exception as e:
            print(f"⚠️ 查詢既有歷史日期異常: {e}", flush=True)

    candidate_dates = []
    curr = start_date
    while curr.date() <= end_date.date():
        if curr.weekday() not in [5, 6]:
            d_str = curr.strftime("%Y-%m-%d")
            if not supabase or (d_str not in existing_dates) or (curr.date() >= (end_date - timedelta(days=3)).date()):
                candidate_dates.append(curr)
        curr += timedelta(days=1)

    if not supabase and candidate_dates:
        candidate_dates = list(reversed(candidate_dates[-7:]))

    print(f"🔍 本次預計檢查與補齊 {len(candidate_dates)} 個候選平日...", flush=True)

    latest_twse_detail = None
    latest_tpex_detail = None
    latest_valid_date = ""
    records_to_upsert = []

    for idx, target_dt in enumerate(candidate_dates, 1):
        twse_date_str = target_dt.strftime("%Y%m%d")
        roc_date_str = f"{target_dt.year - 1911}/{target_dt.strftime('%m/%d')}"
        check_date_str = target_dt.strftime("%Y-%m-%d")

        twse_data = get_twse_margin(twse_date_str)
        if not twse_data:
            time.sleep(0.5)
            continue

        tpex_data = get_tpex_margin(roc_date_str)
        twse_bal = twse_data["今日融資餘額_億元"]
        twse_chg = twse_data["單日增減_億元"]
        tpex_bal = tpex_data["今日融資餘額_億元"] if tpex_data else 0.0
        tpex_chg = tpex_data["單日增減_億元"] if tpex_data else 0.0
        total_bal = round(twse_bal + tpex_bal, 2)
        total_chg = round(twse_chg + tpex_chg, 2)

        print(f"  ✅ [{idx}/{len(candidate_dates)}] {check_date_str} | 上市: {twse_bal} ({twse_chg:+.2f}) | 上櫃: {tpex_bal} ({tpex_chg:+.2f}) | 合計: {total_bal}", flush=True)

        records_to_upsert.append({
            "trade_date": check_date_str,
            "twse_balance": twse_bal,
            "twse_change": twse_chg,
            "tpex_balance": tpex_bal,
            "tpex_change": tpex_chg,
            "total_balance": total_bal,
            "total_change": total_chg
        })

        if check_date_str >= latest_valid_date:
            latest_valid_date = check_date_str
            latest_twse_detail = twse_data
            latest_tpex_detail = tpex_data

        if supabase and len(records_to_upsert) >= 10:
            try:
                supabase.table("margin_daily").upsert(records_to_upsert, on_conflict="trade_date").execute()
                print(f"  💾 已批次寫入 {len(records_to_upsert)} 筆歷史資料至 Supabase。", flush=True)
                records_to_upsert.clear()
            except Exception as e:
                print(f"  ❌ 批次寫入異常: {e}", flush=True)

        if not supabase:
            break

        time.sleep(1.5)

    if supabase and records_to_upsert:
        try:
            supabase.table("margin_daily").upsert(records_to_upsert, on_conflict="trade_date").execute()
            print(f"💾 已寫入剩餘 {len(records_to_upsert)} 筆資料至 Supabase (margin_daily)。", flush=True)
        except Exception as e:
            print(f"❌ Supabase 寫入異常: {e}", flush=True)

    history_asc = []
    if supabase:
        try:
            res = (
                supabase.table("margin_daily")
                .select("*")
                .order("trade_date", desc=True)
                .limit(60)
                .execute()
            )
            rows = res.data or []
            history_asc = list(reversed(rows))
            print(f"📖 成功從 Supabase 讀回最新 {len(history_asc)} 個交易日完整序列！", flush=True)
        except Exception as e:
            print(f"❌ 從 Supabase 讀取歷史序列異常: {e}", flush=True)

    if not history_asc and not latest_valid_date:
        print("⚠️ 未取得任何有效資料，結束程式。", flush=True)
        return

    if history_asc:
        latest_db_row = history_asc[-1]
        final_date = latest_db_row["trade_date"]
        final_twse_bal = float(latest_db_row["twse_balance"])
        final_twse_chg = float(latest_db_row["twse_change"])
        final_tpex_bal = float(latest_db_row["tpex_balance"])
        final_tpex_chg = float(latest_db_row["tpex_change"])
        final_total_bal = float(latest_db_row["total_balance"])
        final_total_chg = float(latest_db_row["total_change"])
    else:
        final_date = latest_valid_date
        final_twse_bal = latest_twse_detail["今日融資餘額_億元"]
        final_twse_chg = latest_twse_detail["單日增減_億元"]
        final_tpex_bal = latest_tpex_detail["今日融資餘額_億元"] if latest_tpex_detail else 0.0
        final_tpex_chg = latest_tpex_detail["單日增減_億元"] if latest_tpex_detail else 0.0
        final_total_bal = round(final_twse_bal + final_tpex_bal, 2)
        final_total_chg = round(final_twse_chg + final_tpex_chg, 2)
        history_asc = [{
            "trade_date": final_date,
            "twse_balance": final_twse_bal,
            "twse_change": final_twse_chg,
            "tpex_balance": final_tpex_bal,
            "tpex_change": final_tpex_chg,
            "total_balance": final_total_bal,
            "total_change": final_total_chg
        }]

    prev_total_bal = round(final_total_bal - final_total_chg, 2)
    total_change_rate = round((final_total_chg / prev_total_bal) * 100, 2) if prev_total_bal else 0.0

    # 計算各市場 3 / 7 / 10 / 20 日動態與 20 / 60 日波段高點回落
    total_dynamics = analyze_margin_dynamics(history_asc, "total_balance", "total_change")
    twse_dynamics = analyze_margin_dynamics(history_asc, "twse_balance", "twse_change")
    tpex_dynamics = analyze_margin_dynamics(history_asc, "tpex_balance", "tpex_change")

    twse_out = latest_twse_detail or {}
    twse_out["今日融資餘額_億元"] = final_twse_bal
    twse_out["單日增減_億元"] = final_twse_chg
    twse_out["多週期動態與波段高點"] = twse_dynamics

    tpex_out = latest_tpex_detail or {}
    tpex_out["今日融資餘額_億元"] = final_tpex_bal
    tpex_out["單日增減_億元"] = final_tpex_chg
    tpex_out["多週期動態與波段高點"] = tpex_dynamics

    output_payload = {
        "交易日期": final_date,
        "資料來源": "Supabase (margin_daily)" if supabase else "Local Fallback",
        "資料更新時間": now_tw.strftime("%Y-%m-%d %H:%M:%S"),
        "全市場融資總結": {
            "全市場融資總餘額_億元": final_total_bal,
            "全市場單日融資增減_億元": final_total_chg,
            "全市場融資增減幅_百分比": total_change_rate,
            "多週期動態與波段高點": total_dynamics
        },
        "集中市場_上市": twse_out,
        "櫃買市場_上櫃": tpex_out
    }

    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{final_date}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=4)

    print(f"💾 最新報告 JSON 寫入成功 ➡️ docs/margin_{final_date}.json", flush=True)
    print(f"📊 {final_date} 總評: {total_dynamics.get('動能轉折總評', '')}", flush=True)
    print("🏁 全部流程執行完畢！", flush=True)

if __name__ == "__main__":
    main()
