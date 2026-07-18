import os
import json
import requests
import feedparser
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# --- 環境變數與設定 ---
TW_TZ = ZoneInfo("Asia/Taipei")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def get_time_range():
    """精準計算時間範圍：昨天下午 14:00 到今天早上 07:00"""
    now_tw = datetime.now(TW_TZ)
    end_tw = now_tw.replace(hour=7, minute=0, second=0, microsecond=0)
    yesterday = end_tw - timedelta(days=1)
    start_tw = yesterday.replace(hour=14, minute=0, second=0, microsecond=0)
    return start_tw, end_tw

def save_debug_json(filename, data):
    """將各來源的原始抓取結果寫入 docs 目錄供 Debug 驗證"""
    try:
        target_dir = os.path.join("..", "docs")
        os.makedirs(target_dir, exist_ok=True)
        file_path = os.path.join(target_dir, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"🐛 [Debug 存檔成功] 已將原始資料寫入 docs/{filename}")
    except Exception as e:
        print(f"❌ [Debug 存檔失敗] 無法寫入 {filename}: {e}")

def filter_cnyes_news(start_time, end_time):
    """抓取並過濾鉅亨網 API 新聞"""
    start_ts = int(start_time.timestamp())
    end_ts = int(end_time.timestamp())
    url = f"https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?startAt={start_ts}&endAt={end_ts}&limit=40"
    articles = []
    
    print(f"📡 [鉅亨網] 開始連線 API: {url}")
    try:
        res = requests.get(url, timeout=10)
        print(f"📡 [鉅亨網] 伺服器回應狀態碼: {res.status_code}")
        if res.status_code == 200:
            res_data = res.json()
            data_list = res_data.get('items', {}).get('data', [])
            print(f"📡 [鉅亨網] API 回傳原始新聞總數: {len(data_list)} 筆")
            
            # 儲存全量原始資料供檢查
            save_debug_json("debug_cnyes.json", data_list)
            
            for item in data_list:
                articles.append({
                    "source": "鉅亨網",
                    "title": item.get('title'),
                    "content": item.get('summary', ''),
                    "link": f"https://news.cnyes.com/news/id/{item.get('newsId')}"
                })
            print(f"✨ [鉅亨網] 成功解析出 {len(articles)} 筆新聞")
    except Exception as e:
        print(f"❌ [鉅亨網] 抓取或解析失敗: {e}")
    return articles

def filter_rss_news(url, source_name, filename, start_time, end_time):
    """抓取並過濾標準 RSS 新聞（自由時報、Yahoo股市），包含詳細 Debug 日誌"""
    articles = []
    print(f"📡 [{source_name}] 開始解析 RSS 網址: {url}")
    try:
        feed = feedparser.parse(url)
        print(f"📡 [{source_name}] RSS 標題: {feed.feed.get('title', '無標題')}")
        print(f"📡 [{source_name}] RSS 回傳原始新聞總數: {len(feed.entries)} 筆")
        
        # 儲存全量原始資料供檢查（將 feed 轉換為可序列化字典）
        serializable_entries = []
        for entry in feed.entries:
            serializable_entries.append({
                "title": entry.get("title", ""),
                "link": entry.get("link", ""),
                "published": entry.get("published", ""),
                "summary": entry.get("summary", "")
            })
        save_debug_json(filename, serializable_entries)
        
        time_match_count = 0
        for entry in feed.entries:
            if 'published_parsed' in entry:
                utc_dt = datetime(*entry.published_parsed[:6], tzinfo=ZoneInfo("UTC"))
                pub_time_tw = utc_dt.astimezone(TW_TZ)
                
                # Debug 印出每篇新聞的時間對比
                if start_time <= pub_time_tw <= end_time:
                    time_match_count += 1
                    articles.append({
                        "source": source_name,
                        "title": entry.title,
                        "content": entry.summary if 'summary' in entry else entry.title,
                        "link": entry.link
                    })
        print(f"✨ [{source_name}] 時間範圍相符的新聞有 {time_match_count} 筆，最終成功納入 {len(articles)} 筆")
    except Exception as e:
        print(f"❌ [{source_name}] RSS 抓取或解析失敗: {e}")
    return articles

def ai_generate_report(news_list):
    """將新聞送交 Gemini AI 進行台股專業結構化分析"""
    url = f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    news_context = ""
    for i, news in enumerate(news_list, 1):
        news_context += f"新聞 {i} [{news['source']}]：{news['title']}\n摘要：{news['content']}\n\n"
    
    prompt = (
        "你是一位資深的台股專業分析師。請仔細閱讀以下涵蓋『昨日下午2點至今日早上7點』的台股與國際財經新聞。\n"
        "請幫我統整出一份簡明扼要、適合在開盤前閱讀的『台股盤前焦點分析報告』。\n\n"
        "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
        "1. 📈 國際大盤焦點（美股表現、重要經濟數據、台積電ADR動態）。\n"
        "2. 🚀 今日重大個股利多（提及的公司、代號、關鍵財務數字或利多原因）。\n"
        "3. ⚠️ 今日重大個股利空（提及的公司、代號、潛在風險或利空原因）。\n"
        "4. 💡 操盤手筆記（綜合以上資訊，今天開盤需注意的整體市場氛圍或族群趨勢）。\n\n"
        f"新聞資料來源如下：\n{news_context}"
    )
    
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
        res = requests.post(url, json=payload, headers=headers, timeout=30)
        res_json = res.json()
        
        if 'candidates' in res_json and len(res_json['candidates']) > 0:
            return res_json['candidates'][0]['content']['parts'][0]['text']
        else:
            print(f"❌ Gemini 回傳異常（可能是安全機制或無效內容）：{res_json}")
            return "<h2>⚠️ AI 報告暫時無法生成</h2><p>今日部分財經新聞文字可能誤觸了 AI 的安全保護機制。請直接參考下方完整的原始新聞來源連結。</p>"
    except Exception as e:
        return f"<h2>❌ AI 連線分析失敗</h2><p>原因：{e}</p>"

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
        
        <!-- AI 深度分析區塊 -->
        {ai_content}
        
        <hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0;">
        
        <!-- 原始出處超連結區塊 -->
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
    
    print(f"🚀 [Debug 開始] 正在蒐集 {date_str} 盤前新聞...")
    print(f"⏰ [Debug 篩選時間軸區間] 台灣時間 {start_tw} 到 {end_tw}")
    
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
    
    print(f"📊 [Debug 統計] 各來源最終成功納入總數：鉅亨網({len(cnyes_news)})、自由財經({len(ltn_news)})、Yahoo股市({len(yahoo_news)})")
    
    if all_news:
        print(f"📊 成功篩選出總共 {len(all_news)} 筆新聞，正在產生 AI 報告網頁...")
        report_html = ai_generate_report(all_news)
        save_to_html(report_html, all_news, date_str)
    else:
        print("😴 沒有找到新的台股新聞，跳過本次更新。")
