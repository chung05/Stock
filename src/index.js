// src/index.js (全西元 - 上市無斜線 + 上櫃帶斜線對齊版)
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
      // 📡 1. 下載上市 (TWSE) - 使用純 8 碼西元年 (無斜線)
      // ==========================================
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      const twseRes = await fetch(twseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.twse.com.tw/zh/page/trading/fund/T86.html'
        }
      });
      const twseJson = await twseRes.json();

      // ==========================================
      // 📡 2. 下載上櫃 (TPEx) - 完全依照您提供的西元帶斜線格式 (YYYY/MM/DD)
      // ==========================================
      const tpexDateStr = `${year}/${month}/${day}`; // 組合成 "2026/06/26"
      
      const tpexUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${tpexDateStr}&se=EW&o=json`;
      const tpexRes = await fetch(tpexUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.tpex.org.tw/zh-tw/obk/page/three.html'
        }
      });
      const tpexJson = await tpexRes.json();

      // ==========================================
      // 🧽 3. 資料清洗、對齊與合併 (維持 17 欄架構)
      // ==========================================
      let mergedData = [];

      // 匯入上市股票
      if (twseJson && twseJson.data) {
        mergedData = mergedData.concat(twseJson.data);
      }

      // 匯入上櫃股票
      if (tpexJson && tpexJson.aaData) {
        const cleanedTpexRows = tpexJson.aaData.map(row => {
          return [
            row[0] ? row[0].trim() : "", // 0. 股票代號
            row[1] ? row[1].trim() : "", // 1. 股票名稱
            row[2],  // 2. 外資買進股數
            row[3],  // 3. 外資賣出股數
            row[4],  // 4. 外資買賣超股數
            row[5],  // 5. 外資自營商買進股數
            row[6],  // 6. 外資自營商賣出股數
            row[7],  // 7. 外資自營商買賣超股數
            row[8],  // 8. 投信買進股數
            row[9],  // 9. 投信賣出股數
            row[10], // 10. 投信買賣超股數
            row[11], // 11. 自營商(自行買賣)買進股數
            row[12], // 12. 自營商(自行買賣)賣出股數
            row[13], // 13. 自營商(自行買賣)買賣超股數
            row[14], // 14. 自營商(避險)買進股數
            row[15], // 15. 自營商(避險)賣出股數
            row[16], // 16. 三大法人買賣超總計
          ];
        });
        mergedData = mergedData.concat(cleanedTpexRows);
      }

      // 建立統整報表結構
      const finalReport = {
        stat: "TWSE: " + (twseJson.stat || "OK") + " / TPEx: " + (tpexJson.statis || "OK"),
        date: date,
        market: "TWSE + TPEx (Merged)",
        data: mergedData
      };

      // ==========================================
      // 📥 4. 推送至 GitHub (維持西元 8 碼檔名：20260626.json)
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
        message: `📥 自動落地備份【全西元上市櫃】融合總表：${date}.json`,
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
