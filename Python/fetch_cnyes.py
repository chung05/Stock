import os
import json
import re
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
    使用 Yahoo Finance v8 chart 接口獲取美股四大指數與 ADR 行情
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

def fetch_taifex_info_hub_night():
    """
    第一優先：期交所官方「期貨交易資訊觀測站 (Taifex Info Hub)」首頁
    官方直接渲染，不擋爬蟲、不擋 GitHub Actions，週末永遠保留最新夜盤與日盤成交！
    頁面標靶內容：『臺股期貨行情 日盤 47,418 +959 (2.06%) 夜盤 47,405 -23 (-0.05%)』
    """
    url = "https://www.taifex.com.tw/eventTaifexTradingCenter/cht/index.do"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200 and ("臺股期貨行情" in res.text or "夜盤" in res.text):
            text = res.text
            # 正則比對：匹配夜盤價格與漲跌 (格式: 47,405 -23 (-0.05%))
            match = re.search(r'([\d,]+)\s+([+\-]?[\d,]+(?:\.\d+)?)\s*\(([+\-]?[\d\.]+)%\)', text)
            
            # 若全文有多組，精準匹配「夜盤」後方的行情字串
            night_block = re.search(r'夜盤.*?([\d,]+)\s+([+\-]?[\d,]+(?:\.\d+)?)\s*\(([+\-]?[\d\.]+)%\)', text, re.DOTALL)
            target_match = night_block if night_block else match
            
            if target_match:
                price_str = target_match.group(1).replace(',', '')
                change_str = target_match.group(2).replace(',', '')
                pct_str = target_match.group(3)

                price = float(price_str)
                change = float(change_str)
                change_pct = float(pct_str)

                if price > 30000:
                    return {
                        "name": "台指期貨(近月)",
                        "price": price,
                        "change": change,
                        "change_pct": change_pct,
                        "time": datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                    }
    except Exception as e:
        print(f"  ⚠️ 期交所觀測站解析異常: {e}")
    return None

def fetch_wantgoo_wtxp_html():
    """
    第二優先：玩股網 (Wantgoo) 台指期盤後專用 HTML 頁面解析 (WTXP&)
    """
    url = "https://www.wantgoo.com/futures/wtxp&"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
    try:
        res = requests.get(url, headers=headers, timeout=8)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            # 取得成交價
            deal_elem = soup.find(id='quote-deal') or soup.find(class_='deal')
            price_val = 0
            if deal_elem:
                price_val = float(deal_elem.get_text(strip=True).replace(',', ''))
            else:
                # 正則尋找收盤價文字
                m = re.search(r'收盤\s*([\d,]+)', res.text)
                if m:
                    price_val = float(m.group(1).replace(',', ''))

            # 取得漲跌
            change_elem = soup.find(id='quote-change')
            change_val = float(change_elem.get_text(strip=True).replace(',', '')) if change_elem else 0.0

            # 取得漲跌幅
            pct_elem = soup.find(id='quote-change-percent')
            pct_val = float(pct_elem.get_text(strip=True).replace('%', '').replace(',', '')) if pct_elem else 0.0

            if price_val > 30000:
                return {
                    "name": "台指期貨(近月)",
                    "price": price_val,
                    "change": change_val,
                    "change_pct": pct_val,
                    "time": datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                }
    except Exception:
        pass
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
    
    # 1. 美股四大指數與台積電 ADR (Yahoo v8 Chart 已驗證 100% 成功)
    for name, symbol in targets.items():
        quote = fetch_yahoo_chart_quote(symbol, name, session)
        if quote:
            market_data[name] = quote
            print(f"  ✅ 成功取得 {name}: {quote['price']} ({quote['change_pct']:.2f}%)")
        else:
            print(f"  ❌ 未能取得 {name} ({symbol})")

    # 2. 抓取台指期夜盤 (期交所 Info Hub 官方觀測站直取)
    print("  📡 正在連線台指期夜盤報價 (期交所官方資訊觀測站 / 玩股網 WTXP&)...")
    
    tx_quote = fetch_taifex_info_hub_night()
    if not tx_quote:
        tx_quote = fetch_wantgoo_wtxp_html()

    if tx_quote:
        market_data["台指期貨(近月)"] = tx_quote
        print(f"  ✅ 成功取得 台指期貨(近月): {tx_quote['price']} (漲跌: {tx_quote['change']} 點, {tx_quote['change_pct']}%)")
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
    
    # 前一日 13:30 到當天 07:00 的資料區間
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
