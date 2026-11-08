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
        for table in data.get("tables", []):
            if "信用交易統計" in table.get("title", ""):
                for row in table.get("data", []):
                    if "融資金額(仟元)" in row[0]:
                        today_val = int(row[5].replace(",", ""))
                        prev_val = int(row[4].replace(",", ""))
                        result = {
                            "today_balance_thousand_ntd": today_val,
                            "today_balance_hundred_million_ntd": round(today_val / 100000, 2),
                            "prev_balance_hundred_million_ntd": round(prev_val / 100000, 2),
                            "buy_hundred_million_ntd": round(int(row[1].replace(",", "")) / 100000, 2),
                            "sell_hundred_million_ntd": round(int(row[2].replace(",", "")) / 100000, 2),
                            "repay_hundred_million_ntd": round(int(row[3].replace(",", "")) / 100000, 2),
                            "change_hundred_million_ntd": round((today_val - prev_val) / 100000, 2)
                        }
                        break
        return result
    except Exception as e:
        return None

def get_tpex_margin(roc_date_str):
    """
    抓取 TPEx (上櫃) 信用交易統計
    """
    url = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal_result.php?l=zh-tw&d={roc_date_str}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200 or not res.text.strip().startswith("{"):
            return None  # 避免休假日非 JSON 內容拋出 Exception
            
        data = res.json()
        total_data = data.get("reportTot", [])
        if total_data and len(total_data) > 4:
            today_bal = int(str(total_data[4]).replace(",", ""))
            prev_bal = int(str(total_data[3]).replace(",", ""))
            return {
                "today_balance_hundred_million_ntd": round(today_bal / 100000, 2),
                "prev_balance_hundred_million_ntd": round(prev_bal / 100000, 2),
                "change_hundred_million_ntd": round((today_bal - prev_bal) / 100000, 2)
            }
        return None
    except Exception:
        return None

def main():
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    
    # 決定起始基準日
    if current_hour < 20: 
        # 晚上 20:00 前證交所通常尚未結算完成，往前推一天
        base_date = now_tw - timedelta(days=1)
    else:
        base_date = now_tw

    # 智慧回溯：若當日是週末或查無資料，自動往前尋找最近一個有開盤的交易日（最多往前找 7 天）
    target_date = base_date
    twse_data = None
    tpex_data = None
    valid_file_date = ""

    for _ in range(7):
        twse_date_str = target_date.strftime("%Y%m%d")
        roc_date_str = f"{target_date.year - 1911}/{target_date.strftime('%m/%d')}"
        check_date_str = target_date.strftime("%Y-%m-%d")
        
        print(f"📡 嘗試確認 {check_date_str} (民國 {roc_date_str}) 交易資料...")
        twse_data = get_twse_margin(twse_date_str)
        
        if twse_data:
            valid_file_date = check_date_str
            tpex_data = get_tpex_margin(roc_date_str)
            print(f"✅ 成功鎖定交易日: {valid_file_date}")
            break
        else:
            print(f"  ℹ️ {check_date_str} 為休假日或尚未公布，往前一天尋找...")
            target_date -= timedelta(days=1)
            time.sleep(1)

    if not twse_data:
        print("⚠️ 連續 7 天均無交易資料，結束執行。")
        return

    # 計算市場總計
    total_margin_market = twse_data["today_balance_hundred_million_ntd"]
    total_margin_change = twse_data["change_hundred_million_ntd"]

    if tpex_data:
        total_margin_market = round(total_margin_market + tpex_data["today_balance_hundred_million_ntd"], 2)
        total_margin_change = round(total_margin_change + tpex_data["change_hundred_million_ntd"], 2)

    payload = {
        "date": valid_file_date,
        "updated_at": now_tw.strftime("%Y-%m-%d %H:%M:%S"),
        "market_summary": {
            "total_margin_balance_hundred_million_ntd": total_margin_market,
            "total_margin_change_hundred_million_ntd": total_margin_change
        },
        "twse_listed": twse_data,
        "tpex_otc": tpex_data
    }

    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{valid_file_date}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"💾 存檔成功 ➡️ 目的地: docs/margin_{valid_file_date}.json")
    print(f"📊 {valid_file_date} 上市融資餘額: {twse_data['today_balance_hundred_million_ntd']} 億元 (單日增減: {twse_data['change_hundred_million_ntd']} 億元)")

if __name__ == "__main__":
    main()
