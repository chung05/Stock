// src/index.js (全市場上市櫃自動融合純淨版)
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
      const date = url.searchParams.get("date"); // 接收前端傳來的 "20260626"

      if (!date || date.length !== 8 || isNaN(date)) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid date: [${date}].` }), 
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const year = date.substring(0, 4);
      const month = date.substring(4, 6);
      const day = date.substring(6, 8);

      // ==========================================
      // 📡 步驟 1：下載上市 (TWSE) 原始籌碼資料
      // ==========================================
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      const twseRes = await fetch(twseUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const twseJson = await twseRes.json();

      // ==========================================
      // 📡 步驟 2：下載上櫃 (TPEx) 原始籌碼資料 (格式強制帶斜線)
      // ==========================================
      const tpexDateStr = `${year}/${month}/${day}`;
      const tpexUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&o=json`;
      const tpexRes = await fetch(tpexUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const tpexJson = await tpexRes.json();

      // ==========================================
      // 🧽 步驟 3：清洗並格式化上櫃資料，使其完美對齊上市結構
      // ==========================================
      let mergedData = [];

      // 注入上市股票
      if (twseJson && twseJson.data) {
        mergedData = mergedData.concat(twseJson.data);
      }

      // 轉換並注入上櫃股票
      if (tpexJson && tpexJson.aaData) {
        const cleanedTpexRows = tpexJson.aaData.map(row => {
          return [
            row[0] ? row[0].trim() : "", // 0. 股票代號
            row[1] ? row[1].trim() : "", // 1. 股票名稱
            row[2],  // 2. 外資買進
            row[3],  // 3. 外資賣出
            row[4],  // 4. 外資買賣超
            row[5],  // 5. 外資自營商買進
            row[6],  // 6. 外資自營商賣出
            row[7],  // 7. 外資自營商買賣超
            row[8],  // 8. 投信買進
            row[9],  // 9. 投信賣出
            row[10], // 10. 投信買賣超
            row[11], // 11. 自營商(自行)買進
            row[12], // 12. 自營商(自行)賣出
            row[13], // 13. 自營商(自行)買賣超
            row[14], // 14. 自營商(避險)買進
            row[15], // 15. 自營商(避險)賣出
            row[16], // 16. 三大法人買賣超總計
          ];
        });
        mergedData = mergedData.concat(cleanedTpexRows);
      }

      // 建立統整後的融合大總表結構
      const finalReport = {
        stat: (twseJson.stat || "OK") + " / " + (tpexJson.statis || "OK"),
        date: date,
        market: "TWSE + TPEx (Merged)",
        data: mergedData
      };

      // ==========================================
      // 📥 步驟 4：將完美合併的全市場檔案推送到 GitHub
      // ==========================================
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

      const b64Content = btoa(unescape(encodeURIComponent(JSON.stringify(finalReport)))); 
      
      const bodyPayload = {
        message: `📥 自動落地備份【上市+上櫃】融合總表：${date}.json`,
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
        totalStocksSynced: mergedData.length
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
