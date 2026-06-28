// src/index.js (CORS 強化終極版)
export default {
  async fetch(request, env) {
    // 💡 建立統一的 CORS 回應標頭
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // 處理瀏覽器的預檢請求 (OPTIONS)，必須直接回傳 200 與 CORS 標頭
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const date = url.searchParams.get("date"); // 例如 "20260626"

      if (!date || date.length !== 8) {
        return new Response("Missing date", { status: 400, headers: corsHeaders });
      }

      // 1. 西元轉民國日期
      const year = parseInt(date.substring(0, 4));
      const month = date.substring(4, 6);
      const day = date.substring(6, 8);
      const twYear = year - 1911;
      const twDateStr = `${twYear}/${month}/${day}`; // "115/06/26"

      // 2. 直連證交所下載總表
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${encodeURIComponent(twDateStr)}&selectType=ALLBUT0999&response=json`;
      
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.twse.com.tw/'
        }
      });
      
      const totalBookJson = await twseRes.text();

      // 3. 推送到 GitHub
      const ghUser = env.GH_USER;     
      const ghRepo = env.GH_REPO;     
      const ghToken = env.GH_TOKEN;   
      
      const commitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/json/${date}.json`;
      
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

      const b64Content = btoa(unescape(encodeURIComponent(totalBookJson))); 
      
      const bodyPayload = {
        message: `📥 自動同步 ${date} 證交所總表`,
        content: b64Content
      };
      if (sha) bodyPayload.sha = sha; 

      const ghRes = await fetch(commitUrl, {
        method: "PUT",
        headers: {
          "Authorization": `token ${ghToken}`,
          "User-Agent": "Cloudflare-Worker",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyPayload)
      });

      // 💡 成功回應，也必須強制帶上 corsHeaders！
      return new Response(JSON.stringify({ success: ghRes.ok, status: ghRes.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      // 💡 萬一發生錯誤，也要帶上 CORS 標頭，網頁端才看得到錯誤因
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
