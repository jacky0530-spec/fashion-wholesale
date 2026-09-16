import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { request } from '../lib/api'
import { useCustomers, COLOR_MAP, CATEGORIES } from '../lib/data'

const money = value => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)

export default function Inventory({ showToast }) {
  const { customers } = useCustomers()
  const [inventory, setInventory] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [transfers, setTransfers] = useState([])
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [filterWarehouse, setFilterWarehouse] = useState('all')
  const [busy, setBusy] = useState(false)

  const [transferOpen, setTransferOpen] = useState(false)
  const [transferId, setTransferId] = useState('')
  const [transferForm, setTransferForm] = useState({ transfer_date: today(), from_warehouse: '總倉', to_warehouse: 'p.coast', transfer_no: '', note: '' })
  const [transferQty, setTransferQty] = useState({})
  const [transferSearch, setTransferSearch] = useState('')

  const [settleOpen, setSettleOpen] = useState(false)
  const [settleId, setSettleId] = useState('')
  const [settleForm, setSettleForm] = useState({ settlement_date: today(), warehouse: 'p.coast', customer_id: '' })
  const [countedQty, setCountedQty] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [i, w, t, s] = await Promise.all([
      request('list', { table: 'inventory' }),
      request('list', { table: 'warehouses' }),
      request('list', { table: 'transfers' }),
      request('list', { table: 'consignment_settlements' }),
    ])
    setLoading(false)
    const error = i.error || w.error || t.error || s.error
    if (error) return
    setInventory(i.data || [])
    setWarehouses(w.data || [])
    setTransfers(t.data || [])
    setSettlements(s.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const activeWarehouseNames = warehouses.map(w => w.name)
  const consignmentWarehouses = warehouses.filter(w => w.warehouse_type === 'consignment')
  const consignmentCustomers = customers.filter(c => c.sale_mode === 'consignment')

  const filtered = inventory.filter(v => {
    const hay = `${v.product_code || ''} ${v.product_name} ${v.color} ${v.size}`.toLowerCase()
    const matchSearch = hay.includes(search.toLowerCase())
    const matchCat = filterCat === 'all' || v.category === filterCat
    const matchWarehouse = filterWarehouse === 'all' || Number(v.warehouse_stock?.[filterWarehouse] || 0) > 0
    return matchSearch && matchCat && matchWarehouse
  })

  const warehouseTotals = useMemo(() => Object.fromEntries(activeWarehouseNames.map(name => [name, inventory.reduce((sum, row) => sum + Number(row.warehouse_stock?.[name] || 0), 0)])), [inventory, warehouses])
  const totalStock = inventory.reduce((sum, row) => sum + Number(row.total_stock || 0), 0)

  const openTransfer = () => {
    const source = warehouses.find(w => w.name === '總倉')?.name || warehouses[0]?.name || ''
    const target = consignmentWarehouses[0]?.name || warehouses.find(w => w.name !== source)?.name || ''
    setTransferForm({ transfer_date: today(), from_warehouse: source, to_warehouse: target, transfer_no: '', note: '' })
    setTransferQty({}); setTransferSearch(''); setTransferId(crypto.randomUUID()); setTransferOpen(true)
  }
  const transferCandidates = inventory.filter(row => {
    const stock = Number(row.warehouse_stock?.[transferForm.from_warehouse] || 0)
    return stock > 0 && `${row.product_code || ''} ${row.product_name} ${row.color} ${row.size}`.toLowerCase().includes(transferSearch.toLowerCase())
  })
  const transferItems = Object.entries(transferQty).filter(([, qty]) => Number(qty) > 0).map(([variant_id, qty]) => ({ variant_id, qty: Number(qty) }))
  const saveTransfer = async () => {
    if (busy || !transferItems.length || transferForm.from_warehouse === transferForm.to_warehouse) return
    setBusy(true)
    const r = await request('postTransfer', { table: 'transfers', id: transferId, record: { ...transferForm, items: transferItems } })
    if (!r.error) { showToast('調撥完成，倉庫庫存已更新'); setTransferOpen(false); await load() }
    setBusy(false)
  }
  const voidTransfer = async transfer => {
    if (busy || !confirm(`作廢調撥單 ${transfer.transfer_no}？庫存將移回 ${transfer.from_warehouse}。`)) return
    setBusy(true)
    const r = await request('voidTransfer', { table: 'transfers', id: transfer.id })
    if (!r.error) { showToast('調撥單已作廢並沖回庫存'); await load() }
    setBusy(false)
  }

  const initializeCount = warehouse => {
    const next = {}
    inventory.forEach(row => {
      const qty = Number(row.warehouse_stock?.[warehouse] || 0)
      if (qty > 0) next[row.variant_id] = qty
    })
    setCountedQty(next)
  }
  const openSettlement = () => {
    const warehouse = consignmentWarehouses.find(w => warehouseTotals[w.name] > 0)?.name || consignmentWarehouses[0]?.name || ''
    const matchedCustomer = consignmentCustomers.find(c => (c.shop_name || '').toLowerCase() === warehouse.toLowerCase()) || consignmentCustomers[0]
    setSettleForm({ settlement_date: today(), warehouse, customer_id: matchedCustomer?.id || '' })
    initializeCount(warehouse)
    setSettleId(crypto.randomUUID()); setSettleOpen(true)
  }
  const settlementRows = inventory.filter(row => Number(row.warehouse_stock?.[settleForm.warehouse] || 0) > 0)
  const selectedCustomer = customers.find(c => c.id === settleForm.customer_id)
  const settlementSold = settlementRows.reduce((sum, row) => sum + Math.max(0, Number(row.warehouse_stock?.[settleForm.warehouse] || 0) - Number(countedQty[row.variant_id] ?? 0)), 0)
  const saveSettlement = async () => {
    if (busy || !settleForm.warehouse || !settleForm.customer_id || !settlementRows.length) return
    const items = settlementRows.map(row => ({ variant_id: row.variant_id, counted_qty: Number(countedQty[row.variant_id] ?? 0) }))
    if (items.some(item => !Number.isInteger(item.counted_qty) || item.counted_qty < 0)) { showToast('盤點數量請填 0 以上整數', 'error'); return }
    setBusy(true)
    const r = await request('settleWarehouseConsignment', { table: 'consignment_settlements', id: settleId, record: { ...settleForm, items } })
    if (!r.error) { showToast(`寄賣月結完成，本期售出 ${settlementSold} 雙，已產生應收單`); setSettleOpen(false); await load() }
    setBusy(false)
  }

  return <>
    <div className="page-header">
      <div><h1 className="page-title">庫存管理</h1><div className="page-sub">WAREHOUSE INVENTORY · {inventory.length} 個 SKU</div></div>
      <div className="toolbar">
        <input className="form-control" style={{ width: 210 }} placeholder="搜尋貨號、款式、規格…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-control" style={{ width: 120 }} value={filterCat} onChange={e => setFilterCat(e.target.value)}><option value="all">全部分類</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select className="form-control" style={{ width: 150 }} value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)}><option value="all">全部倉庫</option>{activeWarehouseNames.map(name => <option key={name}>{name}</option>)}</select>
        <button className="btn btn-ghost" onClick={openTransfer} disabled={!warehouses.length}>⇄ 庫存調撥</button>
        <button className="btn btn-primary" onClick={openSettlement} disabled={!consignmentWarehouses.length}>寄賣月結</button>
      </div>
    </div>

    <div className="page-body">
      <div className="stats-grid" style={{ gridTemplateColumns: `repeat(${Math.min(activeWarehouseNames.length + 1, 5)},minmax(130px,1fr))`, marginBottom: 20 }}>
        <div className="stat-card green"><div className="stat-label">全部庫存</div><div className="stat-value" style={{ fontSize: 22 }}>{totalStock}<span className="stat-unit">雙</span></div></div>
        {activeWarehouseNames.map(name => <div className="stat-card" key={name}><div className="stat-label">{name}</div><div className="stat-value" style={{ fontSize: 22 }}>{warehouseTotals[name] || 0}<span className="stat-unit">雙</span></div></div>)}
      </div>

      <div className="card"><div className="table-wrap"><table><thead><tr><th>貨號／款式</th><th>分類</th><th>規格</th>{activeWarehouseNames.map(name => <th key={name}>{name}</th>)}<th>合計</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={activeWarehouseNames.length + 4} style={{ textAlign: 'center', padding: 30 }}><span className="spinner" /></td></tr> : filtered.length === 0 ? <tr><td colSpan={activeWarehouseNames.length + 4}><div className="empty-state">無符合條件的庫存</div></td></tr> : filtered.map(row => <tr key={row.variant_id}>
          <td><div style={{ fontWeight: 600 }}>{row.product_name}</div>{row.product_code && <div className="mono text-muted" style={{ fontSize: 11 }}>{row.product_code}</div>}</td>
          <td><span className="badge badge-gold">{row.category}</span></td>
          <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: COLOR_MAP[row.color] || '#888' }} />{row.color}／{row.size}</span></td>
          {activeWarehouseNames.map(name => <td key={name} className="mono" style={{ fontWeight: Number(row.warehouse_stock?.[name] || 0) ? 700 : 400, color: Number(row.warehouse_stock?.[name] || 0) ? 'var(--text)' : 'var(--text3)' }}>{Number(row.warehouse_stock?.[name] || 0)}</td>)}
          <td className="mono" style={{ fontWeight: 800 }}>{row.total_stock}</td>
        </tr>)}
      </tbody></table></div></div>

      <div className="card" style={{ marginTop: 20 }}><div className="card-header"><div><div className="card-title">最近調撥</div><div className="card-sub">總倉與寄賣客戶倉之間的庫存移動</div></div></div><div className="table-wrap"><table><thead><tr><th>日期</th><th>單號</th><th>來源</th><th>目的</th><th>數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        {transfers.slice(0, 12).map(t => <tr key={t.id}><td>{String(t.transfer_date).slice(0, 10)}</td><td>{t.transfer_no}</td><td>{t.from_warehouse}</td><td>{t.to_warehouse}</td><td>{(t.items || []).reduce((n, i) => n + Number(i.qty), 0)}</td><td><span className={`badge ${t.status === 'void' ? 'badge-red' : 'badge-green'}`}>{t.status === 'void' ? '已作廢' : '已調撥'}</span></td><td>{t.status !== 'void' && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => voidTransfer(t)}>作廢</button>}</td></tr>)}
        {!transfers.length && <tr><td colSpan={7}><div className="empty-state">尚無調撥紀錄</div></td></tr>}
      </tbody></table></div></div>

      <div className="card" style={{ marginTop: 20 }}><div className="card-header"><div><div className="card-title">寄賣月結</div><div className="card-sub">月底實盤後，自動計算售出數量與含稅應收</div></div></div><div className="table-wrap"><table><thead><tr><th>日期</th><th>月結單號</th><th>倉庫</th><th>客戶</th><th>售出</th><th>未稅</th><th>稅額</th><th>含稅應收</th></tr></thead><tbody>
        {settlements.slice(0, 12).map(s => <tr key={s.id}><td>{String(s.settlement_date).slice(0, 10)}</td><td>{s.settlement_no}</td><td>{s.warehouse}</td><td>{s.shop_name || s.customer_name}</td><td>{(s.items || []).reduce((n, i) => n + Number(i.sold_qty), 0)}</td><td>{money(s.net_amount)}</td><td>{money(s.tax_amount)}</td><td style={{ fontWeight: 700 }}>{money(s.total_amount)}</td></tr>)}
        {!settlements.length && <tr><td colSpan={8}><div className="empty-state">尚無寄賣月結紀錄</div></td></tr>}
      </tbody></table></div></div>
    </div>

    {transferOpen && <div className="modal-overlay"><div className="modal" style={{ width: 'min(1000px,96vw)', maxWidth: 1000 }}><div className="modal-header"><span className="modal-title">庫存調撥</span><button className="btn btn-ghost" onClick={() => setTransferOpen(false)} disabled={busy}>關閉</button></div><div className="modal-body">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <div className="form-group"><label className="form-label">日期</label><input className="form-control" type="date" value={transferForm.transfer_date} onChange={e => setTransferForm(f => ({ ...f, transfer_date: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">來源倉</label><select className="form-control" value={transferForm.from_warehouse} onChange={e => { setTransferForm(f => ({ ...f, from_warehouse: e.target.value })); setTransferQty({}) }}>{activeWarehouseNames.map(name => <option key={name}>{name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">目的倉</label><select className="form-control" value={transferForm.to_warehouse} onChange={e => setTransferForm(f => ({ ...f, to_warehouse: e.target.value }))}>{activeWarehouseNames.filter(name => name !== transferForm.from_warehouse).map(name => <option key={name}>{name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">調撥單號</label><input className="form-control" value={transferForm.transfer_no} onChange={e => setTransferForm(f => ({ ...f, transfer_no: e.target.value }))} placeholder="留空自動產生" /></div>
      </div>
      <div className="form-group"><label className="form-label">備註</label><input className="form-control" value={transferForm.note} onChange={e => setTransferForm(f => ({ ...f, note: e.target.value }))} placeholder="例如：9月補貨" /></div>
      <input className="form-control" style={{ width: 260, marginBottom: 10 }} placeholder="搜尋貨號、款式或規格" value={transferSearch} onChange={e => setTransferSearch(e.target.value)} />
      <div className="table-wrap" style={{ maxHeight: 400, overflow: 'auto' }}><table><thead><tr><th>商品</th><th>規格</th><th>來源可用</th><th>調撥數量</th></tr></thead><tbody>{transferCandidates.map(row => { const available = Number(row.warehouse_stock?.[transferForm.from_warehouse] || 0); return <tr key={row.variant_id}><td>{row.product_code ? `${row.product_code} · ` : ''}{row.product_name}</td><td>{row.color}／{row.size}</td><td>{available}</td><td><input className="form-control" style={{ width: 100 }} type="number" min="0" max={available} step="1" value={transferQty[row.variant_id] ?? ''} onChange={e => { const value = Math.min(available, Math.max(0, Number(e.target.value || 0))); setTransferQty(q => ({ ...q, [row.variant_id]: value || '' })) }} /></td></tr>})}{!transferCandidates.length && <tr><td colSpan={4}>此來源倉沒有可調撥庫存。</td></tr>}</tbody></table></div>
    </div><div className="modal-footer"><button className="btn btn-ghost" onClick={() => setTransferOpen(false)} disabled={busy}>取消</button><button className="btn btn-primary" onClick={saveTransfer} disabled={busy || !transferItems.length || transferForm.from_warehouse === transferForm.to_warehouse}>{busy ? '調撥中…' : `確認調撥 ${transferItems.reduce((n, i) => n + i.qty, 0)} 雙`}</button></div></div></div>}

    {settleOpen && <div className="modal-overlay"><div className="modal" style={{ width: 'min(1000px,96vw)', maxWidth: 1000 }}><div className="modal-header"><span className="modal-title">寄賣月結盤點</span><button className="btn btn-ghost" onClick={() => setSettleOpen(false)} disabled={busy}>關閉</button></div><div className="modal-body">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        <div className="form-group"><label className="form-label">月結日期</label><input className="form-control" type="date" value={settleForm.settlement_date} onChange={e => setSettleForm(f => ({ ...f, settlement_date: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">寄賣倉庫</label><select className="form-control" value={settleForm.warehouse} onChange={e => { const warehouse = e.target.value; const matched = consignmentCustomers.find(c => (c.shop_name || '').toLowerCase() === warehouse.toLowerCase()); setSettleForm(f => ({ ...f, warehouse, customer_id: matched?.id || f.customer_id })); initializeCount(warehouse) }}>{consignmentWarehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">結帳客戶</label><select className="form-control" value={settleForm.customer_id} onChange={e => setSettleForm(f => ({ ...f, customer_id: e.target.value }))}><option value="">選擇寄賣客戶</option>{consignmentCustomers.map(c => <option key={c.id} value={c.id}>{c.shop_name || c.name}（{c.discount}折）</option>)}</select></div>
      </div>
      <p style={{ color: 'var(--text2)', marginBottom: 12 }}>系統寄放數量－月底實盤數量＝本月售出數量。售出後才依客戶寄賣折數計算未稅貨款，再另加 5% 稅額。</p>
      <div className="table-wrap" style={{ maxHeight: 430, overflow: 'auto' }}><table><thead><tr><th>商品</th><th>規格</th><th>系統寄放</th><th>月底實盤</th><th>本月售出</th></tr></thead><tbody>{settlementRows.map(row => { const systemQty = Number(row.warehouse_stock?.[settleForm.warehouse] || 0); const counted = Number(countedQty[row.variant_id] ?? systemQty); return <tr key={row.variant_id}><td>{row.product_code ? `${row.product_code} · ` : ''}{row.product_name}</td><td>{row.color}／{row.size}</td><td>{systemQty}</td><td><input className="form-control" style={{ width: 100 }} type="number" min="0" max={systemQty} step="1" value={countedQty[row.variant_id] ?? systemQty} onChange={e => { const value = Math.min(systemQty, Math.max(0, Number(e.target.value || 0))); setCountedQty(q => ({ ...q, [row.variant_id]: value })) }} /></td><td style={{ fontWeight: 700, color: systemQty - counted > 0 ? 'var(--green)' : 'var(--text3)' }}>{systemQty - counted}</td></tr>})}{!settlementRows.length && <tr><td colSpan={5}>此寄賣倉目前沒有庫存，不需月結。</td></tr>}</tbody></table></div>
      {selectedCustomer && <p style={{ marginTop: 14, fontWeight: 600 }}>本期售出共 {settlementSold} 雙；客戶條件：零售價 × {selectedCustomer.discount} 折（未稅）＋ 5% 稅。</p>}
    </div><div className="modal-footer"><button className="btn btn-ghost" onClick={() => setSettleOpen(false)} disabled={busy}>取消</button><button className="btn btn-primary" onClick={saveSettlement} disabled={busy || !settleForm.customer_id || !settlementRows.length}>{busy ? '結帳中…' : `確認月結（售出 ${settlementSold} 雙）`}</button></div></div></div>}
  </>
}
