import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

export const COLOR_MAP = {
  '黑色': '#2a2a2a', '白色': '#e8e8e8', '米白': '#e8dcc8',
  '卡其': '#b5a589', '灰色': '#909090', '深灰': '#555555',
  '藍色': '#3b6ea5', '深藍': '#1a3a5c', '淺藍': '#7fb3d3',
  '粉色': '#e8a0b0', '紅色': '#c0392b', '橘色': '#e07820',
  '黃色': '#d4b800', '綠色': '#4a8c5c', '深綠': '#2c5c38',
  '紫色': '#7c5c9e', '棕色': '#8c6040',
}
export const COLORS = Object.keys(COLOR_MAP)
export const SIZES  = ['F', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']
export const CATEGORIES = ['上衣', '下著', '洋裝', '外套', '配件', '其他']

// ─────────────────────────────────────────────
//  Products
// ─────────────────────────────────────────────
export function useProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select('*, variants:product_variants(*)')
      .order('created_at', { ascending: false })
    if (error) { setError(error.message); setLoading(false); return }
    setProducts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addProduct = async (form) => {
    const { error } = await supabase.from('products').insert([{
      name: form.name, category: form.category,
      cost_price: +form.cost_price, wholesale_price: +form.wholesale_price,
      retail_price: +form.retail_price, note: form.note || null,
    }])
    if (error) throw error
    await load()
  }

  const updateProduct = async (id, form) => {
    const { error } = await supabase.from('products').update({
      name: form.name, category: form.category,
      cost_price: +form.cost_price, wholesale_price: +form.wholesale_price,
      retail_price: +form.retail_price, note: form.note || null,
    }).eq('id', id)
    if (error) throw error
    await load()
  }

  const deleteProduct = async (id) => {
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) throw error
    await load()
  }

  // 儲存整批 variants（先刪後插）
  const saveVariants = async (productId, variants) => {
    const { error: delErr } = await supabase
      .from('product_variants').delete().eq('product_id', productId)
    if (delErr) throw delErr

    if (variants.length > 0) {
      const rows = variants.map(v => ({
        product_id: productId,
        color: v.color, size: v.size,
        stock_qty: +v.stock_qty || 0,
      }))
      const { error: insErr } = await supabase.from('product_variants').insert(rows)
      if (insErr) throw insErr
    }
    await load()
  }

  return { products, loading, error, load, addProduct, updateProduct, deleteProduct, saveVariants }
}

// ─────────────────────────────────────────────
//  Customers
// ─────────────────────────────────────────────
export function useCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('customers').select('*').order('joined_at', { ascending: false })
    setCustomers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addCustomer = async (form) => {
    const { error } = await supabase.from('customers').insert([{
      name: form.name, shop_name: form.shop_name || null,
      line_nick: form.line_nick || null, phone: form.phone || null,
      address: form.address || null, customer_type: form.customer_type,
      credit_limit: +form.credit_limit || 0, note: form.note || null,
    }])
    if (error) throw error
    await load()
  }

  const updateCustomer = async (id, form) => {
    const { error } = await supabase.from('customers').update({
      name: form.name, shop_name: form.shop_name || null,
      line_nick: form.line_nick || null, phone: form.phone || null,
      address: form.address || null, customer_type: form.customer_type,
      credit_limit: +form.credit_limit || 0, note: form.note || null,
    }).eq('id', id)
    if (error) throw error
    await load()
  }

  const deleteCustomer = async (id) => {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) throw error
    await load()
  }

  return { customers, loading, load, addCustomer, updateCustomer, deleteCustomer }
}

// ─────────────────────────────────────────────
//  Orders
// ─────────────────────────────────────────────
export function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        customer:customers(name, shop_name),
        items:order_items(*)
      `)
      .order('order_date', { ascending: false })
    if (error) { setLoading(false); return }
    const enriched = (data || []).map(o => ({
      ...o,
      customer_name: o.customer?.name || '',
      shop_name: o.customer?.shop_name || '',
    }))
    setOrders(enriched)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addOrder = async ({ customer_id, total_amount, note, items }) => {
    // Insert order
    const { data: orderData, error: orderErr } = await supabase
      .from('orders')
      .insert([{ customer_id, total_amount, note: note || null }])
      .select()
      .single()
    if (orderErr) throw orderErr

    // Insert items
    if (items.length > 0) {
      const rows = items.map(i => ({
        order_id: orderData.id,
        variant_id: i.variant_id,
        product_name: i.product_name,
        color: i.color, size: i.size,
        qty: i.qty, unit_price: i.price,
      }))
      const { error: itemErr } = await supabase.from('order_items').insert(rows)
      if (itemErr) throw itemErr
    }
    await load()
  }

  const updateOrder = async (id, patch) => {
    const { error } = await supabase.from('orders').update(patch).eq('id', id)
    if (error) throw error
    await load()
  }

  const deleteOrder = async (id) => {
    const { error } = await supabase.from('orders').delete().eq('id', id)
    if (error) throw error
    await load()
  }

  const shipOrders = async (ids) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'shipped', shipped_at: new Date().toISOString() })
      .in('id', ids)
    if (error) throw error
    await load()
  }

  return { orders, loading, load, addOrder, updateOrder, deleteOrder, shipOrders }
}

// ─────────────────────────────────────────────
//  Dashboard stats (computed from orders hook)
// ─────────────────────────────────────────────
export function useDashboardStats(orders, products, customers) {
  const totalRevenue = orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + +o.total_amount, 0)
  const unpaidAmount = orders.filter(o => o.payment_status === 'unpaid' && o.status === 'shipped').reduce((s, o) => s + +o.total_amount, 0)
  const pendingOrders = orders.filter(o => o.status === 'pending').length
  const totalStock = products.flatMap(p => p.variants || []).reduce((s, v) => s + +v.stock_qty, 0)
  const lowStock = products.flatMap(p => p.variants || []).filter(v => +v.stock_qty > 0 && +v.stock_qty <= 5).length
  return { totalRevenue, unpaidAmount, pendingOrders, totalStock, lowStock, customerCount: customers.length }
}

// ─────────────────────────────────────────────
//  Returns（退換貨）
// ─────────────────────────────────────────────
export function useReturns() {
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('returns')
      .select(`
        *,
        customer:customers(name, shop_name),
        order:orders(order_date)
      `)
      .order('created_at', { ascending: false })
    if (error) { setLoading(false); return }
    const enriched = (data || []).map(r => ({
      ...r,
      customer_name: r.customer?.name || '',
      shop_name: r.customer?.shop_name || '',
    }))
    setReturns(enriched)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addReturn = async (form) => {
    const { error } = await supabase.from('returns').insert([{
      order_id:      form.order_id || null,
      customer_id:   form.customer_id,
      product_name:  form.product_name,
      color:         form.color,
      size:          form.size,
      qty:           +form.qty,
      return_type:   form.return_type,  // 'return' | 'exchange'
      reason:        form.reason,
      refund_amount: +form.refund_amount || 0,
      note:          form.note || null,
      status:        'pending',
    }])
    if (error) throw error
    await load()
  }

  const updateReturnStatus = async (id, status, note) => {
    const { error } = await supabase
      .from('returns')
      .update({ status, note: note || null, resolved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await load()
  }

  const deleteReturn = async (id) => {
    const { error } = await supabase.from('returns').delete().eq('id', id)
    if (error) throw error
    await load()
  }

  return { returns, loading, load, addReturn, updateReturnStatus, deleteReturn }
}
