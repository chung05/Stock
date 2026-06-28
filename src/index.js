// src/index.js (Cloudflare Worker 修正版)
export default {
  async fetch(request, env) {
    // 處理網頁端跨網域預檢 (CORS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    const url = new URL(request.url);
    const date = url.searchParams.get("date"); // 接收網頁傳來的西元格式，例如 "20250625"

    if (!date || date.length !== 8) {
      return new Response("Missing or invalid date param (should be YYYYMMDD)", { status: 400 });
    }

    // 💡 【核心邏輯修正】：將西元日期轉換為證交所 T86 接口指定的「民國日期」
    const year = parseInt(date.substring(0, 4));
    const month = date.substring(4, 6);
    const day = date.substring(6, 8);
    
    const twYear = year - 1911; // 2025 - 1911 = 114
    const twDateStr = `${twYear}/${month}/${day}`; // 轉換成 "114/06/25"

    // 1. 直連證交所下載總表 (帶入正確的民國日期網址)
    const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${encodeURIComponent(twDateStr)}&selectType=ALLBUT0999&response=json`;
    
    const twseRes = await fetch(twseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twse.com.tw/'
      }
    });
    
    const totalBookJson = await twseRes.text();

    // 2. 將大檔案推送到您的 GitHub 資料夾 (維持用西元命名，方便網頁讀取)
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
      message: `📥 自動同步 ${date} (民國 ${twDateStr}) 證交所總表`,
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

    return new Response(JSON.stringify({ success: ghRes.ok, status: ghRes.status, msg: `Converted to ${twDateStr}` }), {
      headers: { 
        "Access-Control-Allow-Origin": "*", 
        "Content-Type": "application/json" 
      }
    });
  }
};
