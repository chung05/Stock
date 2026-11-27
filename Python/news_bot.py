import os
import json
import re
import time
import requests
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from dateutil import parser as date_parser

# --- 環境變數與設定 ---
TW_TZ = ZoneInfo("Asia/Taipei")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
}

def get_time_range():
    """精準計算時間範圍：昨天下午 14:00 到今天早上 07:00"""
    now_tw = datetime.now(TW_TZ)
    end_tw = now_tw.replace(hour=7, minute=0, second=0, microsecond=0)
    yesterday = end_tw - timedelta(days=1)
    start_tw = yesterday.replace(hour=14, minute=0, second=0, microsecond=0)
    return start_tw, end_tw

def save_debug_json(filename, data):
    """將資料寫入 docs 目錄供驗證"""
    try:
        target_dir = os.path.join("..", "docs")
        os.makedirs(target_dir, exist_ok=True)
        file_path = os.path.join(target_dir, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"🐛 [Debug 存檔成功] 已將資料寫入 docs/{filename}")
    except Exception as e:
        print(f"❌ [Debug 存檔失敗] 無法寫入 {filename}: {e}")

def fetch_full_content(url, source_name):
    """根據不同媒體的網頁結構，點擊進入連結並爬取完整新聞內文"""
    if not url:
        return ""
    time.sleep(1)
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        if res.status_code != 200:
            return ""
        res.encoding = res.apparent_encoding
        soup = BeautifulSoup(res.text, 'html.parser')
        paragraphs = []
        
        if source_name == "鉅亨網":
            text_area = soup.find('div', itemprop='articleBody')
            if text_area:
                for p in text_area.find_all('p'):
                    paragraphs.append(p.text.strip())
        elif source_name == "自由財經":
            text_area = soup.find('div', class_='text')
            if text_area:
                for p in text_area.find_all('p', recursive=False):
                    if not p.find('a', class_='app_link') and "請繼續往下閱讀" not in p.text:
                        paragraphs.append(p.text.strip())
        elif source_name == "Yahoo股市":
            text_area = soup.find('div', class_='caas-body')
            if text_area:
                for p in text_area.find_all('p'):
                    paragraphs.append(p.text.strip())
                    
        full_text = "\n".join([p for p in paragraphs if p])
        return full_text[:800] if full_text else ""
    except Exception as e:
        print(f"⚠️ [內文爬取警告] 無法由連結獲取 {source_name} 完整內文: {url}, 原因: {e}")
        return ""

def filter_cnyes_news(start_time, end_time):
    """抓取並過濾鉅亨網 API 新聞（全面導入逐筆透明化檢查機制）"""
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    url = f"https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?startAt={start_ts - 86400}&endAt={end_ts + 86400}&limit=50"
    articles = []
    
    print(f"\n📡 [鉅亨網] 開始連線 API: {url}")
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            res_data = res.json()
            data_list = res_data.get('items', {}).get('data', [])
            total_entries = len(data_list)
            print(f"📡 [鉅亨網] API 回傳原始新聞總數: {total_entries} 筆")
            print(f"📋 --- [鉅亨網] 完整時間比對清單開始 ---")
            
            time_match_count = 0
            skip_count = 0
            
            for idx, item in enumerate(data_list, 1):
                publish_ts = item.get('publishAt')
                pub_time_tw = None
                if publish_ts:
                    pub_time_tw = datetime.fromtimestamp(publish_ts, tz=TW_TZ)
                
                time_str = pub_time_tw.strftime('%Y-%m-%d %H:%M:%S') if pub_time_tw else "無法解析時間"
                title_preview = item.get('title', '')[:18]
                
                if pub_time_tw and (start_time <= pub_time_tw <= end_time):
                    time_match_count += 1
                    print(f"  [✅ 符合] ({idx}/{total_entries}) 時間: {time_str} | 標題: {title_preview}...")
                    
                    news_id = item.get('newsId')
                    news_link = f"https://news.cnyes.com/news/id/{news_id}"
                    full_content = fetch_full_content(news_link, "鉅亨網")
                    
                    if not full_content:
                        full_content = item.get('summary', '')
                    
                    articles.append({
                        "source": "鉅亨網",
                        "title": item.get('title'),
                        "content": full_content,
                        "link": news_link
                    })
                else:
                    skip_count += 1
                    print(f"  [🚫 不符合] ({idx}/{total_entries}) 時間: {time_str} | 標題: {title_preview}...")
            
            print(f"📋 --- [鉅亨網] 完整時間比對清單結束 ---")
            print(f"✨ [鉅亨網] 解析完畢：最終納入 {time_match_count} 筆，跳過不符區間 {skip_count} 筆。")
            save_debug_json("debug_cnyes.json", articles)
    except Exception as e:
        print(f"❌ [鉅亨網] 抓取或解析失敗: {e}")
    return articles

def filter_rss_news(raw_url, source_name, filename, start_time, end_time):
    """抓取過濾標準 RSS 新聞（全面導入逐筆透明化檢查機制）"""
    articles = []
    
    clean_url_match = re.search(r'(https?://[^\s\)\]]+)', raw_url)
    url = clean_url_match.group(1).strip() if clean_url_match else raw_url.strip()

    print(f"\n📡 [{source_name}] 開始抓取 RSS 網址: {url}")
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        if response.status_code != 200:
            print(f"❌ [{source_name}] 抓取失敗，狀態碼錯誤: {response.status_code}")
            return articles
            
        feed = feedparser.parse(response.content)
        total_entries = len(feed.entries)
        print(f"📡 [{source_name}] RSS 回傳原始新聞總數: {total_entries} 筆")
        print(f"📋 --- [{source_name}] 完整時間比對清單開始 ---")
        
        time_match_count = 0
        skip_count = 0
        
        for idx, entry in enumerate(feed.entries, 1):
            pub_time_tw = None
            raw_pub_str = entry.get('published') or entry.get('updated')
            
            if raw_pub_str:
                try:
                    dt_parsed = date_parser.parse(raw_pub_str)
                    if dt_parsed.tzinfo is None:
                        dt_parsed = dt_parsed.replace(tzinfo=TW_TZ)
                    pub_time_tw = dt_parsed.astimezone(TW_TZ)
                except Exception:
                    pub_time_tw = None

            if pub_time_tw is None and 'published_parsed' in entry:
                try:
                    utc_dt = datetime(*entry.published_parsed[:6], tzinfo=ZoneInfo("UTC"))
                    pub_time_tw = utc_dt.astimezone(TW_TZ)
                except Exception:
                    pub_time_tw = None

            time_str = pub_time_tw.strftime('%Y-%m-%d %H:%M:%S') if pub_time_tw else "無法解析時間"
            title_preview = entry.title[:18]

            if pub_time_tw and (start_time <= pub_time_tw <= end_time):
                time_match_count += 1
                print(f"  [✅ 符合] ({idx}/{total_entries}) 時間: {time_str} | 標題: {title_preview}...")
                
                news_link = entry.get("link", "")
                full_content = fetch_full_content(news_link, source_name)
                
                if not full_content:
                    full_content = entry.summary if 'summary' in entry else entry.title
                
                articles.append({
                    "source": source_name,
                    "title": entry.title,
                    "content": full_content,
                    "link": news_link
                })
            else:
                skip_count += 1
                print(f"  [🚫 不符合] ({idx}/{total_entries}) 時間: {time_str} | 標題: {title_preview}...")
                    
        print(f"📋 --- [{source_name}] 完整時間比對清單結束 ---")
        print(f"✨ [{source_name}] 解析完畢：最終納入 {time_match_count} 筆，跳過不符區間 {skip_count} 筆。")
        save_debug_json(filename, articles)
    except Exception as e:
        print(f"❌ [{source_name}] RSS 抓取或進階解析失敗: {e}")
    return articles

def ai_generate_report(news_list):
    """將新聞送交 Gemini AI 進行台股專業結構化分析"""
    url = f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    news_context = ""
    for i, news in enumerate(news_list, 1):
        news_context += f"新聞 {i} [{news['source']}]：{news['title']}\n內文細節：{news['content']}\n\n"
    
    prompt = (
        "你是一位資深的台股專業分析師。請仔細閱讀以下涵蓋『昨日下午2點至今日早上7點』的台股與國際財經新聞細節。\n"
        "請幫我統整出一份簡明扼要、適合在開盤前閱讀的『台股盤前焦點分析報告』。\n"
        "由於目前所有新聞來源均已包含完整的內文，請務必深入解讀個股利多與利空中的財報數據、展望、接單狀況及外資或投顧意見。\n\n"
        "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
        "1. 📈 國際大盤焦點（美股表現、重要經濟數據、台積電ADR動態）。\n"
        "2. 🚀 今日重大個股利多（提及的公司、代號、關鍵財務數字或利多原因）。\n"
        "3. ⚠️ 今日重大個股利空（提及的公司、代號、潛在風險或利空原因）。\n"
        "4. 💡 操盤手筆記（綜合以上資訊，今天開盤需注意的整體市場氛圍或族群趨勢）。\n\n"
        f"新聞資料來源如下：\n{news_context}"
    )
    
    # 修正拼字錯誤: HATE_SHEECH -> HATE_SPEECH
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ]
    }
    
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=40)
        res_json = res.json()
        if 'candidates' in res_json and len(res_json['candidates']) > 0:
            return res_json['candidates'][0]['content']['parts'][0]['text']
        else:
            # 發生異常直接中斷，阻止程式傻傻往下寫入 index.html
            raise RuntimeError(f"Gemini 回傳異常內容: {res_json}")
    except Exception as e:
        raise RuntimeError(f"AI 連線或解析失敗原因: {e}")

def save_to_html(ai_content, news_list, target_date_str):
    """將 AI 報告與原始新聞超連結來源一起包裝成網頁"""
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    
    sources_html = "<h2>🔗 今日參考新聞來源（可點選查看完整資訊）</h2><ul>"
    for news in news_list:
        sources_html += f'<li>[{news["source"]}] <a href="{news["link"]}" target="_blank" style="color: #0056b3; text-decoration: none;">{news["title"]}</a></li>'
    sources_html += "</ul>"
    
    full_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{target_date_str} 台股盤前 AI 焦點分析</title>
    <style>
        body {{ font-family: 'Microsoft JhengHei', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin: 0; padding: 20px; }}
        .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
        h1 {{ color: #003366; border-bottom: 3px solid #003366; padding-bottom: 10px; margin-top: 0; font-size: 24px; }}
        h2 {{ color: #0056b3; margin-top: 25px; font-size: 18px; border-left: 4px solid #0056b3; padding-left: 10px; }}
        p, li {{ line-height: 1.8; font-size: 16px; margin-bottom: 8px; }}
        ul {{ padding-left: 20px; }}
        a:hover {{ text-decoration: underline !important; }}
        .meta {{ color: #666; font-size: 14px; margin-bottom: 20px; background: #eef2f7; padding: 10px; border-radius: 6px; }}
        footer {{ margin-top: 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1><img src="avatar.png" style="height: 30px; vertical-align: middle; margin-right: 10px;">牛牛盤前情報AI分析</h1>
        <div class="meta">
            📌 日期：{target_date_str}<br>
            ⏱️ 範圍：昨日 14:00 至 今日 07:00
        </div>
        
        {ai_content}
        
        <hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0;">
        {sources_html}
        
        <footer>
            本網頁由©<img src="avatar.png" style="height: 30px; vertical-align: middle; margin-right: 10px;">牛牛分析站 AI 自動生成，僅供參考。<br>
        </footer>
    </div>
</body>
</html>
"""
    file_path = os.path.join(target_dir, "index.html")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(full_html)
    print(f"💾 網頁已成功儲存至 {file_path}")

if __name__ == "__main__":
    start_tw, end_tw = get_time_range()
    date_str = end_tw.strftime("%Y-%m-%d")
    
    print(f"🚀 [全方位內文深化版] 開始蒐集 {date_str} 盤前新聞與深層內文...")
    print(f"⏰ [篩選時間軸區間] 台灣時間 {start_tw} 到 {end_tw}")
    
    all_news = []
    
    # 1. 抓取鉅亨網
    cnyes_news = filter_cnyes_news(start_tw, end_tw)
    all_news.extend(cnyes_news)
    
    # 2. 抓取自由財經
    ltn_news = filter_rss_news("[https://news.ltn.com.tw/rss/business.xml](https://news.ltn.com.tw/rss/business.xml)", "自由財經", "debug_ltn.json", start_tw, end_tw)
    all_news.extend(ltn_news)
    
    # 3. 抓取Yahoo股市
    yahoo_news = filter_rss_news("[https://tw.stock.yahoo.com/rss?category=tw-market](https://tw.stock.yahoo.com/rss?category=tw-market)", "Yahoo股市", "debug_yahoo.json", start_tw, end_tw)
    all_news.extend(yahoo_news)
    
    print(f"\n📊 [統計] 各來源最終成功納入總數：鉅亨網({len(cnyes_news)})、自由財經({len(ltn_news)})、Yahoo股市({len(yahoo_news)})")
    
    # 🚀 重點追加：將合併後的所有新聞（那 38 筆），強制保存成一個完整的大 JSON 檔
    print(f"📦 [正在彙整] 將全部共 {len(all_news)} 筆符合時段的新聞彙整包，寫入 docs/debug_all_news.json...")
    save_debug_json("debug_all_news.json", all_news)
    
    if len(all_news) > 0:
        print(f"🔥 [全面啟動] 交付 AI 生成最新報告網頁...")
        report_html = ai_generate_report(all_news)
        save_to_html(report_html, all_news, date_str)
    else:
        print("😴 全數來源均完全沒有任何符合時段的新聞，未執行網頁更新。")
