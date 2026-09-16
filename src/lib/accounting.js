export const roundMoney = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const dealerPrice = (retail, discount) => Math.round(Math.round(Number(retail) * 100) * Math.round(Number(discount) * 100) / 1000) / 100
export const collected = o => Number(o.paid_amount ?? (o.payment_status === 'paid' ? o.total_amount : 0))
export const outstanding = o => Math.max(0, roundMoney(Number(o.total_amount) - collected(o)))
export const salesQty = (o, item) => Number(o.sale_mode === 'consignment' ? item.sold_qty || 0 : item.qty)
export const modeLabel = mode => mode === 'consignment' ? '寄賣' : '買斷'
