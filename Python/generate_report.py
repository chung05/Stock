import os
import json
import requests
import re
import asyncio
import time
import glob
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import edge_tts

TW_TZ = ZoneInfo("Asia/Taipei")

def format_chips_for_prompt(chips_data):
    """將結構化的 chips_*.json 轉換為適合 Prompt 閱讀的高密度文字摘要"""
    if not chips_data:
        return "無最新籌碼數據。\n"
    
    meta = chips_data.get("meta", {})
    dates = meta.get("dates_analyzed", [])
    date_str = f"[{', '.join(dates)}]" if dates else "[T-2, T-1, T]"
    
    lines = [
        f"【核心觀察股 (231檔) 三大法人與技術籌碼監控】",
        f"※ 數列格式統一為 {date_str}，由左至右為 [前天, 昨天, 今天] 數值 (單位: 張)\n"
    ]

    def format_list(title, items, top_n=25, extra_key=None):
        sub_lines = [f"### {title}"]
        for item in items[:top_n]:
            sid = item.get("stock_id")
            sname = item.get("stock_name")
            rel = item.get("relation", "分歧")
            today_net = item.get("today_total_net", 0)
            f_net = item.get("foreign_net_3d", [])
            it_net = item.get("investment_trust_net_3d", [])
            d_net = item.get("dealer_net_3d", [])
            margin = item.get("margin_net_today", 0)
            macd = item.get("macd_osc_today", 0)
            
            extra_str = ""
            if extra_key and extra_key in item:
                extra_str = f" | 累計:{item[extra_key]:+d}張"

            sub_lines.append(
                f"- {sid} {sname} [{rel}] | 今日三大法人:{today_net:+d}張{extra_str} (資:{margin:+d}張, MACD柱:{macd:+.2f})\n"
                f"  外資:{f_net} | 投信:{it_net} | 自營:{d_net}"
            )
        return "\n".join(sub_lines)

    if "top_institutional_buys_1d" in chips_data:
        lines.append(format_list("今日三大法人買超前列：", chips_data["top_institutional_buys_1d"], top_n=25))
        lines.append("")

    if "top_institutional_sells_1d" in chips_data:
        lines.append(format_list("今日三大法人賣超前列：", chips_data["top_institutional_sells_1d"], top_n=25))
        lines.append("")

    if "consecutive_2_days_buys" in chips_data:
        lines.append(format_list("連續兩日買超（短線發動/轉買回補）：", chips_data["consecutive_2_days_buys"], top_n=20, extra_key="sum_2d_net"))
        lines.append("")

    if "consecutive_2_days_sells" in chips_data:
        lines.append(format_list("連續兩日賣超（短線調節/轉賣壓力）：", chips_data["consecutive_2_days_sells"], top_n=20, extra_key="sum_2d_net"))
        lines.append("")

    if "consecutive_3_days_buys" in chips_data:
        lines.append(format_list("連續三日買超（波段強勢鎖碼）：", chips_data["consecutive_3_days_buys"], top_n=20, extra_key="sum_3d_net"))
        lines.append("")

    if "consecutive_3_days_sells" in chips_data:
        lines.append(format_list("連續三日賣超（波段持續拋售）：", chips_data["consecutive_3_days_sells"], top_n=20, extra_key="sum_3d_net"))
        lines.append("")

    return "\n".join(lines)

def build_prompt(news_list, market_data, chips_data, today_dt, max_news_count=None, max_content_len=1500):
    weekday = today_dt.weekday()  # 0:週一, 5:週六, 6:週日
    chips_context = format_chips_for_prompt(chips_data)
    
    is_weekend = (weekday == 6)
    title_context = "台股週末財經總覽與下週展望報告" if is_weekend else "台股盤前焦點分析報告"
    market_header = "【本週五美股與台指期夜盤最終收盤數據（週末休市）】\n" if is_weekend else "【昨日美股與台指期夜盤最終收盤數據】\n"

    role_and_context = f"""你是一位資深的台股專業首席操盤手。請詳細閱讀以下提供的『市場夜盤/美股收盤數據』、『三大法人籌碼監控數據』以及最新的『財經新聞細節』。
請幫我統整出一份深入、具備高度實戰價值的『{title_context}』。

【深度交叉分析核心指令（新聞面 ✖ 資金面）】：
你必須擺脫單純抄寫新聞的模式，強制對照『新聞事件』與『三大法人近3日買賣數列 [前天, 昨天, 今天]、土洋關係、融資增減、MACD柱狀體』：
1. 【真利多（雙強共振）】：新聞有利多，且法人連續買超（或外資投信土洋同買）、融資退場，列入重大利多。
2. 【假利多真出貨（籌碼背離）】：新聞公布營收創高或接單利多，但三大法人卻連續大賣（外資大提款、融資暴增散戶接刀），『必須』列入「⚠️ 重大個股利空」中作為重點風險示警！
3. 【個股數量規範】：
   - 「🚀 重大個股利多」請詳實列出 8 ~ 12 檔，禁止只挑 4~5 檔草草了事。
   - 「⚠️ 重大個股利空」請詳實列出 6 ~ 10 檔（務必納入籌碼背離或法人連賣標的）。
4. 【個股格式統一模板】：
   在第 2 與第 3 區塊中，每一檔個股請嚴格按照以下 HTML 格式輸出：
   <li><strong>公司名稱 (代號)：</strong>【消息面】新聞核心重點與財務數字。【籌碼面】三大法人買賣動向（註明外資/投信張數增減趨勢、土洋同買/對作、融資與MACD狀態），並給予精闢定性解讀。</li>

報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：
注意：絕對不要輸出 <!DOCTYPE>, <html>, <head>, <style>, <body> 等外層網頁標籤，僅輸出內容片段標籤。

1. 📈 國際大盤焦點（美股表現、重要經濟數據、台積電ADR動態與台指期夜盤收盤重點）。
2. 🚀 重大個股利多（篩選 8~12 檔具備基本面亮點或法人買盤加持標的，按模板標示消息面與籌碼面）。
3. ⚠️ 重大個股利空（篩選 6~10 檔實質利空或『營收創新高但法人大倒貨/籌碼背離』個股，按模板標示消息面與籌碼面）。
4. 💡 操盤手筆記（綜合國際氛圍與籌碼數據，歸納土洋對作焦點族群、法人資金輪動方向及開盤實戰策略）。
"""

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
    
    prompt = f"{role_and_context}\n市場收盤數據來源：\n{market_context}\n{chips_context}\n新聞資料來源如下：\n{news_context}"
    return prompt

def ai_generate_report(news_list, market_data, chips_data, today_dt):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("❌ 錯誤：未讀取到 GEMINI_API_KEY 環境變數，請檢查 GitHub Secrets 或系統環境變數設定！")
        
    url = f"[https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=](https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=){api_key}".strip()
    headers = {"Content-Type": "application/json"}
    
    max_retries = 5
    base_backoff_delays = [10, 25, 45, 70, 90]
    
    for attempt in range(max_retries):
        if attempt >= 2:
            print("⚡ 啟動防塞車降載策略：縮減分析新聞為重要前 50 筆...")
            prompt = build_prompt(news_list, market_data, chips_data, today_dt, max_news_count=50, max_content_len=600)
        else:
            prompt = build_prompt(news_list, market_data, chips_data, today_dt, max_news_count=None, max_content_len=1500)
            
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
    
    # 移除 <head>, <style>, <script> 區塊及其內部所有代碼內容
    text = re.sub(r'<(style|script|head)[^>]*>[\s\S]*?</\1>', ' ', html_content, flags=re.IGNORECASE)
    # 移除其餘 HTML 標籤
    text = re.sub(r'<[^>]+>', ' ', text)
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
    chips_data = {}
    
    # 1. 讀取新聞快取檔案 (例如週六抓取的新聞)[cite: 1]
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
            
    # 2. 自動判斷海外夜盤市場檔案日期[cite: 1]
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

    # 3. 讀取 Supabase 籌碼分析 JSON 檔 (優先取前一日，若無取 docs 內最新的一份)
    chips_target_path = os.path.join(target_dir, f"chips_{yesterday_str}.json")
    if not os.path.exists(chips_target_path):
        chip_files = sorted(glob.glob(os.path.join(target_dir, "chips_*.json")))
        if chip_files:
            chips_target_path = chip_files[-1]
            
    if os.path.exists(chips_target_path):
        print(f"📖 讀取法人籌碼與動能資料: {os.path.basename(chips_target_path)}")
        try:
            with open(chips_target_path, "r", encoding="utf-8") as f:
                chips_data = json.load(f)
        except Exception as e:
            print(f"⚠️ 讀取籌碼 JSON 異常: {e}")
    else:
        print("ℹ️ 未找到任何 chips_*.json 檔案。")
            
    if all_combined_news:
        print(f"🔥 交付 Gemini 分析共 {len(all_combined_news)} 筆新聞，深度融合市場夜盤與 Supabase 籌碼大帳本...")
        content = ai_generate_report(all_combined_news, market_data, chips_data, now_tw)
        
        audio_file = asyncio.run(generate_microsoft_tts(content, today_str))
        save_to_html(content, all_combined_news, today_str, now_tw, audio_filename=audio_file)
    else:
        print(f"😴 找不到前一日 ({yesterday_str}) 的新聞快取資料，未生成報告。")

if __name__ == "__main__":
    main()
