import os
import json
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

def fetch_full_content(url):
    if not url: return ""
    time.sleep(1)
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        if res.status_code != 200: return ""
        res.encoding = res.apparent_encoding
        soup = BeautifulSoup(res.text, 'html.parser')
        text_area = soup.find('div', itemprop='articleBody')
        if text_area:
            return "\n".join([p.text.strip() for p in text_area.find_all('p') if p.text.strip()])[:800]
    except: pass
    return ""

def main():
    now_tw = datetime.now(TW_TZ)
    # 設定區間：前一日 13:30 到當天 07:30
    end_time = now_tw.replace(hour=7, minute=30, second=0, microsecond=0)
    yesterday = end_time - timedelta(days=1)
    start_time = yesterday.replace(hour=13, minute=30, second=0, microsecond=0)
    
    # 命名規則：以前一天日期命名
    file_date_str = yesterday.strftime("%Y-%m-%d")
    
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    
    url = f"https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?startAt={start_ts}&endAt={end_ts}&limit=100"
    articles = []
    
    print(f"📡 [鉅亨網] 抓取時間區間: {start_time} 至 {end_time}")
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data_list = res.json().get('items', {}).get('data', [])
            for item in data_list:
                news_link = f"https://news.cnyes.com/news/id/{item.get('newsId')}"
                full_content = fetch_full_content(news_link) or item.get('summary', '')
                articles.append({
                    "source": "鉅亨網",
                    "title": item.get('title'),
                    "summary": item.get('summary', ''),
                    "content": full_content,
                    "link": news_link,
                    "time": datetime.fromtimestamp(item.get('publishAt'), tz=TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                })
        
        target_dir = os.path.join("..", "docs")
        os.makedirs(target_dir, exist_ok=True)
        filename = f"cnyes_{file_date_str}.json"
        with open(os.path.join(target_dir, filename), "w", encoding="utf-8") as f:
            json.dump(articles, f, ensure_ascii=False, indent=4)
        print(f"💾 鉅亨網儲存成功: docs/{filename} (共 {len(articles)} 筆)")
    except Exception as e:
        print(f"❌ 鉅亨網抓取失敗: {e}")

if __name__ == "__main__":
    main()
