import React, { useState } from 'react'
import { useReturns, useOrders, useCustomers, useProducts, COLOR_MAP } from '../lib/data'
import { exportReturns } from '../lib/excel'

const STATUS = {
  pending:   { label: '待處理', cls: 'badge-amber' },
  approved:  { label: '已核准', cls: 'badge-blue' },
  completed: { label: '已完成', cls: 'badge-green' },
  rejected:  { label: '已拒絕', cls: 'badge-red' },
}
const TYPE = {
  return:   { label: '退貨', cls: 'badge-red' },
  exchange: { label: '換貨', cls: 'badge-blue' },
}
const REASONS = ['尺碼不符','顏色有誤','商品瑕疵','與描述不符','客戶改變心意','其他']

export default function Returns({ showToast }) {
  const { returns, loading, addReturn, updateReturnStatus, deleteReturn } = useReturns()
  const { orders } = useOrders()
  const { customers } = useCustomers()
  const { products } = useProducts()

  const [showModal, setShowModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(null) // { return object }
  const [saving, setSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')

  // Form state
  const [custId, setCustId] = useState('')
  const [custSearch, setCustSearch] = useState('')
  const [showCustDrop, setShowCustDrop] = useState(false)
  const [form, setForm] = useState({
    order_id: '', product_name: '', color: '', size: '',
    qty: 1, return_type: 'return', reason: '', refund_amount: '', note: ''
  })
  const [statusNote, setStatusNote] = useState('')

  const filtered = returns.filter(r => {
    const matchStatus = filterStatus === 'all' || r.status === filterStatus
    const matchType   = filterType   === 'all' || r.return_type === filterType
    const matchSearch = r.customer_name?.includes(search) || r.product_name?.includes(search) || (r.shop_name || '').includes(search)
    return matchStatus && matchType && matchSearch
  })

  const filteredCusts = customers.filter(c =>
    c.name.includes(custSearch) || (c.shop_name || '').includes(custSearch)
  )

  // 選擇客戶後自動帶入最近訂單
  const handleSelectCust = (c) => {
    setCustId(c.id)
    setCustSearch(c.name + (c.shop_name ? ` (${c.shop_name})` : ''))
    setShowCustDrop(false)
  }

  const custOrders = orders.filter(o => o.customer_id === custId).slice(0, 10)

  // 選擇訂單後自動帶入第一個品項
  const handleSelectOrder = (orderId) => {
    setForm(f => ({ ...f, order_id: orderId }))
    const order = orders.find(o => o.id === orderId)
    if (order?.items?.[0]) {
      const item = order.items[0]
      setForm(f => ({
        ...f, order_id: orderId,
        product_name: item.product_name || '',
        color: item.color || '', size: item.size || '',
        refund_amount: item.unit_price || ''
      }))
    }
  }

  const openAdd = () => {
    setCustId(''); setCustSearch('')
    setForm({ order_id: '', product_name: '', color: '', size: '', qty: 1, return_type: 'return', reason: '', refund_amount: '', note: '' })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!custId || !form.product_name || !form.reason) {
      showToast('請填寫客戶、品項和原因', 'error'); return
    }
    setSaving(true)
    try {
      await addReturn({ ...form, customer_id: custId })
      showToast('退換貨申請已建立')
      setShowModal(false)
    } catch(e) { showToast(e.message, 'error') }
    finally { setSaving(false) }
  }

  const handleUpdateStatus = async (status) => {
    setSaving(true)
    try {
      await updateReturnStatus(showStatusModal.id, status, statusNote)
      showToast(STATUS[status]?.label + ' 狀態已更新')
      setShowStatusModal(null)
    } catch(e) { showToast(e.message, 'error') }
    finally { setSaving(false) }
  }

  // Stats
  const pendingCount   = returns.filter(r => r.status === 'pending').length
  const totalRefund    = returns.filter(r => r.status === 'completed').reduce((s, r) => s + +r.refund_amount, 0)
  const returnCount    = returns.filter(r => r.return_type === 'return').length
  const exchangeCount  = returns.filter(r => r.return_type === 'exchange').length

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">退換貨管理</h1>
          <div className="page-sub">RETURNS · {returns.length} 筆</div>
        </div>
        <div className="toolbar">
          <div className="search-bar" style={{ width: 200 }}>
            <span className="search-icon">⊘</span>
            <input placeholder="搜尋客戶或品項…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-control" style={{ width: 110, padding: '8px 10px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">全部狀態</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="form-control" style={{ width: 100, padding: '8px 10px' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">退貨 / 換貨</option>
            <option value="return">退貨</option>
            <option value="exchange">換貨</option>
          </select>
          <button className="btn btn-ghost" onClick={() => exportReturns(returns)}>↓ 匯出</button>
          <button className="btn btn-primary" onClick={openAdd}>＋ 新增申請</button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
          <div className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--amber)' }} />
            <div className="stat-label">待處理</div>
            <div className="stat-value" style={{ fontSize: 22, color: pendingCount > 0 ? 'var(--amber)' : 'var(--text)' }}>{pendingCount}<span className="stat-unit">筆</span></div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">退貨</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{returnCount}<span className="stat-unit">筆</span></div>
          </div>
          <div className="stat-card blue">
            <div className="stat-label">換貨</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{exchangeCount}<span className="stat-unit">筆</span></div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">已退款總額</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{totalRefund.toLocaleString()}<span className="stat-unit">元</span></div>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>申請日期</th><th>客戶</th><th>類型</th><th>品項</th>
                  <th>原因</th><th>退款金額</th><th>狀態</th><th>備註</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">↩</div><p>尚無退換貨紀錄</p></div></td></tr>
                )}
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td className="mono" style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {new Date(r.created_at).toLocaleDateString('zh-TW')}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.customer_name}</div>
                      {r.shop_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.shop_name}</div>}
                    </td>
                    <td><span className={`badge ${TYPE[r.return_type]?.cls}`}>{TYPE[r.return_type]?.label}</span></td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{r.product_name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                        {r.color && <>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR_MAP[r.color] || '#888', border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{r.color}</span>
                        </>}
                        {r.size && <span className="size-chip" style={{ fontSize: 10, width: 22, height: 18 }}>{r.size}</span>}
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>×{r.qty}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text2)', fontSize: 12, maxWidth: 140 }}>{r.reason || '—'}</td>
                    <td className="mono" style={{ color: +r.refund_amount > 0 ? 'var(--red)' : 'var(--text3)', fontWeight: +r.refund_amount > 0 ? 700 : 400 }}>
                      {+r.refund_amount > 0 ? `NT$ ${(+r.refund_amount).toLocaleString()}` : '—'}
                    </td>
                    <td>
                      <button
                        onClick={() => { setShowStatusModal(r); setStatusNote(r.note || '') }}
                        className={`badge ${STATUS[r.status]?.cls}`}
                        style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
                        title="點擊更新狀態"
                      >{STATUS[r.status]?.label}</button>
                    </td>
                    <td style={{ color: 'var(--text3)', fontSize: 12, maxWidth: 120 }}>{r.note || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                        <button className="btn btn-danger btn-sm" onClick={async () => {
                          if (confirm('刪除此退換貨紀錄？')) { await deleteReturn(r.id); showToast('已刪除') }
                        }}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Return Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">新增退換貨申請</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  {/* 客戶選擇 */}
                  <div className="form-group">
                    <label className="form-label">客戶 *</label>
                    <div style={{ position: 'relative' }}>
                      <input className="form-control" placeholder="搜尋客戶…"
                        value={custSearch}
                        onFocus={() => setShowCustDrop(true)}
                        onBlur={() => setTimeout(() => setShowCustDrop(false), 150)}
                        onChange={e => { setCustSearch(e.target.value); setCustId('') }}
                      />
                      {showCustDrop && filteredCusts.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', maxHeight: 180, overflowY: 'auto', marginTop: 4, boxShadow: 'var(--shadow)' }}>
                          {filteredCusts.map(c => (
                            <button key={c.id}
                              style={{ width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 13, borderBottom: '1px solid var(--border)', transition: 'var(--transition)' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}
                              onMouseDown={() => handleSelectCust(c)}
                            >
                              {c.name}
                              {c.shop_name && <span style={{ color: 'var(--text3)', marginLeft: 6, fontSize: 11 }}>{c.shop_name}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 關聯訂單 */}
                  {custId && custOrders.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">關聯訂單（選填）</label>
                      <select className="form-control" value={form.order_id} onChange={e => handleSelectOrder(e.target.value)}>
                        <option value="">不關聯特定訂單</option>
                        {custOrders.map(o => (
                          <option key={o.id} value={o.id}>
                            {new Date(o.order_date).toLocaleDateString('zh-TW')} · NT$ {(+o.total_amount).toLocaleString()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 類型 */}
                  <div className="form-group">
                    <label className="form-label">類型 *</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[['return', '退貨'], ['exchange', '換貨']].map(([val, lbl]) => (
                        <button key={val} onClick={() => setForm(f => ({ ...f, return_type: val }))}
                          style={{
                            flex: 1, padding: '9px', border: `1px solid ${form.return_type === val ? 'var(--gold)' : 'var(--border2)'}`,
                            borderRadius: 'var(--radius)', background: form.return_type === val ? 'var(--gold-bg)' : 'var(--bg2)',
                            color: form.return_type === val ? 'var(--gold)' : 'var(--text2)',
                            cursor: 'pointer', fontSize: 13, transition: 'var(--transition)',
                          }}>{lbl}</button>
                      ))}
                    </div>
                  </div>

                  {/* 原因 */}
                  <div className="form-group">
                    <label className="form-label">退換貨原因 *</label>
                    <select className="form-control" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
                      <option value="">請選擇原因</option>
                      {REASONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  {/* 品項 */}
                  <div className="form-group">
                    <label className="form-label">款式名稱 *</label>
                    <input className="form-control" value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} placeholder="例：韓版寬版西裝外套" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">顏色</label>
                      <select className="form-control" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}>
                        <option value="">不指定</option>
                        {Object.keys(COLOR_MAP).map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">尺碼</label>
                      <input className="form-control" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="M" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">數量</label>
                      <input className="form-control" type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">退款金額</label>
                      <input className="form-control" type="number" value={form.refund_amount} onChange={e => setForm(f => ({ ...f, refund_amount: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">備註</label>
                    <input className="form-control" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="補充說明…" />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" disabled={saving || !custId || !form.product_name || !form.reason} onClick={handleSubmit}>
                {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '建立申請'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Update Modal */}
      {showStatusModal && (
        <div className="modal-overlay" onClick={() => setShowStatusModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">更新處理狀態</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowStatusModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Summary */}
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{showStatusModal.customer_name} · {showStatusModal.product_name}</div>
                <div style={{ color: 'var(--text2)' }}>{TYPE[showStatusModal.return_type]?.label} · {showStatusModal.color} {showStatusModal.size} × {showStatusModal.qty}</div>
                <div style={{ color: 'var(--text3)', marginTop: 4 }}>原因：{showStatusModal.reason}</div>
              </div>
              <div className="form-group">
                <label className="form-label">處理備註</label>
                <input className="form-control" value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="補充說明…" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                {[
                  ['approved',  '核准申請', 'btn-ghost'],
                  ['completed', '完成退款', 'btn-primary'],
                  ['rejected',  '拒絕申請', 'btn-danger'],
                ].map(([status, label, cls]) => (
                  <button key={status} className={`btn ${cls}`} disabled={saving || showStatusModal.status === status} onClick={() => handleUpdateStatus(status)}>
                    {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, textAlign: 'center' }}>
                目前狀態：<span className={`badge ${STATUS[showStatusModal.status]?.cls}`}>{STATUS[showStatusModal.status]?.label}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
