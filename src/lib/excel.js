// ── Excel 匯出工具（使用原生 CSV + BOM，無需額外套件）──────────
// 若需要真正的 .xlsx 格式，改用 SheetJS (xlsx) 套件

// ── 通用：陣列資料 → CSV Blob ───────────────────────────────
function toCSV(headers, rows) {
  const BOM = '\uFEFF' // UTF-8 BOM，讓 Excel 正確顯示中文
  const escape = (v) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(','))
  ]
  return new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const today = () => new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')

// ── 1. 訂單報表 ─────────────────────────────────────────────
export function exportOrders(orders) {
  const headers = ['訂單日期','客戶姓名','店家名稱','品項','顏色','尺碼','數量','單價','訂單金額','出貨狀態','收款狀態','備註']
  const STATUS  = { pending: '待出貨', shipped: '已出貨', returned: '退貨' }
  const PAY     = { unpaid: '未收款', paid: '已收款' }

  const rows = []
  orders.forEach(o => {
    const items = o.items || []
    if (items.length === 0) {
      rows.push([
        new Date(o.order_date).toLocaleDateString('zh-TW'),
        o.customer_name, o.shop_name || '',
        '', '', '', '', '',
        +o.total_amount,
        STATUS[o.status] || o.status,
        PAY[o.payment_status] || o.payment_status,
        o.note || ''
      ])
    } else {
      items.forEach((item, i) => {
        rows.push([
          i === 0 ? new Date(o.order_date).toLocaleDateString('zh-TW') : '',
          i === 0 ? o.customer_name : '',
          i === 0 ? (o.shop_name || '') : '',
          item.product_name || '',
          item.color || '',
          item.size || '',
          item.qty,
          +item.unit_price,
          i === 0 ? +o.total_amount : '',
          i === 0 ? (STATUS[o.status] || o.status) : '',
          i === 0 ? (PAY[o.payment_status] || o.payment_status) : '',
          i === 0 ? (o.note || '') : ''
        ])
      })
    }
  })

  download(toCSV(headers, rows), `訂單報表_${today()}.csv`)
}

// ── 2. 應收帳款報表 ──────────────────────────────────────────
export function exportReceivables(orders) {
  const unpaid = orders.filter(o => o.payment_status === 'unpaid' && o.status === 'shipped')
  const headers = ['客戶姓名','店家名稱','訂單日期','出貨日期','金額','天數']

  const rows = unpaid.map(o => {
    const orderDate   = new Date(o.order_date)
    const shippedDate = o.shipped_at ? new Date(o.shipped_at) : null
    const days = shippedDate ? Math.floor((Date.now() - shippedDate) / 86400000) : ''
    return [
      o.customer_name,
      o.shop_name || '',
      orderDate.toLocaleDateString('zh-TW'),
      shippedDate ? shippedDate.toLocaleDateString('zh-TW') : '',
      +o.total_amount,
      days
    ]
  })

  // 加合計列
  const total = unpaid.reduce((s, o) => s + +o.total_amount, 0)
  rows.push(['', '', '', '合計', total, ''])

  download(toCSV(headers, rows), `應收帳款_${today()}.csv`)
}

// ── 3. 庫存報表 ──────────────────────────────────────────────
export function exportInventory(products) {
  const headers = ['款式名稱','分類','顏色','尺碼','庫存數量','進價','批發價','零售價','庫存金額（批發）']

  const rows = []
  products.forEach(p => {
    ;(p.variants || []).forEach(v => {
      rows.push([
        p.name, p.category,
        v.color, v.size,
        +v.stock_qty,
        +p.cost_price,
        +p.wholesale_price,
        +p.retail_price,
        +(v.stock_qty) * +(p.wholesale_price)
      ])
    })
  })

  // 加庫存金額合計
  const totalValue = rows.reduce((s, r) => s + (r[8] || 0), 0)
  rows.push(['', '', '', '', '', '', '', '庫存總值', totalValue])

  download(toCSV(headers, rows), `庫存報表_${today()}.csv`)
}

// ── 4. 熱銷款式報表 ──────────────────────────────────────────
export function exportTopProducts(orders) {
  const productSales = {}
  orders.forEach(o => {
    ;(o.items || []).forEach(item => {
      const k = item.product_name
      if (!productSales[k]) productSales[k] = { name: k, qty: 0, amount: 0 }
      productSales[k].qty    += +item.qty
      productSales[k].amount += +item.qty * +item.unit_price
    })
  })

  const headers = ['排名','款式名稱','銷售數量','銷售金額']
  const rows = Object.values(productSales)
    .sort((a, b) => b.amount - a.amount)
    .map((p, i) => [i + 1, p.name, p.qty, p.amount])

  download(toCSV(headers, rows), `熱銷款式_${today()}.csv`)
}

// ── 5. 退換貨報表 ────────────────────────────────────────────
export function exportReturns(returns) {
  const headers = ['申請日期','客戶姓名','店家名稱','款式','顏色','尺碼','數量','原因','狀態','退款金額','備註']
  const STATUS  = { pending: '待處理', approved: '已核准', rejected: '已拒絕', completed: '已完成' }

  const rows = returns.map(r => [
    new Date(r.created_at).toLocaleDateString('zh-TW'),
    r.customer_name || '',
    r.shop_name || '',
    r.product_name || '',
    r.color || '',
    r.size || '',
    r.qty,
    r.reason || '',
    STATUS[r.status] || r.status,
    +r.refund_amount || 0,
    r.note || ''
  ])

  download(toCSV(headers, rows), `退換貨報表_${today()}.csv`)
}
