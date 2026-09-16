import React, { useState } from 'react'
import { collected, roundMoney, taxFor, grossFor } from '../lib/accounting'
export default function ConsignmentModal({ order, onSave, onClose, showToast }) {
  const [items, setItems] = useState(order.items.map(i => ({ ...i, sold_qty: Number(i.sold_qty || 0), returned_qty: Number(i.returned_qty || 0) })))
  const [busy, setBusy] = useState(false)
  const valid = items.every(i => Number.isInteger(i.sold_qty) && Number.isInteger(i.returned_qty) && i.sold_qty >= Number(order.items.find(x => x.id === i.id).sold_qty) && i.returned_qty >= Number(order.items.find(x => x.id === i.id).returned_qty) && i.sold_qty + i.returned_qty <= i.qty)
  const net = roundMoney(items.reduce((n, i) => n + Number(i.sold_qty || 0) * Number(i.unit_price), 0))
  const tax = taxFor(net, order.tax_rate || 0)
  const due = grossFor(net, order.tax_rate || 0)
  const change = (id, field, value) => setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value === '' ? '' : Number(value) } : i))
  const save = async () => {
    if (busy || !valid) return
    setBusy(true)
    try { await onSave(order, items.map(({ id, sold_qty, returned_qty }) => ({ id, sold_qty, returned_qty }))); showToast('寄賣售出與應收款已更新'); onClose() }
    catch (e) { showToast(e.message, 'error') }
    finally { setBusy(false) }
  }
  return <div className="modal-overlay"><div className="modal modal-lg"><div className="modal-header"><span className="modal-title">寄賣售出／退回登記 · {order.customer_name}</span><button className="btn btn-ghost" disabled={busy} onClick={onClose}>關閉</button></div><div className="modal-body">
    <p>請填「累計」售出及未售退回數量，重複填相同數量不會重複計費。已登記數量不可減少。</p>
    <div className="table-wrap"><table><thead><tr><th>商品</th><th>寄放數量</th><th>累計售出</th><th>累計未售退回</th><th>尚餘寄放</th></tr></thead><tbody>{items.map(i => <tr key={i.id}><td>{i.product_name}<br />{i.color}／{i.size}<br />{Number(order.tax_rate) > 0 ? '未稅單價' : '舊單單價'} {i.unit_price} 元</td><td>{i.qty}</td><td><input aria-label={`${i.product_name} ${i.color} ${i.size} 累計售出`} className="form-control" type="number" min={order.items.find(x => x.id === i.id).sold_qty} max={i.qty - Number(i.returned_qty)} step="1" style={{ minWidth: 90 }} value={i.sold_qty} onChange={e => change(i.id, 'sold_qty', e.target.value)} /></td><td><input aria-label={`${i.product_name} ${i.color} ${i.size} 累計未售退回`} className="form-control" type="number" min={order.items.find(x => x.id === i.id).returned_qty} max={i.qty - Number(i.sold_qty)} step="1" style={{ minWidth: 90 }} value={i.returned_qty} onChange={e => change(i.id, 'returned_qty', e.target.value)} /></td><td>{i.qty - Number(i.sold_qty) - Number(i.returned_qty)}</td></tr>)}</tbody></table></div>
    {!valid && <p role="alert" style={{ color: 'var(--red)' }}>請填有效整數；售出加退回不可超過寄放數量，也不能少於已登記數量。</p>}
    <p style={{ marginTop: 16 }}>售出小計：{net.toLocaleString()} 元　稅額（{Number(order.tax_rate || 0)}%）：{tax.toLocaleString()} 元　含稅應收：{due.toLocaleString()} 元　已收款：{collected(order).toLocaleString()} 元　待收款：{Math.max(0, roundMoney(due - collected(order))).toLocaleString()} 元</p>
    <small>未售退回僅減少寄放餘量，不產生銷售或退款；倉庫庫存仍請至庫存管理調整。</small>
    </div><div className="modal-footer"><button className="btn btn-primary" disabled={busy || !valid} onClick={save}>{busy ? '儲存中…' : '儲存寄賣結算'}</button></div></div></div>
}
