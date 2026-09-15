import React, { useState, useEffect } from 'react'
import { request } from './lib/api'
export default function LoginGate({children}) {
 const [ready,setReady]=useState(false),[logged,setLogged]=useState(false),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{request('session').then(r=>{setLogged(!!r.data?.authenticated);setError(r.error?.message||'');setReady(true)})},[])
 const login=async e=>{e.preventDefault();setBusy(true);const r=await request('login',{password});setBusy(false);setError(r.error?.message||'');if(!r.error){setLogged(true);setPassword('')}}
 if(!ready)return <div style={{padding:40}}>正在連線…</div>
 if(logged)return <><button style={{position:'fixed',bottom:12,right:16,zIndex:100}} onClick={async()=>{const r=await request('logout');if(!r.error)setLogged(false)}}>登出</button>{children}</>
 return <main style={{maxWidth:400,margin:'12vh auto',padding:32}}><h1>批發通</h1><p>請輸入管理密碼</p><form onSubmit={login}><input aria-label="管理密碼" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy} type="submit">{busy?'登入中…':'登入'}</button><p role="alert">{error}</p></form></main>
}
