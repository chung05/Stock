import re
import requests
from bs4 import BeautifulSoup

def get_tpex_margin(roc_date_str):
    """
    透過 HTML 爬蟲解析 TPEx (上櫃) 全市場融資數據
    roc_date_str 格式範例: 115/11/09
    """
    clean_date = roc_date_str.replace("{", "").replace("}", "").strip()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.tpex.org.tw/"
    }

    # -------------------------------------------------------------
    # 策略 1：爬取 TPEx 官方 HTML 報表 (o=htm)
    # -------------------------------------------------------------
    url_official_html = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=htm&d={clean_date}"
    try:
        res = requests.get(url_official_html, headers=headers, timeout=15)
        if res.status_code == 200 and ("融資" in res.text or "tfoot" in res.text.lower()):
            soup = BeautifulSoup(res.text, "html.parser")
            
            # 尋找頁尾 tfoot 或是表格最後幾列
            tfoot = soup.find("tfoot")
            if tfoot:
                rows = tfoot.find_all("tr")
                for row in rows:
                    cells = [td.get_text(strip=True).replace(",", "") for td in row.find_all(["td", "th"])]
                    # 融資金額列通常有 5 個純數字（前日餘額、買進、賣出、現償、今日餘額）
                    num_cells = [c for c in cells if re.match(r'^-?\d+$', c)]
                    if len(num_cells) >= 5:
                        prev_bal = int(num_cells[0])
                        today_bal = int(num_cells[4])
                        diff_bal = today_bal - prev_bal
                        change_rate = round((diff_bal / prev_bal) * 100, 2) if prev_bal else 0.0
                        return {
                            "今日融資餘額_億元": round(today_bal / 100000, 2), # 仟元轉億元
                            "前日融資餘額_億元": round(prev_bal / 100000, 2),
                            "單日增減_億元": round(diff_bal / 100000, 2),
                            "單日增減幅_百分比": change_rate,
                            "本日融資買進_億元": round(int(num_cells[1]) / 100000, 2),
                            "本日融資賣出_億元": round(int(num_cells[2]) / 100000, 2),
                            "現金償還_億元": round(int(num_cells[3]) / 100000, 2),
                            "今日融資餘額_千元": today_bal
                        }
    except Exception as e:
        print(f"⚠️ 官方 HTML 報表爬取異常: {e}")

    # -------------------------------------------------------------
    # 策略 2：鉅亨網 (Anue) 上櫃大盤融資融券彙整頁面爬蟲 (備援)
    # -------------------------------------------------------------
    url_cnyes = "https://www.cnyes.com/twstock/margin/otc"
    try:
        res = requests.get(url_cnyes, headers=headers, timeout=15)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, "html.parser")
            # 尋找包含融資餘額金額的區塊
            text_block = soup.get_text()
            # 匹配例如：「融資餘額 1,024.5 億」或「今日餘額(億) 1024.5」
            match = re.search(r"融資(?:餘額)?.*?([\d,]+\.?\d*)\s*億", text_block)
            diff_match = re.search(r"融資(?:增減)?.*?([+-]?[\d,]+\.?\d*)\s*億", text_block)
            
            if match:
                today_bal_yi = float(match.group(1).replace(",", ""))
                diff_bal_yi = float(diff_match.group(1).replace(",", "")) if diff_match else 0.0
                prev_bal_yi = round(today_bal_yi - diff_bal_yi, 2)
                change_rate = round((diff_bal_yi / prev_bal_yi) * 100, 2) if prev_bal_yi else 0.0
                
                return {
                    "今日融資餘額_億元": today_bal_yi,
                    "前日融資餘額_億元": prev_bal_yi,
                    "單日增減_億元": diff_bal_yi,
                    "單日增減幅_百分比": change_rate,
                    "本日融資買進_億元": 0.0,
                    "本日融資賣出_億元": 0.0,
                    "現金償還_億元": 0.0,
                    "今日融資餘額_千元": int(today_bal_yi * 100000)
                }
    except Exception as e:
        print(f"⚠️ 鉅亨網備援爬蟲異常: {e}")

    return None
