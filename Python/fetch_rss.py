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

def fetch_full_content(url, source_name):
    if not url: return ""
    time.sleep(2) # 延遲 2 秒，避免觸發網站頻率限制防禦
    
    # 針對不同網站客製化最擬真的標頭
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document"
    }
    
    if source_name == "自由財經":
        headers["Referer"] = "https://ec.ltn.com.tw/"
    elif source_name == "Yahoo股市":
        headers["Referer"] = "https://tw.stock.yahoo.com/"

    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200: 
            print(f"  ❌ 網頁請求失敗，狀態碼: {res.status_code}")
            return ""
        
        res.encoding = res.apparent_encoding
        soup = BeautifulSoup(res.text, 'html.parser')
        
        # 移除干擾元素 (廣告、腳本、樣式、按鈕、圖說)
        for element in soup(["script", "style", "iframe", "button", "figure", "figcaption"]):
            element.extract()
            
        paragraphs = []
        
        if source_name == "自由財經":
            # 優先嘗試自由時報已知的核心內容容器
            text_area = soup.find('div', class_='text') or \
                        soup.find('div', itemprop='articleBody') or \
                        soup.find('div', class_='content')
            
            if text_area:
                for p in text_area.find_all('p'):
                    p_text = p.text.strip()
                    # 過濾自由時報常見的延伸閱讀、App下載、廣告等廢言
                    if p_text and "請繼續往下閱讀" not in p_text and "一手掌握經濟脈動" not in p_text and not p.find('a', class_='app_link'):
                        paragraphs.append(p_text)
            
            # 【廣度保底機制】如果以上容器都沒抓到文字，則進行全網頁 P 標籤深度挖掘
            if not paragraphs:
                for p in soup.find_all('p'):
                    p_text = p.text.strip()
                    if len(p_text) > 20 and "請繼續往下閱讀" not in p_text and "版權所有" not in p_text:
                        paragraphs.append(p_text)
                        
        elif source_name == "Yahoo股市":
            # Yahoo 的內容通常散落在 caas-body 或 article 中
            text_area = soup.find('div', class_='caas-body') or \
                        soup.find('div', class_=lambda c: c and 'caas-container' in c) or \
                        soup.find('article')
            
            if text_area:
                for p in text_area.find_all('p'):
                    p_text = p.text.strip()
                    if p_text and not p_text.startswith("👉") and "相關新聞" not in p_text and "延伸閱讀" not in p_text:
                        paragraphs.append(p_text)
                        
            # 【廣度保底機制】若動態樣式改版導致抓不到，直接抓取高文字密度的 P 段落
            if not paragraphs:
                for p in soup.find_all('p'):
                    p_text = p.text.strip()
                    # 篩選非按鈕、非連結、且具備一定長度的新聞描述文字
                    if len(p_text) > 25 and not p_text.startswith("▲") and not p_text.startswith("👉") and "隱私權政策" not in p_text:
                        paragraphs.append(p_text)
                        
        full_text = "\n".join([p for p in paragraphs if p])
        return full_text.strip()
        
    except Exception as e:
        print(f"  ⚠️ {source_name} 網頁內文深度解析異常: {url}, 原因: {e}")
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
        print(f"\n📡 正在讀取 RSS 來源: {src['name']}")
        try:
            # 讀取 RSS 本身也加上 Headers 防止被擋
            res = requests.get(src['url'], headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
            feed = feedparser.parse(res.content)
            print(f"📡 {src['name']} 共有 {len(feed.entries)} 筆項目，檢查是否需要增量下載...")
            
            for entry in feed.entries:
                pub_time = parse_rss_time(entry)
                unique_key = f"{entry.title}_{pub_time}"
                
                if unique_key not in seen_keys:
                    print(f"  [新新聞發現] 進入抓取完整內文: {entry.title[:15]}...")
                    full_content = fetch_full_content(entry.link, src['name'])
                    
                    # 內容擷取不到時的極限保底：改採用 RSS 本身自帶的摘要
                    if not full_content:
                        full_content = entry.get('summary', entry.title)
                        print("  ⚠️ 網頁穿透抓取內容為空，採用摘要/標題進行保底。")
                        
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
    print(f"\n💾 RSS 增量去重儲存完畢。本次成功下載內文數: {new_count} 筆，累積總數: {len(existing_articles)} 筆")

if __name__ == "__main__":
    main()
