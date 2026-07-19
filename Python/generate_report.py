import os
import json
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TW_TZ = ZoneInfo("Asia/Taipei")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def ai_generate_report(news_list, market_data, target_date):
    url = f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    # 建立夜盤及海外指數數據文字脈絡
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
        "2. 🚀 今日重大個股利多（提及的公司、代號、關鍵財務數字或利多原因）。\n"
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

def save_to_html(ai_content, news_list, today_str):
    target_dir = os.path.join("..", "docs")
    sources_html = "<h2>🔗 今日參考新聞來源</h2><ul>"
    for news in news_list:
        sources_html += f'<li>[{news["source"]}] <a href="{news["link"]}" target="_blank" style="color: #0056b3; text-decoration: none;">{news["title"]}</a> ({news["time"]})</li>'
    sources_html += "</ul>"
    
    # ✨ 核心改動：在 HTML 的右上方加入固定（Fixed）的語音播放按鈕，並嵌入強制雲端真人語音的 JS
    full_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{today_str} 台股新聞焦點AI分析</title>
    <style>
        body {{ font-family: 'Microsoft JhengHei', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin: 0; padding: 20px; }}
        .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); position: relative; }}
        h1 {{ color: #003366; border-bottom: 3px solid #003366; padding-bottom: 10px; margin-top: 0; font-size: 24px; padding-right: 180px; }} /* 留空間給右上角按鈕 */
        h2 {{ color: #0056b3; margin-top: 25px; font-size: 18px; border-left: 4px solid #0056b3; padding-left: 10px; }}
        p, li {{ line-height: 1.8; font-size: 16px; margin-bottom: 8px; }}
        ul {{ padding-left: 20px; }}
        .meta {{ color: #666; font-size: 14px; margin-bottom: 20px; background: #eef2f7; padding: 10px; border-radius: 6px; }}
        
        /* 🔊 右上角語音控制列樣式 */
        .audio-controls-top {{
            position: absolute;
            top: 30px;
            right: 30px;
            display: flex;
            gap: 6px;
            background: #fff;
            padding: 4px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        .btn {{
            background-color: #0056b3;
            color: white;
            border: none;
            padding: 8px 14px;
            font-size: 14px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 4px;
        }}
        .btn:hover {{ background-color: #003366; transform: translateY(-1px); }}
        .btn:active {{ transform: translateY(0); }}
        .btn-stop {{ background-color: #dc3545; display: none; }} /* 初始隱藏停止鈕 */
        .btn-stop:hover {{ background-color: #bd2130; }}
        
        footer {{ margin-top: 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }}
        
        /* 手機板適應：寬度不足時自動移至下方或調整位置 */
        @media (max-width: 600px) {{
            .audio-controls-top {{ position: static; margin-bottom: 15px; justify-content: flex-start; box-shadow: none; padding: 0; }}
            h1 {{ padding-right: 0; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <!-- 🔊 右上角播放控制按鈕 -->
        <div class="audio-controls-top">
            <button id="playBtn" class="btn" onclick="toggleSpeech()">▶️ 播放報告</button>
            <button id="stopBtn" class="btn btn-stop" onclick="stopSpeech()">⏹️ 停止</button>
        </div>

        <h1><img src="avatar.png" style="height: 30px; vertical-align: middle; margin-right: 10px;">台股新聞焦點AI分析</h1>
        <div class="meta">📌 報告日期：{today_str} </div>
        
        <!-- 要被朗讀的區塊 -->
        <div id="report-content">
            {ai_content}
        </div>
        
        <hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0;">
        {sources_html}
        <footer>網頁由牛牛分析站AI自動生成，僅供參考。</footer>
    </div>

    <!-- 💡 免費雲端真人語音核心 JavaScript 邏輯 -->
    <script>
        let synth = window.speechSynthesis;
        let utterance = null;
        let isPlaying = false;

        function toggleSpeech() {{
            if (isPlaying) {{
                // 若正在播放中，點擊則為暫停/恢復功能
                if (synth.paused) {{
                    synth.resume();
                    document.getElementById('playBtn').innerHTML = "⏸️ 暫停";
                }} else {{
                    synth.pause();
                    document.getElementById('playBtn').innerHTML = "▶️ 繼續播放";
                }}
                return;
            }}

            // 1. 抓取報告純文字並清洗（避免讀出多餘符號或HTML標籤）
            let rawText = document.getElementById('report-content').innerText;
            // 將圖示換成適當的標點符號方便停頓，將漲跌圖示轉為文字
            let cleanText = rawText
                .replace(/📈/g, "。")
                .replace(/🚀/g, "。")
                .replace(/⚠️/g, "。")
                .replace(/💡/g, "。")
                .replace(/▼/g, "下跌")
                .replace(/▲/g, "上漲");

            if (!cleanText.trim()) return;

            utterance = new SpeechSynthesisUtterance(cleanText);
            
            // 2. 🔥 核心：強制篩選瀏覽器託管的雲端微軟/Google真人神經網路語音 (Neural Voice)
            let voices = synth.getVoices();
            
            // 優先志願排序：微軟雲端真人(曉臻/雲哲) -> Google雲端真人 -> 系統預設台灣中文
            let targetVoice = voices.find(v => v.name.includes('HsiaoChen') || v.name.includes('YunJhe')) || 
                              voices.find(v => v.name.includes('Google') && (v.lang === 'zh-TW' || v.lang === 'zh_TW')) ||
                              voices.find(v => v.lang === 'zh-TW' || v.lang === 'zh_TW');
            
            if (targetVoice) {{
                utterance.voice = targetVoice;
            }}
            
            utterance.lang = 'zh-TW';
            utterance.rate = 1.05; // 微調語速，聽起來更像專業旁白
            utterance.pitch = 1.0;

            // 3. 狀態監聽控制
            utterance.onstart = function() {{
                isPlaying = true;
                document.getElementById('playBtn').innerHTML = "⏸️ 暫停";
                document.getElementById('stopBtn').style.display = "flex";
            }};

            utterance.onend = function() {{
                resetControls();
            }};

            utterance.onerror = function() {{
                resetControls();
            }};

            // 執行播放
            synth.cancel(); // 播放前先清除之前的排隊
            synth.speak(utterance);
        }}

        function stopSpeech() {{
            synth.cancel();
            resetControls();
        }}

        function resetControls() {{
            isPlaying = false;
            document.getElementById('playBtn').innerHTML = "▶️ 播放報告";
            document.getElementById('stopBtn').style.display = "none";
        }}

        // 確保瀏覽器異步載入雲端語音清單
        if (speechSynthesis.onvoiceschanged !== undefined) {{
            speechSynthesis.onvoiceschanged = () => synth.getVoices();
        }}
    </script>
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
        save_to_html(content, all_combined_news, today_str)
    else:
        print(f"😴 找不到前一日 ({yesterday_str}) 的新聞快取資料，未生成報告。")

if __name__ == "__main__":
    main()
