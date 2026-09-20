import os
import json
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

def clean_html_content(html_text):
    if not html_text: 
        return ""
    soup = BeautifulSoup(html_text, 'html.parser')
    for script in soup(["script", "style"]):
        script.extract()
    return soup.get_text(separator="\n").strip()

def fetch_yahoo_chart_quote(symbol, display_name, session):
    """
    使用 Yahoo Finance v8 chart 接口獲取美股與 ADR 行情
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }
    try:
        res = session.get(url, headers=headers, timeout=12)
        if res.status_code == 200:
            data_json = res.json()
            result = data_json.get('chart', {}).get('result', [])
            if result:
                meta = result[0].get('meta', {})
                price = meta.get("regularMarketPrice") or meta.get("previousClose", 0)
                prev_close = meta.get("chartPreviousClose") or meta.get("previousClose", price)
                
                change = round(price - prev_close, 2)
                change_pct = round((change / prev_close) * 100, 2) if prev_close else 0.0
                market_time = meta.get("regularMarketTime", int(time.time()))
                
                return {
                    "name": display_name,
                    "price": round(price, 2),
                    "change": change,
                    "change_pct": change_pct,
                    "time": datetime.fromtimestamp(market_time, tz=TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                }
    except Exception as e:
        pass
    return None

def fetch_cnyes_futures_quote():
    """
    第一優先：透過鉅亨網期貨即時聚合 API 抓取台指期主力近月
    """
    url = "https://invest.cnyes.com/api/v1/futures/realtime?symbol=TXF"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }
    try:
        res = requests.get(url, headers=headers, timeout=8)
        if res.status_code == 200:
            res_json = res.json()
            data = res_json.get('data', {})
            price = float(data.get('lastPrice') or data.get('close') or 0)
            change = float(data.get('change') or 0)
            change_pct = float(data.get('changeRate') or (data.get('changePercent') or 0))

            if price > 30000:
                return {
                    "name": "台指期貨(近月)",
                    "price": round(price, 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2),
                    "time": datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                }
    except Exception:
        pass
    return None

def fetch_taifex_near_month_quote():
    """
    第二優先：解析期交所每日行情，嚴格鎖定【近月主力合約】（排除遠月與跨月價差合約）
    """
    now = datetime.now(TW_TZ)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    for day_offset in range(4):
        target_day = now - timedelta(days=day_offset)
        date_str = target_day.strftime("%Y/%m/%d")
        url = "https://www.taifex.com.tw/cht/3/futDataDown"
        payload = {
            "down_type": "1",
            "queryStartDate": date_str,
            "queryEndDate": date_str,
            "commodity_id": "TX"
        }
        try:
            res = requests.post(url, data=payload, headers=headers, timeout=10)
            if res.status_code == 200 and res.text:
                lines = [line.strip() for line in res.text.strip().split("\n") if line.strip()]
                if len(lines) > 1:
                    headers_list = [h.replace('"', '').strip() for h in lines[0].split(",")]
                    
                    def get_idx(keys):
                        for i, h in enumerate(headers_list):
                            if any(k in h for k in keys): return i
                        return -1

                    idx_sym = get_idx(["契約代碼", "契約"])
                    idx_month = get_idx(["到期月份", "月份"])
                    idx_close = get_idx(["最後成交價", "結算價", "收盤價"])
                    idx_change = get_idx(["漲跌價", "漲跌"])
                    idx_session = get_idx(["交易時段"])

                    valid_contracts = []

                    # 正向讀取所有大台指單一月份合約
                    for line in lines[1:]:
                        parts = [p.replace('"', '').strip() for p in line.split(",")]
                        if len(parts) <= max(idx_sym, idx_month, idx_close):
                            continue
                            
                        commodity = parts[idx_sym] if idx_sym != -1 else ""
                        month = parts[idx_month] if idx_month != -1 else ""
                        session = parts[idx_session] if idx_session != -1 else ""

                        # 必須為 TX，且排斥價差合約 (不含 '/')
                        if commodity == "TX" and "/" not in month and month.isdigit():
                            price_str = parts[idx_close] if idx_close != -1 else ""
                            change_str = parts[idx_change] if idx_change != -1 else "0"
                            try:
                                p_val = float(price_str.replace("-", "0"))
                                c_val = float(change_str.replace("-", "0"))
                                if p_val > 30000:
                                    valid_contracts.append({
                                        "month": int(month),
                                        "price": p_val,
                                        "change": c_val,
                                        "is_night": ("盤後" in session)
                                    })
                            except ValueError:
                                continue

                    if valid_contracts:
                        # 💡 關鍵修正：依月份從小到大排序，永遠選取最小到期月份（即真正的「近月」主力！）
                        valid_contracts.sort(key=lambda x: (not x["is_night"], x["month"]))
                        target_contract = valid_contracts[0]

                        p_val = target_contract["price"]
                        c_val = target_contract["change"]
                        prev_p = p_val - c_val
                        c_pct = round((c_val / prev_p) * 100, 2) if prev_p else 0.0

                        return {
                            "name": "台指期貨(近月)",
                            "price": p_val,
                            "change": c_val,
                            "change_pct": c_pct,
                            "time": target_day.strftime('%Y-%m-%d %H:%M:%S')
                        }
        except Exception:
            continue
    return None

def fetch_night_market_data(file_date_str):
    """抓取海外指數、美股 ADR 與台指期夜盤，儲存至 docs/market_*.json"""
    targets = {
        "台積電ADR": "TSM",
        "道瓊工業指數": "^DJI",
        "那斯達克指數": "^IXIC",
        "費城半導體指數": "^SOX"
    }
    
    market_data = {}
    print("\n📡 開始抓取夜盤與海外市場最新數據...")
    session = requests.Session()
    
    # 1. 美股四大指數與 ADR
    for name, symbol in targets.items():
        quote = fetch_yahoo_chart_quote(symbol, name, session)
        if quote:
            market_data[name] = quote
            print(f"  ✅ 成功取得 {name}: {quote['price']} ({quote['change_pct']:.2f}%)")
        else:
            print(f"  ❌ 未能取得 {name} ({symbol})")

    # 2. 台指期貨近月夜盤
    print("  📡 正在連線台指期近月報價 (優先鉅亨 / Yahoo / 期交所鎖定近月)...")
    
    # 順序 A: 鉅亨期貨 JSON
    tx_quote = fetch_cnyes_futures_quote()
    
    # 順序 B: Yahoo 點分格式 (WTX.F)
    if not tx_quote:
        tx_quote = fetch_yahoo_chart_quote("WTX.F", "台指期貨(近月)", session)
        
    # 順序 C: 期交所近月絕對鎖定
    if not tx_quote:
        tx_quote = fetch_taifex_near_month_quote()

    if tx_quote:
        market_data["台指期貨(近月)"] = tx_quote
        print(f"  ✅ 成功取得 台指期貨(近月): {tx_quote['price']} (漲跌: {tx_quote['change']} 點, {tx_quote['change_pct']:.2f}%)")
    else:
        print("  ❌ 未能取得 台指期貨(近月) 行情")
            
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"market_{file_date_str}.json"
    file_path = os.path.join(target_dir, filename)
    
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(market_data, f, ensure_ascii=False, indent=4)
    print(f"💾 海外與夜盤數據儲存成功: docs/{filename} (共 {len(market_data)} 筆數據)")

def main():
    now_tw = datetime.now(TW_TZ)
    
    # 前一日 13:30 到當天 07:00
    end_time = now_tw.replace(hour=7, minute=0, second=0, microsecond=0)
    yesterday = end_time - timedelta(days=1)
    start_time = yesterday.replace(hour=13, minute=30, second=0, microsecond=0)
    
    file_date_str = yesterday.strftime("%Y-%m-%d")
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"cnyes_{file_date_str}.json"
    file_path = os.path.join(target_dir, filename)
    
    existing_articles = []
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                existing_articles = json.load(f)
        except Exception: 
            pass
        
    seen_links = {a['link'] for a in existing_articles}
    
    url = f"https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?startAt={start_ts}&endAt={end_ts}&limit=100"
    
    print(f"📡 [鉅亨網] 抓取時間區間: {start_time} 至 {end_time}")
    try:
        res = requests.get(url, timeout=15)
        if res.status_code == 200:
            data_list = res.json().get('items', {}).get('data', [])
            print(f"📡 [鉅亨網] API回傳共 {len(data_list)} 筆，進行重複過濾與解析...")
            
            new_count = 0
            for item in data_list:
                news_id = item.get('newsId')
                news_link = f"https://news.cnyes.com/news/id/{news_id}"
                
                if news_link in seen_links:
                    continue
                    
                raw_html_content = item.get('content', '')
                full_content = clean_html_content(raw_html_content)
                if not full_content:
                    full_content = item.get('summary', '')
                    
                existing_articles.append({
                    "source": "鉅亨網",
                    "title": item.get('title'),
                    "summary": item.get('summary', ''),
                    "content": full_content,
                    "link": news_link,
                    "time": datetime.fromtimestamp(item.get('publishAt'), tz=TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                })
                seen_links.add(news_link)
                new_count += 1
                
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(existing_articles, f, ensure_ascii=False, indent=4)
            print(f"💾 鉅亨網儲存成功: docs/{filename} (本次新增: {new_count} 筆，總累積: {len(existing_articles)} 筆)")
    except Exception as e:
        print(f"❌ 鉅亨網抓取失敗: {e}")

    # 執行海外與夜盤數據抓取
    fetch_night_market_data(file_date_str)

if __name__ == "__main__":
    main()
