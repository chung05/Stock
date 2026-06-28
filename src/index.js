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
    const date = url.searchParams.get("date"); // 接收 YYYYMMDD

    if (!date) return new Response("Missing date param", { status: 400 });

    // 1. 直連證交所下載總表 (偽裝標頭)
    const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
    const twseRes = await fetch(twseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twse.com.tw/'
      }
    });
    
    const totalBookJson = await twseRes.text();

    // 2. 將大檔案推送到您的 GitHub 資料夾 (使用 GitHub API)
    const ghUser = env.GH_USER;     // 您的 GitHub 帳號
    const ghRepo = env.GH_REPO;     // 您的 Repository 名稱
    const ghToken = env.GH_TOKEN;   // 您的 GitHub Access Token
    
    const commitUrl = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/json/${date}.json`;
    
    // 檢查 GitHub 上是否已經存在該檔案 (避免重複覆蓋產生衝突)
    let sha = null;
    try {
      const checkRes = await fetch(commitUrl, {
        headers: { "Authorization": `token ${ghToken}`, "User-Agent": "Cloudflare-Worker" }
      });
      if (checkRes.status === 200) {
        const checkData = await checkRes.json();
        sha = checkData.sha; // 如果檔案存在，拿到它的 sha 識別碼
      }
    } catch (e) {}

    // 將資料轉為 Base64 編碼以符合 GitHub API 規範
    const b64Content = btoa(unescape(encodeURIComponent(totalBookJson))); 
    
    const bodyPayload = {
      message: `📥 自動同步 ${date} 證交所總表大明細`,
      content: b64Content
    };
    if (sha) bodyPayload.sha = sha; // 如果檔案已存在，帶入 sha 進行更新

    // 推送給 GitHub API 存檔
    const ghRes = await fetch(commitUrl, {
      method: "PUT",
      headers: {
        "Authorization": `token ${ghToken}`,
        "User-Agent": "Cloudflare-Worker",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(bodyPayload)
    });

    return new Response(JSON.stringify({ success: ghRes.ok, status: ghRes.status }), {
      headers: { 
        "Access-Control-Allow-Origin": "*", 
        "Content-Type": "application/json" 
      }
    });
  }
};
