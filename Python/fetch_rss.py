import os
import json
import time
import requests
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from dateutil import parser as date_parser

TW_TZ = ZoneInfo("Asia/Taipei")

def fetch_full_content(url, source_name):
    if not url: return ""
    time.sleep(2)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9"
    }
    if source_name == "自由財經": headers["Referer"] = "https://ec.ltn.com.tw/"
    elif source_name == "Yahoo股市": headers["Referer"] = "https://tw.stock.yahoo.com/"

    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200: return ""
        res.encoding = res.apparent_encoding
        soup = BeautifulSoup(res.text, 'html.parser')
        for element in soup(["script", "style", "iframe", "button", "figure", "figcaption"]):
            element.extract()
            
        paragraphs = []
        if source_name == "自由財經":
            text_area = soup.find('div', class_='text') or soup.find('div', itemprop='articleBody')
            if text_area:
                for p in text_area.find_all('p'):
                    p_text = p.text.strip()
                    if p_text and "請繼續往下閱讀" not in p_text and "一手掌握經濟脈動" not in p_text:
                        paragraphs.append(p_text)
        elif source_name == "Yahoo股市":
            text_area = soup.find('div', class_='caas-body') or soup.find('article')
            if text_area:
                for p in text_area.find_all('p'):
                    p_text = p.text.strip()
                    if p_text and not p_text.startswith("👉") and "相關新聞" not in p_text:
                        paragraphs.append(p_text)
        
        if not paragraphs:
            for p in soup.find_all('p'):
                p_text = p.text.strip()
                if len(p_text) > 25: paragraphs.append(p_text)
                
        return "\n".join([p for p in paragraphs if p]).strip()
    except Exception as e:
        print(f"  ⚠️ {source_name} 網頁內文解析異常: {url}, 原因: {e}")
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
    now_tw = datetime.now(TW_TZ)
    current_hour = now_tw.hour
    
    # ✨ 核心修正：依照執行時間判定歸屬檔名日期
    # 如果是 00:00 或 06:00 執行，代表它是屬於前一天 18:00 循環開始的資料，檔名採用前一天日期
    if current_hour < 12: 
        file_date_str = (now_tw - timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        file_date_str = now_tw.strftime("%Y-%m-%d")
        
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    file_path = os.path.join(target_dir, f"rss_{file_date_str}.json")
    
    existing_articles = []
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                existing_articles = json.load(f)
        except: pass

    # 以 來源 + 標題 建立去重基準
    seen_keys = {f"{a['source']}_{a['title']}" for a in existing_articles}
    
    sources = [
        {"name": "自由財經", "url": "https://news.ltn.com.tw/rss/business.xml"},
        {"name": "Yahoo股市", "url": "https://tw.stock.yahoo.com/rss?category=tw-market"}
    ]
    
    new_count = 0
    for src in sources:
        print(f"\n📡 正在讀取 RSS 來源: {src['name']}")
        try:
            res = requests.get(src['url'], headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
            feed = feedparser.parse(res.content)
            
            for entry in feed.entries:
                pub_time = parse_rss_time(entry)
                unique_key = f"{src['name']}_{entry.title}"
                
                if unique_key not in seen_keys:
                    print(f"  [新新聞發現] 進入抓取完整內文: {entry.title[:15]}...")
                    full_content = fetch_full_content(entry.link, src['name'])
                    
                    if not full_content:
                        full_content = entry.get('summary', entry.title)
                        
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
            print(f"❌ {src['name']} 處理中斷: {e}")
            
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(existing_articles, f, ensure_ascii=False, indent=4)
    print(f"\n💾 RSS 存檔成功 ➡️ 目的地: docs/rss_{file_date_str}.json (本次新增: {new_count} 筆，總累積: {len(existing_articles)} 筆)")

if __name__ == "__main__":
    main()
