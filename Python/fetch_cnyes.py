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
    （支援美股盤後/收盤價，免除 v7 quote 的 401/403 驗證阻擋）
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
        else:
            print(f"  ⚠️ Yahoo v8 回傳異常狀態碼 {res.status_code} ({display_name} - {symbol})")
    except Exception as e:
        print(f"  ❌ 抓取 {display_name} ({symbol}) 失敗: {e}")
    return None

def fetch_cnyes_wtxp_quote():
    """
    主力來源：透過鉅亨網 (Anue) API 抓取「台指期盤後 (WTXP&)」即時行情報價
    關鍵：WTXP& 的 '&' 符號在 URL 中必須以 %26 編碼，否則會被截斷
    """
    candidate_urls = [
        # 1. 台指期盤後主力合約 (WTXP&)
        "https://ws.api.cnyes.com/ws/api/v1/quote/quotes/WTXP%26:FUTURE:WTXP%26",
        # 2. 鉅亨網常規 TXF 備援接口
        "https://ws.api.cnyes.com/ws/api/v1/quote/quotes/TXF:FUTURE:TXF"
    ]
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    for url in candidate_urls:
        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code == 200:
                res_json = res.json()
                data = res_json.get('data', [])
                if data:
                    item = data[0] if isinstance(data, list) else data
                    # 鉅亨期貨欄位: 6:最新成交價, 11:昨收價, 12:漲跌額, 56:漲跌幅(%)
                    price = float(item.get('6') or item.get('29') or 0)
                    ref_price = float(item.get('11') or price)
                    change = float(item.get('12') or (price - ref_price))
                    change_pct = float(item.get('56') or (round((change / ref_price) * 100, 2) if ref_price else 0))

                    # 防呆：台指期正常指數點位必定高於 10000 點，避免抓到價差或空殼
                    if price > 10000:
                        return {
                            "name": "台指期盤後(近月)",
                            "price": round(price, 2),
                            "change": round(change, 2),
                            "change_pct": round(change_pct, 2),
                            "time": datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                        }
        except Exception as e:
            continue
    return None

def fetch_taifex_night_official_backup():
    """
    官方備援：台灣期交所 (TAIFEX) 盤後交易時段歷史/每日行情介面
    嚴格過濾「TX (大台指)」、排除跨月份價差合約，確保數值真實精準
    """
    now = datetime.now(TW_TZ)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
    
    # 往前追溯最近 4 天（涵蓋週末或假期的最後一個夜盤交易日）
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
                lines = res.text.strip().split("\n")
                if len(lines) > 1:
                    # 倒序尋找最後一筆成交
                    for line in reversed(lines):
                        parts = [p.strip().replace('"', '') for p in line.split(",")]
                        # 格式檢查: 欄位需足夠且契約代碼嚴格為 TX
                        if len(parts) >= 11 and parts[1] == "TX":
                            contract_month = parts[2]
                            # 關鍵排除：價差合約月份帶有斜線 '/' (如 202609/202610)，必須排除
                            if "/" in contract_month:
                                continue
                            
                            # 檢查交易時段欄位（若有標註盤後或一般）
                            session_type = parts[-1] if len(parts) > 17 else ""
                            
                            try:
                                # 第 5 欄為收盤價/結算價，第 6 欄為漲跌
                                price_val = float(parts[5])
                                change_val = float(parts[6])
                                
                                # 防呆檢驗：點數需合理（大台點位必定高於 10000 點）
                                if price_val > 10000:
                                    prev_price = price_val - change_val
                                    change_pct = round((change_val / prev_price) * 100, 2) if prev_price else 0.0
                                    return {
                                        "name": "台指期盤後(近月)",
                                        "price": price_val,
                                        "change": change_val,
                                        "change_pct": change_pct,
                                        "time": target_day.strftime('%Y-%m-%d %H:%M:%S')
                                    }
                            except ValueError:
                                continue
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
    
    # 1. 抓取美股四大指數與台積電 ADR (Yahoo v8 Chart)
    for name, symbol in targets.items():
        quote = fetch_yahoo_chart_quote(symbol, name, session)
        if quote:
            market_data[name] = quote
            print(f"  ✅ 成功取得 {name}: {quote['price']} ({quote['change_pct']:.2f}%)")
        else:
            print(f"  ❌ 未能取得 {name} ({symbol})")

    # 2. 抓取台指期盤後 (WTXP&) 行情報價
    print("  📡 正在連線台指期盤後 (WTXP&) 報價...")
    tx_quote = fetch_cnyes_wtxp_quote()
    if not tx_quote:
        print("  ℹ️ 鉅亨網 WTXP& 未取得，切換期交所官方盤後交易行情備援...")
        tx_quote = fetch_taifex_night_official_backup()

    if tx_quote:
        market_data["台指期貨(近月)"] = tx_quote
        print(f"  ✅ 成功取得 台指期貨(近月): {tx_quote['price']} ({tx_quote['change_pct']:.2f}%)")
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
    
    # 精準界定：前一日 13:30 到當天 07:00 的資料區間
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
