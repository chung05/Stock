import os
import json
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")

# 升級更擬真的瀏覽器標頭，防止被伺服器拒絕
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://news.cnyes.com/"
}

def fetch_full_content(url):
    if not url: return ""
    time.sleep(1.5) # 微調延遲，避免速度太快被封鎖
    try:
        res = requests.get(url, headers=HEADERS, timeout=12)
        if res.status_code != 200: return ""
        res.encoding = 'utf-8' # 強制指定 utf-8 編碼
        soup = BeautifulSoup(res.text, 'html.parser')
        
        paragraphs = []
        # 深度匹配：鉅亨網常見的內文區塊標籤與屬性
        text_area = soup.find('div', itemprop='articleBody') or \
                    soup.find('article') or \
                    soup.find('div', class_=lambda c: c and 'article-content' in c)
        
        if text_area:
            # 遍歷所有段落
            for p in text_area.find_all('p'):
                text = p.text.strip()
                # 過濾掉相關閱讀、延伸閱讀等無關字眼
                if text and not text.startswith("延伸閱讀") and not text.startswith("來源："):
                    paragraphs.append(text)
        
        # 若上方特定區塊沒抓到，改採用保底機制：抓取特定樣式下的所有 P
        if not paragraphs:
            for p in soup.find_all('p', class_=lambda c: c and 'paragraph' in c):
                if p.text.strip(): paragraphs.append(p.text.strip())
                
        full_text = "\n".join(paragraphs)
        return full_text if full_text else ""
    except Exception as e:
        print(f"⚠️ 鉅亨網內文爬取異常: {url}, 原因: {e}")
    return ""

def main():
    now_tw = datetime.now(TW_TZ)
    end_time = now_tw.replace(hour=7, minute=30, second=0, microsecond=0)
    yesterday = end_time - timedelta(days=1)
    start_time = yesterday.replace(hour=13, minute=30, second=0, microsecond=0)
    
    file_date_str = yesterday.strftime("%Y-%m-%d")
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    
    # 擴大 limit 為 100 筆
    url = f"https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?startAt={start_ts}&endAt={end_ts}&limit=100"
    articles = []
    
    print(f"📡 [鉅亨網] 開始抓取指定區間: {start_time} 至 {end_time}")
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data_list = res.json().get('items', {}).get('data', [])
            print(f"📡 [鉅亨網] 發現 {len(data_list)} 筆原始資料，開始深度爬取完整內文...")
            
            for idx, item in enumerate(data_list, 1):
                news_id = item.get('newsId')
                news_link = f"https://news.cnyes.com/news/id/{news_id}"
                
                print(f"  [{idx}/{len(data_list)}] 正在爬取內文: {item.get('title')[:15]}...")
                full_content = fetch_full_content(news_link)
                
                # 如果爬蟲失敗，才使用 summary 摘要作為保底
                if not full_content:
                    full_content = item.get('summary', '')
                    print("  ⚠️ 網頁內文爬取失敗，改採摘要保底")
                
                articles.append({
                    "source": "鉅亨網",
                    "title": item.get('title'),
                    "summary": item.get('summary', ''),
                    "content": full_content, # 這裡就是真正的完整內文了
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
        print(f"❌ 鉅亨網主程序失敗: {e}")

if __name__ == "__main__":
    main()
