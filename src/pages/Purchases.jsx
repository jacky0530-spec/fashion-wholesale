import React, { useCallback, useEffect, useState } from 'react'
import { useProducts } from '../lib/data'
import { request } from '../lib/api'
import { roundMoney, taxFor } from '../lib/accounting'

const money = value => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const newForm = () => ({ purchase_date: today(), supplier: '', warehouse: '', purchase_no: '' })

export default function Purchases({ showToast }) {
  const { products, load: reloadProducts } = useProducts()
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(newForm)
  const [rows, setRows] = useState([])
  const [requestId, setRequestId] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(null)
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    const r = await request('list', { table: 'purchases' })
    setLoading(false); setLoadError(r.error?.message || '')
    if (!r.error) setPurchases(r.data || [])
  }, [])
  useEffect(() => { load() }, [load])
  const selectedProduct = products.find(p => p.id === productId)
  const filteredProducts = products.filter(p => `${p.name} ${p.product_code || ''}`.toLowerCase().includes(productSearch.toLowerCase()))
  const filtered = purchases.filter(p => (showVoided || p.status !== 'void') && `${p.purchase_no} ${p.supplier} ${p.warehouse} ${p.items.map(i => i.product_name + ' ' + (i.product_code || '')).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const net = roundMoney(rows.reduce((n, r) => n + Number(r.qty || 0) * Number(r.unit_price || 0), 0))
  const tax = roundMoney(rows.reduce((n, r) => n + Number(r.tax_amount || 0), 0))
  const valid = rows.length > 0 && form.purchase_date && form.supplier.trim() && form.warehouse.trim() && rows.every(r => Number.isInteger(Number(r.qty)) && Number(r.qty) > 0 && r.unit_price !== '' && Number.isFinite(Number(r.unit_price)) && Number(r.unit_price) >= 0 && r.tax_amount !== '' && Number.isFinite(Number(r.tax_amount)) && Number(r.tax_amount) >= 0)
  const openNew = () => {
    setForm(newForm()); setRows([]); setRequestId(crypto.randomUUID()); setProductId(''); setVariantId(''); setProductSearch(''); setOpen(true)
  }
  const addRow = () => {
    const v = selectedProduct?.variants?.find(v => v.id === variantId)
    if (!v) return
    if (rows.some(r => r.variant_id === v.id)) { showToast('此規格已加入，請直接修改數量', 'error'); return }
    const price = Number(selectedProduct.cost_price || 0)
    setRows(prev => [...prev, { variant_id: v.id, product_name: selectedProduct.name, product_code: selectedProduct.product_code || '', color: v.color, size: v.size, qty: 1, unit_price: price, tax_amount: taxFor(price), manualTax: false }])
  }
  const change = (id, field, value) => setRows(prev => prev.map(r => {
    if (r.variant_id !== id) return r
    const next = { ...r, [field]: value }
    if (field === 'tax_amount') next.manualTax = true
    else if (!next.manualTax) next.tax_amount = taxFor(Number(next.qty || 0) * Number(next.unit_price || 0))
    return next
  }))
  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    const record = { ...form, supplier: form.supplier.trim(), warehouse: form.warehouse.trim(), purchase_no: form.purchase_no.trim(), items: rows.map(r => ({ variant_id: r.variant_id, qty: Number(r.qty), unit_price: Number(r.unit_price), tax_amount: Number(r.tax_amount) })) }
    const r = await request('postPurchase', { table: 'purchases', id: requestId, record })
    if (!r.error) { setOpen(false); showToast('進貨單已儲存，庫存已增加'); await Promise.all([load(), reloadProducts()]) }
    setBusy(false)
  }
  const voidDocument = async p => {
    if (busy || !confirm(`作廢進貨單 ${p.purchase_no}？將扣回本單進貨數量，紀錄仍會保留。`)) return
    setBusy(true)
    const r = await request('voidPurchase', { table: 'purchases', id: p.id })
    if (!r.error) { showToast('進貨單已作廢，庫存已沖回'); setDetail(null); await Promise.all([load(), reloadProducts()]) }
    setBusy(false)
  }
  return <>
    <div className="page-header"><div><h1 className="page-title">進貨單</h1><div className="page-sub">PURCHASES · {filtered.length} 筆</div></div><div className="toolbar"><input className="form-control" style={{ width: 220 }} aria-label="搜尋進貨單" placeholder="單號、供應商、倉庫、品名…" value={search} onChange={e => setSearch(e.target.value)} /><label><input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} /> 顯示已作廢</label><button className="btn btn-primary" onClick={openNew} disabled={busy}>＋ 新增進貨單</button></div></div>
    <div className="page-body"><p style={{ marginBottom: 16, color: 'var(--text2)' }}>進貨過帳後增加商品總庫存。倉庫欄位記錄本次收貨地點；目前庫存管理以所有倉庫合計顯示。</p>{loadError && <p role="alert">{loadError}<button className="btn btn-ghost" onClick={load}>重試</button></p>}<div className="card table-wrap"><table><thead><tr>{['日期','進貨單號','供應商','倉庫','數量','未稅金額','稅額','含稅總額','狀態','操作'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={10}>載入中…</td></tr> : filtered.length === 0 ? <tr><td colSpan={10}><div className="empty-state">尚無符合的進貨單</div></td></tr> : filtered.map(p => <tr key={p.id}><td>{p.purchase_date.slice(0, 10)}</td><td>{p.purchase_no}</td><td>{p.supplier}</td><td>{p.warehouse}</td><td>{p.items.reduce((n, i) => n + Number(i.qty), 0)}</td><td>{money(p.net_amount)}</td><td>{money(p.tax_amount)}</td><td>{money(p.total_amount)}</td><td><span className={`badge ${p.status === 'void' ? 'badge-red' : 'badge-green'}`}>{p.status === 'void' ? '已作廢' : '已入庫'}</span></td><td><button className="btn btn-ghost btn-sm" onClick={() => setDetail(p)}>查看</button>{p.status !== 'void' && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => voidDocument(p)}>作廢</button>}</td></tr>)}</tbody></table></div></div>
    {open && <div className="modal-overlay"><div className="modal" style={{ width: 'min(1080px,96vw)', maxWidth: 1080 }}><div className="modal-header"><span className="modal-title">新增進貨單</span><button className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>關閉</button></div><div className="modal-body">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        <div className="form-group"><label className="form-label" htmlFor="purchase-date">日期 *</label><input id="purchase-date" className="form-control" type="date" value={form.purchase_date} disabled={busy} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label" htmlFor="purchase-supplier">供應商 *</label><input id="purchase-supplier" className="form-control" list="purchase-suppliers" value={form.supplier} disabled={busy} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="輸入供應商名稱" /><datalist id="purchase-suppliers">{[...new Set(purchases.map(p => p.supplier))].map(x => <option key={x} value={x} />)}</datalist></div>
        <div className="form-group"><label className="form-label" htmlFor="purchase-warehouse">倉庫 *</label><input id="purchase-warehouse" className="form-control" list="purchase-warehouses" value={form.warehouse} disabled={busy} onChange={e => setForm(f => ({ ...f, warehouse: e.target.value }))} placeholder="例如：主倉庫" /><datalist id="purchase-warehouses">{[...new Set(purchases.map(p => p.warehouse))].map(x => <option key={x} value={x} />)}</datalist></div>
        <div className="form-group"><label className="form-label" htmlFor="purchase-no">進貨單編號</label><input id="purchase-no" className="form-control" value={form.purchase_no} disabled={busy} onChange={e => setForm(f => ({ ...f, purchase_no: e.target.value }))} placeholder="留空自動產生 PO 單號" /></div>
      </div>
      <fieldset disabled={busy} style={{ border: 0 }}><div className="toolbar" style={{ margin: '12px 0', flexWrap: 'wrap' }}><input className="form-control" style={{ width: 170 }} aria-label="搜尋商品" placeholder="搜尋貨號或品名" value={productSearch} onChange={e => { setProductSearch(e.target.value); setProductId(''); setVariantId('') }} /><select className="form-control" style={{ width: 230 }} aria-label="品名" value={productId} onChange={e => { setProductId(e.target.value); setVariantId('') }}><option value="">選擇品名</option>{filteredProducts.map(p => <option key={p.id} value={p.id}>{p.product_code ? `${p.product_code} · ` : ''}{p.name}</option>)}</select><select className="form-control" style={{ width: 180 }} aria-label="規格" value={variantId} onChange={e => setVariantId(e.target.value)}><option value="">選擇規格</option>{(selectedProduct?.variants || []).map(v => <option key={v.id} value={v.id}>{v.color}／{v.size}</option>)}</select><button className="btn btn-ghost" disabled={!variantId} onClick={addRow}>加入明細</button></div>
      {selectedProduct && !selectedProduct.variants?.length && <p>此商品尚無規格，請先到「款式管理」新增色碼規格。</p>}
      <div className="table-wrap"><table><thead><tr>{['編號／貨號','品名','規格','數量','未稅單價','未稅小計','稅額','操作'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r, index) => <tr key={r.variant_id}><td>{r.product_code || `第 ${index + 1} 項`}</td><td>{r.product_name}</td><td>{r.color}／{r.size}</td><td><input aria-label={`第${index + 1}項數量`} className="form-control" style={{ width: 90 }} type="number" min="1" step="1" value={r.qty} onChange={e => change(r.variant_id, 'qty', e.target.value)} /></td><td><input aria-label={`第${index + 1}項單價`} className="form-control" style={{ width: 110 }} type="number" min="0" step="0.01" value={r.unit_price} onChange={e => change(r.variant_id, 'unit_price', e.target.value)} /></td><td>{money(Number(r.qty) * Number(r.unit_price))}</td><td><input aria-label={`第${index + 1}項稅額`} className="form-control" style={{ width: 100 }} type="number" min="0" step="0.01" value={r.tax_amount} onChange={e => change(r.variant_id, 'tax_amount', e.target.value)} /><button className="btn btn-ghost btn-sm" onClick={() => setRows(prev => prev.map(i => i.variant_id === r.variant_id ? { ...i, manualTax: false, tax_amount: taxFor(Number(i.qty) * Number(i.unit_price)) } : i))}>重算 5%</button></td><td><button className="btn btn-danger btn-sm" onClick={() => setRows(prev => prev.filter(i => i.variant_id !== r.variant_id))}>移除</button></td></tr>)}</tbody></table></div></fieldset>
      <p style={{ marginTop: 16 }}>單價為未稅進價；稅額預設按每列小計的 5% 計算，可依供應商單據直接修改，免稅填 0。</p><p style={{ marginTop: 12, fontWeight: 600 }}>未稅合計 {money(net)} ＋ 稅額 {money(tax)} ＝ 含稅合計 {money(roundMoney(net + tax))} 元</p>
      </div><div className="modal-footer"><button className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>取消</button><button className="btn btn-primary" disabled={!valid || busy} onClick={save}>{busy ? '儲存中…' : '儲存並入庫'}</button></div></div></div>}
    {detail && <div className="modal-overlay"><div className="modal modal-lg"><div className="modal-header"><span className="modal-title">進貨單 {detail.purchase_no}</span><button className="btn btn-ghost" onClick={() => setDetail(null)}>關閉</button></div><div className="modal-body"><p>日期：{detail.purchase_date.slice(0, 10)}　供應商：{detail.supplier}　倉庫：{detail.warehouse}　{detail.status === 'void' ? '已作廢' : '已入庫'}</p><div className="table-wrap"><table><thead><tr>{['編號／貨號','品名','規格','數量','未稅單價','稅額'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{detail.items.map((i, n) => <tr key={i.id}><td>{i.product_code || n + 1}</td><td>{i.product_name}</td><td>{i.color}／{i.size}</td><td>{i.qty}</td><td>{money(i.unit_price)}</td><td>{money(i.tax_amount)}</td></tr>)}</tbody></table></div><p style={{ marginTop: 16 }}>未稅合計 {money(detail.net_amount)} ＋ 稅額 {money(detail.tax_amount)} ＝ 含稅合計 {money(detail.total_amount)} 元</p><small>已入庫單據如需修改，請先作廢再重新開立，以保留庫存異動依據。</small></div></div></div>}
  </>
}
