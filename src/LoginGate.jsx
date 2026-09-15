import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { request } from './lib/api'
import './login.css'

export default function LoginGate({ children }) {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [logged, setLogged] = useState(false)
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    request('session').then(r => {
      if (!active) return
      setLogged(!!r.data?.authenticated)
      setError(r.error?.message || '')
      setReady(true)
    })
    return () => { active = false }
  }, [])

  const login = async e => {
    e.preventDefault()
    if (busy || !ready) return
    setBusy(true); setError(''); setNotice('')
    const r = await request('login', { password })
    setBusy(false)
    if (r.error) { setError(r.error.message); return }
    setPassword(''); setVisible(false); setLogged(true)
  }

  const logout = async () => {
    if (busy) return
    setBusy(true)
    const r = await request('logout')
    setBusy(false)
    if (r.error) return
    setLogged(false); setPassword(''); setVisible(false); setError('')
    setNotice('已安全登出，歡迎下次回來。')
    navigate('/', { replace: true })
  }

  if (logged) return React.cloneElement(children, { onLogout: logout, loggingOut: busy })

  return (
    <main className="login-page">
      <div className="login-brand"><span className="login-mark" aria-hidden="true">W</span><span>批發通<small>WHOLESALE PRO</small></span></div>
      <section className="login-layout" aria-label="批發通登入">
        <div className="login-intro">
          <span className="login-eyebrow">為每一天的生意，做好準備</span>
          <h1>款式有序，<br />生意從容。</h1>
          <p>從商品到訂單，從庫存到客戶。<br />讓繁瑣的日常，變成清楚的下一步。</p>
          <div className="login-features"><span>款式管理</span><span>庫存掌握</span><span>訂單追蹤</span></div>
          <div className="login-art" aria-hidden="true"><span>THE DAILY EDIT</span><div className="login-art-lines"><i /><i /><i /></div><strong>每一件商品<br />都有好生意。</strong><small>CURATED · ORGANIZED · READY</small></div>
        </div>
        <div className="login-card">
          <span className="login-card-eyebrow">YOUR WORKSPACE</span>
          <h2>歡迎回來</h2>
          <p className="login-card-subtitle">登入您的服飾批發管理工作台</p>
          <form onSubmit={login}>
            <label htmlFor="admin-password">管理密碼</label>
            <div className="login-password">
              <input id="admin-password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="請輸入管理密碼" aria-describedby={error ? 'login-error' : undefined} aria-invalid={!!error} disabled={!ready || busy} />
              <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? '隱藏密碼' : '顯示密碼'} aria-pressed={visible}>{visible ? '隱藏' : '顯示'}</button>
            </div>
            {error && <div id="login-error" className="login-error" role="alert">{error}</div>}
            {notice && <div className="login-notice" role="status">{notice}</div>}
            <button className="login-submit" type="submit" disabled={!ready || busy || !password}>{!ready ? '正在連線…' : busy ? '登入中…' : '登入工作台'}<span aria-hidden="true">→</span></button>
          </form>
          <div className="login-help">專屬管理入口<br /><span>請使用您設定的管理密碼登入。</span></div>
        </div>
      </section>
      <footer className="login-footer">批發通 · 服飾批發管理系統</footer>
    </main>
  )
}
