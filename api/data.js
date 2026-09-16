import { neon } from '@neondatabase/serverless'
import { createHash, timingSafeEqual, createHmac } from 'node:crypto'
const fields = {
 purchases: [], warehouses: [], inventory: [], transfers: [], consignment_settlements: [], custom_orders: [],
 products: ['name','product_code','category','cost_price','wholesale_price','retail_price','image_url','note','is_active'],
 customers: ['name','shop_name','line_nick','phone','address','customer_type','sale_mode','discount','credit_limit','note'],
 orders: ['note'],
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
    purchases:`SELECT p.id,p.purchase_no,p.purchase_date,p.supplier,p.warehouse,p.net_amount,p.tax_amount,p.total_amount,p.status,p.created_at,p.voided_at,COALESCE((SELECT json_agg(i ORDER BY i.product_name,i.color,i.size) FROM purchase_items i WHERE i.purchase_id=p.id),'[]') AS items FROM purchases p ORDER BY p.purchase_date DESC,p.created_at DESC`,
    warehouses:`SELECT id,name,warehouse_type,sort_order,is_active,created_at FROM warehouses WHERE is_active ORDER BY sort_order,name`,
    inventory:`SELECT pv.id AS variant_id,p.id AS product_id,p.product_code,p.name AS product_name,p.category,pv.color,pv.size,pv.stock_qty AS total_stock,COALESCE((SELECT jsonb_object_agg(w.name,COALESCE(wi.stock_qty,0) ORDER BY w.sort_order) FROM warehouses w LEFT JOIN warehouse_inventory wi ON wi.warehouse_id=w.id AND wi.variant_id=pv.id WHERE w.is_active),'{}'::jsonb) AS warehouse_stock FROM product_variants pv JOIN products p ON p.id=pv.product_id ORDER BY p.name,pv.color,pv.size`,
    transfers:`SELECT t.id,t.transfer_no,t.transfer_date,t.note,t.status,t.created_at,t.voided_at,fw.name AS from_warehouse,tw.name AS to_warehouse,COALESCE((SELECT json_agg(json_build_object('id',i.id,'variant_id',i.variant_id,'qty',i.qty,'product_name',p.name,'product_code',p.product_code,'color',pv.color,'size',pv.size) ORDER BY p.name,pv.color,pv.size) FROM stock_transfer_items i JOIN product_variants pv ON pv.id=i.variant_id JOIN products p ON p.id=pv.product_id WHERE i.transfer_id=t.id),'[]') AS items FROM stock_transfers t JOIN warehouses fw ON fw.id=t.from_warehouse_id JOIN warehouses tw ON tw.id=t.to_warehouse_id ORDER BY t.transfer_date DESC,t.created_at DESC`,
    consignment_settlements:`SELECT s.id,s.settlement_no,s.settlement_date,s.net_amount,s.tax_amount,s.total_amount,s.order_id,s.created_at,w.name AS warehouse,c.name AS customer_name,c.shop_name,COALESCE((SELECT json_agg(json_build_object('id',i.id,'variant_id',i.variant_id,'system_qty',i.system_qty,'counted_qty',i.counted_qty,'sold_qty',i.sold_qty,'unit_price',i.unit_price,'product_name',p.name,'product_code',p.product_code,'color',pv.color,'size',pv.size) ORDER BY p.name,pv.color,pv.size) FROM consignment_settlement_items i JOIN product_variants pv ON pv.id=i.variant_id JOIN products p ON p.id=pv.product_id WHERE i.settlement_id=s.id),'[]') AS items FROM consignment_settlements s JOIN warehouses w ON w.id=s.warehouse_id JOIN customers c ON c.id=s.customer_id ORDER BY s.settlement_date DESC,s.created_at DESC`,
    custom_orders:`SELECT o.*,json_build_object('name',c.name,'shop_name',c.shop_name) AS customer,COALESCE((SELECT json_agg(i ORDER BY i.sort_order,i.id) FROM custom_order_items i WHERE i.custom_order_id=o.id),'[]') AS items,COALESCE((SELECT json_agg(p ORDER BY p.payment_date,p.created_at) FROM custom_order_payments p WHERE p.custom_order_id=o.id),'[]') AS payments FROM custom_orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.order_date DESC,o.created_at DESC`,
    products:`SELECT p.*, COALESCE((SELECT json_agg(v ORDER BY v.created_at) FROM product_variants v WHERE v.product_id=p.id),'[]') AS variants FROM products p ORDER BY p.created_at DESC`,
    customers:'SELECT * FROM customers ORDER BY joined_at DESC',
    orders:`SELECT o.*, json_build_object('name',c.name,'shop_name',c.shop_name) AS customer, COALESCE((SELECT json_agg(i) FROM order_items i WHERE i.order_id=o.id),'[]') AS items FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.order_date DESC`,
    returns:`SELECT r.*, json_build_object('name',c.name,'shop_name',c.shop_name) AS customer, json_build_object('order_date',o.order_date) AS "order" FROM returns r JOIN customers c ON c.id=r.customer_id LEFT JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC`
   };data=await sql.query(selects[table])
  } else if(action==='postPurchase' && table==='purchases') {
   data=await sql`SELECT post_purchase(${b.id}::uuid,${JSON.stringify(b.record)}::jsonb) AS id`
  } else if(action==='voidPurchase' && table==='purchases') {
   data=await sql`SELECT void_purchase(${b.id}::uuid)`
  } else if(action==='postTransfer' && table==='transfers') {
   data=await sql`SELECT post_stock_transfer(${b.id}::uuid,${JSON.stringify(b.record)}::jsonb) AS id`
  } else if(action==='voidTransfer' && table==='transfers') {
   data=await sql`SELECT void_stock_transfer(${b.id}::uuid)`
  } else if(action==='settleWarehouseConsignment' && table==='consignment_settlements') {
   data=await sql`SELECT settle_warehouse_consignment(${b.id}::uuid,${JSON.stringify(b.record)}::jsonb) AS id`
  } else if(action==='createCustomOrder' && table==='custom_orders') {
   data=await sql`SELECT create_custom_order(${b.id}::uuid,${JSON.stringify(b.record)}::jsonb) AS id`
  } else if(action==='customOrderStatus' && table==='custom_orders') {
   data=await sql`SELECT set_custom_order_status(${b.id}::uuid,${b.status}::text)`
  } else if(action==='customOrderPayment' && table==='custom_orders') {
   data=await sql`SELECT record_custom_order_payment(${b.id}::uuid,${b.payment_id}::uuid,${JSON.stringify(b.record)}::jsonb)`
  } else if(action==='convertCustomOrder' && table==='custom_orders') {
   data=await sql`SELECT convert_custom_order(${b.id}::uuid,${JSON.stringify(b.mappings)}::jsonb) AS id`
  } else if(action==='variants' && table==='products') {
   if(!Array.isArray(b.variants)||b.variants.length>500) fail('規格格式錯誤')
   const rows=b.variants.map(v=>{if(!v.color||!v.size)fail('規格格式錯誤');return {color:v.color,size:v.size}})
   if(new Set(rows.map(v=>JSON.stringify([v.color,v.size]))).size!==rows.length) fail('規格重複')
   data=await sql.transaction([
    sql`SELECT id FROM products WHERE id=${b.id} FOR UPDATE`,
    sql`DELETE FROM product_variants WHERE product_id=${b.id} AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(color text,size text) WHERE x.color=product_variants.color AND x.size=product_variants.size)`,
    sql`INSERT INTO product_variants(product_id,color,size,stock_qty) SELECT ${b.id}::uuid,color,size,0 FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(color text,size text) ON CONFLICT(product_id,color,size) DO UPDATE SET color=EXCLUDED.color RETURNING *`
   ])
  } else if(action==='createOrder' && table==='orders') {
   const f=b.record || {}
   if(f.sale_mode==='consignment') fail('寄賣請到「庫存管理」先調撥到客戶倉，月底再用「寄賣月結」結帳')
   data=await sql`SELECT create_dealer_order(${f.customer_id}::uuid,${f.note||null},${JSON.stringify(f.items)}::jsonb,${f.discount}::numeric,${f.sale_mode}::text) AS id`
  } else if(action==='settle' && table==='orders') {
   data=await sql`SELECT settle_consignment(${b.id}::uuid,${b.revision}::integer,${JSON.stringify(b.items)}::jsonb)`
  } else if(action==='collect' && table==='orders') {
   if(typeof b.paid!=='boolean') fail('收款狀態錯誤')
   data=await sql`SELECT collect_order(${b.id}::uuid,${b.revision}::integer,${b.paid}::boolean)`
  } else if(action==='ship' && table==='orders') {
   if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>500)fail('訂單清單錯誤')
   data=await sql`SELECT ship_orders(${b.ids}::uuid[]) AS id`
  } else if(action==='delete') {
   if(['purchases','transfers','consignment_settlements','custom_orders','orders'].includes(table)) fail('正式單據不可直接刪除，請保留交易與庫存紀錄')
   data=await sql.query(`DELETE FROM ${table} WHERE id=$1 RETURNING id`,[b.id])
  } else if(action==='insert'||action==='update') {
   if(action==='insert'&&table==='orders')fail('請使用訂單建立功能')
   if(table==='customers') {
    if(action==='insert') b.record={...b.record, discount:b.record?.discount ?? (b.record?.sale_mode==='consignment' ? 6 : 5.5)}
    const f=b.record||{}
    if('discount' in f && (f.discount===null || f.discount==='' || !Number.isFinite(+f.discount) || +f.discount<=0 || +f.discount>10 || Math.abs(+f.discount*100-Math.round(+f.discount*100))>0.000001)) fail('折數請填 0.01～10，六五折請填 6.5')
    if('sale_mode' in f && !['buyout','consignment'].includes(f.sale_mode)) fail('合作方式錯誤')
   }
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
  const message=e.status?e.message:e.code==='P0001'?e.message:e.code==='23503'?'此資料已有訂單或退貨關聯，請保留原紀錄。':e.code==='23505'?'資料重複，請檢查後再試。':'資料儲存失敗，請檢查輸入或稍後重試。'
  if(!e.status)console.error('Database operation failed',e.code || e.name)
  return res.status(e.status || 400).json({error:{message}})
 }
}