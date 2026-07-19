import os
import json
import requests
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def clean_text_for_speech(html_content):
    """將 HTML 標籤去除，並做適當的文字清理，讓 AI 朗讀更流暢"""
    # 移除所有 HTML 標籤
    text = re.sub(r'<[^>]+>', ' ', html_content)
    # 將常見的標點符號或Emoji替換成適合停頓的標點
    text = text.replace("📈", "。").replace("🚀", "。").replace("⚠️", "。").replace("💡", "。")
    text = text.replace("▼", "下跌").replace("▲", "上漲")
    # 移除過多的連續空白
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def generate_tts_audio(text, target_date):
    """串接 Sherlock TTS / 公共 VITS 免費接口生成真人語音 MP3"""
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    audio_filename = f"audio_{target_date}.mp3"
    audio_path = os.path.join(target_dir, audio_filename)
    
    print(f"🎙️ 開始請求 AI 真人語音合成 (文字長度: {len(text)} 字)...")
    
    # 使用目前開源社群愛用的公共 VITS2/極速真人語音 API 接口
    # 這裡配置標準的台灣中文女性/男性真人模型參數
    tts_url = "https://tts.xiaoice-like-api.workers.dev/api/tts" 
    
    payload = {
        "text": text[:1000], # 公共接口通常有單次字數限制，控制在 1000 字內最佳
        "speaker": "zh-TW-Lady", # 台灣腔調真人女聲模型
        "speed": 1.0,
        "format": "mp3"
    }
    
    try:
        # 發送請求，設定較長的超時時間以防伺服器反應較慢
        res = requests.post(tts_url, json=payload, timeout=60)
        if res.status_code == 200 and res.content:
            with open(audio_path, "wb") as f:
                f.write(res.content)
            print(f"🎵 真人語音 MP3 生成成功: docs/{audio_filename}")
            return audio_filename
    except Exception as e:
        print(f"⚠️ 語音合成失敗或超時 (將跳過語音生成): {e}")
        
    return None

def ai_generate_report(news_list, market_data, target_date):
    url = f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    market_context = "【昨日美股與台指期夜盤最終收盤數據】\n"
    if market_data:
        for name, data in market_data.items():
            market_context += f"- {name}: 最新價 {data['price']} | 漲跌 {data['change']} | 漲跌幅 {data['change_pct']:.2f}% (數據時間: {data['time']})\n"
    else:
        market_context += "無取得夜盤與海外數據。\n"
        
    news_context = ""
    for i, news in enumerate(news_list, 1):
        content_snippet = news['content'][:1500]
        if len(news['content']) > 1500:
            content_snippet += "...(以下字數過長省略)"
        news_context += f"新聞 {i} [{news['source']}]({news['time']})：{news['title']}\n內文重點：{content_snippet}\n\n"
    
    prompt = (
        "你是一位資深的台股專業分析師。請仔細閱讀以下提供的大盤/海外夜盤數據以及昨日到今日早晨最新的台股與國際財經新聞細節。\n"
        "請幫我統整出一份簡明扼要、適合在開盤前閱讀的『台股盤前焦點分析報告』。\n"
        "必須特別對照夜盤、美股與 ADR 的漲跌表現，並深入解讀個股利多與利空中的財報數據、展望、接單狀況及外資或投顧意見。\n\n"
        "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
        "1. 📈 國際大盤焦點（美股表現、重要經濟數據、台積電ADR動態與台指期夜盤收盤解析）。\n"
        "2. 🚀 今日重大個股利多（提及的公司、代號、關鍵財務數字或利利多原因）。\n"
        "3. ⚠️ 今日重大個股利空（提及的公司、代號、潛在風險或利空原因）。\n"
        "4. 💡 操盤手筆記（綜合以上資訊，今天開盤需注意的整體市場氛圍或族群趨勢）。\n\n"
        f"數據來源：\n{market_context}\n"
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
    
    res = requests.post(url, json=payload, headers=headers, timeout=300)
    res_json = res.json()
    if 'candidates' in res_json and len(res_json['candidates']) > 0:
        return res_json['candidates'][0]['content']['parts'][0]['text']
    raise RuntimeError(f"Gemini 生成異常: {res_json}")

def save_to_html(ai_content, news_list, today_str, audio_filename=None):
    target_dir = os.path.join("..", "docs")
    sources_html = "<h2>🔗 今日參考新聞來源</h2><ul>"
    for news in news_list:
        sources_html += f'<li>[{news["source"]}] <a href="{news["link"]}" target="_blank" style="color: #0056b3; text-decoration: none;">{news["title"]}</a> ({news["time"]})</li>'
    sources_html += "</ul>"
    
    # 判斷是否有成功生成音訊檔，有就嵌入真人播放器
    audio_player_html = ""
    if audio_filename:
        audio_player_html = f"""
        <div class="player-container">
            <span style="font-weight: bold; color: #003366;">🎧 盤前 AI 真人語音導讀：</span>
            <audio src="{audio_filename}" controls style="width: 100%; margin-top: 8px;"></audio>
        </div>
        """
    
    full_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{today_str} 台股新聞焦點AI分析</title>
    <style>
        body {{ font-family: 'Microsoft JhengHei', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin: 0; padding: 20px; }}
        .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
        h1 {{ color: #003366; border-bottom: 3px solid #003366; padding-bottom: 10px; margin-top: 0; font-size: 24px; }}
        h2 {{ color: #0056b3; margin-top: 25px; font-size: 18px; border-left: 4px solid #0056b3; padding-left: 10px; }}
        p, li {{ line-height: 1.8; font-size: 16px; margin-bottom: 8px; }}
        ul {{ padding-left: 20px; }}
        .meta {{ color: #666; font-size: 14px; margin-bottom: 20px; background: #eef2f7; padding: 10px; border-radius: 6px; }}
        .player-container {{ background-color: #f1f8ff; border: 1px solid #b3d7ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }}
        footer {{ margin-top: 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1><img src="avatar.png" style="height: 30px; vertical-align: middle; margin-right: 10px;">台股新聞焦點AI分析</h1>
        <div class="meta">📌 報告日期：{today_str} </div>
        
        {audio_player_html}
        
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
            
    market_path = os.path.join(target_dir, f"market_{yesterday_str}.json")
    if os.path.exists(market_path):
        print(f"📖 讀取夜盤與海外市場資料: market_{yesterday_str}.json")
        try:
            with open(market_path, "r", encoding="utf-8") as f:
                market_data = json.load(f)
        except Exception as e:
            print(f"⚠️ 讀取夜盤 JSON 異常: {e}")
            
    if all_combined_news:
        print(f"🔥 交付 Gemini 分析共 {len(all_combined_news)} 筆彙整新聞並帶入夜盤市場數據...")
        content = ai_generate_report(all_combined_news, market_data, today_str)
        
        # ✨ 新增步驟：將生成的 HTML 文字內容提取為純文字，並進行真人語音合成
        speech_text = clean_text_for_speech(content)
        audio_file = generate_tts_audio(speech_text, today_str)
        
        # 將音訊檔名傳入，用以渲染網頁播放器
        save_to_html(content, all_combined_news, today_str, audio_filename=audio_file)
    else:
        print(f"😴 找不到前一日 ({yesterday_str}) 的新聞快取資料，未生成報告。")

if __name__ == "__main__":
    main()
