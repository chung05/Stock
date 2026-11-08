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
                        buy_val = int(row[1].replace(",", ""))
                        sell_val = int(row[2].replace(",", ""))
                        repay_val = int(row[3].replace(",", ""))
                        diff_val = today_val - prev_val
                        change_rate = round((diff_val / prev_val) * 100, 2) if prev_val else 0.0

                        result = {
                            "今日融資餘額_億元": round(today_val / 100000, 2),
                            "前日融資餘額_億元": round(prev_val / 100000, 2),
                            "單日增減_億元": round(diff_val / 100000, 2),
                            "單日增減幅_百分比": change_rate,
                            "本日融資買進_億元": round(buy_val / 100000, 2),
                            "本日融資賣出_億元": round(sell_val / 100000, 2),
                            "現金償還_億元": round(repay_val / 100000, 2),
                            "今日融資餘額_千元": today_val
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
            return None
            
        data = res.json()
        total_data = data.get("reportTot", [])
        if total_data and len(total_data) > 4:
            today_bal = int(str(total_data[4]).replace(",", ""))
            prev_bal = int(str(total_data[3]).replace(",", ""))
            diff_bal = today_bal - prev_bal
            change_rate = round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0

            return {
                "今日融資餘額_億元": round(today_bal / 100000, 2),
                "前日融資餘額_億元": round(prev_bal / 100000, 2),
                "單日增減_億元": round(diff_bal / 100000, 2),
                "單日增減幅_百分比": change_rate,
                "今日融資餘額_千元": today_bal
            }
        return None
    except Exception:
        return None

def main():
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    
    # 決定起始基準日：晚上 20:00 前證交所通常尚未結算完成，往前推一天
    if current_hour < 20: 
        base_date = now_tw - timedelta(days=1)
    else:
        base_date = now_tw

    target_date = base_date
    twse_data = None
    tpex_data = None
    valid_file_date = ""

    # 自動回溯最近交易日
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

    # 計算全市場（上市 + 上櫃）總和
    total_margin = twse_data["今日融資餘額_億元"]
    total_change = twse_data["單日增減_億元"]
    prev_total = twse_data["前日融資餘額_億元"]

    if tpex_data:
        total_margin = round(total_margin + tpex_data["今日融資餘額_億元"], 2)
        total_change = round(total_change + tpex_data["單日增減_億元"], 2)
        prev_total = round(prev_total + tpex_data["前日融資餘額_億元"], 2)

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

    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"margin_{valid_file_date}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"💾 存檔成功 ➡️ 目的地: docs/margin_{valid_file_date}.json")
    print(f"📊 {valid_file_date} 上市融資餘額: {twse_data['今日融資餘額_億元']} 億元 (單日增減: {twse_data['單日增減_億元']} 億元, 增減幅: {twse_data['單日增減幅_百分比']}%)")

if __name__ == "__main__":
    main()
