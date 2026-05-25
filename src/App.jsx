import React, { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Products  from './pages/Products'
import Customers from './pages/Customers'
import Orders    from './pages/Orders'
import Reports   from './pages/Reports'
import Inventory from './pages/Inventory'
import Returns   from './pages/Returns'

const NAV = [
  { section: '總覽',  items: [{ path: '/',          label: '儀表板',   icon: '▦' }] },
  { section: '商品',  items: [{ path: '/products',  label: '款式管理', icon: '✦' }, { path: '/inventory', label: '庫存管理', icon: '⊟' }] },
  { section: '業務',  items: [
    { path: '/customers', label: '客戶管理', icon: '◈' },
    { path: '/orders',    label: '訂單管理', icon: '◎' },
    { path: '/returns',   label: '退換貨',   icon: '↩' },
  ]},
  { section: '分析',  items: [{ path: '/reports',   label: '銷售報表', icon: '◆' }] },
]

export default function App() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo-text">批發通</span>
          <span className="logo-sub">Wholesale Pro</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(section => (
            <div key={section.section}>
              <div className="nav-section-label">{section.section}</div>
              {section.items.map(item => (
                <button
                  key={item.path}
                  className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
            <div>批發通 v1.2</div>
            <div style={{ color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
              已連線 Supabase
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/"          element={<Dashboard showToast={showToast} />} />
          <Route path="/products"  element={<Products  showToast={showToast} />} />
          <Route path="/inventory" element={<Inventory showToast={showToast} />} />
          <Route path="/customers" element={<Customers showToast={showToast} />} />
          <Route path="/orders"    element={<Orders    showToast={showToast} />} />
          <Route path="/returns"   element={<Returns   showToast={showToast} />} />
          <Route path="/reports"   element={<Reports   showToast={showToast} />} />
        </Routes>
      </main>

      {toast && (
        <div className={`toast ${toast.type}`}>
          <span style={{ fontSize: 15 }}>{toast.type === 'success' ? '✓' : '✗'}</span>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
