import os
import sys
import json
import time
import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# 強制關閉 stdout 緩衝，確保 GitHub Actions 能即時看到 log
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

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
}

def get_twse_margin(date_str):
    """
    抓取 TWSE (上市) 全市場信用交易統計
    API 格式: YYYYMMDD
    """
    url = f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={date_str}&response=json"
    try:
        res = requests.get(url, headers=COMMON_HEADERS, timeout=15)
        if res.status_code != 200:
            print(f"  [TWSE] HTTP 狀態碼異常: {res.status_code}", flush=True)
            return None
        data = res.json()
        if data.get("stat") != "OK":
            print(f"  [TWSE] 官方回應狀態非 OK: {data.get('stat')}", flush=True)
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
        print("  [TWSE] 未在回傳表格中找到「信用交易統計」區塊", flush=True)
        return None
    except Exception as e:
        print(f"  ⚠️ TWSE 抓取異常: {e}", flush=True)
        return None

def get_tpex_margin(roc_date_str):
    """
    透過 HTML 爬蟲解析 TPEx (上櫃) 全市場融資數據
    roc_date_str 格式範例: 115/11/09
    """
    clean_date = roc_date_str.replace("{", "").replace("}", "").strip()
    headers = dict(COMMON_HEADERS)
    headers["Referer"] = "https://www.tpex.org.tw/"

    # 策略 1：爬取 TPEx 官方 HTML 報表 (o=htm)
    url_official_html = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=htm&d={clean_date}"
    try:
        res = requests.get(url_official_html, headers=headers, timeout=15)
        if res.status_code == 200 and ("融資" in res.text or "tfoot" in res.text.lower()):
            soup = BeautifulSoup(res.text, "html.parser")
            tfoot = soup.find("tfoot")
            if tfoot:
                rows = tfoot.find_all("tr")
                for row in rows:
                    cells = [td.get_text(strip=True).replace(",", "") for td in row.find_all(["td", "th"])]
                    num_cells = [c for c in cells if re.match(r'^-?\d+$', c)]
                    if len(num_cells) >= 5:
                        prev_bal = int(num_cells[0])
                        today_bal = int(num_cells[4])
                        diff_bal = today_bal - prev_bal
                        change_rate = round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0
                        print(f"  ✅ [TPEx 官方 HTML] 成功解析上櫃融資: {round(today_bal / 100000, 2)} 億元", flush=True)
                        return {
                            "今日融資餘額_億元": round(today_bal / 100000, 2),
                            "前日融資餘額_億元": round(prev_bal / 100000, 2),
                            "單日增減_億元": round(diff_bal / 100000, 2),
                            "單日增減幅_百分比": change_rate,
                            "本日融資買進_億元": round(int(num_cells[1]) / 100000, 2),
                            "本日融資賣出_億元": round(int(num_cells[2]) / 100000, 2),
                            "現金償還_億元": round(int(num_cells[3]) / 100000, 2),
                            "今日融資餘額_千元": today_bal
                        }
    except Exception as e:
        print(f"  ⚠️ 官方 HTML 報表爬取異常: {e}", flush=True)

    # 策略 2：鉅亨網上櫃信用交易頁面爬蟲 (備援)
    url_cnyes = "https://www.cnyes.com/twstock/margin/otc"
    try:
        res = requests.get(url_cnyes, headers=headers, timeout=15)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, "html.parser")
            text_block = soup.get_text()
            match = re.search(r"融資(?:餘額)?.*?([\d,]+\.?\d*)\s*億", text_block)
            diff_match = re.search(r"融資(?:增減)?.*?([+-]?[\d,]+\.?\d*)\s*億", text_block)
            
            if match:
                today_bal_yi = float(match.group(1).replace(",", ""))
                diff_bal_yi = float(diff_match.group(1).replace(",", "")) if diff_match else 0.0
                prev_bal_yi = round(today_bal_yi - diff_bal_yi, 2)
                change_rate = round((diff_bal_yi / prev_bal_yi) * 100, 2) if prev_bal_yi else 0.0
                print(f"  ✅ [鉅亨網 備援] 成功解析上櫃融資: {today_bal_yi} 億元", flush=True)
                
                return {
                    "今日融資餘額_億元": today_bal_yi,
                    "前日融資餘額_億元": prev_bal_yi,
                    "單日增減_億元": diff_bal_yi,
                    "單日增減幅_百分比": change_rate,
                    "本日融資買進_億元": 0.0,
                    "本日融資賣出_億元": 0.0,
                    "現金償還_億元": 0.0,
                    "今日融資餘額_千元": int(today_bal_yi * 100000)
                }
    except Exception as e:
        print(f"  ⚠️ 鉅亨網備援爬蟲異常: {e}", flush=True)

    return None

def calculate_peak_and_trends(history_rows, balance_key, change_key):
    """
    從資料庫讀出的歷史序列 (由舊到新排序) 動態推算：
    1. 近 3 / 5 / 20 日累計純增減
    2. 近 20 日 / 60 日波段最高點日期、峰值金額、自高點回落金額與百分比
    """
    if not history_rows:
        return {}

    latest = history_rows[-1]
    curr_bal = float(latest.get(balance_key, 0))

    def sum_recent_chg(n):
        subset = history_rows[-n:]
        return round(sum(float(r.get(change_key, 0)) for r in subset), 2)

    def calc_peak_drawdown(n):
        subset = history_rows[-n:]
        # 找出區間內餘額最高的一天（若同高點取較近日期）
        peak_row = max(subset, key=lambda r: (float(r.get(balance_key, 0)), r.get("trade_date", "")))
        peak_bal = float(peak_row.get(balance_key, 0))
        peak_date = peak_row.get("trade_date", "")
        peak_idx = subset.index(peak_row)
        days_since_peak = len(subset) - 1 - peak_idx

        diff_from_peak = round(curr_bal - peak_bal, 2)
        pct_from_peak = round((diff_from_peak / peak_bal) * 100, 2) if peak_bal else 0.0

        return {
            "高點日期": peak_date,
            "高點餘額_億元": peak_bal,
            "自高點增減_億元": diff_from_peak,
            "自高點回落幅_百分比": pct_from_peak,
            "距高點交易日數": days_since_peak
        }

    return {
        "近3日累計增減_億元": sum_recent_chg(3),
        "近5日累計增減_億元": sum_recent_chg(5),
        "近20日累計增減_億元": sum_recent_chg(20),
        "近20日波段高點分析": calc_peak_drawdown(20),
        "近60日波段高點分析": calc_peak_drawdown(60)
    }

def upsert_and_fetch_from_supabase(record_payload):
    """
    步驟 1：將資料寫入 Supabase 寬表 (margin_daily)
    步驟 2：從資料庫讀出當日最新資料與近 60 日歷史紀錄
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key or not HAS_SUPABASE:
        print("⚠️ Supabase 未設定或套件未安裝，跳過資料庫讀寫。", flush=True)
        return None, []

    try:
        supabase: Client = create_client(supabase_url, supabase_key)
        
        # 1. 先寫入 (Upsert) 到方案 B 寬表
        supabase.table("margin_daily").upsert(record_payload, on_conflict="trade_date").execute()
        print(f"✅ [寫入成功] 已將 {record_payload['trade_date']} 寫入 Supabase 寬表 (margin_daily)。", flush=True)
        
        # 2. 再從資料表讀出 (Select) 截至該交易日的近 60 筆歷史紀錄（由新到舊抓出後反轉為由舊到新）
        target_date = record_payload["trade_date"]
        res = (
            supabase.table("margin_daily")
            .select("*")
            .lte("trade_date", target_date)
            .order("trade_date", desc=True)
            .limit(60)
            .execute()
        )
        
        rows = res.data or []
        if not rows:
            print("⚠️ 從資料庫讀回紀錄為空。", flush=True)
            return None, []
            
        latest_db_row = rows[0]  # 最新一筆即為剛寫入的當日資料
        history_asc = list(reversed(rows))  # 轉為時間升冪排序方便計算序列趨勢
        print(f"📖 [讀取成功] 已從 Supabase 讀回 {latest_db_row['trade_date']} 數據（含近 {len(history_asc)} 交易日歷史序列）。", flush=True)
        return latest_db_row, history_asc

    except Exception as e:
        print(f"❌ Supabase 讀寫異常: {e}", flush=True)
        return None, []

def main():
    print("🚀 fetch_margin.py 啟動執行...", flush=True)
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    is_weekend = now_tw.weekday() in [5, 6]

    if is_weekend or current_hour < 20:
        target_date = now_tw - timedelta(days=1)
    else:
        target_date = now_tw

    max_lookback = 10
    twse_data = None
    tpex_data = None
    valid_file_date = ""

    print(f"ℹ️ 當前台灣時間: {now_tw.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
    print(f"🔍 起始檢查日期: {target_date.strftime('%Y-%m-%d')} (回溯上限: {max_lookback} 天)", flush=True)

    for i in range(max_lookback):
        if target_date.weekday() in [5, 6]:
            target_date -= timedelta(days=1)
            continue

        twse_date_str = target_date.strftime("%Y%m%d")
        roc_date_str = f"{target_date.year - 1911}/{target_date.strftime('%m/%d')}"
        check_date_str = target_date.strftime("%Y-%m-%d")

        print(f"📡 [{i+1}/{max_lookback}] 檢查 {check_date_str} (民國 {roc_date_str}) 交易資料...", flush=True)
        twse_data = get_twse_margin(twse_date_str)

        if twse_data:
            valid_file_date = check_date_str
            print("  👉 集中市場鎖定成功，開始解析櫃買市場資料...", flush=True)
            tpex_data = get_tpex_margin(roc_date_str)
            print(f"✅ 成功鎖定有效交易日: {valid_file_date}", flush=True)
            break
        else:
            print(f"  ℹ️ {check_date_str} 查無上市資料，往前推進一天...", flush=True)
            target_date -= timedelta(days=1)
            time.sleep(1)

    if not twse_data:
        print("⚠️ 連續回溯 10 天均未取得有效交易日資料，安全退出。", flush=True)
        return

    # 整理準備寫入方案 B 寬表的欄位資料
    twse_bal = twse_data["今日融資餘額_億元"]
    twse_chg = twse_data["單日增減_億元"]
    tpex_bal = tpex_data["今日融資餘額_億元"] if tpex_data else 0.0
    tpex_chg = tpex_data["單日增減_億元"] if tpex_data else 0.0
    total_bal = round(twse_bal + tpex_bal, 2)
    total_chg = round(twse_chg + tpex_chg, 2)

    db_record = {
        "trade_date": valid_file_date,
        "twse_balance": twse_bal,
        "twse_change": twse_chg,
        "tpex_balance": tpex_bal,
        "tpex_change": tpex_chg,
        "total_balance": total_bal,
        "total_change": total_chg
    }

    # 先寫入 Supabase 資料庫，再從資料庫讀出資料
    db_row, history_asc = upsert_and_fetch_from_supabase(db_record)

    # 以資料庫讀出的數值為準（若資料庫連線失敗則自動降級使用本地記憶體數值）
    if db_row:
        final_date = db_row["trade_date"]
        final_twse_bal = float(db_row["twse_balance"])
        final_twse_chg = float(db_row["twse_change"])
        final_tpex_bal = float(db_row["tpex_balance"])
        final_tpex_chg = float(db_row["tpex_change"])
        final_total_bal = float(db_row["total_balance"])
        final_total_chg = float(db_row["total_change"])
    else:
        final_date = valid_file_date
        final_twse_bal = twse_bal
        final_twse_chg = twse_chg
        final_tpex_bal = tpex_bal
        final_tpex_chg = tpex_chg
        final_total_bal = total_bal
        final_total_chg = total_chg
        history_asc = [db_record]

    prev_total_bal = round(final_total_bal - final_total_chg, 2)
    total_change_rate = round((final_total_chg / prev_total_bal) * 100, 2) if prev_total_bal else 0.0

    # 依據從資料庫讀回的歷史序列，動態計算各市場波段高點與週期趨勢
    total_trends = calculate_peak_and_trends(history_asc, "total_balance", "total_change")
    twse_trends = calculate_peak_and_trends(history_asc, "twse_balance", "twse_change")
    tpex_trends = calculate_peak_and_trends(history_asc, "tpex_balance", "tpex_change")

    # 同步更新細項字典中的核心餘額為資料庫讀出值
    twse_data["今日融資餘額_億元"] = final_twse_bal
    twse_data["單日增減_億元"] = final_twse_chg
    twse_data["趨勢與波段高點"] = twse_trends

    if tpex_data:
        tpex_data["今日融資餘額_億元"] = final_tpex_bal
        tpex_data["單日增減_億元"] = final_tpex_chg
        tpex_data["趨勢與波段高點"] = tpex_trends
    else:
        tpex_data = {
            "今日融資餘額_億元": final_tpex_bal,
            "單日增減_億元": final_tpex_chg,
            "趨勢與波段高點": tpex_trends
        }

    # 組裝由資料庫數據生成的最終 JSON 輸出
    output_payload = {
        "交易日期": final_date,
        "資料來源": "Supabase (margin_daily)",
        "資料更新時間": now_tw.strftime("%Y-%m-%d %H:%M:%S"),
        "全市場融資總結": {
            "全市場融資總餘額_億元": final_total_bal,
            "全市場單日融資增減_億元": final_total_chg,
            "全市場融資增減幅_百分比": total_change_rate,
            "趨勢與波段高點": total_trends
        },
        "集中市場_上市": twse_data,
        "櫃買市場_上櫃": tpex_data
    }

    # 寫入文字檔案 (JSON) 至 docs/
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{final_date}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=4)

    print(f"💾 檔案寫入成功（數據來自 Supabase 讀回）➡️ docs/margin_{final_date}.json", flush=True)
    print(f"📊 {final_date} 上市: {final_twse_bal} 億元 ({final_twse_chg:+.2f} 億元) | 上櫃: {final_tpex_bal} 億元 ({final_tpex_chg:+.2f} 億元) | 合計: {final_total_bal} 億元", flush=True)
    print("🏁 全部流程執行完畢！", flush=True)

if __name__ == "__main__":
    main()
