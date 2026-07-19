import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

def clean_html_content(html_text):
    """清除鉅亨網內容內含的 HTML 標籤，還原純文字"""
    if not html_text:
        return ""
    soup = BeautifulSoup(html_text, 'html.parser')
    # 移除可能夾帶的腳本或樣式
    for script in soup(["script", "style"]):
        script.extract()
    return soup.get_text(separator="\n").strip()

def main():
    now_tw = datetime.now(TW_TZ)
    # 設定區間：前一日 13:30 到當天 07:30
    end_time = now_tw.replace(hour=7, minute=30, second=0, microsecond=0)
    yesterday = end_time - timedelta(days=1)
    start_time = yesterday.replace(hour=13, minute=30, second=0, microsecond=0)
    
    # ✨ 這裡維持以前一日日期命名 (例如今天 18 號，檔名會是 cnyes_2026-07-17.json)
    file_date_str = yesterday.strftime("%Y-%m-%d")
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    
    # 提高 limit 至 100
    url = f"https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?startAt={start_ts}&endAt={end_ts}&limit=100"
    articles = []
    
    print(f"📡 [鉅亨網] 抓取時間區間: {start_time} 至 {end_time}")
    try:
        res = requests.get(url, timeout=15)
        if res.status_code == 200:
            data_list = res.json().get('items', {}).get('data', [])
            print(f"📡 [鉅亨網] API 回傳原始新聞共 {len(data_list)} 筆，開始解析內容...")
            
            for idx, item in enumerate(data_list, 1):
                news_id = item.get('newsId')
                news_link = f"https://news.cnyes.com/news/id/{news_id}"
                
                # ✨ 核心優化：鉅亨網 API 內建有最完整的 html content，免去網頁爬蟲
                raw_html_content = item.get('content', '')
                full_content = clean_html_content(raw_html_content)
                
                # 如果 API content 為空，才使用 summary 保底
                if not full_content:
                    full_content = item.get('summary', '')
                    
                articles.append({
                    "source": "鉅亨網",
                    "title": item.get('title'),
                    "summary": item.get('summary', ''),
                    "content": full_content,
                    "link": news_link,
                    "time": datetime.fromtimestamp(item.get('publishAt'), tz=TW_TZ).strftime('%Y-%m-%d %H:%M:%S')
                })
                print(f"  [{idx}/{len(data_list)}] 成功提取內文：{item.get('title')[:15]}... (字數: {len(full_content)})")
        
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
