import os
import json
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def ai_generate_report(news_list, target_date):
    url = f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    news_context = ""
    for i, news in enumerate(news_list, 1):
        # ✨ 依需求調整：字數截斷限制放寬至最大 1500 字
        content_snippet = news['content'][:1500]
        if len(news['content']) > 1500:
            content_snippet += "...(以下字數過長省略)"
            
        news_context += f"新聞 {i} [{news['source']}]({news['time']})：{news['title']}\n內文重點：{content_snippet}\n\n"
    
    prompt = (
        "你是一位資深的台股專業分析師。請仔謝閱讀以下涵蓋昨日到今日早晨最新的台股與國際財經新聞細節。\n"
        "請幫我統整出一份簡明扼要、適合在開盤前閱讀的『台股盤前焦點分析報告』。\n"
        "必須深入解讀個股利多與利空中的財報數據、展望、接單狀況及外資或投顧意見。\n\n"
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
    
    # ✨ 依需求調整：將 timeout 機制大幅提高至 300 秒
    res = requests.post(url, json=payload, headers=headers, timeout=300)
    res_json = res.json()
    if 'candidates' in res_json and len(res_json['candidates']) > 0:
        return res_json['candidates'][0]['content']['parts'][0]['text']
    raise RuntimeError(f"Gemini 生成異常: {res_json}")

def save_to_html(ai_content, news_list, today_str):
    target_dir = os.path.join("..", "docs")
    sources_html = "<h2>🔗 今日參考新聞來源</h2><ul>"
    for news in news_list:
        sources_html += f'<li>[{news["source"]}] <a href="{news["link"]}" target="_blank" style="color: #0056b3; text-decoration: none;">{news["title"]}</a> ({news["time"]})</li>'
    sources_html += "</ul>"
    
    full_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{today_str} 台股盤前 AI 焦點分析</title>
    <style>
        body {{ font-family: 'Microsoft JhengHei', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin: 0; padding: 20px; }}
        .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
        h1 {{ color: #003366; border-bottom: 3px solid #003366; padding-bottom: 10px; margin-top: 0; font-size: 24px; }}
        h2 {{ color: #0056b3; margin-top: 25px; font-size: 18px; border-left: 4px solid #0056b3; padding-left: 10px; }}
        p, li {{ line-height: 1.8; font-size: 16px; margin-bottom: 8px; }}
        ul {{ padding-left: 20px; }}
        .meta {{ color: #666; font-size: 14px; margin-bottom: 20px; background: #eef2f7; padding: 10px; border-radius: 6px; }}
        footer {{ margin-top: 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1><img src="avatar.png" style="height: 30px; vertical-align: middle; margin-right: 10px;">牛牛盤前情報AI分析</h1>
        <div class="meta">📌 報告產出日期：{today_str} 盤前分析</div>
        {ai_content}
        <hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0;">
        {sources_html}
        <footer>本網頁由 牛牛分析站 AI 自動生成，僅供參考。</footer>
    </div>
</body>
</html>"""
    
    output_filename = f"newsai_{today_str}.html"
    with open(os.path.join(target_dir, output_filename), "w", encoding="utf-8") as f:
        f.write(full_html)
    print(f"💾 報告成功輸出至 docs/{output_filename}")

def main():
    now_tw = datetime.now(TW_TZ)
    today_str = now_tw.strftime("%Y-%m-%d")
    yesterday_str = (now_tw - timedelta(days=1)).strftime("%Y-%m-%d")
    
    target_dir = os.path.join("..", "docs")
    all_combined_news = []
    
    # 讀取前一天 (yesterday_str) 的檔案
    cnyes_path = os.path.join(target_dir, f"cnyes_{yesterday_str}.json")
    if os.path.exists(cnyes_path):
        print(f"📖 讀取鉅亨網資料: cnyes_{yesterday_str}.json")
        with open(cnyes_path, "r", encoding="utf-8") as f:
            all_combined_news.extend(json.load(f))
            
    # 讀取前一天 (yesterday_str) 的 RSS 檔案
    rss_path = os.path.join(target_dir, f"rss_{yesterday_str}.json")
    if os.path.exists(rss_path):
        print(f"📖 讀取 RSS 資料: rss_{yesterday_str}.json")
        with open(rss_path, "r", encoding="utf-8") as f:
            all_combined_news.extend(json.load(f))
            
    if all_combined_news:
        print(f"🔥 交付 Gemini 分析共 {len(all_combined_news)} 筆彙整新聞...")
        content = ai_generate_report(all_combined_news, today_str)
        save_to_html(content, all_combined_news, today_str)
    else:
        print(f"😴 找不到前一日 ({yesterday_str}) 的新聞快取資料，未生成報告。")

if __name__ == "__main__":
    main()
