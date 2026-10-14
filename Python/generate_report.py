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
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

def format_chips_for_prompt(chips_data):
    """將結構化的 5 日量價與籌碼資料轉換為高密度 Prompt 摘要"""
    if not chips_data:
        return "無最新籌碼數據。\n"
    
    meta = chips_data.get("meta", {})
    dates = meta.get("dates_analyzed", [])
    date_str = f"[{', '.join(dates)}]" if dates else "[T-4, T-3, T-2, T-1, T]"
    
    lines = [
        f"【核心觀察股 (231檔) 近5日三大法人、量價K線與技術指標監控】",
        f"※ 數列格式統一為 {date_str}，由左至右分別為 [T-4, T-3, T-2, T-1, T] (單位: 張/元)\n"
    ]

    def format_list(title, items, top_n=25, extra_key=None):
        sub_lines = [f"### {title}"]
        for item in items[:top_n]:
            sid = item.get("stock_id")
            sname = item.get("stock_name")
            rel = item.get("relation", "分歧")
            today_net = item.get("today_total_net", 0)
            f_net = item.get("foreign_net_5d", [])
            it_net = item.get("investment_trust_net_5d", [])
            d_net = item.get("dealer_net_5d", [])
            inst_ratio = item.get("inst_ratio_pct", 0)
            
            p = item.get("price_data", {})
            today_c = p.get("today_close", 0)
            chg_pct = p.get("change_pct", 0)
            o, h, l = p.get("open", 0), p.get("high", 0), p.get("low", 0)
            vol = p.get("today_volume", 0)
            vol_ratio = p.get("vol_ratio_5d", 1.0)
            
            ma = item.get("ma_data", {})
            ma_status = ma.get("status", "均線糾結")
            ma5, ma20 = ma.get("ma5", 0), ma.get("ma20", 0)
            
            tech = item.get("tech_data", {})
            kd = tech.get("kd", {})
            k_val, d_val = kd.get("k", 0), kd.get("d", 0)
            rsi = tech.get("rsi_5d", [])
            macd_osc = tech.get("macd_osc", 0)
            
            credit = item.get("credit_data", {})
            m_net = credit.get("margin_net_today", 0)
            s_net = credit.get("short_net_today", 0)
            
            extra_str = ""
            if extra_key and extra_key in item:
                extra_str = f" | 累計買賣超:{item[extra_key]:+d}張"

            sub_lines.append(
                f"- {sid} {sname} [{rel}] 收盤:{today_c}元 ({chg_pct:+.2f}%) [開:{o},高:{h},低:{l}] | 量:{vol}張 (5日量比:{vol_ratio}倍)\n"
                f"  法人籌碼: 今日三大法人:{today_net:+d}張{extra_str} (佔成交量:{inst_ratio}%) | 外資:{f_net} | 投信:{it_net} | 自營:{d_net}\n"
                f"  型態與指標: {ma_status} (5MA:{ma5}, 20MA:{ma20}) | KD:({k_val:.1f}/{d_val:.1f}), RSI:{rsi}, MACD柱:{macd_osc:+.2f} | 資:{m_net:+d}張, 券:{s_net:+d}張"
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

def build_prompt(news_list, market_data, chips_data, today_dt, max_news_count=80, max_content_len=900):
    weekday = today_dt.weekday()  # 0:週一, 5:週六, 6:週日
    chips_context = format_chips_for_prompt(chips_data)
    is_weekend = (weekday == 6)
    
    if is_weekend:
        market_header = "【本週五美股與台指期夜盤最終收盤數據（週末休市）】\n"
        role_and_context = (
            "你是一位資深的台股首席專業操盤手。今天是星期天，台股與美股均處於週末休市狀態。\n"
            "請詳細閱讀以下提供的『週五美股與夜盤收盤數據』、本週末最新『台股與國際財經新聞』，以及本週最新『核心觀察股 (231檔) 三大法人籌碼、5日量價與技術指標監控』。\n"
            "請統整出一份兼具基本面與深度量價籌碼動向的『台股週末財經總覽與下週展望報告』。\n"
            "嚴格禁止提及『昨日美股』或『今日開盤』等錯誤字眼，應以『週五美股表現』及『展望下週一開盤』角度分析。\n\n"
            "【個股覆蓋與量價籌碼深度分析要求（請嚴格遵循）】：\n"
            "1. 涵蓋數量：重大個股利多請詳實篩選 10 ~ 15 檔；重大個股利空請篩選 6 ~ 10 檔。禁止只挑 4~5 檔！\n"
            "2. 動態顯示量價籌碼面（重要規則）：\n"
            "   - 若該股票在提供的 231 檔監控數據中：輸出模板為：\n"
            "     <li><strong>公司名稱 (代號)：</strong>【消息面】新聞核心重點與財務業務展望。【量價與籌碼面】當日收盤價(漲跌幅)、K線型態(影線/開高低)、成交量增比、三大法人買賣超(外資/投信張數與佔比)、均線位置(是否站上月線)及KD/RSI狀態，並給予『量價齊揚鎖碼』或『高檔爆量出貨』之實戰定性評估。</li>\n"
            "   - 若該股票不在提供的監控數據中：【完全不需要顯示籌碼與技術面】，直接輸出消息面即可：\n"
            "     <li><strong>公司名稱 (代號)：</strong>【消息面】新聞核心重點與財務業務展望。</li>\n"
            "3. 假利多真出貨警示：若個股營收創新高，但法人連續大賣且爆量留長上影線(或融資暴增散戶接刀)，務必歸入『重大個股利空』進行示警。\n\n"
            "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
            "注意：絕對不要輸出 <!DOCTYPE>, <html>, <head>, <style>, <body> 等外層網頁標籤，僅輸出內容片段標籤。\n"
            "1. 📈 國際大盤焦點（週五美股四大指數、重要經濟數據、台積電ADR動態與台指期夜盤收盤重點）。\n"
            "2. 🚀 週末重大個股利多（列出 10~15 檔基本面亮點個股，有量價籌碼數據則結合驗證，無則僅寫消息面）。\n"
            "3. ⚠️ 週末重大個股利空（列出 6~10 檔實質利空或『營收高但高檔爆量倒貨/破月線背離』個股）。\n"
            "4. 💡 操盤手筆記（綜合週末情勢、均線多空排列、土洋對作重點族群與資金流向，展望下週一操作策略）。\n\n"
        )
    else:
        market_header = "【昨日美股與台指期夜盤最終收盤數據】\n"
        role_and_context = (
            "你是一位資深的台股首席專業操盤手。請仔細閱讀以下提供的大盤/海外夜盤數據、最新台股與國際財經新聞，以及『核心觀察股 (231檔) 三大法人籌碼、5日量價與技術指標監控』。\n"
            "請統整出一份深入、適合在開盤前閱讀的『台股盤前焦點分析報告』。\n"
            "必須特別對照夜盤、美股與 ADR 的表現，並深入解讀個股消息面與量價籌碼背離狀況。\n\n"
            "【個股覆蓋與量價籌碼深度分析要求（請嚴格遵循）】：\n"
            "1. 涵蓋數量：重大個股利多請詳實篩選 10 ~ 15 檔；重大個股利空請篩選 6 ~ 10 檔。禁止只挑 4~5 檔！\n"
            "2. 動態顯示量價籌碼面（重要規則）：\n"
            "   - 若該股票在提供的 231 檔監控數據中：輸出模板為：\n"
            "     <li><strong>公司名稱 (代號)：</strong>【消息面】新聞核心重點與財務業務展望。【量價與籌碼面】當日收盤價(漲跌幅)、K線型態(影線/開高低)、成交量增比、三大法人買賣超(外資/投信張數與佔比)、均線位置(是否站上月線)及KD/RSI狀態，並給予『量價齊揚鎖碼』或『高檔爆量出貨』之實戰定性評估。</li>\n"
            "   - 若該股票不在提供的監控數據中：【完全不需要顯示籌碼與技術面】，直接輸出消息面即可：\n"
            "     <li><strong>公司名稱 (代號)：</strong>【消息面】新聞核心重點與財務業務展望。</li>\n"
            "3. 假利多真出貨警示：若個股營收創新高，但法人連續大賣且爆量留長上影線(或融資暴增散戶接刀)，務必歸入『重大個股利空』進行示警。\n\n"
            "報告必須嚴格包含以下四個區塊，並使用乾淨的 HTML 標籤格式輸出（如 <h2>, <p>, <ul>, <li> 等，不要包含額外的 ```html 標記，直接輸出 HTML 內容）：\n"
            "注意：絕對不要輸出 <!DOCTYPE>, <html>, <head>, <style>, <body> 等外層網頁標籤，僅輸出內容片段標籤。\n"
            "1. 📈 國際大盤焦點（美股表現、重要經濟數據、台積電ADR動態與台指期夜盤收盤解析）。\n"
            "2. 🚀 今日重大個股利多（列出 10~15 檔基本面亮點個股，有量價籌碼數據則結合驗證，無則僅寫消息面）。\n"
            "3. ⚠️ 今日重大個股利空（列出 6~10 檔實質利空或『營收高但高檔爆量倒貨/破月線背離』個股）。\n"
            "4. 💡 操盤手筆記（綜合大盤情勢、均線多空排列、土洋對作族群與資金流向，給出開盤操作實戰指南）。\n\n"
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
            content_snippet += "...(以下字數省略)"
        news_context += f"新聞 {i} [{news['source']}]({news['time']})：{news['title']}\n內文重點：{content_snippet}\n\n"
    
    prompt = f"{role_and_context}數據來源：\n{market_context}\n{chips_context}\n新聞資料來源如下：\n{news_context}"
    return prompt

def ai_generate_report(news_list, market_data, chips_data, today_dt):
    if not GEMINI_API_KEY:
        raise ValueError("❌ 錯誤：GEMINI_API_KEY 環境變數為空，請確認 GitHub Secrets 設定！")
        
    url = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent"
    params = {"key": GEMINI_API_KEY}
    headers = {"Content-Type": "application/json"}
    
    max_retries = 5
    base_backoff_delays = [10, 25, 45, 70, 90]
