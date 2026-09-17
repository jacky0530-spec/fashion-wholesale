import React, { useMemo, useState } from 'react'
import { useProducts } from '../lib/data'
import { request } from '../lib/api'

const emptyForm = () => ({ name: '', product_code: '', retail_price: '', note: '' })

export default function Bundles({ showToast }) {
  const { products, loading, load, deleteProduct } = useProducts()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [components, setComponents] = useState([])
  const [busy, setBusy] = useState(false)
  const [componentSearch, setComponentSearch] = useState('')

  const bundles = products.filter(p => p.is_bundle)
  const physical = products.filter(p => !p.is_bundle)
  const variants = useMemo(() => physical.flatMap(p => (p.variants || []).map(v => ({
    ...v,
    product_name: p.name,
    product_code: p.product_code || '',
    cost_price: Number(p.cost_price || 0),
  }))), [products])

  const filteredBundles = bundles.filter(b => `${b.name} ${b.product_code || ''} ${(b.bundle_components || []).map(c => `${c.product_name} ${c.color} ${c.size}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
  const filteredVariants = variants.filter(v => `${v.product_name} ${v.product_code} ${v.color} ${v.size}`.toLowerCase().includes(componentSearch.toLowerCase()))

  const openNew = () => {
    setEditing(null)
    setForm(emptyForm())
    setComponents([])
    setComponentSearch('')
    setOpen(true)
  }

  const openEdit = bundle => {
    setEditing(bundle)
    setForm({ name: bundle.name, product_code: bundle.product_code || '', retail_price: String(bundle.retail_price ?? ''), note: bundle.note || '' })
    setComponents((bundle.bundle_components || []).map(c => ({ variant_id: c.variant_id, qty: Number(c.qty) })))
    setComponentSearch('')
    setOpen(true)
  }

  const addComponent = variant => {
    setComponents(prev => {
      const found = prev.find(x => x.variant_id === variant.id)
      if (found) return prev.map(x => x.variant_id === variant.id ? { ...x, qty: x.qty + 1 } : x)
      return [...prev, { variant_id: variant.id, qty: 1 }]
    })
  }

  const updateQty = (variantId, qty) => {
    const n = Math.max(0, Math.floor(Number(qty || 0)))
    if (!n) setComponents(prev => prev.filter(x => x.variant_id !== variantId))
    else setComponents(prev => prev.map(x => x.variant_id === variantId ? { ...x, qty: n } : x))
  }

  const componentRows = components.map(c => ({ ...c, variant: variants.find(v => v.id === c.variant_id) })).filter(c => c.variant)
  const estimatedCost = componentRows.reduce((sum, c) => sum + c.variant.cost_price * c.qty, 0)
  const valid = form.name.trim() && form.retail_price !== '' && Number(form.retail_price) >= 0 && components.length >= 2 && components.every(c => Number.isInteger(Number(c.qty)) && Number(c.qty) > 0)

  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    const id = editing?.id || crypto.randomUUID()
    const r = await request('saveBundle', { table: 'products', id, record: {
      name: form.name.trim(),
      product_code: form.product_code.trim(),
      retail_price: Number(form.retail_price),
      note: form.note.trim(),
      components: components.map(c => ({ variant_id: c.variant_id, qty: Number(c.qty) })),
    } })
    if (!r.error) {
      await load()
      setOpen(false)
      showToast(editing ? '組合商品已更新' : '組合商品已建立')
    }
    setBusy(false)
  }

  const removeBundle = async bundle => {
    if (busy || !confirm(`刪除組合商品「${bundle.name}」？A、B 原商品與庫存不會被刪除。`)) return
    setBusy(true)
    try { await deleteProduct(bundle.id); showToast('組合商品已刪除') }
    catch(e) { showToast(e.message, 'error') }
    setBusy(false)
  }

  return <>
    <div className="page-header">
      <div><h1 className="page-title">組合商品</h1><div className="page-sub">BUNDLES · A、B 分開進貨，銷售時組成套組</div></div>
      <div className="toolbar">
        <input className="form-control" style={{ width: 230 }} placeholder="搜尋組合、貨號或內容…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={openNew}>＋ 新增組合</button>
      </div>
    </div>

    <div className="page-body">
      <div style={{ padding: 14, background: 'var(--gold-bg)', borderRadius: 8, marginBottom: 18 }}>
        <strong>庫存邏輯：</strong> A、B 仍各自用進貨單入庫。組合商品本身不存實體庫存；例如 A 庫存 10、B 庫存 6，若 1 組需要 A×1＋B×1，最多可售 6 組。出貨 2 組時會自動扣 A 2 件、B 2 件。
      </div>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>組合名稱</th><th>貨號</th><th>組合內容</th><th>估算成本</th><th>零售價（含稅）</th><th>總倉可售組數</th><th>操作</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28 }}><span className="spinner" /></td></tr> : filteredBundles.length === 0 ? <tr><td colSpan={7}><div className="empty-state">尚無組合商品</div></td></tr> : filteredBundles.map(b => <tr key={b.id}>
          <td><div style={{ fontWeight: 700 }}>{b.name}</div>{b.note && <div className="text-muted" style={{ fontSize: 11 }}>{b.note}</div>}</td>
          <td className="mono">{b.product_code || '—'}</td>
          <td>{(b.bundle_components || []).map(c => <div key={c.variant_id} style={{ fontSize: 12, marginBottom: 3 }}>{c.product_code ? `${c.product_code} · ` : ''}{c.product_name} {c.color}/{c.size} × {c.qty}</div>)}</td>
          <td className="mono">{Number(b.cost_price || 0).toLocaleString()}</td>
          <td className="mono text-gold" style={{ fontWeight: 700 }}>{Number(b.retail_price || 0).toLocaleString()}</td>
          <td><span className={`badge ${Number(b.variants?.[0]?.stock_qty || 0) <= 2 ? 'badge-amber' : 'badge-green'}`}>{Number(b.variants?.[0]?.stock_qty || 0)} 組</span></td>
          <td><div style={{ display: 'flex', gap: 6 }}><button className="btn btn-ghost btn-sm" onClick={() => openEdit(b)}>編輯</button><button className="btn btn-danger btn-sm" onClick={() => removeBundle(b)}>刪除</button></div></td>
        </tr>)}
      </tbody></table></div></div>
    </div>

    {open && <div className="modal-overlay"><div className="modal" style={{ width: 'min(980px,96vw)', maxWidth: 980 }}><div className="modal-header"><span className="modal-title">{editing ? '編輯組合商品' : '新增組合商品'}</span><button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>關閉</button></div><div className="modal-body">
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div className="form-group"><label className="form-label">組合名稱 *</label><input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：A+B 雙入組" /></div>
        <div className="form-group"><label className="form-label">組合貨號</label><input className="form-control" value={form.product_code} onChange={e => setForm(f => ({ ...f, product_code: e.target.value }))} placeholder="例：SET-AB01" /></div>
        <div className="form-group"><label className="form-label">零售價（含稅）*</label><input className="form-control" type="number" min="0" step="0.01" value={form.retail_price} onChange={e => setForm(f => ({ ...f, retail_price: e.target.value }))} /></div>
      </div>
      <div className="form-group"><label className="form-label">備註</label><input className="form-control" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="例：官網限定組合" /></div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div className="form-label">加入 A／B 元件</div>
          <input className="form-control" style={{ marginBottom: 8 }} placeholder="搜尋貨號、品名、顏色、尺寸" value={componentSearch} onChange={e => setComponentSearch(e.target.value)} />
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 330, overflow: 'auto' }}>
            {filteredVariants.map(v => <button key={v.id} onClick={() => addComponent(v)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg2)', padding: '9px 11px', cursor: 'pointer', color: 'var(--text)' }}>
              <div style={{ fontWeight: 600 }}>{v.product_code ? `${v.product_code} · ` : ''}{v.product_name}</div><div className="text-muted" style={{ fontSize: 11 }}>{v.color}／{v.size} · 總庫存 {v.stock_qty}</div>
            </button>)}
            {!filteredVariants.length && <div style={{ padding: 18 }} className="text-muted">找不到商品規格</div>}
          </div>
        </div>
        <div>
          <div className="form-label">目前組合內容（至少 2 個不同規格）</div>
          <div className="table-wrap"><table><thead><tr><th>品項</th><th>每組數量</th><th></th></tr></thead><tbody>{componentRows.map(c => <tr key={c.variant_id}><td><div style={{ fontWeight: 600 }}>{c.variant.product_code ? `${c.variant.product_code} · ` : ''}{c.variant.product_name}</div><div className="text-muted" style={{ fontSize: 11 }}>{c.variant.color}／{c.variant.size}</div></td><td><input className="form-control" style={{ width: 90 }} type="number" min="1" step="1" value={c.qty} onChange={e => updateQty(c.variant_id, e.target.value)} /></td><td><button className="btn btn-danger btn-sm" onClick={() => updateQty(c.variant_id, 0)}>移除</button></td></tr>)}{!componentRows.length && <tr><td colSpan={3}>請從左側加入 A、B 元件</td></tr>}</tbody></table></div>
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg3)', borderRadius: 8 }}>元件成本合計：<strong>{estimatedCost.toLocaleString()}</strong> 元<br /><span className="text-muted" style={{ fontSize: 11 }}>成本由 A、B 商品進貨成本自動加總；組合商品不另外進貨。</span></div>
        </div>
      </div>
    </div><div className="modal-footer"><button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>取消</button><button className="btn btn-primary" onClick={save} disabled={!valid || busy}>{busy ? '儲存中…' : '儲存組合商品'}</button></div></div></div>}
  </>
}
