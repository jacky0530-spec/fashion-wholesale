import React, { useState } from 'react'
import { useOrders, useProducts, useCustomers, COLOR_MAP } from '../lib/data'

import { dealerPrice, discountedPrice, collected, outstanding, modeLabel, roundMoney, taxFor, grossFor, taxModeLabel } from '../lib/accounting'
import ConsignmentModal from './ConsignmentModal'

const STATUS = { pending: { label: '待出貨', cls: 'badge-amber' }, shipped: { label: '已出貨', cls: 'badge-blue' }, returned: { label: '退貨', cls: 'badge-red' } }
const PAY    = { unpaid:  { label: '未收款', cls: 'badge-red'   }, paid:    { label: '已收款', cls: 'badge-green' } }

export default function Orders({ showToast }) {
  const { orders, loading, addOrder, deleteOrder, shipOrders, settleOrder, collectOrder } = useOrders()
  const { products, saveVariants } = useProducts()
  const { customers } = useCustomers()
  const [settlement, setSettlement] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPay, setFilterPay] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [showReceipt, setShowReceipt] = useState(null)
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)

  const [custId, setCustId] = useState('')
  const [custSearch, setCustSearch] = useState('')
  const [showCustDrop, setShowCustDrop] = useState(false)
  const [cartItems, setCartItems] = useState([])
  const [orderNote, setOrderNote] = useState('')
  const [prodSearch, setProdSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [showProdDrop, setShowProdDrop] = useState(false)

  const filtered = orders.filter(o => {
    const matchSearch = o.customer_name.includes(search) || (o.shop_name || '').includes(search)
    const matchStatus = filterStatus === 'all' || o.status === filterStatus
    const matchPay    = filterPay === 'all' || (filterPay === 'paid' ? o.payment_status === 'paid' : outstanding(o) > 0)
    return matchSearch && matchStatus && matchPay
  })

  const selectedCustomer = customers.find(c => c.id === custId)
  const selectedTaxMode = selectedCustomer?.tax_mode || 'exclusive'
  const cartNet = roundMoney(cartItems.reduce((s, i) => s + Number(i.qty || 0) * i.price, 0))
  const inclusiveGross = selectedCustomer ? roundMoney(cartItems.reduce((s, i) => s + Number(i.qty || 0) * discountedPrice(i.retail_price, selectedCustomer.discount), 0)) : 0
  const cartTax = selectedTaxMode === 'inclusive' ? roundMoney(inclusiveGross - cartNet) : taxFor(cartNet)
  const cartTotal = selectedTaxMode === 'inclusive' ? inclusiveGross : grossFor(cartNet)
  const hasInvalidQty = cartItems.some(i => !Number.isInteger(Number(i.qty)) || Number(i.qty) <= 0)

  const openAdd = () => {
    setCustId(''); setCustSearch(''); setCartItems([]); setOrderNote('')
    setSelectedProduct(null); setProdSearch('')
    setShowModal(true)
  }

  const addToCart = (product, variant) => {
    if (!selectedCustomer || selectedCustomer.discount == null) { showToast('請先選擇已設定折數的客戶', 'error'); return }
    const price = dealerPrice(product.retail_price, selectedCustomer.discount, selectedTaxMode)
    setCartItems(prev => {
      const idx = prev.findIndex(i => i.variant_id === variant.id)
      if (idx !== -1) {
        const u = [...prev]
        u[idx] = { ...u[idx], qty: Number(u[idx].qty || 0) + 1, available_stock: Number(variant.stock_qty || u[idx].available_stock || 0) }
        return u
      }
      return [...prev, {
        variant_id: variant.id,
        color: variant.color || '單一',
        size: variant.size || 'F',
        product_name: product.name,
        retail_price: +product.retail_price,
        qty: 1,
        price,
        available_stock: Number(variant.stock_qty || 0),
      }]
    })
  }

  const chooseProduct = async p => {
    setSelectedProduct(p)
    setProdSearch(p.name)
    setShowProdDrop(false)
    if (!selectedCustomer || selectedCustomer.discount == null) return

    const variants = p.variants || []
    if (variants.length === 0) {
      try {
        const created = await saveVariants(p.id, [{ color: '單一', size: 'F', stock_qty: 0 }])
        if (!created?.id) throw new Error('無法建立商品預設規格')
        const variant = { ...created, color: created.color || '單一', size: created.size || 'F', stock_qty: Number(created.stock_qty || 0) }
        setSelectedProduct({ ...p, variants: [variant] })
        addToCart(p, variant)
        showToast('此商品原本沒有規格，已自動建立 F（單一尺寸）並加入訂單')
      } catch (e) { showToast(e.message, 'error') }
      return
    }

    if (variants.length === 1) addToCart(p, variants[0])
  }

  const updateCartQty = (variantId, qty) => {
    const n = Math.floor(Number(qty))
    if (!Number.isFinite(n) || n <= 0) {
      setCartItems(prev => prev.filter(i => i.variant_id !== variantId))
      return
    }
    setCartItems(prev => prev.map(i => i.variant_id === variantId ? { ...i, qty: n } : i))
  }

  const handleSubmit = async () => {
    if (!custId || selectedCustomer?.discount == null || cartItems.length === 0) return
    if (hasInvalidQty) { showToast('商品數量必須是大於 0 的整數', 'error'); return }
    setSaving(true)
    try {
      await addOrder({ customer_id: custId, total_amount: cartTotal, note: orderNote, items: cartItems.map(i => ({ ...i, qty: Number(i.qty) })), discount: +selectedCustomer.discount, sale_mode: selectedCustomer.sale_mode, tax_mode: selectedTaxMode })
      showToast('訂單已建立')
      setShowModal(false)
    } catch(e) { showToast(e.message, 'error') }
    finally { setSaving(false) }
  }

  const chooseCustomer = c => {
    setCustId(c.id); setCustSearch(c.name + (c.shop_name ? ` (${c.shop_name})` : '')); setShowCustDrop(false)
    setCartItems(items => items.map(i => ({ ...i, price: c.discount == null ? 0 : dealerPrice(i.retail_price, c.discount, c.tax_mode || 'exclusive') })))
  }
  const receivePayment = async o => {
    if (actionBusy) return
    const paid = o.sale_mode === 'consignment' || o.payment_status !== 'paid'
    if (!confirm(paid ? `確認已收到 ${outstanding(o).toLocaleString()} 元？` : '取消此買斷單的收款標記？')) return
    setActionBusy(true)
    try { await collectOrder(o, paid); showToast(paid ? '收款已登記' : '已取消收款') }
    catch(e) { showToast(e.message, 'error') }
    finally { setActionBusy(false) }
  }
  const toggleSelect = id => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map(o => o.id))

  const handleBatchShip = async () => {
    const toShip = selected.filter(id => orders.find(o => o.id === id)?.status === 'pending')
    if (!toShip.length) { showToast('沒有待出貨的訂單', 'error'); return }
    try { await shipOrders(toShip); showToast(`${toShip.length} 筆訂單已出貨`); setSelected([]) } catch(e) { showToast(e.message, 'error') }
  }

  const filteredProds = products.filter(p => p.name.includes(prodSearch) || p.category.includes(prodSearch) || (p.product_code || '').includes(prodSearch))
  const filteredCusts = customers.filter(c => c.name.includes(custSearch) || (c.shop_name || '').includes(custSearch))

  const DropDown = ({ children, style }) => <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', maxHeight: 190, overflowY: 'auto', marginTop: 4, boxShadow: 'var(--shadow)', ...style }}>{children}</div>
  const DropItem = ({ onMouseDown, children }) => <button style={{ width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 13, borderBottom: '1px solid var(--border)', transition: 'var(--transition)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onMouseDown={onMouseDown}>{children}</button>

  return <>
    <div className="page-header"><div><h1 className="page-title">訂單管理</h1><div className="page-sub">ORDERS · {orders.length} 筆</div></div><div className="toolbar"><div className="search-bar" style={{ width: 190 }}><span className="search-icon">⊘</span><input placeholder="搜尋客戶…" value={search} onChange={e => setSearch(e.target.value)} /></div><select className="form-control" style={{ width: 110, padding: '8px 10px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">全部狀態</option><option value="pending">待出貨</option><option value="shipped">已出貨</option></select><select className="form-control" style={{ width: 110, padding: '8px 10px' }} value={filterPay} onChange={e => setFilterPay(e.target.value)}><option value="all">全部款項</option><option value="unpaid">未收款</option><option value="paid">已收款</option></select>{selected.length > 0 && <><button className="btn btn-ghost btn-sm" onClick={handleBatchShip}>▲ 批次出貨 ({selected.length})</button><button className="btn btn-ghost btn-sm" onClick={() => setShowReceipt(orders.filter(o => selected.includes(o.id)))}>◎ 出貨單</button></>}<button className="btn btn-primary" onClick={openAdd}>＋ 開立訂單</button></div></div>

    <div className="page-body"><div className="card"><div className="table-wrap"><table><thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleAll} style={{ cursor: 'pointer' }} /></th><th>客戶</th><th>日期</th><th>品項</th><th>貨值／應收</th><th>出貨</th><th>收款</th><th>備註</th><th style={{ textAlign: 'right' }}>操作</th></tr></thead><tbody>
      {loading && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></td></tr>}
      {!loading && filtered.length === 0 && <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">◎</div><p>無符合的訂單</p></div></td></tr>}
      {filtered.map(o => <tr key={o.id}>
        <td><input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSelect(o.id)} style={{ cursor: 'pointer' }} /></td>
        <td><div style={{ fontWeight: 500 }}>{o.customer_name}</div><div className="badge badge-gold">{modeLabel(o.sale_mode)}{o.discount != null ? ` · ${Number(o.discount)} 折 · ${taxModeLabel(o.tax_mode || 'exclusive')}` : ' · 舊單價格'}</div>{o.shop_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.shop_name}</div>}</td>
        <td className="mono" style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>{new Date(o.order_date).toLocaleDateString('zh-TW')}</td>
        <td style={{ maxWidth: 200 }}>{(o.items || []).map((it, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2, fontSize: 12 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR_MAP[it.color] || '#888', border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} /><span style={{ color: 'var(--text2)' }}>{it.product_name}</span><span className="size-chip" style={{ fontSize: 10, width: 22, height: 18 }}>{it.size}</span><span style={{ color: 'var(--text3)' }}>×{it.qty}{o.sale_mode === 'consignment' ? `（售 ${it.sold_qty}／退 ${it.returned_qty}／餘 ${it.qty-it.sold_qty-it.returned_qty}）` : ''}</span></div>)}</td>
        <td className="mono text-gold" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>含稅應收 {(+o.total_amount).toLocaleString()}<div style={{ fontSize: 11, color: 'var(--text2)' }}>含稅貨值 {Number(o.goods_amount ?? o.total_amount).toLocaleString()}<br />未稅 {Number(o.net_amount ?? o.total_amount).toLocaleString()}＋稅 {Number(o.tax_amount || 0).toLocaleString()}<br />已收 {collected(o).toLocaleString()}／待收 {outstanding(o).toLocaleString()}</div></td>
        <td><span className={`badge ${STATUS[o.status]?.cls}`}>{STATUS[o.status]?.label}</span></td>
        <td><button className="btn btn-ghost btn-sm" disabled={actionBusy || (o.sale_mode === 'consignment' && outstanding(o) <= 0)} onClick={() => receivePayment(o)}>{o.sale_mode === 'consignment' ? (outstanding(o) > 0 ? '登記收款' : +o.total_amount === 0 ? '尚無售出應收' : '已收款') : o.payment_status === 'paid' ? '已收款（取消）' : '登記收款'}</button></td>
        <td style={{ color: 'var(--text3)', fontSize: 12 }}>{o.note || '—'}</td>
        <td><div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}><button className="btn btn-ghost btn-sm" onClick={() => setShowReceipt([o])}>◎</button>{o.sale_mode === 'consignment' && o.status === 'shipped' && <button className="btn btn-primary btn-sm" onClick={() => setSettlement(o)}>售出／退回</button>}{o.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={async () => { try { await shipOrders([o.id]); showToast('已出貨') } catch(e) { showToast(e.message, 'error') } }}>出貨</button>}<button className="btn btn-danger btn-sm" onClick={async () => { if (confirm('刪除此訂單？')) { try { await deleteOrder(o.id); showToast('已刪除') } catch(e) { showToast(e.message, 'error') } } }}>✕</button></div></td>
      </tr>)}
    </tbody></table></div></div></div>

    {settlement && <ConsignmentModal order={settlement} onSave={settleOrder} onClose={() => setSettlement(null)} showToast={showToast} />}

    {showModal && <div className="modal-overlay" onClick={() => setShowModal(false)}><div className="modal modal-lg" onClick={e => e.stopPropagation()}><div className="modal-header"><span className="modal-title">開立新訂單</span><button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowModal(false)}>✕</button></div><div className="modal-body"><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div><div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>選擇客戶</div><div style={{ position: 'relative', marginBottom: 16 }}><input className="form-control" placeholder="搜尋客戶…" value={custSearch} onFocus={() => setShowCustDrop(true)} onBlur={() => setTimeout(() => setShowCustDrop(false), 150)} onChange={e => { setCustSearch(e.target.value); setCustId('') }} />{showCustDrop && filteredCusts.length > 0 && <DropDown>{filteredCusts.map(c => <DropItem key={c.id} onMouseDown={() => chooseCustomer(c)}>{c.name}{c.shop_name && <span style={{ color: 'var(--text3)', marginLeft: 6, fontSize: 11 }}>{c.shop_name}</span>}<span className={`badge ${c.customer_type === 'wholesale' ? 'badge-gold' : c.customer_type === 'website' ? 'badge-green' : 'badge-blue'}`} style={{ marginLeft: 8, fontSize: 10 }}>{modeLabel(c.sale_mode)} · {c.discount == null ? '未設定折數' : `${Number(c.discount)} 折`} · {taxModeLabel(c.tax_mode || 'exclusive')}</span></DropItem>)}</DropDown>}</div>
      {selectedCustomer && <p style={{ marginBottom: 16, color: selectedCustomer.discount == null ? 'var(--red)' : 'var(--text2)' }}>{selectedCustomer.discount == null ? '請先到客戶管理設定折數，才能開立銷貨單。' : selectedTaxMode === 'inclusive' ? `${modeLabel(selectedCustomer.sale_mode)} · ${Number(selectedCustomer.discount)} 折，折後金額已內含 5% 稅；系統會自動拆分未稅與稅額。` : `${modeLabel(selectedCustomer.sale_mode)} · 含稅零售價 × ${Number(selectedCustomer.discount)} ÷ 10 為未稅成交價，再外加 5% 稅。`}</p>}
      <div>選擇商品</div><div style={{ position: 'relative', marginBottom: 12 }}><input className="form-control" placeholder="搜尋款式…" value={prodSearch} onFocus={() => setShowProdDrop(true)} onBlur={() => setTimeout(() => setShowProdDrop(false), 150)} onChange={e => setProdSearch(e.target.value)} />{showProdDrop && filteredProds.length > 0 && <DropDown>{filteredProds.map(p => <DropItem key={p.id} onMouseDown={e => { e.preventDefault(); chooseProduct(p) }}>{p.name}<span style={{ color: 'var(--gold)', marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>{selectedCustomer?.discount != null ? `未稅 NT$ ${dealerPrice(p.retail_price, selectedCustomer.discount, selectedTaxMode)}` : `含稅零售價 ${p.retail_price}`}</span>{(p.variants || []).length <= 1 && <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 10 }}>點一下直接加入</span>}</DropItem>)}</DropDown>}</div>
      {selectedProduct && <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{selectedProduct.name}</div>{(() => { const colors=[...new Set((selectedProduct.variants||[]).map(v=>v.color))]; const sizes=[...new Set((selectedProduct.variants||[]).map(v=>v.size))]; if ((selectedProduct.variants || []).length === 1) { const v=selectedProduct.variants[0]; return <div style={{ fontSize:12,color:'var(--text2)',marginBottom:8 }}>已加入右側明細：{v.color || '單一'} · {v.size || 'F'}，可直接調整數量。<br /><span style={{ color:+v.stock_qty<=0?'var(--amber)':'var(--text3)' }}>目前庫存 {Number(v.stock_qty || 0)}；庫存不足仍可先開單，出貨時系統會再檢查。</span></div> } return colors.map(color => <div key={color} style={{ marginBottom: 10 }}><div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:6,fontSize:12,color:'var(--text2)' }}><span style={{ width:10,height:10,borderRadius:'50%',background:COLOR_MAP[color]||'#888',border:'1px solid rgba(0,0,0,0.1)' }} />{color}</div><div style={{ display:'flex',gap:5,flexWrap:'wrap' }}>{sizes.map(size => { const v=(selectedProduct.variants||[]).find(vv=>vv.color===color&&vv.size===size); if(!v)return null; return <button key={size} disabled={selectedCustomer?.discount==null} onClick={()=>addToCart(selectedProduct,v)} style={{ display:'flex',flexDirection:'column',alignItems:'center',padding:'4px 9px',borderRadius:4,cursor:selectedCustomer?.discount==null?'not-allowed':'pointer',border:'1px solid var(--border2)',background:'var(--bg2)',opacity:selectedCustomer?.discount==null?0.45:1,transition:'var(--transition)' }} onMouseEnter={e=>{if(selectedCustomer?.discount!=null)e.currentTarget.style.borderColor='var(--gold)'}} onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}><span style={{ fontSize:12,fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--text)' }}>{size}</span><span style={{ fontSize:10,color:+v.stock_qty<=5?'var(--amber)':'var(--text3)' }}>庫存 {v.stock_qty}</span></button>})}</div></div>) })()}<div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>含稅零售價 {selectedProduct.retail_price} 元 → 未稅成交單價 {selectedCustomer?.discount == null ? '—' : dealerPrice(selectedProduct.retail_price, selectedCustomer.discount, selectedTaxMode)} 元（{taxModeLabel(selectedTaxMode)}）</div></div>}
      </div>

      <div><div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>訂單明細</div>{cartItems.length === 0 ? <div style={{ padding:'40px 0',textAlign:'center',color:'var(--text3)',fontSize:13,border:'1px dashed var(--border2)',borderRadius:'var(--radius)' }}>選擇商品後會加入這裡；單一規格商品可直接調整數量</div> : <>{cartItems.map(item => <div key={item.variant_id} style={{ display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid var(--border)' }}><span style={{ width:8,height:8,borderRadius:'50%',background:COLOR_MAP[item.color]||'#888',border:'1px solid rgba(0,0,0,0.1)',flexShrink:0 }} /><div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:13,fontWeight:500 }}>{item.product_name}</div><div style={{ fontSize:11,color:'var(--text3)' }}>{item.color} · {item.size} · 未稅 NT$ {item.price}<br /><span style={{ color:Number(item.available_stock || 0) < Number(item.qty || 0) ? 'var(--amber)' : 'var(--text3)' }}>庫存 {Number(item.available_stock || 0)}；可先開單，出貨時檢查庫存</span></div></div><div style={{ display:'flex',alignItems:'center',gap:5 }}><button onClick={()=>updateCartQty(item.variant_id,Number(item.qty)-1)} style={{ width:28,height:28,borderRadius:4,border:'1px solid var(--border2)',background:'var(--bg3)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>−</button><input type="number" min="1" step="1" value={item.qty} onFocus={e=>e.currentTarget.select()} onChange={e=>{ const n=Math.floor(Number(e.target.value)); if(Number.isFinite(n)&&n>0) updateCartQty(item.variant_id,n) }} style={{ width:58,height:30,textAlign:'center',border:'1px solid var(--border2)',borderRadius:4,background:'var(--bg2)',color:'var(--text)',fontFamily:'var(--font-mono)',fontSize:14 }} /><button onClick={()=>updateCartQty(item.variant_id,Number(item.qty)+1)} style={{ width:28,height:28,borderRadius:4,border:'1px solid var(--border2)',background:'var(--bg3)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center' }}>＋</button></div><span style={{ fontFamily:'var(--font-mono)',fontSize:13,color:'var(--gold)',fontWeight:700,minWidth:54,textAlign:'right' }}>{(Number(item.qty)*item.price).toLocaleString()}</span><button onClick={()=>updateCartQty(item.variant_id,0)} style={{ background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:14 }}>✕</button></div>)}<div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:12 }}><span style={{ fontSize:12,color:'var(--text3)' }}>{cartItems.reduce((s,i)=>s+Number(i.qty || 0),0)} 件</span><span style={{ fontFamily:'var(--font-display)',fontSize:22,color:'var(--gold)' }}>未稅 {cartNet.toLocaleString()}<br /><small>稅額 5%：{cartTax.toLocaleString()}（{selectedTaxMode === 'inclusive' ? '已內含' : '外加'}）</small><br />含稅合計 {cartTotal.toLocaleString()}</span></div></>}
      <div className="form-group mt-3"><label className="form-label">訂單備註</label><input className="form-control" value={orderNote} onChange={e=>setOrderNote(e.target.value)} placeholder="急單、台南寄送…" /></div></div>
    </div></div><div className="modal-footer"><button className="btn btn-ghost" onClick={()=>setShowModal(false)}>取消</button><button className="btn btn-primary" disabled={!custId||selectedCustomer?.discount==null||cartItems.length===0||hasInvalidQty||saving} onClick={handleSubmit}>{saving ? <span className="spinner" style={{ width:14,height:14 }} /> : `建立${selectedCustomer?.sale_mode==='consignment'?'寄賣單（含稅貨值）':'銷貨單（含稅）'} NT$ ${cartTotal.toLocaleString()}`}</button></div></div></div>}

    {showReceipt && <div className="modal-overlay" onClick={()=>setShowReceipt(null)}><div className="modal modal-lg" onClick={e=>e.stopPropagation()}><div className="modal-header"><span className="modal-title">出貨單</span><div style={{ display:'flex',gap:8 }}><button className="btn btn-primary btn-sm" onClick={()=>window.print()}>列印</button><button className="btn btn-ghost btn-sm btn-icon" onClick={()=>setShowReceipt(null)}>✕</button></div></div><div className="modal-body"><div style={{ fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)',marginBottom:16 }}>列印日期：{new Date().toLocaleDateString('zh-TW')}</div>{showReceipt.map(o => <div key={o.id} style={{ marginBottom:24,paddingBottom:20,borderBottom:'1px solid var(--border)' }}><div style={{ display:'flex',justifyContent:'space-between',marginBottom:12 }}><div><div style={{ fontFamily:'var(--font-display)',fontSize:20 }}>{o.customer_name}</div><p>{modeLabel(o.sale_mode)} · {o.discount == null ? '舊單價格' : `${Number(o.discount)} 折 · ${taxModeLabel(o.tax_mode || 'exclusive')}`}</p>{o.shop_name && <div style={{ fontSize:12,color:'var(--text3)' }}>{o.shop_name}</div>}</div><div style={{ textAlign:'right',fontSize:12,color:'var(--text3)',fontFamily:'var(--font-mono)' }}>{new Date(o.order_date).toLocaleDateString('zh-TW')}</div></div><table style={{ width:'100%',borderCollapse:'collapse' }}><thead><tr style={{ borderBottom:'1px solid var(--border)' }}>{['品項','顏色','尺碼','數量',Number(o.tax_rate)>0?'未稅單價':'舊單單價','小計'].map(h=><th key={h} style={{ textAlign:h==='小計'?'right':'left',padding:'6px 4px',color:'var(--text3)',fontSize:11,fontFamily:'var(--font-mono)',fontWeight:400 }}>{h}</th>)}</tr></thead><tbody>{(o.items||[]).map((it,i)=><tr key={i} style={{ borderBottom:'1px dashed var(--border)' }}><td style={{ padding:'8px 4px',fontSize:13 }}>{it.product_name}</td><td style={{ padding:'8px 4px' }}><span style={{ display:'inline-flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text2)' }}><span style={{ width:8,height:8,borderRadius:'50%',background:COLOR_MAP[it.color]||'#888' }} />{it.color}</span></td><td style={{ padding:'8px 4px' }}><span className="size-chip">{it.size}</span></td><td style={{ padding:'8px 4px',fontFamily:'var(--font-mono)',fontSize:13 }}>×{it.qty}</td><td style={{ padding:'8px 4px',fontFamily:'var(--font-mono)',fontSize:13,color:'var(--text2)' }}>{(+it.unit_price).toLocaleString()}</td><td style={{ padding:'8px 4px',fontFamily:'var(--font-mono)',fontSize:13,color:'var(--gold)',fontWeight:700,textAlign:'right' }}>{(it.qty*+it.unit_price).toLocaleString()}</td></tr>)}</tbody></table><div style={{ display:'flex',justifyContent:'flex-end',marginTop:12,gap:16,alignItems:'center' }}>{o.note && <span style={{ fontSize:12,color:'var(--text3)' }}>備註：{o.note}</span>}<span style={{ fontFamily:'var(--font-display)',fontSize:22,color:'var(--gold)' }}>含稅貨值 {Number(o.goods_amount ?? o.total_amount).toLocaleString()} 元<br />銷售未稅 {Number(o.net_amount ?? o.total_amount).toLocaleString()} 元<br />稅額（{Number(o.tax_rate || 0)}% · {taxModeLabel(o.tax_mode || 'exclusive')}）{Number(o.tax_amount || 0).toLocaleString()} 元<br />{o.sale_mode === 'consignment' ? '已售含稅應收' : '含稅應收'} {(+o.total_amount).toLocaleString()} 元<br />已收 {collected(o).toLocaleString()}／待收 {outstanding(o).toLocaleString()}</span></div></div>)}</div></div></div>}
  </>
}