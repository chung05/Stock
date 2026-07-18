def filter_rss_news(url, source_name, filename, start_time, end_time):
    """抓取過濾標準 RSS 新聞，並自動點入連結爬取完整內文"""
    articles = []
    
    if "[" in url and "]" in url:
        match = re.search(r'\((https?://[^\)]+)\)', url)
        if match:
            url = match.group(1)

    print(f"📡 [{source_name}] 開始抓取 RSS 網址: {url}")
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        if response.status_code != 200:
            print(f"❌ [{source_name}] 抓取失敗，狀態碼錯誤。")
            return articles
            
        feed = feedparser.parse(response.content)
        print(f"📡 [{source_name}] RSS 回傳原始新聞總數: {len(feed.entries)} 筆")
        
        time_match_count = 0
        skip_count = 0  # 💡 新增：統計因時間不符被跳過的筆數
        
        for entry in feed.entries:
            if 'published_parsed' in entry:
                utc_dt = datetime(*entry.published_parsed[:6], tzinfo=ZoneInfo("UTC"))
                pub_time_tw = utc_dt.astimezone(TW_TZ)
                
                if start_time <= pub_time_tw <= end_time:
                    time_match_count += 1
                    
                    news_link = entry.get("link", "")
                    print(f"  🕷️ [{source_name}] 正在爬取內文 [{time_match_count}]: {entry.title[:15]}...")
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
                    skip_count += 1  # 💡 時間不符，記錄下來
                    
        print(f"✨ [{source_name}] 解析完畢：符合時間 {time_match_count} 筆，非此區間(已跳過) {skip_count} 筆。")
        save_debug_json(filename, articles)
    except Exception as e:
        print(f"❌ [{source_name}] RSS 抓取或進階解析失敗: {e}")
    return articles
