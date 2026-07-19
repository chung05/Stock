import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

def clean_html_content(html_text):
    if not html_text: return ""
    soup = BeautifulSoup(html_text, 'html.parser')
    for script in soup(["script", "style"]):
        script.extract()
    return soup.get_text(separator="\n").strip()

def main():
    now_tw = datetime.now(TW_TZ)
    
    # 精準界定：前一日 13:30 到當天 07:30 的資料區間
    end_time = now_tw.replace(hour=7, minute=30, second=0, microsecond=0)
    yesterday = end_time - timedelta(days=1)
    start_time = yesterday.replace(hour=13, minute=30, second=0, microsecond=0)
    
    # ✨ 命名規則：以前一日的日期作為檔案名稱 (例如 7/19 執行，命名為 cnyes_2026-07-18.json)
    file_date_str = yesterday.strftime("%Y-%m-%d")
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"cnyes_{file_date_str}.json"
    file_path = os.path.join(target_dir, filename)
    
    # ✨ 讀取現有檔案以進行重複過濾
    existing_articles = []
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                existing_articles = json.load(f)
        except: pass
        
    # 用 link 或 標題 作為唯一鍵值去重
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
                
                # 如果已經在先前的執行中抓過，直接跳過
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

if __name__ == "__main__":
    main()
