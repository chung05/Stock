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
        else:
            print(f"  ⚠️ Yahoo v8 回傳異常狀態碼 {res.status_code} ({display_name} - {symbol})")
    except Exception as e:
        print(f"  ❌ 抓取 {display_name} ({symbol}) 失敗: {e}")
    return None

def fetch_taifex_official_night_report():
    """
    第一優先：期交所官方「盤後交易時段行情查詢」頁面 (marketCode = 1)
    這是全台灣最權威、最正確的夜盤 (WTXP&) 官方報表來源！
    """
    now = datetime.now(TW_TZ)
    url = "https://www.taifex.com.tw/cht/3/futDailyMarketReport"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    # 往前追溯最多 4 天，尋找最近一筆夜盤收盤數據（如週五跨週六清晨收盤的夜盤）
    for day_offset in range(4):
        target_day = now - timedelta(days=day_offset)
        date_str = target_day.strftime("%Y/%m/%d")
        
        payload = {
            "queryType": "2",
            "marketCode": "1",            # 🌟 關鍵參數：1 代表「盤後交易時段 (夜盤)」
            "dateaddcnt": "",
            "commodity_id": "TX",
            "commodity_id2": "",
            "queryDate": date_str
        }

        try:
            res = requests.post(url, data=payload, headers=headers, timeout=10)
            if res.status_code == 200 and "臺股期貨" in res.text:
                soup = BeautifulSoup(res.text, 'html.parser')
                table = soup.find('table', class_='table_f')
                if not table:
                    continue

                rows = table.find_all('tr')
                for tr in rows:
                    cols = [td.get_text(strip=True).replace(',', '') for td in tr.find_all(['td', 'th'])]
                    # 檢查是否為大台指近月單一月份合約 (排除表頭與跨月價差合約 '/')
                    if len(cols) >= 8 and cols[0] == "TX":
                        contract_month = cols[1]
                        if "/" in contract_month:
                            continue  # 排除價差合約
                        
                        price_str = cols[5]   # 最後成交價
                        change_str = cols[6]  # 漲跌價
                        rate_str = cols[7]    # 漲跌幅 %

                        # 若盤後有成交
                        if price_str and price_str != "-" and price_str != "":
                            try:
                                price_val = float(price_str)
                                change_val = float(change_str) if change_str != "-" else 0.0
                                
                                # 移除 % 符號並解析漲跌幅
                                rate_clean = rate_str.replace('%', '').strip()
                                rate_val = float(rate_clean) if rate_clean and rate_clean != "-" else 0.0
                                
                                if price_val > 30000:
                                    return {
                                        "name": "台指期貨(近月)",
                                        "price": price_val,
                                        "change": change_val,
                                        "change_pct": rate_val,
                                        "time": target_day.strftime('%Y-%m-%d %H:%M:%S')
                                    }
                            except ValueError:
                                continue
        except Exception:
            continue
    return None

def fetch_taifex_mis_night_quote():
    """
    第二優先：期交所 MIS 即時報價 (盤中即時用)
    """
    url = "https://mis.taifex.com.tw/futures/api/getQuoteDetail"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json;charset=UTF-8"
    }
    payload = {
        "MarketType": "1",
        "SymbolId": "TXF"
    }
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=8)
        if res.status_code == 200:
            data = res.json()
            quotes = data.get("RtData", {}).get("QuoteList", [])
            for q in quotes:
                symbol_id = q.get("SymbolID", "") or q.get("SymbolId", "")
                if "/" in symbol_id:
                    continue

                price_str = q.get("CLastPrice") or q.get("CLast")
                ref_str = q.get("CRefPrice") or q.get("CRef")
                diff_str = q.get("CDiff") or q.get("CChange")
                rate_str = q.get("CRate")

                if price_str and price_str != "-":
                    price = float(price_str)
                    ref_price = float(ref_str) if ref_str and ref_str != "-" else price
                    change = float(diff_str) if diff_str and diff_str != "-" else round(price - ref_price, 2)
                    change_pct = float(rate_str) if rate_str and rate_str != "-" else (round((change / ref_price) * 100, 2) if ref_price else 0.0)

                    if price > 30000 and abs(change_pct) < 10.0:
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
    
    # 1. 美股四大指數與台積電 ADR
    for name, symbol in targets.items():
        quote = fetch_yahoo_chart_quote(symbol, name, session)
        if quote:
            market_data[name] = quote
            print(f"  ✅ 成功取得 {name}: {quote['price']} ({quote['change_pct']:.2f}%)")
        else:
            print(f"  ❌ 未能取得 {name} ({symbol})")

    # 2. 抓取台指期夜盤行情（期交所盤後專屬報表 marketCode=1 優先）
    print("  📡 正在連線台指期夜盤報價 (期交所官方盤後交易時段專屬報表)...")
    
    # 順序 1: 期交所官方盤後專用 HTML 報表 (marketCode=1)
    tx_quote = fetch_taifex_official_night_report()
    
    # 順序 2: 期交所 MIS 盤後即時接口
    if not tx_quote:
        tx_quote = fetch_taifex_mis_night_quote()

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
