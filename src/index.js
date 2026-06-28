// src/index.js (完整終極修正版：中文字元日期編碼 + 雙重 CORS 防護)
export default {
  async fetch(request, env) {
    // 💡 建立統一的 CORS 回應標頭，允許您本地的網頁 (test.html) 跨網域存取
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // 處理瀏覽器的預檢請求 (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const date = url.searchParams.get("date"); // 接收前端網頁傳來的 8 碼西元字串，例如 "20250625"

      if (!date || date.length !== 8) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing or invalid date param (should be YYYYMMDD)" }), 
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 💡 【核心邏輯升級】：切碎西元日期，並轉換為證交所同樣完全看懂的「民國中文字串」格式
      // 避開了斜線「/」在網路傳輸中會被某些瀏覽器或網域偷偷吃掉、導致時空倒流的技術死穴！
      const year = parseInt(date.substring(0, 4));  // 例如 2025
      const month = date.substring(4, 6);           // 例如 06
      const day = date.substring(6, 8);             // 例如 25
      
      const twYear = year - 1911;                   // 2025 - 1911 = 114
      const twDateStr = `${twYear}年${month}月${day}日`; // 組合為安全的 "114年06月25日"

      // 1. 直連臺灣證券交易所下載當天所有個股的三大法人買賣超大總表
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${encodeURIComponent(twDateStr)}&selectType=ALLBUT0999&response=json`;
      
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.twse.com.tw/'
        }
      });
      
      // 讀取證交所回傳的原始文字檔 (JSON)
      const totalBookJson = await twseRes.text();

      // 2. 準備將大檔案推送到您的 GitHub 專案資料夾
      const ghUser = env.GH_USER;     // 從 Cloudflare Worker Secrets 讀取帳號
      const ghRepo = env.GH_REPO;     // 從 Cloudflare Worker Secrets 讀取倉庫名
      const ghToken = env.GH_TOKEN;   // 從 Cloudflare Worker Secrets 讀取密鑰權杖
      
      // 儲存在 GitHub 上的路徑維持以西元 YYYYMMDD.json 命名，方便網頁端精確對接
      const commitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/json/${date}.json`;
      
      // 檢查該日期檔案是否在 GitHub 上已存在，若存在則必須取得對應的 sha 識別碼才能進行覆蓋更新
      let sha = null;
      try {
        const checkRes = await fetch(commitUrl, {
          headers: { "Authorization": `token ${ghToken}`, "User-Agent": "Cloudflare-Worker" }
        });
        if (checkRes.status === 200) {
          const checkData = await checkRes.json();
          sha = checkData.sha; 
        }
      } catch (e) {
        // 若檔案不存在，直接忽略錯誤，後續將以新創檔案處理
      }

      // 將證交所的 JSON 字串進行安全的 Base64 編碼，以符合 GitHub API 傳輸規範
      const b64Content = btoa(unescape(encodeURIComponent(totalBookJson))); 
      
      const bodyPayload = {
        message: `📥 自動同步 ${date} (民國 ${twDateStr}) 證交所三大法人總表`,
        content: b64Content
      };
      if (sha) bodyPayload.sha = sha; // 如果檔案已存在，帶入 sha 執行覆蓋

      // 發送 PUT 請求給 GitHub API 執行寫入
      const ghRes = await fetch(commitUrl, {
        method: "PUT",
        headers: {
          "Authorization": `token ${ghToken}`,
          "User-Agent": "Cloudflare-Worker",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyPayload)
      });

      // 3. 回傳成功訊號給本機網頁 (強制帶上 CORS 標頭與 JSON 格式)
      return new Response(JSON.stringify({ 
        success: ghRes.ok, 
        status: ghRes.status, 
        msg: `Successfully converted to ${twDateStr} and synced to GitHub.` 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      // 萬一發生異常，回傳 500 錯誤與 CORS 標頭，方便網頁端 debug
      return new Response(JSON.stringify({ 
        success: false, 
        error: err.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
