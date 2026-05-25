import React, { useState } from 'react'
import { useCustomers } from '../lib/data'

export default function Customers({ showToast }) {
  const { customers, loading, addCustomer, updateCustomer, deleteCustomer } = useCustomers()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', shop_name: '', line_nick: '', phone: '', address: '', customer_type: 'wholesale', credit_limit: '', note: '' })

  const filtered = customers.filter(c =>
    c.name.includes(search) || (c.shop_name || '').includes(search) ||
    (c.phone || '').includes(search) || (c.line_nick || '').toLowerCase().includes(search.toLowerCase())
  )

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', shop_name: '', line_nick: '', phone: '', address: '', customer_type: 'wholesale', credit_limit: '', note: '' })
    setShowModal(true)
  }
  const openEdit = (c) => { setEditing(c); setForm({ ...c, credit_limit: c.credit_limit || '' }); setShowModal(true) }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editing) { await updateCustomer(editing.id, form); showToast('客戶資料已更新') }
      else { await addCustomer(form); showToast('客戶已新增') }
      setShowModal(false)
    } catch(e) { showToast(e.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">客戶管理</h1>
          <div className="page-sub">CUSTOMERS · {customers.length} 位</div>
        </div>
        <div className="toolbar">
          <div className="search-bar" style={{ width: 240 }}>
            <span className="search-icon">⊘</span>
            <input placeholder="搜尋姓名、店名、電話…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openAdd}>＋ 新增客戶</button>
        </div>
      </div>

      <div className="page-body">
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>客戶</th><th>Line 暱稱</th><th>電話</th><th>類型</th><th>信用額度</th><th>備註</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon">◈</div><p>尚無客戶資料</p></div></td></tr>
                )}
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.name}</div>
                      {c.shop_name && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{c.shop_name}</div>}
                    </td>
                    <td style={{ color: 'var(--text2)' }}>
                      {c.line_nick
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                            {c.line_nick}
                          </span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="mono" style={{ color: 'var(--text2)' }}>{c.phone || '—'}</td>
                    <td>
                      <span className={`badge ${c.customer_type === 'wholesale' ? 'badge-gold' : 'badge-blue'}`}>
                        {c.customer_type === 'wholesale' ? '批發' : '零售'}
                      </span>
                    </td>
                    <td className="mono" style={{ color: +c.credit_limit > 0 ? 'var(--gold)' : 'var(--text3)' }}>
                      {+c.credit_limit > 0 ? `NT$ ${(+c.credit_limit).toLocaleString()}` : '—'}
                    </td>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{c.note || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>✎ 編輯</button>
                        <button className="btn btn-danger btn-sm" onClick={async () => {
                          if (confirm(`刪除客戶「${c.name}」？`)) { await deleteCustomer(c.id); showToast('已刪除') }
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

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? '編輯客戶' : '新增客戶'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">聯絡人姓名 *</label>
                  <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="王小明" />
                </div>
                <div className="form-group">
                  <label className="form-label">店家 / 公司名稱</label>
                  <input className="form-control" value={form.shop_name} onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))} placeholder="明日精品" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Line 暱稱</label>
                  <input className="form-control" value={form.line_nick} onChange={e => setForm(f => ({ ...f, line_nick: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">聯絡電話</label>
                  <input className="form-control" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912-345-678" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">收件地址</label>
                <input className="form-control" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="台南市中西區…" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">客戶類型</label>
                  <select className="form-control" value={form.customer_type} onChange={e => setForm(f => ({ ...f, customer_type: e.target.value }))}>
                    <option value="wholesale">批發商</option>
                    <option value="retail">零售客戶</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">信用額度（元）</label>
                  <input className="form-control" type="number" value={form.credit_limit} onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))} placeholder="50000" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">備註</label>
                <input className="form-control" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="例：每週三固定下單" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" disabled={saving || !form.name.trim()} onClick={handleSave}>
                {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (editing ? '確認更新' : '新增客戶')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
