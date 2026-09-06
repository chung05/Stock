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

def build_prompt(news_list, market_data, max_news_count=None, max_content_len=1500):
    """組合發送給 Gemini 的 Prompt"""
    market_context = "【昨日美股與台指期夜盤最終收盤數據】\n"
    if market_data:
        for name, data in market_data.items():
            market_context += f"- {name}: 最新價 {data['price']} | 漲跌 {data['change']} | 漲跌幅 {data['change_pct']:.2f}% (數據時間: {data['time']})\n"
    else:
        market_context += "無取得夜盤與海外數據。\n"
        
    # 若有指定最大筆數則進行截斷
    selected_news = news_list[:max_news_count] if max_news_count else news_list
    
    news_context = ""
    for i, news in enumerate(selected_news, 1):
        content_snippet = news['content'][:max_content_len]
        if len(news['content']) > max_content_len:
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
    return prompt

def ai_generate_report(news_list, market_data, target_date):
    url = f"[https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=](https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=){GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    max_retries = 5
    base_backoff_delays = [10, 25, 45, 70, 90]
    
    for attempt in range(max_retries):
        # 如果重試達到第 3 次以上（attempt >= 2），自動啟動降載模式縮減 Token
        if attempt >= 2:
            print(f"⚡ 啟動防塞車降載策略：縮減分析新聞為重要前 50 筆，降低 Token 壓力...")
            prompt = build_prompt(news_list, market_data, max_news_count=50, max_content_len=600)
        else:
            prompt = build_prompt(news_list, market_data, max_news_count=None, max_content_len=1500)
            
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
            
            # 檢查是否有候選內容回傳
            if 'candidates' in res_json and len(res_json['candidates']) > 0:
                return res_json['candidates'][0]['content']['parts'][0]['text']
            
            # 檢查錯誤代碼是否為 503 (繁忙) 或 429 (限流)
            if 'error' in res_json:
                error_code = res_json['error'].get('code')
                error_msg = res_json['error'].get('message', '')
                
                if error_code in [503, 429] or 'high demand' in error_msg.lower():
                    wait_sec = base_backoff_delays[attempt]
                    print(f"⚠️ Gemini 伺服器流量高峰 (代碼 {error_code})，等待 {wait_sec} 秒後進行第 {attempt + 1}/{max_retries} 次重試...")
                    time.sleep(wait_sec)
                    continue
                else:
                    raise RuntimeError(f"Gemini 生成異常（不可重試的錯誤）: {res_json}")
            
            # 若無 candidates 亦無特定 error
            raise RuntimeError(f"Gemini 回傳內容格式未知: {res_json}")
            
        except (requests.exceptions.RequestException, RuntimeError) as e:
            if attempt == max_retries - 1:
                print("❌ 已達最大重試次數，宣告生成失敗。")
                raise e
            wait_sec = base_backoff_delays[attempt]
            print(f"⚠️ 請求連線失敗: {e}，等待 {wait_sec} 秒後重試...")
            time.sleep(wait_sec)

async def generate_microsoft_tts(html_content, target_date):
    """使用微軟 Edge-TTS 在後端生成優化發音後的真人語音"""
    target_dir = os.path.join("..", "docs")
    os.makedirs(target_dir, exist_ok=True)
    audio_filename = f"audio_{target_date}.mp3"
    audio_path = os.path.join(target_dir, audio_filename)
    
    # 1. 移除 HTML 標籤
    text = re.sub(r'<[^>]+>', ' ', html_content)
    
    # 2. 移除符號與替換基本漲跌
    text = text.replace("📈", "。").replace("🚀", "。").replace("⚠️", "。").replace("💡", "。")
    text = text.replace("▼", "下跌").replace("▲", "上漲")
    
    # ✨ 修正 1 & 2：精準校正百分比與正負號讀音
    text = re.sub(r'\+([\d\.]+)\%', r'上漲百分之\1', text)
    text = re.sub(r'\-([\d\.]+)\%', r'下跌百分之\1', text)
    text = re.sub(r'([\d\.]+)\%', r'百分之\1', text)
    
    # 股票代號處理（4碼數字中間加空格，如 2330 -> 2 3 3 0）
    text = re.sub(r'(?<!\d)(\d)(\d)(\d)(\d)(?!\d)', r'\1 \2 \3 \4', text)
    
    # 財經常用英文縮寫與名詞優化
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

def save_to_html(ai_content, news_list, today_str, audio_filename=None):
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
    
    full_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{today_str} 台股新聞焦點AI分析</title>
    <style>
        body {{ font-family: 'Microsoft JhengHei', Arial, sans-serif; background-color: #f4f6f9; color: #333; margin: 0; padding: 15px; }}
        .container {{ max-width: 800px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }}
        h1 {{ color: #003366; border-bottom: 3px solid #003366; padding-bottom: 10px; margin-top: 0; font-size: 22px; }}
        h2 {{ color: #0056b3; margin-top: 25px; font-size: 17px; border-left: 4px solid #0056b3; padding-left: 10px; }}
        p, li {{ line-height: 1.8; font-size: 15px; margin-bottom: 8px; }}
        ul {{ padding-left: 20px; }}
        
        .meta {{ 
            color: #555; 
            font-size: 13px; 
            margin-bottom: 20px; 
            background: #eef2f7; 
            padding: 6px 10px
