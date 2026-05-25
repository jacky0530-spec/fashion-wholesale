import React from 'react'
import { useDashboardStats, useOrders, useProducts, useCustomers } from '../lib/data'

export default function Dashboard() {
  const { orders, loading: oLoad } = useOrders()
  const { products, loading: pLoad } = useProducts()
  const { customers } = useCustomers()
  const stats = useDashboardStats(orders, products, customers)
  const recent = orders.slice(0, 6)

  const STATUS_LABEL = {
    pending:  { label: '待出貨', cls: 'badge-amber' },
    shipped:  { label: '已出貨', cls: 'badge-blue' },
    returned: { label: '退貨',   cls: 'badge-red' },
  }
  const PAY_LABEL = {
    unpaid: { label: '未收款', cls: 'badge-red' },
    paid:   { label: '已收款', cls: 'badge-green' },
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">儀表板</h1>
          <div className="page-sub">DASHBOARD · {new Date().toLocaleDateString('zh-TW')}</div>
        </div>
      </div>
      <div className="page-body">
        <div className="stats-grid">
          <div className="stat-card gold">
            <div className="stat-label">已收款收入</div>
            <div className="stat-value">{stats.totalRevenue.toLocaleString()}<span className="stat-unit">元</span></div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">應收帳款</div>
            <div className="stat-value">{stats.unpaidAmount.toLocaleString()}<span className="stat-unit">元</span></div>
          </div>
          <div className="stat-card blue">
            <div className="stat-label">待出貨</div>
            <div className="stat-value">{stats.pendingOrders}<span className="stat-unit">筆</span></div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">客戶數</div>
            <div className="stat-value">{stats.customerCount}<span className="stat-unit">位</span></div>
          </div>
        </div>

        {stats.lowStock > 0 && (
          <div className="alert alert-amber" style={{ marginBottom: 16 }}>
            ⚠ 庫存預警：<strong>{stats.lowStock}</strong> 個 SKU 剩餘 ≤ 5 件，請儘速補貨
          </div>
        )}
        {stats.unpaidAmount > 0 && (
          <div className="alert alert-red" style={{ marginBottom: 16 }}>
            ● 應收帳款 <strong>NT$ {stats.unpaidAmount.toLocaleString()}</strong> 尚未收回
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <span>最近訂單</span>
            {oLoad && <span className="spinner" />}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>客戶</th><th>日期</th><th>金額</th><th>出貨</th><th>收款</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && !oLoad && (
                  <tr><td colSpan={5}><div className="empty-state"><div className="empty-icon">◎</div><p>尚無訂單</p></div></td></tr>
                )}
                {recent.map(o => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{o.customer_name}</div>
                      {o.shop_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.shop_name}</div>}
                    </td>
                    <td className="mono" style={{ color: 'var(--text2)' }}>
                      {new Date(o.order_date).toLocaleDateString('zh-TW')}
                    </td>
                    <td className="mono text-gold" style={{ fontWeight: 700 }}>
                      {(+o.total_amount).toLocaleString()}
                    </td>
                    <td><span className={`badge ${STATUS_LABEL[o.status]?.cls}`}>{STATUS_LABEL[o.status]?.label}</span></td>
                    <td><span className={`badge ${PAY_LABEL[o.payment_status]?.cls}`}>{PAY_LABEL[o.payment_status]?.label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
          <div className="card">
            <div className="card-body" style={{ padding: '16px 20px' }}>
              <div className="stat-label">總庫存量</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{stats.totalStock}<span className="stat-unit">件</span></div>
            </div>
          </div>
          <div className="card" style={{ borderColor: stats.lowStock > 0 ? 'var(--amber-bd)' : 'var(--border)' }}>
            <div className="card-body" style={{ padding: '16px 20px' }}>
              <div className="stat-label">低庫存 SKU</div>
              <div className="stat-value" style={{ fontSize: 22, color: stats.lowStock > 0 ? 'var(--amber)' : 'var(--text)' }}>
                {stats.lowStock}<span className="stat-unit">項</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
