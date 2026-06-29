// src/index.js (全西元 - 上市櫃獨立雙檔案 - 100% 繼承原文字推流安全版)
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

      const year = date.substring(0, 4);
      const month = date.substring(4, 6);
      const day = date.substring(6, 8);

      const ghUser = env.GH_USER;     
      const ghRepo = env.GH_REPO;     
      const ghToken = env.GH_TOKEN;   

      // =================================================================
      // 📡 【第一線：上市 (TWSE)】- 100% 完整保留您原本成功版本的每一行邏輯
      // =================================================================
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      
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

      if (!totalBookJson.trim().startsWith("{")) {
        return new Response(
          JSON.stringify({ success: false, error: "TWSE returned non-JSON data. Please check connection or date." }), 
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
      // 📡 【第二線：上櫃 (TPEx)】- 獨立且採用與上市完全相同的純文字穩定架構
      // =================================================================
      const tpexDateStr = `${year}/${month}/${day}`; // 組合成 "2026/06/26"
      const tpexUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&o=json`;

      const tpexRes = await fetch(tpexUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://www.tpex.org.tw/zh-tw/obk/page/three.html',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      const tpexBookJson = await tpexRes.text();

      // 安全檢查：若櫃買中心回傳異常文字則跳過上櫃落地，不阻斷程式
      let tpexSuccess = false;
      let tpexStatus = 0;

      if (tpexBookJson.trim().startsWith("{")) {
        // 推送上櫃檔案到 GitHub (檔名為 YYYYMMDD_otc.json)
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
      }

      // =================================================================
      // 🏁 3. 回傳參數給前端
      // =================================================================
      return new Response(JSON.stringify({ 
        success: twseGhRes.ok && tpexSuccess, 
        status: twseGhRes.status, 
        tpexStatus: tpexStatus,
        calledTwseUrl: twseUrl,
        calledTpexUrl: tpexUrl
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
