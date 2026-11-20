// src/index.js (完全對齊瀏覽器西元 8 碼驗證版)
export default {
  async fetch(request, env) {
    // 統一 CORS 標頭，允許您本地網頁跨網域撈資料
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
      const date = url.searchParams.get("date"); // 接收前端傳來的純 8 碼西元，如 "20260626"

      // 嚴格檢查參數
      if (!date || date.length !== 8 || isNaN(date)) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid date: [${date}]. Must be YYYYMMDD.` }), 
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 💡 【核心修改】：完全採用您驗證成功、一模一樣的西元 8 碼官方接口網址結構
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      
      // 模擬頂級瀏覽器標頭，防止證交所對 Cloudflare 機房進行阻擋 (WAF 防禦)
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://www.twse.com.tw/zh/page/trading/fund/T86.html',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      const totalBookJson = await twseRes.text();

      // 安全檢查：如果證交所回傳的不是以 { 開頭，說明它噴了 HTML 錯誤（例如 Page Not Found），此時直接中斷避免污染 GitHub
      if (!totalBookJson.trim().startsWith("{")) {
        return new Response(
          JSON.stringify({ success: false, error: "TWSE returned non-JSON data. Please check connection or date." }), 
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. 將此正確的 JSON 推送到您的 GitHub 倉庫 (檔名維持西元 8 碼)
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

      // 安全進行 Base64 編碼
      const b64Content = btoa(unescape(encodeURIComponent(totalBookJson))); 
      
      const bodyPayload = {
        message: `📥 自動同步西元大帳本：${date}.json`,
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

      // 3. 回傳參數給前端，供日誌與調試使用
      return new Response(JSON.stringify({ 
        success: ghRes.ok, 
        status: ghRes.status, 
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
