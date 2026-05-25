# 批發通 — 服飾批發管理系統

## 快速啟動

```bash
npm install
cp .env.example .env   # 填入 Supabase 金鑰
npm run dev            # http://localhost:5173
```

## Supabase 設定步驟

1. 前往 https://supabase.com → New Project
2. 進入 **SQL Editor**，複製 `src/lib/supabase.js` 內的 SQL 執行
3. 進入 **Settings → API**，複製 Project URL 和 anon key
4. 填入 `.env` 檔案

## 功能模組
- 儀表板：營收、應收帳款、低庫存警示
- 款式管理：顏色 × 尺碼庫存矩陣
- 庫存管理：全 SKU 覽表、低庫存篩選
- 客戶管理：批發/零售、信用額度
- 訂單管理：開單、出貨、收款標記、出貨單列印
- 銷售報表：營收、熱銷款式、客戶排行、色碼分析
