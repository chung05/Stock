import os
import json
import requests
import re
import asyncio
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import edge_tts

TW_TZ = ZoneInfo("Asia/Taipei")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def build_prompt(news_list, market_data, today_dt, max_news_count=None, max_content_len=1500):
    weekday = today_dt.weekday()  # 0:週一, 5:週六, 6:週日
    
    # 針對星期天（或週末）動態切換數據標題與情境
    if weekday == 6:
        market_header = "【本週五美股與台指期夜盤最終收盤數據（週末休市）】\n"
        role_and_context = (
            "你是一位資深的台股專業分析師。今天是星期天，台股與美股均處於週末休市狀態。\n"
            "請詳細閱讀以下提供的『週五美股與夜盤收盤數據』以及本週末最新的台股與國際財經新聞細節。\n"
            "請幫我統整出一份深入、適合在週末閱讀的『台股週末財經總覽與下週展望報告』。\n"
            "嚴格禁止提及『昨日美股』或『今日開盤』等錯誤字眼，應以『週五美股表現』及『展望下週一開盤』的角度進行分析。\n\n"
            "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
            "1. 📈 國際大盤焦點（週五美股四大指數、重要經濟數據、台積電ADR動態與台指期夜盤收盤重點）。\n"
            "2. 🚀 週末重大個股利多（提及的公司、代號、關鍵財務數字或產業利多展望）。\n"
            "3. ⚠️ 週末重大個股利空（提及的公司、代號、潛在風險或利空訊息）。\n"
            "4. 💡 操盤手筆記（綜合週末資訊與國際情勢，展望下週一開盤需注意的整體氛圍、可能受惠或避險的族群趨勢）。\n\n"
        )
    else:
        market_header = "【昨日美股與台指期夜盤最終收盤數據】\n"
        role_and_context = (
            "你是一位資深的台股專業分析師。請仔細閱讀以下提供的大盤/海外夜盤數據以及昨日到今日早晨最新的台股與國際財經新聞細節。\n"
            "請幫我統整出一份簡明扼要、適合在開盤前閱讀的『台股盤前焦點分析報告』。\n"
            "必須特別對照夜盤、美股與 ADR 的漲跌表現，並深入解讀個股利多與利空中的財報數據、展望、接單狀況及外資或投顧意見。\n\n"
            "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
            "1. 📈 國際大盤焦點（美股表現、重要經濟數據、台積電ADR動態與台指期夜盤收盤解析）。\n"
            "2. 🚀 今日重大個股利多（提及的公司、代號、關鍵財務數字或利多原因）。\n"
            "3. ⚠️ 今日重大個股利空（提及的公司、代號、潛在風險或利空原因）。\n"
            "4. 💡 操盤手筆記（綜合以上資訊，今天開盤需注意的整體市場氛圍或族群趨勢）。\n\n"
        )

    market_context = market_header
    if market_data:
        for name, data in market_data.items():
            market_context += f"- {name}: 最新價 {data['price']} | 漲跌 {data['change']} | 漲跌幅 {data['change_pct']:.2f}% (數據時間: {data['time']})\n"
    else:
        market_context += "無取得夜盤與海外數據。\n"
        
    selected_news = news_list[:max_news_count] if max_news_count else news_list
    news_context = ""
    for i, news in enumerate(selected_news, 1):
        content_snippet = news['content'][:max_content_len]
        if len(news['content']) > max_content_len:
            content_snippet += "...(以下字數過長省略)"
        news_context += f"新聞 {i} [{news['source']}]({news['time']})：{news['title']}\n內文重點：{content_snippet}\n\n"
    
    prompt = f"{role_and_context}數據來源：\n{market_context}\n新聞資料來源如下：\n{news_context}"
    return prompt

def ai_generate_report(news_list, market_data, today_dt):
    url = f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    max_retries = 5
    base_backoff_delays = [10, 25, 45, 70, 90]
    
    for attempt in range(max_retries):
        if attempt >= 2:
            print("⚡ 啟動防塞車降載策略：縮減分析新聞為重要前 50 筆...")
            prompt = build_prompt(news_list, market_data, today_dt, max_news_count=50, max_content_len=600)
        else:
            prompt = build_prompt(news_list, market_data, today_dt, max_news_count=None, max_content_len=1500)
            
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
            res = requests.post(url, json=payload, headers=headers, timeout=300)
            res_json = res.json()
            
            if 'candidates' in res_json and len(res_json['candidates']) > 0:
                return res_json['candidates'][0]['content']['parts'][0]['text']
            
            if 'error' in res_json:
                error_code = res_json['error'].get('code')
                error_msg = res_json['error'].get('message', '')
                if error_code in [503, 429] or 'high demand' in error_msg.lower():
                    wait_sec = base_backoff_delays[attempt]
                    print(f"⚠️ Gemini 流量高峰 (代碼 {error_code})，等待 {wait_sec} 秒後進行第 {attempt + 1}/{max_retries} 次重試...")
                    time.sleep(wait_sec)
                    continue
                else:
                    raise RuntimeError(f"Gemini 生成異常: {res_json}")
            
            raise RuntimeError(f"Gemini 回傳格式異常: {res_json}")
            
        except (requests.exceptions.RequestException, RuntimeError) as e:
            if attempt == max_retries - 1:
                raise e
            wait_sec = base_backoff_delays[attempt]
            print(f"⚠️ 連線錯誤: {e}，等待 {wait_sec} 秒後重試...")
            time.sleep(wait_sec)

async def generate_microsoft_tts(html_content, target_date):
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    audio_filename = f"audio_{target_date}.mp3"
    audio_path = os.path.join(target_dir, audio_filename)
    
    text = re.sub(r'<[^>]+>', ' ', html_content)
    text = text.replace("📈", "。").replace("🚀", "。").replace("⚠️", "。").replace("💡", "。")
    text = text.replace("▼", "下跌").replace("▲", "上漲")
    
    text = re.sub(r'\+([\d\.]+)\%', r'上漲百分之\1', text)
    text = re.sub(r'\-([\d\.]+)\%', r'下跌百分之\1', text)
    text = re.sub(r'([\d\.]+)\%', r'百分之\1', text)
    text = re.sub(r'(?<!\d)(\d)(\d)(\d)(\d)(?!\d)', r'\1 \2 \3 \4', text)
    text = text.replace("ADR", "A D R").replace("AI", " A I ").replace("FED", "美聯準").replace("TSMC", "台積電").replace("NVIDIA", "輝達")
    
    print(f"🎙️ 微軟 Edge-TTS 開始合成 (字數: {len(text)})...")
    try:
        communicate = edge_tts.Communicate(text, "zh-TW-HsiaoChenNeural", rate="+5%")
        await communicate.save(audio_path)
        print(f"🎵 語音導讀生成成功: docs/{audio_filename}")
        return audio_filename
    except Exception as e:
        print(f"⚠️ 微軟 TTS 生成失敗: {e}")
        return None

def save_to_html(ai_content, news_list, today_str, today_dt, audio_filename=None):
    target_dir = os.path.join("..", "docs")
    sources_html = "<h2>🔗 今日參考新聞來源</h2><ul>"
    for news in news_list:
        sources_html += f'<li>[{news["source"]}] <a href="{news["link"]}" target="_blank" style="color: #0056b3; text-decoration: none;">{news["title"]}</a> ({news["time"]})</li>'
    sources_html += "</ul>"
    
    audio_html = ""
    if audio_filename:
        audio_html = f"""
        <div class="audio-inline-controls">
            <audio src="{audio_filename}" controls style="height: 28px; max-width: 180px;"></audio>
        </div>
        """
    
    title_suffix = "週末財經焦點AI分析" if today_dt.weekday() == 6 else "台股新聞焦點AI分析"
    
    full_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{today_str} {title_suffix}</title>
    <style>
        body {{ font-family: 'Microsoft JhengHei', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin: 0; padding: 15px; }}
        .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
        h1 {{ color: #003366; border-bottom: 3px solid #003366; padding-bottom: 10px; margin-top: 0; font-size: 22px; }}
        h2 {{ color: #0056b3; margin-top: 25px; font-size: 17px; border-left: 4px solid #0056b3; padding-left: 10px; }}
        p, li {{ line-height: 1.8; font-size: 15px; margin-bottom: 8px; }}
        ul {{ padding-left: 20px; }}
        .meta {{ 
            color: #555; font-size: 13px; margin-bottom: 20px; background: #eef2f7; 
            padding: 6px 10px; border-radius: 6px; display: flex; align-items: center; 
            justify-content: space-between; flex-wrap: nowrap;
        }}
        .meta-date {{ white-space: nowrap; }}
        .audio-inline-controls {{ display: flex; align-items: center; }}
        footer {{ margin-top: 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1><img src="avatar.png" style="height: 26px; vertical-align: middle; margin-right: 8px;">{title_suffix}</h1>
        <div class="meta">
            <span class="meta-date">📌 日期：{today_str}</span>
            {audio_html}
        </div>
        <div id="report-content">
            {ai_content}
        </div>
        <hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0;">
        {sources_html}
        <footer>網頁由牛牛分析站AI自動生成，僅供參考。</footer>
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
    market_data = {}
    
    # 1. 讀取新聞：依然讀取前一日新聞檔案 (週六抓取的新聞)
    cnyes_path = os.path.join(target_dir, f"cnyes_{yesterday_str}.json")
    if os.path.exists(cnyes_path):
        print(f"📖 讀取鉅亨網資料: cnyes_{yesterday_str}.json")
        with open(cnyes_path, "r", encoding="utf-8") as f:
            all_combined_news.extend(json.load(f))
            
    rss_path = os.path.join(target_dir, f"rss_{yesterday_str}.json")
    if os.path.exists(rss_path):
        print(f"📖 讀取 RSS 資料: rss_{yesterday_str}.json")
        with open(rss_path, "r", encoding="utf-8") as f:
            all_combined_news.extend(json.load(f))
            
    # 2. 自動判斷海外夜盤市場檔案日期：
    # 若今天是星期天 (weekday == 6)，海外夜盤取「週五收盤（即前天 2 天前）」的檔案
    if now_tw.weekday() == 6:
        market_date_str = (now_tw - timedelta(days=2)).strftime("%Y-%m-%d")
        print(f"📅 今日為週日，海外市場數據自動對齊週五收盤檔期: market_{market_date_str}.json")
    else:
        market_date_str = yesterday_str
        
    market_path = os.path.join(target_dir, f"market_{market_date_str}.json")
    if os.path.exists(market_path):
        print(f"📖 讀取夜盤與海外市場資料: market_{market_date_str}.json")
        try:
            with open(market_path, "r", encoding="utf-8") as f:
                market_data = json.load(f)
        except Exception as e:
            print(f"⚠️ 讀取夜盤 JSON 異常: {e}")
    else:
        print(f"ℹ️ 未找到 market_{market_date_str}.json (非交易日或未產生)")
            
    if all_combined_news:
        print(f"🔥 交付 Gemini 分析共 {len(all_combined_news)} 筆彙整新聞並帶入市場數據...")
        content = ai_generate_report(all_combined_news, market_data, now_tw)
        
        audio_file = asyncio.run(generate_microsoft_tts(content, today_str))
        save_to_html(content, all_combined_news, today_str, now_tw, audio_filename=audio_file)
    else:
        print(f"😴 找不到前一日 ({yesterday_str}) 的新聞快取資料，未生成報告。")

if __name__ == "__main__":
    main()
