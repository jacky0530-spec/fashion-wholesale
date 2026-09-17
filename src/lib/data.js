import { useState, useEffect, useCallback } from 'react'
import { request } from './api'
import { collected, outstanding } from './accounting'

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
export const CATEGORIES = ['上衣', '下著', '洋裝', '外套', '配件', '襪子', '其他']

export function useProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await request('list', { table: 'products' })
    if (error) { setError(error.message); setLoading(false); return }
    setError(null)
    setProducts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addProduct = async (form) => {
    const { data, error } = await request('insert', { table: 'products', record: {
      name: form.name, product_code: form.product_code?.trim() || null, category: form.category,
      cost_price: +form.cost_price, wholesale_price: +form.wholesale_price,
      retail_price: +form.retail_price, image_url: form.image_url || null, note: form.note || null,
    } })
    if (error) throw error
    await load()
    return data[0].id
  }

  const updateProduct = async (id, form) => {
    const { error } = await request('update', { table: 'products', id, record: {
      name: form.name, product_code: form.product_code?.trim() || null, category: form.category,
      cost_price: +form.cost_price, wholesale_price: +form.wholesale_price,
      retail_price: +form.retail_price, image_url: form.image_url || null, note: form.note || null,
    } })
    if (error) throw error
    await load()
  }

  const deleteProduct = async (id) => {
    const { error } = await request('delete', { table: 'products', id })
    if (error) throw error
    await load()
  }

  const saveVariants = async (productId, variants) => {
    const { error } = await request('variants', { table: 'products', id: productId, variants })
    if (error) throw error
    await load()
  }

  return { products, loading, error, load, addProduct, updateProduct, deleteProduct, saveVariants }
}

export function useCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await request('list', { table: 'customers' })
    if (error) { setLoading(false); return }
    setCustomers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addCustomer = async (form) => {
    const { error } = await request('insert', { table: 'customers', record: {
      customer_name: form.customer_name?.trim() || null,
      name: form.name, shop_name: form.shop_name || null, tax_id: form.tax_id?.trim() || null,
      line_nick: form.line_nick || null, phone: form.phone || null, contact_email: form.contact_email?.trim() || null,
      address: form.address || null, customer_type: form.customer_type,
      sale_mode: form.sale_mode, discount: form.discount === '' ? null : Number(form.discount),
      tax_mode: form.tax_mode || 'exclusive', credit_limit: +form.credit_limit || 0, note: form.note || null,
    } })
    if (error) throw error
    await load()
  }

  const updateCustomer = async (id, form) => {
    const { error } = await request('update', { table: 'customers', id, record: {
      customer_name: form.customer_name?.trim() || null,
      name: form.name, shop_name: form.shop_name || null, tax_id: form.tax_id?.trim() || null,
      line_nick: form.line_nick || null, phone: form.phone || null, contact_email: form.contact_email?.trim() || null,
      address: form.address || null, customer_type: form.customer_type,
      sale_mode: form.sale_mode, discount: form.discount === '' ? null : Number(form.discount),
      tax_mode: form.tax_mode || 'exclusive', credit_limit: +form.credit_limit || 0, note: form.note || null,
    } })
    if (error) throw error
    await load()
  }

  const deleteCustomer = async (id) => {
    const { error } = await request('delete', { table: 'customers', id })
    if (error) throw error
    await load()
  }

  return { customers, loading, load, addCustomer, updateCustomer, deleteCustomer }
}

export function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await request('list', { table: 'orders' })
    if (error) { setLoading(false); return }
    const enriched = (data || []).map(o => ({
      ...o,
      customer_name: o.customer?.customer_name || o.customer?.name || '',
      contact_name: o.customer?.name || '',
      shop_name: o.customer?.shop_name || '',
    }))
    setOrders(enriched)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addOrder = async ({ customer_id, total_amount, note, items, discount, sale_mode, tax_mode }) => {
    const { error } = await request('createOrder', { table: 'orders', record: { customer_id, total_amount, note, items, discount, sale_mode, tax_mode } })
    if (error) throw error
    await load()
  }

  const updateOrder = async (id, patch) => {
    const { error } = await request('update', { table: 'orders', id, record: patch })
    if (error) throw error
    await load()
  }

  const deleteOrder = async (id) => {
    const { error } = await request('delete', { table: 'orders', id })
    if (error) throw error
    await load()
  }

  const shipOrders = async (ids) => {
    const { error } = await request('ship', { table: 'orders', ids })
    if (error) throw error
    await load()
  }

  const settleOrder = async (order, items) => {
    const { error } = await request('settle', { table: 'orders', id: order.id, revision: order.revision, items })
    if (error) throw error
    await load()
  }
  const collectOrder = async (order, paid) => {
    const { error } = await request('collect', { table: 'orders', id: order.id, revision: order.revision, paid })
    if (error) throw error
    await load()
  }
  return { orders, loading, load, addOrder, updateOrder, deleteOrder, shipOrders, settleOrder, collectOrder }
}

export function useDashboardStats(orders, products, customers) {
  const totalRevenue = orders.reduce((s, o) => s + collected(o), 0)
  const unpaidAmount = orders.filter(o => o.status === 'shipped').reduce((s, o) => s + outstanding(o), 0)
  const pendingOrders = orders.filter(o => o.status === 'pending').length
  const physicalProducts = products.filter(p => !p.is_bundle)
  const totalStock = physicalProducts.flatMap(p => p.variants || []).reduce((s, v) => s + +v.stock_qty, 0)
  const lowStock = physicalProducts.flatMap(p => p.variants || []).filter(v => +v.stock_qty > 0 && +v.stock_qty <= 5).length
  return { totalRevenue, unpaidAmount, pendingOrders, totalStock, lowStock, customerCount: customers.length }
}

export function useReturns() {
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await request('list', { table: 'returns' })
    if (error) { setLoading(false); return }
    const enriched = (data || []).map(r => ({
      ...r,
      customer_name: r.customer?.customer_name || r.customer?.name || '',
      contact_name: r.customer?.name || '',
      shop_name: r.customer?.shop_name || '',
    }))
    setReturns(enriched)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addReturn = async (form) => {
    const { error } = await request('insert', { table: 'returns', record: {
      order_id:      form.order_id || null,
      customer_id:   form.customer_id,
      product_name:  form.product_name,
      color:         form.color,
      size:          form.size,
      qty:           +form.qty,
      return_type:   form.return_type,
      reason:        form.reason,
      refund_amount: +form.refund_amount || 0,
      note:          form.note || null,
      status:        'pending',
    } })
    if (error) throw error
    await load()
  }

  const updateReturnStatus = async (id, status, note) => {
    const { error } = await request('update', { table: 'returns', id, record: { status, note: note || null, resolved_at: new Date().toISOString() } })
    if (error) throw error
    await load()
  }

  const deleteReturn = async (id) => {
    const { error } = await request('delete', { table: 'returns', id })
    if (error) throw error
    await load()
  }

  return { returns, loading, load, addReturn, updateReturnStatus, deleteReturn }
}
