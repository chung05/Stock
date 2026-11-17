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

def save_to_supabase(trade_date, twse_data, tpex_data):
    """
    寫入 Supabase 資料庫
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        print("ℹ️ 未設定 SUPABASE_URL 或 SUPABASE_KEY 環境變數，略過資料庫寫入。", flush=True)
        return

    if not HAS_SUPABASE:
        print("⚠️ 未安裝 supabase 套件，略過資料庫寫入。", flush=True)
        return

    try:
        supabase: Client = create_client(supabase_url, supabase_key)
        records = [
            {
                "trade_date": trade_date,
                "market": "TWSE",
                "margin_balance": twse_data["今日融資餘額_億元"],
                "margin_change": twse_data["單日增減_億元"]
            }
        ]
        
        if tpex_data:
            records.append({
                "trade_date": trade_date,
                "market": "TPEX",
                "margin_balance": tpex_data["今日融資餘額_億元"],
                "margin_change": tpex_data["單日增減_億元"]
            })

        supabase.table("margin_daily").upsert(records, on_conflict="trade_date,market").execute()
        print(f"✅ Supabase 資料庫寫入成功（共寫入 {len(records)} 列資料）。", flush=True)
    except Exception as e:
        print(f"❌ Supabase 寫入異常: {e}", flush=True)

def main():
    print("🚀 fetch_margin.py 啟動執行...", flush=True)
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    is_weekend = now_tw.weekday() in [5, 6]

    # 若在 20:30 前或週末執行，起始查詢點為昨日
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
        # 排除週末
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
            print(f"  👉 集中市場鎖定成功，開始解析櫃買市場資料...", flush=True)
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

    twse_bal = twse_data["今日融資餘額_億元"]
    twse_chg = twse_data["單日增減_億元"]
    prev_twse = twse_data["前日融資餘額_億元"]

    tpex_bal = tpex_data["今日融資餘額_億元"] if tpex_data else 0.0
    tpex_chg = tpex_data["單日增減_億元"] if tpex_data else 0.0
    prev_tpex = tpex_data["前日融資餘額_億元"] if tpex_data else 0.0

    total_margin = round(twse_bal + tpex_bal, 2)
    total_change = round(twse_chg + tpex_chg, 2)
    prev_total = round(prev_twse + prev_tpex, 2)
    total_change_rate = round((total_change / prev_total) * 100, 2) if prev_total else 0.0

    payload = {
        "交易日期": valid_file_date,
        "資料更新時間": now_tw.strftime("%Y-%m-%d %H:%M:%S"),
        "全市場融資總結": {
            "全市場融資總餘額_億元": total_margin,
            "全市場單日融資增減_億元": total_change,
            "全市場融資增減幅_百分比": total_change_rate
        },
        "集中市場_上市": twse_data,
        "櫃買市場_上櫃": tpex_data
    }

    # 存檔至 docs/
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{valid_file_date}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"💾 檔案存檔成功 ➡️ 目的地: docs/margin_{valid_file_date}.json", flush=True)
    print(f"📊 {valid_file_date} 上市: {twse_bal} 億元 ({twse_chg} 億元) | 上櫃: {tpex_bal} 億元 ({tpex_chg} 億元)", flush=True)

    save_to_supabase(valid_file_date, twse_data, tpex_data)
    print("🏁 全部流程執行完畢！", flush=True)

if __name__ == "__main__":
    main()
