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

## 經銷商折數與寄賣

先於客戶管理設定合作方式及零售價折數（6.5 為六五折，10 為原價）。舊客戶折數留空，需自行填入後才能開新單，避免猜測既有合約。新銷貨單從零售價計算，單價四捨五入至小數點兩位；保存合作方式、折數與零售價快照。價格或客戶條件在操作期間被修改時，伺服器會拒絕舊價格，需重新選擇客戶及商品。

寄賣建立時僅記錄貨值，應收為零。出貨後按「售出／退回」，填累計售出及未售退回數量，售出數量乘原單價才列入應收；已收款金額獨立保存，可多次售出、多次收款。結算與收款皆用行鎖及 revision 防止舊畫面覆寫；未售數量無法收款。累計數量不得減少，已登記的售出退貨／退款更正需另行處理。未售退回僅調整寄放餘量；倉庫庫存維持原系統手動調整流程。已結算寄賣單因保留紀錄不可直接刪除。

新資料庫依序執行 db/schema.sql、db/dealer-terms.sql（已在正式庫套用）；db/verify-dealer-terms.sql 自動回復測試資料，驗證計價、分批售出收款、數量限制、重複請求、歷史價格及失敗交易回復。
