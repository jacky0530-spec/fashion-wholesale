import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { request } from '../lib/api'
import { useCustomers, useProducts } from '../lib/data'
import { roundMoney, taxFor } from '../lib/accounting'

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const money = value => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const STATUS = {
  draft: ['草稿','badge'], confirmed: ['已確認','badge-gold'], deposit_paid: ['已收訂金','badge-green'],
  production: ['生產中','badge-amber'], arrived: ['已到貨','badge-blue'], converted: ['已轉銷貨','badge-gold'],
  completed: ['完成','badge-green'], cancelled: ['已取消','badge-red'],
}
const PAYMENT = { unpaid: '未收款', partial: '部分收款', paid: '已收清' }
const emptyItem = () => ({ key: crypto.randomUUID(), description: '', specification: '', qty: 1, unit_price: '' })

export default function CustomOrders({ showToast }) {
  const { customers } = useCustomers()
  const { products } = useProducts()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [paymentOpen, setPaymentOpen] = useState(null)
  const [convertOpen, setConvertOpen] = useState(null)
  const [form, setForm] = useState({ customer_id: '', order_date: today(), expected_delivery_date: '', custom_order_no: '', deposit_required: '', note: '' })
  const [items, setItems] = useState([emptyItem()])
  const [payment, setPayment] = useState({ payment_date: today(), payment_type: 'deposit', amount: '', note: '' })
  const [mappings, setMappings] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const r = await request('list', { table: 'custom_orders' })
    setLoading(false)
    if (!r.error) setOrders(r.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const variants = useMemo(() => products.flatMap(p => (p.variants || []).map(v => ({ ...v, product_name: p.name, product_code: p.product_code || '' }))), [products])
  const filtered = orders.filter(o => {
    const hay = `${o.custom_order_no} ${o.customer?.name || ''} ${o.customer?.shop_name || ''} ${(o.items || []).map(i => i.description + ' ' + (i.specification || '')).join(' ')}`.toLowerCase()
    const matches = hay.includes(search.toLowerCase())
    if (!matches) return false
    if (filter === 'active') return !['completed','cancelled'].includes(o.status)
    if (filter === 'unpaid') return o.payment_status !== 'paid' && o.status !== 'cancelled'
    return filter === 'all' || o.status === filter
  })

  const net = roundMoney(items.reduce((n, i) => n + Number(i.qty || 0) * Number(i.unit_price || 0), 0))
  const tax = taxFor(net)
  const total = roundMoney(net + tax)
  const createValid = form.customer_id && form.order_date && items.length > 0 && items.every(i => i.description.trim() && Number.isInteger(Number(i.qty)) && Number(i.qty) > 0 && i.unit_price !== '' && Number(i.unit_price) >= 0) && Number(form.deposit_required || 0) >= 0 && Number(form.deposit_required || 0) <= total

  const openCreate = () => {
    setForm({ customer_id: customers[0]?.id || '', order_date: today(), expected_delivery_date: '', custom_order_no: '', deposit_required: '', note: '' })
    setItems([emptyItem()]); setCreateOpen(true)
  }
  const updateItem = (key, field, value) => setItems(prev => prev.map(i => i.key === key ? { ...i, [field]: value } : i))
  const saveCreate = async () => {
    if (!createValid || busy) return
    setBusy(true)
    const id = crypto.randomUUID()
    const record = {
      ...form,
      deposit_required: Number(form.deposit_required || 0),
      items: items.map(i => ({ description: i.description.trim(), specification: i.specification.trim(), qty: Number(i.qty), unit_price: Number(i.unit_price) })),
    }
    const r = await request('createCustomOrder', { table: 'custom_orders', id, record })
    if (!r.error) { setCreateOpen(false); showToast('自訂訂購單已建立'); await load() }
    setBusy(false)
  }

  const changeStatus = async (order, status) => {
    if (busy) return
    const labels = { confirmed: '確認訂購單', production: '進入生產', arrived: '標記大貨已到貨', completed: '完成訂購單', cancelled: '取消訂購單' }
    if (status === 'cancelled' && !confirm(`確定取消 ${order.custom_order_no}？已收款紀錄仍會保留。`)) return
    setBusy(true)
    const r = await request('customOrderStatus', { table: 'custom_orders', id: order.id, status })
    if (!r.error) { showToast(`${labels[status] || '狀態更新'}完成`); setDetail(null); await load() }
    setBusy(false)
  }

  const openPayment = order => {
    const remaining = Math.max(0, Number(order.total_amount) - Number(order.paid_amount))
    const depositRemain = Math.max(0, Number(order.deposit_required) - Number(order.paid_amount))
    const type = depositRemain > 0 ? 'deposit' : 'balance'
    setPayment({ payment_date: today(), payment_type: type, amount: String(type === 'deposit' ? Math.min(depositRemain, remaining) : remaining), note: '' })
    setPaymentOpen(order)
  }
  const savePayment = async () => {
    const order = paymentOpen
    const amount = Number(payment.amount)
    const remaining = Number(order.total_amount) - Number(order.paid_amount)
    if (!order || busy || !payment.payment_date || !Number.isFinite(amount) || amount <= 0 || amount > remaining) return
    setBusy(true)
    const r = await request('customOrderPayment', { table: 'custom_orders', id: order.id, payment_id: crypto.randomUUID(), record: { ...payment, amount } })
    if (!r.error) { setPaymentOpen(null); setDetail(null); showToast(payment.payment_type === 'deposit' ? '訂金已登記' : '收款已登記'); await load() }
    setBusy(false)
  }

  const openConvert = order => {
    const initial = {}
    ;(order.items || []).forEach(i => { if (i.variant_id) initial[i.id] = i.variant_id })
    setMappings(initial); setConvertOpen(order)
  }
  const saveConvert = async () => {
    if (!convertOpen || busy) return
    const mapped = (convertOpen.items || []).map(i => ({ item_id: i.id, variant_id: mappings[i.id] })).filter(x => x.variant_id)
    if (mapped.length !== (convertOpen.items || []).length) { showToast('請為每個自訂品項選擇已入庫的商品規格', 'error'); return }
    setBusy(true)
    const r = await request('convertCustomOrder', { table: 'custom_orders', id: convertOpen.id, mappings: mapped })
    if (!r.error) { setConvertOpen(null); setDetail(null); showToast('已轉成銷貨單，訂金已帶入已收款金額'); await load() }
    setBusy(false)
  }

  const refreshDetail = order => {
    const next = orders.find(o => o.id === order.id)
    if (next) setDetail(next)
  }
  useEffect(() => { if (detail) refreshDetail(detail) }, [orders])

  const statusActions = order => <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {order.status === 'draft' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => changeStatus(order, 'confirmed')}>確認訂單</button>}
    {['confirmed','deposit_paid'].includes(order.status) && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => changeStatus(order, 'production')}>進入生產</button>}
    {order.status === 'production' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => changeStatus(order, 'arrived')}>大貨到貨</button>}
    {order.status === 'arrived' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => openConvert(order)}>轉銷貨單</button>}
    {order.status === 'converted' && order.payment_status === 'paid' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => changeStatus(order, 'completed')}>完成</button>}
    {!['completed','cancelled'].includes(order.status) && Number(order.paid_amount) < Number(order.total_amount) && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openPayment(order)}>{Number(order.paid_amount) < Number(order.deposit_required) ? '收訂金' : '登記收款'}</button>}
  </div>

  return <>
    <div className="page-header">
      <div><h1 className="page-title">自訂訂購單</h1><div className="page-sub">CUSTOM ORDERS · 訂金 → 生產 → 到貨 → 銷貨 → 尾款</div></div>
      <div className="toolbar">
        <input className="form-control" style={{ width: 220 }} placeholder="單號、客戶、品名…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-control" style={{ width: 135 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="active">進行中</option><option value="unpaid">尚有應收</option><option value="all">全部</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <button className="btn btn-primary" onClick={openCreate}>＋ 新增訂購單</button>
      </div>
    </div>
    <div className="page-body">
      <div className="card"><div className="table-wrap"><table><thead><tr><th>日期／單號</th><th>客戶</th><th>品項</th><th>含稅總額</th><th>已收</th><th>未收</th><th>進度</th><th>收款</th><th>操作</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 30 }}><span className="spinner" /></td></tr> : filtered.length === 0 ? <tr><td colSpan={9}><div className="empty-state">尚無符合的自訂訂購單</div></td></tr> : filtered.map(o => {
          const status = STATUS[o.status] || [o.status, 'badge']
          const remaining = Math.max(0, Number(o.total_amount) - Number(o.paid_amount))
          return <tr key={o.id}>
            <td><div>{String(o.order_date).slice(0,10)}</div><div className="mono text-muted" style={{ fontSize: 11 }}>{o.custom_order_no}</div></td>
            <td><div style={{ fontWeight: 600 }}>{o.customer?.shop_name || o.customer?.name}</div>{o.customer?.shop_name && <div className="text-muted" style={{ fontSize: 11 }}>{o.customer?.name}</div>}</td>
            <td>{(o.items || []).length} 項／{(o.items || []).reduce((n, i) => n + Number(i.qty), 0)} 件</td>
            <td className="mono" style={{ fontWeight: 700 }}>{money(o.total_amount)}</td>
            <td className="mono" style={{ color: 'var(--green)' }}>{money(o.paid_amount)}</td>
            <td className="mono" style={{ color: remaining > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{money(remaining)}</td>
            <td><span className={`badge ${status[1]}`}>{status[0]}</span></td>
            <td><span className={`badge ${o.payment_status === 'paid' ? 'badge-green' : o.payment_status === 'partial' ? 'badge-amber' : 'badge-red'}`}>{PAYMENT[o.payment_status]}</span></td>
            <td><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><button className="btn btn-ghost btn-sm" onClick={() => setDetail(o)}>查看</button>{statusActions(o)}</div></td>
          </tr>
        })}
      </tbody></table></div></div>
    </div>

    {createOpen && <div className="modal-overlay"><div className="modal" style={{ width: 'min(1050px,96vw)', maxWidth: 1050 }}><div className="modal-header"><span className="modal-title">新增自訂訂購單</span><button className="btn btn-ghost" disabled={busy} onClick={() => setCreateOpen(false)}>關閉</button></div><div className="modal-body">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <div className="form-group"><label className="form-label">客戶 *</label><select className="form-control" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}><option value="">選擇客戶</option>{customers.map(c => <option key={c.id} value={c.id}>{c.shop_name || c.name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">訂購日期 *</label><input className="form-control" type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">預計交貨日</label><input className="form-control" type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">訂購單號</label><input className="form-control" value={form.custom_order_no} onChange={e => setForm(f => ({ ...f, custom_order_no: e.target.value }))} placeholder="留空自動產生" /></div>
        <div className="form-group"><label className="form-label">預計訂金（含稅）</label><input className="form-control" type="number" min="0" step="0.01" value={form.deposit_required} onChange={e => setForm(f => ({ ...f, deposit_required: e.target.value }))} placeholder="例如 10000" /></div>
      </div>
      <div className="form-group"><label className="form-label">備註</label><input className="form-control" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="版型、交期或客戶特殊需求" /></div>
      <div className="table-wrap"><table><thead><tr><th>品名／款式 *</th><th>規格／設計說明</th><th>數量</th><th>未稅單價</th><th>未稅小計</th><th>操作</th></tr></thead><tbody>{items.map((i, index) => <tr key={i.key}><td><input className="form-control" value={i.description} onChange={e => updateItem(i.key, 'description', e.target.value)} placeholder="例：企業LOGO中筒襪" /></td><td><input className="form-control" value={i.specification} onChange={e => updateItem(i.key, 'specification', e.target.value)} placeholder="顏色、尺寸、包裝等" /></td><td><input className="form-control" style={{ width: 90 }} type="number" min="1" step="1" value={i.qty} onChange={e => updateItem(i.key, 'qty', e.target.value)} /></td><td><input className="form-control" style={{ width: 110 }} type="number" min="0" step="0.01" value={i.unit_price} onChange={e => updateItem(i.key, 'unit_price', e.target.value)} /></td><td>{money(Number(i.qty || 0) * Number(i.unit_price || 0))}</td><td><button className="btn btn-danger btn-sm" disabled={items.length === 1} onClick={() => setItems(prev => prev.filter(x => x.key !== i.key))}>移除</button></td></tr>)}</tbody></table></div>
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setItems(prev => [...prev, emptyItem()])}>＋ 增加品項</button>
      <div style={{ marginTop: 16, padding: 14, background: 'var(--bg3)', borderRadius: 8 }}><div>未稅：{money(net)} 元</div><div>稅額 5%：{money(tax)} 元</div><div style={{ fontWeight: 800, fontSize: 16 }}>含稅總額：{money(total)} 元</div><div className="text-muted" style={{ marginTop: 4 }}>訂金只記錄預計應收；客戶實際匯款後，再用「收訂金」登記付款日期與金額。</div></div>
    </div><div className="modal-footer"><button className="btn btn-ghost" disabled={busy} onClick={() => setCreateOpen(false)}>取消</button><button className="btn btn-primary" disabled={!createValid || busy} onClick={saveCreate}>{busy ? '儲存中…' : '建立訂購單'}</button></div></div></div>}

    {detail && <div className="modal-overlay"><div className="modal" style={{ width: 'min(960px,96vw)', maxWidth: 960 }}><div className="modal-header"><div><div className="modal-title">{detail.custom_order_no}</div><div className="text-muted" style={{ fontSize: 12 }}>{detail.customer?.shop_name || detail.customer?.name}</div></div><button className="btn btn-ghost" onClick={() => setDetail(null)}>關閉</button></div><div className="modal-body">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10, marginBottom: 16 }}>
        <div><div className="stat-label">狀態</div><span className={`badge ${(STATUS[detail.status] || [0,'badge'])[1]}`}>{(STATUS[detail.status] || [detail.status])[0]}</span></div>
        <div><div className="stat-label">含稅總額</div><strong>{money(detail.total_amount)}</strong></div><div><div className="stat-label">預計訂金</div><strong>{money(detail.deposit_required)}</strong></div><div><div className="stat-label">已收款</div><strong style={{ color: 'var(--green)' }}>{money(detail.paid_amount)}</strong></div><div><div className="stat-label">尚欠</div><strong style={{ color: Number(detail.total_amount) > Number(detail.paid_amount) ? 'var(--red)' : 'var(--green)' }}>{money(Number(detail.total_amount)-Number(detail.paid_amount))}</strong></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>品名</th><th>規格</th><th>數量</th><th>未稅單價</th><th>小計</th></tr></thead><tbody>{(detail.items || []).map(i => <tr key={i.id}><td>{i.description}</td><td>{i.specification || '—'}</td><td>{i.qty}</td><td>{money(i.unit_price)}</td><td>{money(Number(i.qty)*Number(i.unit_price))}</td></tr>)}</tbody></table></div>
      <h3 style={{ marginTop: 18, marginBottom: 8, fontSize: 14 }}>收款紀錄</h3><div className="table-wrap"><table><thead><tr><th>日期</th><th>類型</th><th>金額</th><th>備註</th></tr></thead><tbody>{(detail.payments || []).map(p => <tr key={p.id}><td>{String(p.payment_date).slice(0,10)}</td><td>{p.payment_type === 'deposit' ? '訂金' : p.payment_type === 'balance' ? '尾款' : '其他'}</td><td>{money(p.amount)}</td><td>{p.note || '—'}</td></tr>)}{!(detail.payments || []).length && <tr><td colSpan={4}>尚無收款紀錄</td></tr>}</tbody></table></div>
      {detail.sales_order_id && <p style={{ marginTop: 12 }}>已轉銷貨單：<span className="mono">{detail.sales_order_id.slice(0,8)}…</span></p>}
      {detail.note && <p style={{ marginTop: 12 }}>備註：{detail.note}</p>}
    </div><div className="modal-footer" style={{ justifyContent: 'space-between' }}><div>{!['completed','cancelled','converted'].includes(detail.status) && <button className="btn btn-danger" disabled={busy} onClick={() => changeStatus(detail,'cancelled')}>取消訂購單</button>}</div>{statusActions(detail)}</div></div></div>}

    {paymentOpen && <div className="modal-overlay"><div className="modal"><div className="modal-header"><span className="modal-title">登記收款 — {paymentOpen.custom_order_no}</span><button className="btn btn-ghost" onClick={() => setPaymentOpen(null)}>關閉</button></div><div className="modal-body">
      <p style={{ marginBottom: 12 }}>含稅總額 {money(paymentOpen.total_amount)} ／ 已收 {money(paymentOpen.paid_amount)} ／ 尚欠 <strong>{money(Number(paymentOpen.total_amount)-Number(paymentOpen.paid_amount))}</strong></p>
      <div className="form-group"><label className="form-label">付款日期 *</label><input className="form-control" type="date" value={payment.payment_date} onChange={e => setPayment(p => ({ ...p, payment_date: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">收款類型</label><select className="form-control" value={payment.payment_type} onChange={e => setPayment(p => ({ ...p, payment_type: e.target.value }))}><option value="deposit">訂金</option><option value="balance">尾款</option><option value="other">其他</option></select></div>
      <div className="form-group"><label className="form-label">實收金額 *</label><input className="form-control" type="number" min="0.01" step="0.01" value={payment.amount} onChange={e => setPayment(p => ({ ...p, amount: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">備註</label><input className="form-control" value={payment.note} onChange={e => setPayment(p => ({ ...p, note: e.target.value }))} placeholder="匯款末五碼等" /></div>
    </div><div className="modal-footer"><button className="btn btn-ghost" onClick={() => setPaymentOpen(null)}>取消</button><button className="btn btn-primary" disabled={busy || !payment.amount || Number(payment.amount)<=0 || Number(payment.amount)>Number(paymentOpen.total_amount)-Number(paymentOpen.paid_amount)} onClick={savePayment}>{busy ? '儲存中…' : '確認收款'}</button></div></div></div>}

    {convertOpen && <div className="modal-overlay"><div className="modal" style={{ width: 'min(920px,96vw)', maxWidth: 920 }}><div className="modal-header"><span className="modal-title">轉銷貨單 — {convertOpen.custom_order_no}</span><button className="btn btn-ghost" onClick={() => setConvertOpen(null)}>關閉</button></div><div className="modal-body">
      <div style={{ padding: 12, background: 'var(--gold-bg)', borderRadius: 8, marginBottom: 14 }}>請先用「進貨單」將大貨入<strong>總倉</strong>，再把每個自訂品項對應到已建立的商品規格。轉銷貨時會從總倉扣除數量，訂金會自動帶入銷貨單已收款。</div>
      <div className="table-wrap"><table><thead><tr><th>自訂品項</th><th>數量</th><th>對應商品規格 *</th></tr></thead><tbody>{(convertOpen.items || []).map(i => <tr key={i.id}><td><div style={{ fontWeight: 600 }}>{i.description}</div><div className="text-muted">{i.specification || '—'}</div></td><td>{i.qty}</td><td><select className="form-control" value={mappings[i.id] || ''} onChange={e => setMappings(m => ({ ...m, [i.id]: e.target.value }))}><option value="">選擇已入庫規格</option>{variants.map(v => <option key={v.id} value={v.id}>{v.product_code ? `${v.product_code} · ` : ''}{v.product_name} · {v.color}/{v.size}（總庫存 {v.stock_qty}）</option>)}</select></td></tr>)}</tbody></table></div>
    </div><div className="modal-footer"><button className="btn btn-ghost" onClick={() => setConvertOpen(null)}>取消</button><button className="btn btn-primary" disabled={busy || (convertOpen.items || []).some(i => !mappings[i.id])} onClick={saveConvert}>{busy ? '轉換中…' : '確認轉銷貨單'}</button></div></div></div>}
  </>
}
