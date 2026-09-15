# 批發通：服飾批發管理系統

React / Vite 前端，Vercel 單一 `/api/data` API，Neon PostgreSQL。

## 正式環境切換

Neon 專案：`fashion-wholesale` (`curly-brook-69618415`)，新加坡，PostgreSQL 18。
正式分支：`br-dry-scene-b31x7m4z`，資料庫：`neondb`。
`db/schema.sql` 的六張表已建立，無需再次執行。

在 Vercel `fashion-wholesale` → Settings → Environment Variables 設定：

| 名稱 | 值 | 環境 |
| --- | --- | --- |
| `DATABASE_URL` | Neon 此專案 Connect 面板的 PostgreSQL 連線字串 | Production |
| `ADMIN_PASSWORD` | 自訂至少 16 字元、不易猜測的管理密碼 | Production |

兩者均為伺服器端秘密，請勿加上 `VITE_` 前綴，也不要提交 Git。
Preview 請另用 Neon 開發分支與不同管理密碼，勿讓測試環境直接連正式資料。
設定完成後合併移轉分支，讓 Vercel 從 main 重新部署。確認登入、商品、客戶與訂單功能後才算完成正式切換。
原 Supabase 專案未刪除；它目前為 INACTIVE。本次依使用者確認「資料空白」建立新結構，未宣稱讀取或備份其實際資料。

## 行為

- 六張營運資料表均由 Neon 管理，前端不持有資料庫密碼。
- 管理密碼登入，8 小時 HttpOnly / SameSite=Strict Cookie；正式環境使用 Secure。更換環境變數中的管理密碼並重新部署可使舊登入失效。
- 訂單主檔與明細同一交易，金額由伺服器依明細重新計算。
- 規格更新保留既有 ID；已有訂單關聯的規格不能刪除，失敗時整批回復。
- 商品圖最大上傳 5MB，縮至最長邊 1200px、轉 WebP，壓縮後最多約 1MB，存於商品欄位。GIF 僅保留靜態畫面。適合小型商品目錄，日後大量圖片宜改用物件儲存。
- 訂單建立及出貨不會自動扣庫存，延續原系統行為。
- API 只開放固定資料表與欄位，採參數化查詢。

## 本機及驗證

```sh
npm ci
cp .env.example .env.local
# 在本機填入 DATABASE_URL（測試分支）及 ADMIN_PASSWORD
npx vercel dev
npm run build
node --env-file=.env.local scripts/verify.mjs
```

`verify.mjs` 會建立具識別名稱的測試資料，驗證登入、商品圖片、規格、客戶、訂單交易回復、出貨收款、退貨，並於 finally 刪除自己建立的紀錄。請使用隔離測試資料庫。

## 回復

切換前保留原 Vercel 部署。若新版無法運作，回復原部署即可回復程式版本；原版仍需要啟用 Supabase 才能正常存取資料。本次未停用、刪除或清空 Supabase。
