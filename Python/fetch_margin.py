import os
import json
import time
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

def get_twse_margin(date_str):
    """
    抓取 TWSE (上市) 全市場信用交易統計
    API 格式: YYYYMMDD
    """
    url = f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={date_str}&response=json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200:
            return None
        data = res.json()
        if data.get("stat") != "OK":
            return None
            
        result = {}
        # 尋找信用交易統計總表 (通常為 tables[0])
        for table in data.get("tables", []):
            if "信用交易統計" in table.get("title", ""):
                for row in table.get("data", []):
                    # 抓取大盤融資金額 (仟元)
                    if "融資金額(仟元)" in row[0]:
                        result = {
                            "today_balance_thousand_ntd": int(row[5].replace(",", "")),
                            "today_balance_hundred_million_ntd": round(int(row[5].replace(",", "")) / 100000, 2),
                            "prev_balance_hundred_million_ntd": round(int(row[4].replace(",", "")) / 100000, 2),
                            "buy_hundred_million_ntd": round(int(row[1].replace(",", "")) / 100000, 2),
                            "sell_hundred_million_ntd": round(int(row[2].replace(",", "")) / 100000, 2),
                            "repay_hundred_million_ntd": round(int(row[3].replace(",", "")) / 100000, 2)
                        }
                        # 計算單日增減 (億元)
                        result["change_hundred_million_ntd"] = round(
                            result["today_balance_hundred_million_ntd"] - result["prev_balance_hundred_million_ntd"], 2
                        )
                        break
        return result
    except Exception as e:
        print(f"⚠️ 抓取 TWSE 異常: {e}")
        return None

def get_tpex_margin(roc_date_str):
    """
    抓取 TPEx (上櫃) 信用交易統計
    格式: 民國年/MM/DD (例如 115/11/06)
    """
    url = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal_result.php?l=zh-tw&d={roc_date_str}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200:
            return None
        data = res.json()
        
        # 取得上櫃融資總計
        total_data = data.get("reportTot", [])
        if total_data and len(total_data) > 0:
            today_bal = int(str(total_data[4]).replace(",", "")) # 融資今日餘額(仟元)
            prev_bal = int(str(total_data[3]).replace(",", ""))  # 融資前日餘額(仟元)
            return {
                "today_balance_hundred_million_ntd": round(today_bal / 100000, 2),
                "prev_balance_hundred_million_ntd": round(prev_bal / 100000, 2),
                "change_hundred_million_ntd": round((today_bal - prev_bal) / 100000, 2)
            }
        return None
    except Exception as e:
        print(f"⚠️ 抓取 TPEx 異常: {e}")
        return None

def main():
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    
    # 依照 fetch_rss.py 邏輯判定資料歸屬日期：
    # 若在凌晨 00:00~11:59 執行，資料歸屬為前一天；下午或晚上執行，歸屬當天
    if current_hour < 12:
        target_date = now_tw - timedelta(days=1)
    else:
        target_date = now_tw

    file_date_str = target_date.strftime("%Y-%m-%d")
    twse_date_str = target_date.strftime("%Y%m%d")
    roc_date_str = f"{target_date.year - 1911}/{target_date.strftime('%m/%d')}"

    # 設定儲存目錄與檔名（比照 fetch_rss 的 ../docs/ 規則）
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{file_date_str}.json")

    print(f"📡 開始擷取 {file_date_str} (民國 {roc_date_str}) 融資水位數據...")

    # 重試機制（若結算未完成，最多嘗試 3 次，每次間隔 10 秒）
    twse_data = None
    for attempt in range(1, 4):
        print(f"  [嘗試 {attempt}/3] 抓取上市 (TWSE)...")
        twse_data = get_twse_margin(twse_date_str)
        if twse_data:
            break
        time.sleep(10)

    tpex_data = get_tpex_margin(roc_date_str)

    if not twse_data:
        print(f"⚠️ {file_date_str} 資料尚未公布或非交易日，略過儲存。")
        return

    # 彙整上市櫃總計
    total_margin_market = twse_data["today_balance_hundred_million_ntd"]
    total_margin_change = twse_data["change_hundred_million_ntd"]

    if tpex_data:
        total_margin_market = round(total_margin_market + tpex_data["today_balance_hundred_million_ntd"], 2)
        total_margin_change = round(total_margin_change + tpex_data["change_hundred_million_ntd"], 2)

    payload = {
        "date": file_date_str,
        "updated_at": now_tw.strftime("%Y-%m-%d %H:%M:%S"),
        "market_summary": {
            "total_margin_balance_hundred_million_ntd": total_margin_market,
            "total_margin_change_hundred_million_ntd": total_margin_change
        },
        "twse_listed": twse_data,
        "tpex_otc": tpex_data
    }

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"💾 融資水位存檔成功 ➡️ 目的地: docs/margin_{file_date_str}.json")
    print(f"📊 上市融資餘額: {twse_data['today_balance_hundred_million_ntd']} 億元 (單日增減: {twse_data['change_hundred_million_ntd']} 億元)")

if __name__ == "__main__":
    main()
