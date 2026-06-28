// src/index.js (證交所最新規格校正版)
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const date = url.searchParams.get("date"); // 接收前端的 "20260626"

      if (!date || date.length !== 8) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing or invalid date param" }), 
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 💡 【規格校正】：精準轉換為證交所規定的 7 碼純數字民國年格式 (例如 1150626)
      const year = parseInt(date.substring(0, 4));  
      const month = date.substring(4, 6);           
      const day = date.substring(6, 8);             
      
      const twYear = year - 1911; // 115
      
      // 確保年份如果是兩位數 (如99年) 會自動補零，三位數 (115) 則維持正常
      const twYearStr = String(twYear).padStart(3, '0'); 
      const twDateStr = `${twYearStr}${month}${day}`; // 組合出完全標準的 "1150626"

      // 1. 直連臺灣證券交易所 (使用最新 7 碼民國年規格)
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${twDateStr}&selectType=ALLBUT0999&response=json`;
      
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.twse.com.tw/'
        }
      });
      
      const totalBookJson = await twseRes.text();

      // 2. 推送到 GitHub
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
        message: `📥 自動同步 ${date} (證交所參數: ${twDateStr}) 三大法人總表`,
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

      return new Response(JSON.stringify({ 
        success: ghRes.ok, 
        status: ghRes.status, 
        msg: `Successfully queried TWSE with parameter [${twDateStr}] and synced.` 
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
