import { supabase } from './supabase'

const BUCKET = 'product-images'

// ── 上傳圖片，回傳公開 URL ──────────────────────────────
export async function uploadProductImage(file, productId) {
  // 驗證類型
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowed.includes(file.type)) throw new Error('僅支援 JPG、PNG、WebP、GIF 格式')
  if (file.size > 5 * 1024 * 1024) throw new Error('圖片大小不可超過 5MB')

  const ext  = file.name.split('.').pop()
  const path = `${productId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, cacheControl: '3600' })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// ── 刪除舊圖（path = publicUrl 的路徑部分）────────────────
export async function deleteProductImage(publicUrl) {
  if (!publicUrl) return
  try {
    // 從 publicUrl 解析 storage path
    const marker = `/object/public/${BUCKET}/`
    const idx = publicUrl.indexOf(marker)
    if (idx === -1) return
    const path = publicUrl.slice(idx + marker.length)
    await supabase.storage.from(BUCKET).remove([path])
  } catch (_) { /* 刪除失敗不阻斷主流程 */ }
}

/*
════════════════════════════════════════════════════
  Supabase Storage 設定（一次性，在 Dashboard 執行）
════════════════════════════════════════════════════
1. 進入 Supabase 專案 → 左側 Storage
2. 點 "New bucket"
3. Name: product-images
4. 勾選 "Public bucket"（讓圖片可公開存取）
5. 點 Create bucket

6. 進入 Storage → Policies → product-images bucket
7. 點 "New policy" → "For full customization"
8. 貼上以下 SQL 並執行：

CREATE POLICY "allow_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY "allow_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "allow_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'product-images');

CREATE POLICY "allow_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'product-images');
*/
