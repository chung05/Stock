import os
import json
import time
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

try:
    from supabase import create_client, Client
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False

TW_TZ = ZoneInfo("Asia/Taipei")

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
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
        print(f"⚠️ TWSE 抓取異常: {e}")
        return None

def get_tpex_margin(roc_date_str):
    """
    抓取 TPEx (上櫃) 信用交易統計
    roc_date_str 格式: 115/11/06
    """
    session = requests.Session()
    headers = dict(COMMON_HEADERS)
    headers["Referer"] = "https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal.php?l=zh-tw"
    headers["X-Requested-With"] = "XMLHttpRequest"

    # 方案 1：官方報表 API（指定日期）
    url_web = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal_result.php?l=zh-tw&d={roc_date_str}"
    try:
        session.get("https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal.php?l=zh-tw", headers=headers, timeout=10)
        res = session.get(url_web, headers=headers, timeout=15)
        
        if res.status_code == 200 and res.text.strip().startswith("{"):
            data = res.json()
            tot = data.get("reportTot", [])
            if tot and len(tot) >= 6:
                today_bal = int(str(tot[5]).replace(",", ""))
                prev_bal = int(str(tot[4]).replace(",", ""))
                diff_bal = today_bal - prev_bal
                return {
                    "今日融資餘額_億元": round(today_bal / 100000, 2),
                    "前日融資餘額_億元": round(prev_bal / 100000, 2),
                    "單日增減_億元": round(diff_bal / 100000, 2),
                    "單日增減幅_百分比": round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0,
                    "今日融資餘額_千元": today_bal
                }
            
            for table in data.get("tables", []):
                for row in table.get("data", []):
                    if len(row) >= 6 and ("合計" in str(row[0]) or "全市場" in str(row[0]) or "融資" in str(row[0])):
                        today_bal = int(str(row[5]).replace(",", ""))
                        prev_bal = int(str(row[4]).replace(",", ""))
                        diff_bal = today_bal - prev_bal
                        return {
                            "今日融資餘額_億元": round(today_bal / 100000, 2),
                            "前日融資餘額_億元": round(prev_bal / 100000, 2),
                            "單日增減_億元": round(diff_bal / 100000, 2),
                            "單日增減幅_百分比": round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0,
                            "今日融資餘額_千元": today_bal
                        }
    except Exception as e:
        print(f"⚠️ TPEx 方案 1 抓取異常: {e}")

    # 方案 2：TPEx 官方 OpenAPI 備援
    url_openapi = "https://www.tpex.org.tw/openapi/v1/mkt_margin_trade"
    try:
        res = session.get(url_openapi, headers={"User-Agent": headers["User-Agent"]}, timeout=15)
        if res.status_code == 200 and res.text.strip().startswith("["):
            items = res.json()
            for row in items:
                if "融資" in row.get("Item", "") or "合計" in row.get("Item", ""):
                    today_bal = int(str(row.get("TodayBalance", "0")).replace(",", ""))
                    prev_bal = int(str(row.get("PreviousBalance", "0")).replace(",", ""))
                    diff_bal = today_bal - prev_bal
                    return {
                        "今日融資餘額_億元": round(today_bal / 100000, 2),
                        "前日融資餘額_億元": round(prev_bal / 100000, 2),
                        "單日增減_億元": round(diff_bal / 100000, 2),
                        "單日增減幅_百分比": round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0,
                        "今日融資餘額_千元": today_bal
                    }
    except Exception as e:
        print(f"⚠️ TPEx 方案 2 抓取異常: {e}")

    return None

def save_to_supabase(trade_date, twse_data, tpex_data):
    """
    寫入 Supabase 資料庫（窄表架構：上市/上櫃分別獨立一筆記錄）
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        print("ℹ️ 未設定 SUPABASE_URL 或 SUPABASE_KEY 環境變數，略過資料庫寫入。")
        return

    if not HAS_SUPABASE:
        print("⚠️ 未安裝 supabase 套件（pip install supabase），略過資料庫寫入。")
        return

    try:
        supabase: Client = create_client(supabase_url, supabase_key)
        records = []
        
        # 1. 上市紀錄
        records.append({
            "trade_date": trade_date,
            "market": "TWSE",
            "margin_balance": twse_data["今日融資餘額_億元"],
            "margin_change": twse_data["單日增減_億元"]
        })
        
        # 2. 上櫃紀錄
        if tpex_data:
            records.append({
                "trade_date": trade_date,
                "market": "TPEX",
                "margin_balance": tpex_data["今日融資餘額_億元"],
                "margin_change": tpex_data["單日增減_億元"]
            })

        supabase.table("margin_daily").upsert(records, on_conflict="trade_date,market").execute()
        print(f"✅ Supabase 資料庫寫入成功（共寫入 {len(records)} 列資料）。")
    except Exception as e:
        print(f"❌ Supabase 寫入異常: {e}")

def main():
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    is_weekend = now_tw.weekday() in [5, 6]

    # 判定起點：若在週末或平日晚上 20:00 前執行，自動啟動回溯尋找最近營業日
    if is_weekend or current_hour < 20:
        print(f"ℹ️ 當前時間 ({now_tw.strftime('%Y-%m-%d %H:%M')}) 非結算公布時段，自動回溯尋找最近營業日...")
        target_date = now_tw - timedelta(days=1)
        max_lookback = 7
    else:
        target_date = now_tw
        max_lookback = 1

    twse_data = None
    tpex_data = None
    valid_file_date = ""

    # 交易日輪巡檢查
    for _ in range(max_lookback):
        # 遇週末直接略過
        if target_date.weekday() in [5, 6]:
            target_date -= timedelta(days=1)
            continue

        twse_date_str = target_date.strftime("%Y%m%d")
        roc_date_str = f"{target_date.year - 1911}/{target_date.strftime('%m/%d')}"
        check_date_str = target_date.strftime("%Y-%m-%d")

        print(f"📡 檢查 {check_date_str} (民國 {roc_date_str}) 交易資料...")
        twse_data = get_twse_margin(twse_date_str)

        if twse_data:
            valid_file_date = check_date_str
            tpex_data = get_tpex_margin(roc_date_str)
            print(f"✅ 成功鎖定交易日: {valid_file_date}")
            break
        else:
            print(f"  ℹ️ {check_date_str} 查無資料（可能為國定假日/未公布）。")
            target_date -= timedelta(days=1)
            time.sleep(1)

    if not twse_data:
        print("⚠️ 未取得任何有效交易日資料，安全退出。")
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

    # 存入 docs 目錄（路徑參考 fetch_rss.py）
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{valid_file_date}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"💾 檔案存檔成功 ➡️ 目的地: docs/margin_{valid_file_date}.json")
    print(f"📊 {valid_file_date} 上市: {twse_bal} 億元 ({twse_chg} 億元) | 上櫃: {tpex_bal} 億元 ({tpex_chg} 億元)")

    # 寫入 Supabase 資料庫
    save_to_supabase(valid_file_date, twse_data, tpex_data)

if __name__ == "__main__":
    main()
