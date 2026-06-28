// src/index.js (全西元 - 上市櫃獨立雙檔案落地版)
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
      const date = url.searchParams.get("date"); // 接收 "20260626"

      if (!date || date.length !== 8 || isNaN(date)) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid date: [${date}].` }), 
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const year = date.substring(0, 4);
      const month = date.substring(4, 6);
      const day = date.substring(6, 8);

      const ghUser = env.GH_USER;     
      const ghRepo = env.GH_REPO;     
      const ghToken = env.GH_TOKEN;   

      // 建立通用的 GitHub SHA 檢查與上傳邏輯函數
      async function uploadToGithub(path, contentStr, commitMessage) {
        const commitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/${path}`;
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

        const b64Content = btoa(unescape(encodeURIComponent(contentStr))); 
        const bodyPayload = { message: commitMessage, content: b64Content };
        if (sha) bodyPayload.sha = sha; 

        return await fetch(commitUrl, {
          method: "PUT",
          headers: {
            "Authorization": `token ${ghToken}`,
            "User-Agent": "Cloudflare-Worker",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(bodyPayload)
        });
      }

      // ==========================================
      // 📡 1. 下載並儲存 上市 (TWSE) 原始檔案
      // ==========================================
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.twse.com.tw/zh/page/trading/fund/T86.html'
        }
      });
      const twseJson = await twseRes.json();
      
      // 將上市原裝 JSON 上傳至 json/YYYYMMDD.json
      const twseGhRes = await uploadToGithub(
        `json/${date}.json`, 
        JSON.stringify(twseJson), 
        `📥 自動落地：上市大總表 ${date}.json`
      );

      // ==========================================
      // 📡 2. 下載並儲存 上櫃 (TPEx) 原始檔案
      // ==========================================
      const tpexDateStr = `${year}/${month}/${day}`; 
      const tpexUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&o=json`;
      const tpexRes = await fetch(tpexUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.tpex.org.tw/zh-tw/obk/page/three.html'
        }
      });
      const tpexJson = await tpexRes.json();
      
      // 將上櫃原裝 JSON 上傳至 json/YYYYMMDD_otc.json
      const tpexGhRes = await uploadToGithub(
        `json/${date}_otc.json`, 
        JSON.stringify(tpexJson), 
        `📥 自動落地：上櫃大總表 ${date}_otc.json`
      );

      // ==========================================
      // 🏁 3. 回傳雙線處理結果給前端
      // ==========================================
      return new Response(JSON.stringify({ 
        success: twseGhRes.ok && tpexGhRes.ok, 
        twseStatus: twseGhRes.status,
        tpexStatus: tpexGhRes.status,
        message: "上市與上櫃原始檔案已分開獨立落盤成功！"
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
