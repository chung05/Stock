import os
import json
import time
import re
import requests
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime
from zoneinfo import ZoneInfo
from dateutil import parser as date_parser

TW_TZ = ZoneInfo("Asia/Taipei")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

def fetch_full_content(url, source_name):
    if not url: return ""
    time.sleep(1)
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        if res.status_code != 200: return ""
        res.encoding = res.apparent_encoding
        soup = BeautifulSoup(res.text, 'html.parser')
        paragraphs = []
        if source_name == "自由財經":
            text_area = soup.find('div', class_='text')
            if text_area:
                paragraphs = [p.text.strip() for p in text_area.find_all('p', recursive=False) if "請繼續往下閱讀" not in p.text]
        elif source_name == "Yahoo股市":
            text_area = soup.find('div', class_='caas-body')
            if text_area:
                paragraphs = [p.text.strip() for p in text_area.find_all('p')]
        return "\n".join([p for p in paragraphs if p])[:800]
    except: pass
    return ""

def parse_rss_time(entry):
    raw_pub_str = entry.get('published') or entry.get('updated')
    if raw_pub_str:
        try:
            dt = date_parser.parse(raw_pub_str)
            if dt.tzinfo is None: dt = dt.replace(tzinfo=TW_TZ)
            return dt.astimezone(TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
        except: pass
    return datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S')

def main():
    # 依當天日期命名儲存
    today_str = datetime.now(TW_TZ).strftime("%Y-%m-%d")
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"rss_{today_str}.json")
    
    # 讀取舊有歷史資料庫做比對
    existing_articles = []
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                existing_articles = json.load(f)
        except: pass

    # 建立現有資料的 unique 檢查碼集合 (用 標題+時間 判定)
    seen_keys = {f"{a['title']}_{a['time']}" for a in existing_articles}
    
    sources = [
        {"name": "自由財經", "url": "https://news.ltn.com.tw/rss/business.xml"},
        {"name": "Yahoo股市", "url": "https://tw.stock.yahoo.com/rss?category=tw-market"}
    ]
    
    new_count = 0
    for src in sources:
        print(f"📡 正在讀取 RSS: {src['name']}")
        try:
            res = requests.get(src['url'], headers=HEADERS, timeout=15)
            feed = feedparser.parse(res.content)
            for entry in feed.entries:
                pub_time = parse_rss_time(entry)
                unique_key = f"{entry.title}_{pub_time}"
                
                if unique_key not in seen_keys:
                    full_content = fetch_full_content(entry.link, src['name']) or entry.get('summary', entry.title)
                    existing_articles.append({
                        "source": src['name'],
                        "title": entry.title,
                        "summary": entry.get('summary', ''),
                        "content": full_content,
                        "link": entry.link,
                        "time": pub_time
                    })
                    seen_keys.add(unique_key)
                    new_count += 1
        except Exception as e:
            print(f"❌ {src['name']} 讀取失敗: {e}")
            
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(existing_articles, f, ensure_ascii=False, indent=4)
    print(f"💾 RSS 資料累計更新完畢。本次新增: {new_count} 筆，總計現存: {len(existing_articles)} 筆")

if __name__ == "__main__":
    main()
