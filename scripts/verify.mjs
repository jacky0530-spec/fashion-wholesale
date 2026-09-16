import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import handler from '../api/data.js'
let cookie=''
async function call(action,payload={},auth=true) {
 const res={headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.code=s;return this},json(v){this.body=v;return this}}
 await handler({method:'POST',headers:{host:'localhost',...(auth?{cookie}:{})},body:{action,...payload}},res)
 if(res.headers['Set-Cookie'])cookie=res.headers['Set-Cookie'].split(';')[0]
 return res
}
const ok=async(action,payload)=>{const r=await call(action,payload);assert.equal(r.code,200,JSON.stringify(r.body));return r.body.data}
assert.equal((await call('list',{table:'customers'},false)).code,401)
assert.equal((await call('login',{password:'wrong'},false)).code,401)
await ok('login',{password:process.env.ADMIN_PASSWORD})
assert.equal((await ok('session')).authenticated,true)
let product,customer,order,ret
try {
 ;[product]=await ok('insert',{table:'products',record:{name:'Migration verification '+randomUUID(),retail_price:100,image_url:'data:image/png;base64,iVBORw0KGgo='}})
 ;[customer]=await ok('insert',{table:'customers',record:{name:'Migration verification',discount:10,sale_mode:'buyout'}})
 await ok('variants',{table:'products',id:product.id,variants:[{color:'黑色',size:'M',stock_qty:10}]})
 let p=(await ok('list',{table:'products'})).find(x=>x.id===product.id)
 const variant=p.variants[0]
 assert.ok(p.image_url)
 const record={customer_id:customer.id,total_amount:1,discount:10,sale_mode:'buyout',items:[{variant_id:variant.id,qty:2,price:100,product_name:p.name,color:'黑色',size:'M'}]}
 await ok('createOrder',{table:'orders',record})
 order=(await ok('list',{table:'orders'})).find(x=>x.customer_id===customer.id)
 assert.equal(Number(order.total_amount),200);assert.equal(order.items.length,1)
 const bad=await call('createOrder',{table:'orders',record:{...record,items:[{...record.items[0],variant_id:randomUUID()}]}})
 assert.equal(bad.code,400)
 assert.equal((await ok('list',{table:'orders'})).filter(x=>x.customer_id===customer.id).length,1)
 await ok('variants',{table:'products',id:product.id,variants:[{color:'黑色',size:'M',stock_qty:9}]})
 p=(await ok('list',{table:'products'})).find(x=>x.id===product.id)
 assert.equal(p.variants[0].id,variant.id);assert.equal(p.variants[0].stock_qty,9)
 assert.equal((await call('variants',{table:'products',id:product.id,variants:[]})).code,400)
 await ok('ship',{table:'orders',ids:[order.id]})
 await ok('collect',{table:'orders',id:order.id,revision:order.revision,paid:true})
 ;[ret]=await ok('insert',{table:'returns',record:{customer_id:customer.id,order_id:order.id,product_name:p.name,qty:1}})
 await ok('update',{table:'returns',id:ret.id,record:{status:'completed'}})
 assert.equal((await ok('list',{table:'returns'})).find(x=>x.id===ret.id).status,'completed')
 console.log('PASS: authentication, products/images, variants, customers, atomic orders/rollback, shipping, payments, returns')
} finally {
 for(const [table,row] of [['returns',ret],['orders',order],['products',product],['customers',customer]])if(row)await ok('delete',{table,id:row.id})
 await ok('logout');assert.equal((await call('list',{table:'products'})).code,401)
}
