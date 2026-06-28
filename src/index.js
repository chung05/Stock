// src/index.js (純淨西元 8 碼版 - 徹底拋棄民國年)
export default {
  async fetch(request, env) {
    // 建立標準 CORS 標頭，解鎖跨網域限制
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // 處理瀏覽器 Axios 的預檢請求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const date = url.searchParams.get("date"); // 前端傳過來的純 8 碼西元字串，例如 "20260626"

      // 嚴格防呆：確保收到的日期一定是 8 位數純數字
      if (!date || date.length !== 8 || isNaN(date)) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid date param: [${date}]. Must be YYYYMMDD format.` }), 
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 💡 1. 直接使用西元 8 碼去戳證交所官方大帳本 API (T86_gg 接口)
      // 這就是您第一版測試成功、最原汁原味的官方西元網址結構
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86_gg?date=${date}&selectType=ALLBUT0999&response=json`;
      
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.twse.com.tw/'
        }
      });
      
      // 擷取證交所吐回來的原始總表資料
      const totalBookJson = await twseRes.text();

      // 2. 推送到您的 GitHub 專案資料夾 (維持西元 8 碼命名，例如 20260626.json)
      const ghUser = env.GH_USER;     
      const ghRepo = env.GH_REPO;     
      const ghToken = env.GH_TOKEN;   
      
      const commitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/json/${date}.json`;
      
      // 檢查該檔案是否已存在，用來獲取 sha 覆蓋檔案
      let sha = null;
      try {
        const checkRes = await fetch(commitUrl, {
          headers: { "Authorization": `token ${ghToken}`, "User-Agent": "Cloudflare-Worker" }
        });
        if (checkRes.status === 200) {
          const checkData = await checkRes.json();
          sha = checkData.sha; 
        }
      } catch (e) {}

      // Base64 安全編碼
      const b64Content = btoa(unescape(encodeURIComponent(totalBookJson))); 
      
      const bodyPayload = {
        message: `📥 自動落地備份西元總表：${date}.json`,
        content: b64Content
      };
      if (sha) bodyPayload.sha = sha; 

      // 寫入 GitHub
      const ghRes = await fetch(commitUrl, {
        method: "PUT",
        headers: {
          "Authorization": `token ${ghToken}`,
          "User-Agent": "Cloudflare-Worker",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyPayload)
      });

      // 3. 吐回完整的通訊參數給前端網頁列印
      return new Response(JSON.stringify({ 
        success: ghRes.ok, 
        status: ghRes.status, 
        queriedWestDate: date,
        calledTwseUrl: twseUrl
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
