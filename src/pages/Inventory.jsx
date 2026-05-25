import React, { useState } from 'react'
import { useProducts, COLOR_MAP, CATEGORIES } from '../lib/data'

export default function Inventory() {
  const { products, loading } = useProducts()
  const [filterCat, setFilterCat] = useState('all')
  const [filterStock, setFilterStock] = useState('all')
  const [search, setSearch] = useState('')

  const allVariants = products.flatMap(p =>
    (p.variants || []).map(v => ({ ...v, product_name: p.name, category: p.category }))
  )

  const filtered = allVariants.filter(v => {
    const matchCat   = filterCat === 'all' || v.category === filterCat
    const matchStock = filterStock === 'all'
      || (filterStock === 'low' && +v.stock_qty > 0 && +v.stock_qty <= 5)
      || (filterStock === 'out' && +v.stock_qty === 0)
      || (filterStock === 'ok'  && +v.stock_qty > 5)
    const matchSearch = v.product_name.includes(search) || v.color.includes(search) || v.size.includes(search)
    return matchCat && matchStock && matchSearch
  })

  const totalStock = allVariants.reduce((s, v) => s + +v.stock_qty, 0)
  const lowCount   = allVariants.filter(v => +v.stock_qty > 0 && +v.stock_qty <= 5).length
  const outCount   = allVariants.filter(v => +v.stock_qty === 0).length

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">庫存管理</h1>
          <div className="page-sub">INVENTORY · {allVariants.length} 個 SKU</div>
        </div>
        <div className="toolbar">
          <div className="search-bar" style={{ width: 200 }}>
            <span className="search-icon">⊘</span>
            <input placeholder="款式、顏色、尺碼…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-control" style={{ width: 100, padding: '8px 10px' }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="all">全部分類</option>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <select className="form-control" style={{ width: 120, padding: '8px 10px' }} value={filterStock} onChange={e => setFilterStock(e.target.value)}>
            <option value="all">全部庫存</option>
            <option value="ok">充足 ＞5</option>
            <option value="low">低庫存 ≤5</option>
            <option value="out">已售完</option>
          </select>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', maxWidth: 480, marginBottom: 20 }}>
          <div className="stat-card green">
            <div className="stat-label">總庫存</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{totalStock}<span className="stat-unit">件</span></div>
          </div>
          <div className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--amber)' }} />
            <div className="stat-label">低庫存</div>
            <div className="stat-value" style={{ fontSize: 22, color: lowCount > 0 ? 'var(--amber)' : 'var(--text)' }}>{lowCount}<span className="stat-unit">項</span></div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">已售完</div>
            <div className="stat-value" style={{ fontSize: 22, color: outCount > 0 ? 'var(--red)' : 'var(--text)' }}>{outCount}<span className="stat-unit">項</span></div>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>款式名稱</th><th>分類</th><th>顏色</th><th>尺碼</th><th>庫存數量</th><th>狀態</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">⊟</div><p>無符合條件的 SKU</p></div></td></tr>
                )}
                {filtered.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 500 }}>{v.product_name}</td>
                    <td><span className="badge badge-gold">{v.category}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: COLOR_MAP[v.color] || '#888', border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text2)', fontSize: 13 }}>{v.color}</span>
                      </div>
                    </td>
                    <td><span className="size-chip has-stock">{v.size}</span></td>
                    <td className="mono" style={{ fontSize: 16, fontWeight: 700, color: +v.stock_qty === 0 ? 'var(--red)' : +v.stock_qty <= 5 ? 'var(--amber)' : 'var(--text)' }}>
                      {v.stock_qty}
                    </td>
                    <td>
                      {+v.stock_qty === 0
                        ? <span className="badge badge-red">售完</span>
                        : +v.stock_qty <= 5
                        ? <span className="badge badge-amber">⚠ 低庫存</span>
                        : <span className="badge badge-green">充足</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
