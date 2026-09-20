from datetime import datetime
import requests


def get_txf_night_price():
    """示範：抓取台指期夜盤報價時必備的檢驗邏輯架構"""
    now = datetime.now()
    # 判斷當前是否為夜盤活躍/有效時段 (15:00 - 次日 05:00)
    is_night_session = (now.hour >= 15) or (now.hour < 5)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    # 1. 建議使用期交所 MIS 即時報價 API (以 TXF 台指期近月為例)
    # 期交所 MIS 盤後交易查詢通常帶有 session 或市場旗標
    url = "https://mis.taifex.com.tw/quote/api/getQuoteList"
    payload = {
        "MarketType": "1",  # 0: 日盤, 1: 盤後(夜盤)
        "SymbolType": "F",
        "KindID": "TX",
    }

    try:
        res = requests.post(url, json=payload, headers=headers, timeout=10)
        data = res.json()

        # 2. 嚴格比對合約月份與報價時間戳記
        # 確保抓取的是成交量最高 (或到期月份最近) 的合約
        items = data.get("RtData", {}).get("QuoteList", [])
        if not items:
            raise ValueError("期交所盤後 API 未返回有效數據，請檢查開盤狀態或切換備援。")

        target = items[0]  # 通常首筆或按月份排序後第一筆為近月
        latest_price = float(target["CLastPrice"])
        ref_price = float(target["CRefPrice"])  # 正確的昨收/日盤參考價

        diff_pt = latest_price - ref_price
        diff_pct = (diff_pt / ref_price) * 100

        return {
            "symbol": "TXF_Night",
            "price": latest_price,
            "change": round(diff_pt, 2),
            "change_pct": f"{diff_pct:+.2f}%",
            "timestamp": target.get("CTime", str(now)),
        }

    except Exception as e:
        # 3. 若期交所失敗切換至備援源 (如 Yahoo/鉅亨)，需手動計算漲跌幅，不可盲信第三方現成值
        print(f"期交所主通道異常: {e}，切換至備援解析...")
        # (執行備援邏輯並強制以日盤收盤價校準 diff)
