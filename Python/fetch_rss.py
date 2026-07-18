import os
import json
import time
import requests
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime
from zoneinfo import ZoneInfo
from dateutil import parser as date_parser

TW_TZ = ZoneInfo("Asia/Taipei")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
}

def fetch_full_content(url, source_name):
    if not url: return ""
    time.sleep(1.5)
    try:
        res = requests.get(url, headers=HEADERS, timeout=12)
        if res.status_code != 200: return ""
        res.encoding = res.apparent_encoding
        soup = BeautifulSoup(res.text, 'html.parser')
        paragraphs = []
        
        if source_name == "自由財經":
            # 自由時報的內文通常在 div.text 內
            text_area = soup.find('div', class_='text') or soup.find('div', itemprop='articleBody')
            if text_area:
                for p in text_area.find_all('p', recursive=False):
                    p_text = p.text.strip()
                    # 排除廣告、無關警語、延伸閱讀連結
                    if p_text and not p.find('a', class_='app_link') and "請繼續往下閱讀" not in p_text and "一手掌握經濟脈動" not in p_text:
                        paragraphs.append(p_text)
                        
        elif source_name == "Yahoo股市":
            # Yahoo 股市內文在 .caas-body 內
            text_area = soup.find('div', class_='caas-body') or soup.find('div', class_='canvas-body')
            if text_area:
                for p in text_area.find_all('p'):
                    p_text = p.text.strip()
                    # 過濾掉相關影片、相關新聞等廣告字眼
                    if p_text and not p_text.startswith("▲") and not p_text.startswith("👉"):
                        paragraphs.append(p_text)
                        
        full_text = "\n".join([p for p in paragraphs if p])
        return full_text if full_text else ""
    except Exception as e:
        print(f"⚠️ {source_name} 內文爬取異常: {url}, 原因: {e}")
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
    today_str = datetime.now(TW_TZ).strftime("%Y-%m-%d")
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"rss_{today_str}.json")
    
    existing_articles = []
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                existing_articles = json.load(f)
        except: pass

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
            print(f"📡 {src['name']} 發現 {len(feed.entries)} 筆 RSS 項目，檢查是否需要增量抓取...")
            
            for entry in feed.entries:
                pub_time = parse_rss_time(entry)
                unique_key = f"{entry.title}_{pub_time}"
                
                # 如果這則新聞沒抓過，才執行深層內文爬蟲
                if unique_key not in seen_keys:
                    print(f"  [新新聞] 進入爬取完整內文: {entry.title[:15]}...")
                    full_content = fetch_full_content(entry.link, src['name'])
                    
                    # 爬蟲保底
                    if not full_content:
                        full_content = entry.get('summary', entry.title)
                        print("  ⚠️ 內文爬取失敗，改採 RSS 摘要保底")
                        
                    existing_articles.append({
                        "source": src['name'],
                        "title": entry.title,
                        "summary": entry.get('summary', ''),
                        "content": full_content, # 真正的完整內文
                        "link": entry.link,
                        "time": pub_time
                    })
                    seen_keys.add(unique_key)
                    new_count += 1
        except Exception as e:
            print(f"❌ {src['name']} RSS 解析失敗: {e}")
            
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(existing_articles, f, ensure_ascii=False, indent=4)
    print(f"💾 RSS 增量庫更新完畢。本次新增: {new_count} 筆，總計現存: {len(existing_articles)} 筆")

if __name__ == "__main__":
    main()
