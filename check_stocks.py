import os
import sys
import pandas as pd
from FinMind.data import DataLoader

def check_finmind_database():
    # 1. 初始化 FinMind API
    api = DataLoader()

    # 2. 從環境變數讀取 Token（在 GitHub Secrets 或本地環境設定）
    #    如果沒有設定 Token，則會以匿名模式嘗試執行
    finmind_token = os.getenv("FINMIND_TOKEN")
    
    if finmind_token:
        print("🔑 偵測到 Token，正在進行驗證登入...")
        api.login_by_token(token=finmind_token)
    else:
        print("⚠️ 未偵測到 FINMIND_TOKEN 環境變數，將以匿名模式執行（可能受流量限制）。")

    print("🚀 正在從 FinMind 獲取全台股票基本總表...")
    
    try:
        # 3. 抓取全市場股票基本資訊
        stock_info = api.taiwan_stock_info()
        
        if stock_info is None or stock_info.empty:
            print("❌ 錯誤：無法從 FinMind 取得任何股票清單，請檢查網路或 API 狀態。")
            sys.exit(1)

        # 4. 篩選出 2301 與 6446 的資料
        target_ids = ["2301", "6446"]
        target_stocks = stock_info[stock_info["stock_id"].isin(target_ids)]

        print("\n" + "="*40)
        print("🔍 FinMind 資料庫排查結果")
        print("="*40)

        # 5. 分析結果並回報
        if target_stocks.empty:
            print("❌ 結論：FinMind 的股票清單中【完全找不到】2301 與 6446！")
            print("   原因：後端資料庫的基本總表缺失，導致歷史資料 API 無法調用。")
        else:
            print(f"✅ 成功在總表中找到資料（共 {len(target_stocks)} 筆）：\n")
            # 調整顯示格式，讓 GitHub 輸出 Log 更好看
            pd.set_option('display.max_columns', None)
            pd.set_option('display.width', 1000)
            print(target_stocks[["stock_id", "stock_name", "type", "status"]])
            
            print("\n💡 提示：如果這裡有找到資料，但 daily 歷史K線抓不到，")
            print("   代表是後端 daily 價格資料表（Daily Price）出現斷層。")
            
    except Exception as e:
        print(f"💥 程式執行發生異常: {e}")
        sys.exit(1)

if __name__ == "__main__":
    check_finmind_database()
