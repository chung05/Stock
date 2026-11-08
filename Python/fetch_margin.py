import os
import json
import time
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
}

def get_twse_margin(date_str):
    """
    抓取 TWSE (上市) 全市場信用交易統計
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
    抓取 TPEx (上櫃) 信用交易統計 (修復 null 問題)
    """
    url = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal_result.php?l=zh-tw&d={roc_date_str}"
    headers = dict(COMMON_HEADERS)
    headers["Referer"] = "https://www.tpex.org.tw/web/stock/margin_trading/margin_bal/margin_bal.php?l=zh-tw"
    
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200 or not res.text.strip():
            return None
            
        data = res.json()
        
        # 1. 優先從 reportTot 取總計
        total_data = data.get("reportTot", [])
        if total_data and len(total_data) >= 5:
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
            
        # 2. 備援：若無 reportTot 則遍歷 tables
        for table in data.get("tables", []):
            if "融資" in table.get("title", ""):
                for row in table.get("data", []):
                    if "總計" in str(row[0]) or "合計" in str(row[0]):
                        today_bal = int(str(row[5]).replace(",", ""))
                        prev_bal = int(str(row[4]).replace(",", ""))
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
    except Exception as e:
        print(f"⚠️ TPEx 抓取異常: {e}")
        return None

def update_and_calculate_trends(target_dir, current_record):
    """
    讀取歷史每日記錄，計算近 1 日、3 日、5 日、20 日、60 日的累計增減與高點減幅
    """
    history_file = os.path.join(target_dir, "margin_history.json")
    history = []
    
    if os.path.exists(history_file):
        try:
            with open(history_file, "r", encoding="utf-8") as f:
                history = json.load(f)
        except:
            history = []

    # 依日期去重並加入當日
    history = [h for h in history if h.get("日期") != current_record["日期"]]
    history.append({
        "日期": current_record["日期"],
        "全市場融資總餘額_億元": current_record["全市場融資總結"]["全市場融資總餘額_億元"],
        "上市融資餘額_億元": current_record["集中市場_上市"]["今日融資餘額_億元"],
        "上櫃融資餘額_億元": current_record["櫃買市場_上櫃"]["今日融資餘額_億元"] if current_record.get("櫃買市場_上櫃") else 0.0
    })
    
    # 依日期由舊到新排序
    history.sort(key=lambda x: x["日期"])

    # 寫回歷史檔
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=4)

    # 計算多週期統計
    current_val = current_record["全市場融資總結"]["全市場融資總餘額_億元"]
    total_len = len(history)

    def calc_period_stat(days):
        if total_len <= days:
            return {"說明": f"歷史資料不足 {days} 個交易日"}
        past_val = history[-1 - days]["全市場融資總餘額_億元"]
        diff = round(current_val - past_val, 2)
        rate = round((diff / past_val) * 100, 2) if past_val else 0.0
        return {
            "比較基準日": history[-1 - days]["日期"],
            "期間增減_億元": diff,
            "期間增減幅_百分比": rate
        }

    # 近 60 日 (一季) 高點回落幅度分析 (去槓桿指標)
    recent_60 = history[-60:] if total_len >= 60 else history
    max_record = max(recent_60, key=lambda x: x["全市場融資總餘額_億元"])
    peak_val = max_record["全市場融資總餘額_億元"]
    drop_from_peak = round(current_val - peak_val, 2)
    drop_rate = round((drop_from_peak / peak_val) * 100, 2) if peak_val else 0.0

    analysis = {
        "比昨天": calc_period_stat(1),
        "近3日累計": calc_period_stat(3),
        "近5日累計_一週": calc_period_stat(5),
        "近20日累計_一個月": calc_period_stat(20),
        "近60日波段最高點分析_一季": {
            "波段最高點日期": max_record["日期"],
            "波段最高餘額_億元": peak_val,
            "自最高點累積增減_億元": drop_from_peak,
            "自最高點累積減幅_百分比": drop_rate
        }
    }
    
    return analysis

def main():
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    
    if current_hour < 20: 
        base_date = now_tw - timedelta(days=1)
    else:
        base_date = now_tw

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
        tpex_data = get_tpex_margin(roc_date_str)
        
        if twse_data:
            valid_file_date = check_date_str
            print(f"✅ 成功鎖定交易日: {valid_file_date}")
            break
        else:
            print(f"  ℹ️ {check_date_str} 為休假日或尚未公布，往前一天尋找...")
            target_date -= timedelta(days=1)
            time.sleep(1)

    if not twse_data:
        print("⚠️ 連續 7 天均無交易資料，結束執行。")
        return

    # 計算全市場總和
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
        "日期": valid_file_date,
        "資料更新時間": now_tw.strftime("%Y-%m-%d %H:%M:%S"),
        "全市場融資總結": {
            "全市場融資總餘額_億元": total_margin,
            "全市場單日融資增減_億元": total_change,
            "全市場融資增減幅_百分比": total_change_rate
        },
        "集中市場_上市": twse_data,
        "櫃買市場_上櫃": tpex_data
    }

    # 儲存目錄
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)

    # 執行歷史累積與多週期統計運算
    period_trends = update_and_calculate_trends(target_dir, payload)
    payload["波段趨勢統計"] = period_trends

    file_path = os.path.join(target_dir, f"margin_{valid_file_date}.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"💾 存檔成功 ➡️ 目的地: docs/margin_{valid_file_date}.json 與 docs/margin_history.json")
    print(f"📊 {valid_file_date} 全市場融資餘額: {total_margin} 億元 (單日增減: {total_change} 億元)")

if __name__ == "__main__":
    main()
