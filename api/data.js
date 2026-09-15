import { neon } from '@neondatabase/serverless'
import { createHash, timingSafeEqual, createHmac, randomUUID } from 'node:crypto'
const fields = {
 products: ['name','product_code','category','cost_price','wholesale_price','retail_price','image_url','note','is_active'],
 customers: ['name','shop_name','line_nick','phone','address','customer_type','credit_limit','note'],
 orders: ['status','payment_status','shipped_at','note'],
 returns: ['order_id','customer_id','product_name','color','size','qty','return_type','reason','refund_amount','note','status','resolved_at']
}
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}) }
const equal = (a,b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest())
const sign = value => createHmac('sha256',process.env.ADMIN_PASSWORD).update(value).digest('hex')
function authenticated(req) {
 const token = (req.headers.cookie || '').split('; ').find(x=>x.startsWith('wholesale_session='))?.split('=')[1] || ''
 const [expiry,signature] = token.split('.')
 return Number(expiry)>Date.now() && equal(signature,sign(expiry))
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store')
 try {
  if (!process.env.DATABASE_URL) fail('Production 缺少 DATABASE_URL，請於 Vercel 設定後重新部署。',503)
  if (!process.env.ADMIN_PASSWORD) fail('Production 缺少 ADMIN_PASSWORD，請於 Vercel 設定後重新部署。',503)
  if (process.env.ADMIN_PASSWORD.length<16) fail('ADMIN_PASSWORD 少於 16 字元，請延長管理密碼後重新部署。',503)
  const b = typeof req.body==='string' ? JSON.parse(req.body) : (req.body || {})
  if(req.method==='POST' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) fail('來源不符',403)
  const action = req.method==='GET' ? req.query?.action : b.action
  if(action==='session') {
   try {
    const sql=neon(process.env.DATABASE_URL)
    const [check]=await sql`SELECT bool_and(to_regclass('public.' || name) IS NOT NULL) AS ready FROM unnest(ARRAY['products','product_variants','customers','orders','order_items','returns']) AS t(name)`
    if(!check.ready) fail('資料庫缺少必要資料表，請確認 DATABASE_URL 指向批發通的 Neon 資料庫。',503)
   } catch(e) {
    if(e.status) throw e
    fail('無法連線資料庫，請確認 Production 的 DATABASE_URL 是有效的 Neon 連線字串。',503)
   }
   return res.status(200).json({data:{authenticated:authenticated(req),database_ready:true}})
  }
  if(req.method!=='POST') fail('不支援的請求',405)
  if(action==='login') {
   if(typeof b.password!=='string' || !equal(b.password,process.env.ADMIN_PASSWORD)) fail('密碼不正確',401)
   const expiry=String(Date.now()+8*3600000)
   res.setHeader('Set-Cookie',`wholesale_session=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`)
   return res.status(200).json({data:true})
  }
  if(action==='logout') {res.setHeader('Set-Cookie','wholesale_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return res.status(200).json({data:true})}
  if(!authenticated(req)) fail('請先登入',401)
  const sql=neon(process.env.DATABASE_URL)
  const table=b.table
  if(!Object.hasOwn(fields,table)) fail('無效的資料類型')
  let data
  if(action==='list') {
   const selects={
    products:`SELECT p.*, COALESCE((SELECT json_agg(v ORDER BY v.created_at) FROM product_variants v WHERE v.product_id=p.id),'[]') AS variants FROM products p ORDER BY p.created_at DESC`,
    customers:'SELECT * FROM customers ORDER BY joined_at DESC',
    orders:`SELECT o.*, json_build_object('name',c.name,'shop_name',c.shop_name) AS customer, COALESCE((SELECT json_agg(i) FROM order_items i WHERE i.order_id=o.id),'[]') AS items FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.order_date DESC`,
    returns:`SELECT r.*, json_build_object('name',c.name,'shop_name',c.shop_name) AS customer, json_build_object('order_date',o.order_date) AS "order" FROM returns r JOIN customers c ON c.id=r.customer_id LEFT JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC`
   };data=await sql.query(selects[table])
  } else if(action==='variants' && table==='products') {
   if(!Array.isArray(b.variants)||b.variants.length>500) fail('規格格式錯誤')
   const rows=b.variants.map(v=>{if(!v.color||!v.size||!Number.isInteger(+v.stock_qty)||+v.stock_qty<0)fail('規格或庫存數量錯誤');return {color:v.color,size:v.size,stock_qty:+v.stock_qty}})
   if(new Set(rows.map(v=>JSON.stringify([v.color,v.size]))).size!==rows.length) fail('規格重複')
   data=await sql.transaction([
    sql`SELECT id FROM products WHERE id=${b.id} FOR UPDATE`,
    sql`DELETE FROM product_variants WHERE product_id=${b.id} AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(color text,size text,stock_qty integer) WHERE x.color=product_variants.color AND x.size=product_variants.size)`,
    sql`INSERT INTO product_variants(product_id,color,size,stock_qty) SELECT ${b.id}::uuid,color,size,stock_qty FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(color text,size text,stock_qty integer) ON CONFLICT(product_id,color,size) DO UPDATE SET stock_qty=EXCLUDED.stock_qty RETURNING *`
   ])
  } else if(action==='createOrder' && table==='orders') {
   const f=b.record, id=randomUUID()
   if(!Array.isArray(f.items)||!f.items.length||f.items.length>500) fail('訂單必須包含商品')
   const items=f.items.map(i=>{if(!Number.isInteger(+i.qty)||+i.qty<1||!Number.isFinite(+i.price)||+i.price<0)fail('商品數量或價格錯誤');return {...i,qty:+i.qty,unit_price:+i.price}})
   const total=items.reduce((s,i)=>s+Math.round(i.qty*i.unit_price*100),0)/100
   data=await sql.transaction([
    sql`INSERT INTO orders(id,customer_id,total_amount,note) VALUES(${id},${f.customer_id},${total},${f.note||null}) RETURNING *`,
    sql`INSERT INTO order_items(order_id,variant_id,product_name,color,size,qty,unit_price) SELECT ${id}::uuid,variant_id,product_name,color,size,qty,unit_price FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS x(variant_id uuid,product_name text,color text,size text,qty integer,unit_price numeric) RETURNING *`
   ])
  } else if(action==='ship' && table==='orders') {
   if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>500)fail('訂單清單錯誤')
   data=await sql`UPDATE orders SET status='shipped',shipped_at=now() WHERE id=ANY(${b.ids}::uuid[]) RETURNING id`
  } else if(action==='delete') {
   data=await sql.query(`DELETE FROM ${table} WHERE id=$1 RETURNING id`,[b.id])
  } else if(action==='insert'||action==='update') {
   if(action==='insert'&&table==='orders')fail('請使用訂單建立功能')
   const entries=Object.entries(b.record||{}).filter(([k])=>fields[table].includes(k))
   if(!entries.length)fail('沒有可儲存的欄位')
   const image=b.record?.image_url
   if(image && (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>1400000))fail('圖片格式錯誤或壓縮後超過 1MB')
   const keys=entries.map(([k])=>k),values=entries.map(([,v])=>v)
   if(action==='insert')data=await sql.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values)
   else data=await sql.query(`UPDATE ${table} SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} WHERE id=$${keys.length+1} RETURNING *`,[...values,b.id])
  } else fail('不支援的操作')
  return res.status(200).json({data})
 } catch(e) {
  const message=e.status?e.message:e.code==='23503'?'此資料已有訂單或退貨關聯，請保留原紀錄。':e.code==='23505'?'資料重複，請檢查後再試。':'資料儲存失敗，請檢查輸入或稍後重試。'
  if(!e.status)console.error('Database operation failed',e.code || e.name)
  return res.status(e.status || 400).json({error:{message}})
 }
}
