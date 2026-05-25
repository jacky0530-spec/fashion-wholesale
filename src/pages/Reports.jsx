import React, { useState } from 'react'
import { useOrders, useProducts, useCustomers, COLOR_MAP } from '../lib/data'
import { exportOrders, exportReceivables, exportInventory, exportTopProducts } from '../lib/excel'
import { printRevenuePDF, printProductsPDF, printCustomersPDF, printAnalysisPDF, printCurrentTab } from '../lib/pdf'

export default function Reports({ showToast }) {
  const { orders } = useOrders()
  const { products } = useProducts()
  const { customers } = useCustomers()
  const [tab, setTab] = useState('revenue')
  const [pdfLoading, setPdfLoading] = useState(false)

  const paid   = orders.filter(o => o.payment_status === 'paid')
  const unpaid = orders.filter(o => o.payment_status === 'unpaid' && o.status === 'shipped')
  const totalRevenue  = paid.reduce((s, o) => s + +o.total_amount, 0)
  const totalUnpaid   = unpaid.reduce((s, o) => s + +o.total_amount, 0)
  const totalSalesAmt = orders.reduce((s, o) => s + +o.total_amount, 0)

  const productSales = {}
  orders.forEach(o => (o.items || []).forEach(item => {
    const k = item.product_name
    if (!productSales[k]) productSales[k] = { name: k, qty: 0, amount: 0 }
    productSales[k].qty    += +item.qty
    productSales[k].amount += +item.qty * +item.unit_price
  }))
  const topProducts = Object.values(productSales).sort((a, b) => b.amount - a.amount)
  const maxProdAmt  = topProducts[0]?.amount || 1

  const custSales = {}
  orders.forEach(o => {
    if (!custSales[o.customer_id]) custSales[o.customer_id] = { name: o.customer_name, shop: o.shop_name, amount: 0, orders: 0 }
    custSales[o.customer_id].amount += +o.total_amount
    custSales[o.customer_id].orders += 1
  })
  const topCustomers = Object.values(custSales).sort((a, b) => b.amount - a.amount)

  const colorSales = {}; const sizeSales = {}
  orders.forEach(o => (o.items || []).forEach(item => {
    colorSales[item.color] = (colorSales[item.color] || 0) + +item.qty
    sizeSales[item.size]   = (sizeSales[item.size]   || 0) + +item.qty
  }))
  const topColors   = Object.entries(colorSales).sort((a, b) => b[1] - a[1])
  const topSizes    = Object.entries(sizeSales).sort((a, b) => b[1] - a[1])
  const maxColorQty = topColors[0]?.[1] || 1
  const maxSizeQty  = topSizes[0]?.[1]  || 1

  const TABS = [
    { id: 'revenue',   label: '營收總覽' },
    { id: 'products',  label: '熱銷款式' },
    { id: 'customers', label: '客戶排行' },
    { id: 'analysis',  label: '色碼分析' },
  ]

  const PDF_FNS = {
    revenue: printRevenuePDF,
    products: printProductsPDF,
    customers: printCustomersPDF,
    analysis: printAnalysisPDF,
  }

  const handlePDF = async () => {
    setPdfLoading(true)
    try {
      await PDF_FNS[tab]()
      showToast('PDF 已下載')
    } catch(e) {
      showToast('PDF 產生失敗：' + e.message, 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  const handlePrint = () => {
    printCurrentTab(tab)
  }

  const Bar = ({ ratio, color }) => (
    <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${(ratio * 100).toFixed(1)}%`, background: color || 'var(--gold)', borderRadius: 3, transition: 'width 0.5s ease' }} />
    </div>
  )

  // ── 工具列 ────────────────────────────────────────────────
  const ActionBar = () => (
    <div className="export-bar" style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20,
      padding: '12px 16px', background: 'var(--bg2)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      alignItems: 'center',
    }}>
      {/* 列印 / PDF */}
      <div style={{ display: 'flex', gap: 6, paddingRight: 14, borderRight: '1px solid var(--border)', marginRight: 6 }}>
        <button className="btn btn-ghost btn-sm" onClick={handlePrint} title="列印目前報表">
          <span style={{ fontSize: 14 }}>⎙</span> 列印
        </button>
        <button className="btn btn-primary btn-sm" onClick={handlePDF} disabled={pdfLoading} title="下載 PDF">
          {pdfLoading
            ? <><span className="spinner" style={{ width: 12, height: 12 }} /> 產生中…</>
            : <><span style={{ fontSize: 13 }}>↓</span> 下載 PDF</>
          }
        </button>
      </div>

      {/* CSV 匯出 */}
      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginRight: 2 }}>CSV</span>
      <button className="btn btn-ghost btn-sm" onClick={() => { exportOrders(orders); showToast('訂單報表已下載') }}>訂單報表</button>
      <button className="btn btn-ghost btn-sm" onClick={() => { exportReceivables(orders); showToast('應收帳款已下載') }}>應收帳款</button>
      <button className="btn btn-ghost btn-sm" onClick={() => { exportInventory(products); showToast('庫存報表已下載') }}>庫存報表</button>
      <button className="btn btn-ghost btn-sm" onClick={() => { exportTopProducts(orders); showToast('熱銷款式已下載') }}>熱銷款式</button>
    </div>
  )

  // ── 列印用標題（螢幕隱藏，列印時顯示）────────────────────
  const PrintHeader = ({ title }) => (
    <div className="print-header" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #b07d2e', paddingBottom: 10, marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, color: '#1a1816' }}>批發通 · 銷售報表</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>{title}</div>
        </div>
        <div style={{ fontSize: 11, color: '#aaa', textAlign: 'right' }}>
          <div>列印日期：{new Date().toLocaleDateString('zh-TW')}</div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">銷售報表</h1>
          <div className="page-sub">REPORTS · 截至今日</div>
        </div>
      </div>

      <div className="page-body">
        <ActionBar />

        {/* Tab bar */}
        <div className="no-print" style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '9px 20px', background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: tab === t.id ? 'var(--gold)' : 'var(--text3)',
              fontFamily: 'var(--font-sans)', fontSize: 13.5,
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer', transition: 'var(--transition)', marginBottom: -2,
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── 營收總覽 ── */}
        <div id="print-revenue" style={{ display: tab === 'revenue' ? 'block' : 'none' }}>
          <PrintHeader title="營收總覽" />
          <div className="stats-grid">
            <div className="stat-card gold">
              <div className="stat-label">已收款收入</div>
              <div className="stat-value">{totalRevenue.toLocaleString()}<span className="stat-unit">元</span></div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">應收帳款</div>
              <div className="stat-value">{totalUnpaid.toLocaleString()}<span className="stat-unit">元</span></div>
            </div>
            <div className="stat-card blue">
              <div className="stat-label">訂單總數</div>
              <div className="stat-value">{orders.length}<span className="stat-unit">筆</span></div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">平均客單價</div>
              <div className="stat-value" style={{ fontSize: 22 }}>
                {orders.length ? Math.round(totalSalesAmt / orders.length).toLocaleString() : 0}
                <span className="stat-unit">元</span>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span>應收帳款明細（已出貨未收款）</span></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>客戶</th><th>出貨日期</th><th>金額</th><th>天數</th><th>狀態</th></tr>
                </thead>
                <tbody>
                  {unpaid.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--green)', padding: 28, fontWeight: 500 }}>
                      ✓ 目前無未收款項目
                    </td></tr>
                  )}
                  {unpaid.map(o => {
                    const days = o.shipped_at ? Math.floor((Date.now() - new Date(o.shipped_at)) / 86400000) : null
                    return (
                      <tr key={o.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{o.customer_name}</div>
                          {o.shop_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.shop_name}</div>}
                        </td>
                        <td className="mono" style={{ color: 'var(--text2)' }}>
                          {o.shipped_at ? new Date(o.shipped_at).toLocaleDateString('zh-TW') : '—'}
                        </td>
                        <td className="mono" style={{ color: 'var(--red)', fontWeight: 700 }}>NT$ {(+o.total_amount).toLocaleString()}</td>
                        <td>
                          {days !== null && (
                            <span className={`badge ${days > 30 ? 'badge-red' : days > 14 ? 'badge-amber' : 'badge-blue'}`}>
                              {days} 天
                            </span>
                          )}
                        </td>
                        <td><span className="badge badge-red">未收款</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── 熱銷款式 ── */}
        <div id="print-products" style={{ display: tab === 'products' ? 'block' : 'none' }}>
          <PrintHeader title="熱銷款式排行" />
          <div className="card">
            <div className="card-header"><span>款式銷售排行</span></div>
            <div style={{ padding: '20px' }}>
              {topProducts.length === 0 && <div className="empty-state"><div className="empty-icon">✦</div><p>尚無銷售資料</p></div>}
              {topProducts.map((p, i) => (
                <div key={p.name} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: 22, textAlign: 'center', fontWeight: 700, color: i === 0 ? 'var(--gold)' : i === 1 ? 'var(--text2)' : 'var(--text3)' }}>#{i + 1}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{p.qty} 件</div>
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--gold)', fontWeight: 700 }}>NT$ {p.amount.toLocaleString()}</span>
                  </div>
                  <Bar ratio={p.amount / maxProdAmt} color={i === 0 ? 'var(--gold)' : 'var(--border2)'} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 客戶排行 ── */}
        <div id="print-customers" style={{ display: tab === 'customers' ? 'block' : 'none' }}>
          <PrintHeader title="客戶消費排行" />
          <div className="card">
            <div className="card-header"><span>客戶消費排行</span></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th style={{ width: 44 }}>排名</th><th>客戶</th><th>訂單數</th><th>總消費</th><th style={{ width: 160 }}>佔比</th></tr>
                </thead>
                <tbody>
                  {topCustomers.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-icon">◈</div><p>尚無資料</p></div></td></tr>}
                  {topCustomers.map((c, i) => (
                    <tr key={c.name}>
                      <td className="mono" style={{ fontWeight: 700, color: i === 0 ? 'var(--gold)' : i === 1 ? 'var(--text2)' : 'var(--text3)' }}>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        {c.shop && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.shop}</div>}
                      </td>
                      <td className="mono" style={{ color: 'var(--text2)' }}>{c.orders}</td>
                      <td className="mono text-gold" style={{ fontWeight: 700 }}>NT$ {c.amount.toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Bar ratio={c.amount / (topCustomers[0]?.amount || 1)} />
                          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)', width: 30, textAlign: 'right' }}>
                            {totalSalesAmt > 0 ? (c.amount / totalSalesAmt * 100).toFixed(0) : 0}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── 色碼分析 ── */}
        <div id="print-analysis" style={{ display: tab === 'analysis' ? 'block' : 'none' }}>
          <PrintHeader title="顏色尺碼分析" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="card">
              <div className="card-header"><span>顏色銷售分析</span></div>
              <div style={{ padding: '18px 20px' }}>
                {topColors.length === 0 && <div className="empty-state" style={{ padding: '28px 0' }}><p>尚無資料</p></div>}
                {topColors.map(([color, qty]) => (
                  <div key={color} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 13, height: 13, borderRadius: '50%', background: COLOR_MAP[color] || '#888', border: '1px solid rgba(0,0,0,0.12)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13 }}>{color}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{qty} 件</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(qty / maxColorQty * 100).toFixed(0)}%`, background: COLOR_MAP[color] || 'var(--border2)', borderRadius: 3, opacity: 0.75 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span>尺碼銷售分析</span></div>
              <div style={{ padding: '18px 20px' }}>
                {topSizes.length === 0 && <div className="empty-state" style={{ padding: '28px 0' }}><p>尚無資料</p></div>}
                {topSizes.map(([size, qty]) => (
                  <div key={size} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="size-chip has-stock">{size}</span>
                        <span style={{ fontSize: 13 }}>尺碼 {size}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{qty} 件</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(qty / maxSizeQty * 100).toFixed(0)}%`, background: 'var(--gold)', borderRadius: 3, opacity: 0.65 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
