// src/index.js (全西元 - 上市櫃完全獨立 - 精簡標頭防阻擋版)
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
      const date = url.searchParams.get("date"); // 接收 "20260623"

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

      // =================================================================
      // 📡 【第一步：上市 (TWSE)】- 100% 沿用原本保證成功版本的寫法
      // =================================================================
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.twse.com.tw/zh/page/trading/fund/T86.html'
        }
      });
      
      const totalBookJson = await twseRes.text();

      // 推送上市檔案到 GitHub
      const twseCommitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/json/${date}.json`;
      let twseSha = null;
      try {
        const checkRes = await fetch(twseCommitUrl, {
          headers: { "Authorization": `token ${ghToken}`, "User-Agent": "Cloudflare-Worker" }
        });
        if (checkRes.status === 200) {
          const checkData = await checkRes.json();
          twseSha = checkData.sha; 
        }
      } catch (e) {}

      const twseB64Content = btoa(unescape(encodeURIComponent(totalBookJson))); 
      const twsePayload = { message: `📥 自動同步西元上市大帳本：${date}.json`, content: twseB64Content };
      if (twseSha) twsePayload.sha = twseSha; 

      const twseGhRes = await fetch(twseCommitUrl, {
        method: "PUT",
        headers: {
          "Authorization": `token ${ghToken}`,
          "User-Agent": "Cloudflare-Worker",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(twsePayload)
      });


      // =================================================================
      // 📡 【第二步：上櫃 (TPEx)】- 移除多餘干擾標頭，採用完全隔離防線
      // =================================================================
      let tpexSuccess = false;
      let tpexStatus = 0;
      let tpexErrorMsg = "無錯誤";

      try {
        const tpexDateStr = `${year}/${month}/${day}`; // "2026/06/23"
        const tpexUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&o=json`;

        // 💡 關鍵修正：精簡 Headers，不要帶 Accept、X-Requested-With 等容易引起機房 WAF 誤判的標頭
        const tpexRes = await fetch(tpexUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.tpex.org.tw/zh-tw/obk/page/three.html'
          }
        });

        const tpexBookJson = await tpexRes.text();

        // 💡 關鍵修正：取消過度嚴格的開頭檢查，不論內容是什麼，通通直接強制推送落地，讓您能在 GitHub 直觀看到回傳結果
        const tpexCommitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/json/${date}_otc.json`;
        let tpexSha = null;
        try {
          const checkRes = await fetch(tpexCommitUrl, {
            headers: { "Authorization": `token ${ghToken}`, "User-Agent": "Cloudflare-Worker" }
          });
          if (checkRes.status === 200) {
            const checkData = await checkRes.json();
            tpexSha = checkData.sha; 
          }
        } catch (e) {}

        const tpexB64Content = btoa(unescape(encodeURIComponent(tpexBookJson))); 
        const tpexPayload = { message: `📥 自動同步西元上櫃大帳本：${date}_otc.json`, content: tpexB64Content };
        if (tpexSha) tpexPayload.sha = tpexSha; 

        const tpexGhRes = await fetch(tpexCommitUrl, {
          method: "PUT",
          headers: {
            "Authorization": `token ${ghToken}`,
            "User-Agent": "Cloudflare-Worker",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(tpexPayload)
        });
        
        tpexSuccess = tpexGhRes.ok;
        tpexStatus = tpexGhRes.status;
        
      } catch (tpexErr) {
        tpexErrorMsg = tpexErr.message;
      }

      // =================================================================
      // 🏁 【第三步：回傳結果】
      // =================================================================
      return new Response(JSON.stringify({ 
        success: twseGhRes.ok, 
        status: twseGhRes.status, 
        calledTwseUrl: twseUrl,
        tpexInfo: {
          success: tpexSuccess,
          status: tpexStatus,
          log: tpexErrorMsg
        }
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
