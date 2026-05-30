const fs = require('fs');

function exportForAI() {
  console.log("⚙️ 正在轉換為 AI 專用格式...");
  
  const rawData = JSON.parse(fs.readFileSync('./data/raw_data.json', 'utf8'));
  
  // 💡 您可以在這裡設定目標標的，例如只分析台積電
  // 若要分析全部，移除 .filter 即可
  const targetStock = "2330"; 
  
  const aiData = rawData
    // .filter(row => row.stock_id === targetStock) // 若需特定股票請取消註解
    .map(row => ({
      d: row.date,
      id: row.stock_id,
      p: row.price,
      // 計算法人淨買賣超
      f_net: (row.f_buy || 0) - (row.f_sell || 0),
      it_net: (row.it_buy || 0) - (row.it_sell || 0),
      vol: row.trading_volume
    }));

  // 轉為 JSON Lines (AI 處理長序列資料最有效率的格式)
  const jsonlContent = aiData.map(obj => JSON.stringify(obj)).join('\n');
  
  fs.writeFileSync('./data/ai_analysis.jsonl', jsonlContent);
  console.log("✅ AI 分析檔已產出: ./data/ai_analysis.jsonl");
}

exportForAI();
