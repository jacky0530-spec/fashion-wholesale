import React, { useState, useRef } from 'react'
import { useProducts, COLORS, SIZES, COLOR_MAP, CATEGORIES } from '../lib/data'
import { uploadProductImage } from '../lib/storage'

export default function Products({ showToast }) {
  const { products, loading, addProduct, updateProduct, deleteProduct, saveVariants } = useProducts()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showVariantModal, setShowVariantModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [variantTarget, setVariantTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [imgPreview, setImgPreview] = useState(null)   // local preview URL
  const [imgFile, setImgFile] = useState(null)         // File object
  const [form, setForm] = useState({ name: '', product_code: '', category: '襪子', cost_price: '', wholesale_price: '', retail_price: '', note: '', image_url: '' })
  const [variantGrid, setVariantGrid] = useState({})
  const [selectedColors, setSelectedColors] = useState([])
  const [selectedSizes, setSelectedSizes] = useState(['S', 'M', 'L', 'XL'])
  const fileInputRef = useRef(null)

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.category.includes(search) || (p.product_code || '').toLowerCase().includes(search.toLowerCase())
  )

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', product_code: '', category: '襪子', cost_price: '', wholesale_price: '', retail_price: '', note: '', image_url: '' })
    setImgPreview(null); setImgFile(null)
    setShowModal(true)
  }
  const openEdit = (p) => {
    setEditing(p)
    setForm({ name: p.name, product_code: p.product_code || '', category: p.category, cost_price: p.cost_price, wholesale_price: p.wholesale_price, retail_price: p.retail_price, note: p.note || '', image_url: p.image_url || '' })
    setImgPreview(p.image_url || null); setImgFile(null)
    setShowModal(true)
  }
  const openVariants = (p) => {
    setVariantTarget(p)
    const grid = {}; const colors = []; const sizes = new Set(['S', 'M', 'L', 'XL'])
    ;(p.variants || []).forEach(v => {
      if (!grid[v.color]) { grid[v.color] = {}; colors.push(v.color) }
      grid[v.color][v.size] = v.stock_qty; sizes.add(v.size)
    })
    setVariantGrid(grid)
    setSelectedColors(colors.length ? colors : ['黑色'])
    setSelectedSizes([...sizes])
    setShowVariantModal(true)
  }

  // ── 選擇圖片（本機預覽）
  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { showToast('圖片大小不可超過 5MB', 'error'); return }
    setImgFile(file)
    setImgPreview(URL.createObjectURL(file))
  }

  // ── 拖曳上傳
  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > 5 * 1024 * 1024) { showToast('圖片大小不可超過 5MB', 'error'); return }
    setImgFile(file)
    setImgPreview(URL.createObjectURL(file))
  }

  const removeImage = () => { setImgFile(null); setImgPreview(null); setForm(f => ({ ...f, image_url: '' })) }

  // ── 儲存款式（含上傳圖片）
  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      let image_url = form.image_url

      // 有新圖片要上傳
      if (imgFile) {
        setUploadingImg(true)
        image_url = await uploadProductImage(imgFile)
        setUploadingImg(false)
      }

      if (editing) {
        await updateProduct(editing.id, { ...form, image_url })
        showToast('款式已更新')
      } else {
        await addProduct({ ...form, image_url })
        showToast('款式已新增')
      }
      setShowModal(false)
    } catch(e) { showToast(e.message, 'error') }
    finally { setSaving(false); setUploadingImg(false) }
  }

  const handleSaveVariants = async () => {
    const variants = []
    selectedColors.forEach(color => {
      selectedSizes.forEach(size => {
        const qty = variantGrid[color]?.[size]
        if (qty !== undefined && qty !== '') variants.push({ color, size, stock_qty: +qty })
      })
    })
    setSaving(true)
    try { await saveVariants(variantTarget.id, variants); showToast('庫存已儲存'); setShowVariantModal(false) }
    catch(e) { showToast(e.message, 'error') }
    finally { setSaving(false) }
  }

  const toggleColor = (c) => setSelectedColors(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  const toggleSize  = (s) => setSelectedSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  const setQty = (color, size, val) => setVariantGrid(prev => ({ ...prev, [color]: { ...(prev[color] || {}), [size]: val } }))

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">款式管理</h1>
          <div className="page-sub">PRODUCTS · {products.length} 款</div>
        </div>
        <div className="toolbar">
          <div className="search-bar" style={{ width: 220 }}>
            <span className="search-icon">⊘</span>
            <input placeholder="搜尋貨號、款式名稱或分類…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openAdd}>＋ 新增款式</button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="empty-state"><span className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">✦</div><p>尚無款式，點右上角新增</p></div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>圖片</th>
                    <th>款式名稱</th><th>分類</th><th>進價</th><th>批發價</th><th>零售價</th>
                    <th>顏色／尺碼</th><th>庫存</th><th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const totalStock = (p.variants || []).reduce((s, v) => s + +v.stock_qty, 0)
                    const colors = [...new Set((p.variants || []).map(v => v.color))]
                    const sizes  = [...new Set((p.variants || []).map(v => v.size))]
                    return (
                      <tr key={p.id}>
                        <td>
                          {p.image_url
                            ? <img src={p.image_url} alt={p.name} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                            : <div style={{ width: 44, height: 44, borderRadius: 6, border: '1px dashed var(--border2)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--text3)' }}>✦</div>
                          }
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          {p.product_code && <div className="mono text-muted" style={{ fontSize: 12 }}>貨號：{p.product_code}</div>}
                          {p.note && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{p.note}</div>}
                        </td>
                        <td><span className="badge badge-gold">{p.category}</span></td>
                        <td className="mono text-muted">{(+p.cost_price).toLocaleString()}</td>
                        <td className="mono text-gold" style={{ fontWeight: 700 }}>{(+p.wholesale_price).toLocaleString()}</td>
                        <td className="mono" style={{ color: 'var(--text2)' }}>{(+p.retail_price).toLocaleString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                            {colors.map(c => <span key={c} title={c} style={{ display: 'inline-block', width: 13, height: 13, borderRadius: '50%', background: COLOR_MAP[c] || '#888', border: '1px solid rgba(0,0,0,0.1)' }} />)}
                          </div>
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {sizes.map(s => <span key={s} className="size-chip has-stock">{s}</span>)}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${totalStock === 0 ? 'badge-red' : totalStock <= 10 ? 'badge-amber' : 'badge-green'}`}>
                            {totalStock} 件
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => openVariants(p)}>⊟ 庫存</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>✎ 編輯</button>
                            <button className="btn btn-danger btn-sm" onClick={async () => {
                              if (confirm(`刪除「${p.name}」？`)) {
                                if (p.image_url) await deleteProductImage(p.image_url)
                                await deleteProduct(p.id); showToast('已刪除')
                              }
                            }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? '編輯款式' : '新增款式'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24 }}>

                {/* 圖片上傳區 */}
                <div>
                  <label className="form-label">商品圖片</label>
                  <div
                    onClick={() => !imgPreview && fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDrop}
                    style={{
                      width: '100%', aspectRatio: '1', borderRadius: 8,
                      border: imgPreview ? '1px solid var(--border)' : '2px dashed var(--border2)',
                      background: 'var(--bg3)', overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: imgPreview ? 'default' : 'pointer',
                      position: 'relative', transition: 'var(--transition)',
                    }}
                  >
                    {imgPreview ? (
                      <>
                        <img src={imgPreview} alt="預覽" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button onClick={e => { e.stopPropagation(); removeImage() }}
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 24, height: 24, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.55)', color: '#fff',
                            border: 'none', cursor: 'pointer', fontSize: 13,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>✕</button>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 16 }}>
                        <div style={{ fontSize: 28, marginBottom: 8, color: 'var(--text3)' }}>↑</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                          點擊或拖曳<br />上傳圖片
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>JPG/PNG/WebP · 最大 5MB</div>
                      </div>
                    )}
                    {uploadingImg && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="spinner" />
                      </div>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
                  {!imgPreview && (
                    <button className="btn btn-ghost btn-sm w-full" style={{ marginTop: 8 }} onClick={() => fileInputRef.current?.click()}>
                      選擇圖片
                    </button>
                  )}
                  {imgPreview && (
                    <button className="btn btn-ghost btn-sm w-full" style={{ marginTop: 8 }} onClick={() => fileInputRef.current?.click()}>
                      換一張
                    </button>
                  )}
                </div>

                {/* 表單欄位 */}
                <div>
                  <div className="form-group">
                    <label className="form-label">款式名稱 *</label>
                    <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：韓版寬版西裝外套" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="product-code">貨號</label>
                    <input id="product-code" className="form-control" type="text" value={form.product_code} onChange={e => setForm(f => ({ ...f, product_code: e.target.value }))} placeholder="例：SK-001（選填）" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">分類</label>
                    <select className="form-control" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">進貨成本</label>
                      <input className="form-control" type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="0" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">批發單價</label>
                      <input className="form-control" type="number" value={form.wholesale_price} onChange={e => setForm(f => ({ ...f, wholesale_price: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">零售定價</label>
                    <input className="form-control" type="number" value={form.retail_price} onChange={e => setForm(f => ({ ...f, retail_price: e.target.value }))} placeholder="0" />
                  </div>
                  {(+form.wholesale_price > 0 && +form.cost_price > 0) && (
                    <div style={{ fontSize: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)', marginTop: -10, marginBottom: 14 }}>
                      批發毛利率：{Math.round((+form.wholesale_price - +form.cost_price) / +form.wholesale_price * 100)}%
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">備註</label>
                    <input className="form-control" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="例：韓國空運、夏季主打" />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" disabled={saving || !form.name.trim()} onClick={handleSave}>
                {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} />{uploadingImg ? ' 上傳圖片…' : ' 儲存中…'}</> : (editing ? '確認更新' : '新增款式')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant Matrix Modal */}
      {showVariantModal && variantTarget && (
        <div className="modal-overlay" onClick={() => setShowVariantModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">庫存管理 — {variantTarget.name}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowVariantModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">選擇顏色</label>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {COLORS.map(c => (
                    <button key={c} onClick={() => toggleColor(c)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                      borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12, transition: 'var(--transition)',
                      border: `1px solid ${selectedColors.includes(c) ? 'var(--gold)' : 'var(--border2)'}`,
                      background: selectedColors.includes(c) ? 'var(--gold-bg)' : 'var(--bg2)',
                      color: selectedColors.includes(c) ? 'var(--gold)' : 'var(--text2)',
                    }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLOR_MAP[c] || '#888', border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">選擇尺碼</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {SIZES.map(s => (
                    <button key={s} onClick={() => toggleSize(s)} style={{
                      padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, transition: 'var(--transition)',
                      border: `1px solid ${selectedSizes.includes(s) ? 'var(--gold)' : 'var(--border2)'}`,
                      background: selectedSizes.includes(s) ? 'var(--gold-bg)' : 'var(--bg2)',
                      color: selectedSizes.includes(s) ? 'var(--gold)' : 'var(--text2)',
                    }}>{s}</button>
                  ))}
                </div>
              </div>
              {selectedColors.length > 0 && selectedSizes.length > 0 && (
                <div className="table-wrap">
                  <table className="size-matrix">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', minWidth: 90 }}>顏色 ╲ 尺碼</th>
                        {selectedSizes.map(s => <th key={s}>{s}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedColors.map(color => (
                        <tr key={color}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                              <span style={{ width: 11, height: 11, borderRadius: '50%', background: COLOR_MAP[color] || '#888', border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                              {color}
                            </div>
                          </td>
                          {selectedSizes.map(size => (
                            <td key={size} style={{ textAlign: 'center' }}>
                              <input type="number" min="0" value={variantGrid[color]?.[size] ?? ''} onChange={e => setQty(color, size, e.target.value)} placeholder="0" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowVariantModal(false)}>取消</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSaveVariants}>
                {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '儲存庫存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
