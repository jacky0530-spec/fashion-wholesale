export const roundMoney = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const discountedPrice = (retail, discount) => Math.round(Math.round(Number(retail) * 100) * Math.round(Number(discount) * 100) / 1000) / 100
export const dealerPrice = (retail, discount, taxMode = 'exclusive') => {
  const discounted = discountedPrice(retail, discount)
  return taxMode === 'inclusive' ? roundMoney(discounted / 1.05) : discounted
}
export const collected = o => Number(o.paid_amount ?? (o.payment_status === 'paid' ? o.total_amount : 0))
export const outstanding = o => Math.max(0, roundMoney(Number(o.total_amount) - collected(o)))
export const salesQty = (o, item) => Number(o.sale_mode === 'consignment' ? item.sold_qty || 0 : item.qty)
export const modeLabel = mode => mode === 'consignment' ? '寄賣' : '買斷'
export const taxModeLabel = mode => mode === 'inclusive' ? '內含 5% 稅' : '外加 5% 稅'

export const DEFAULT_TAX_RATE = 5
export const defaultDiscount = mode => mode === 'consignment' ? 6 : 5.5
export const taxFor = (net, rate = DEFAULT_TAX_RATE) => Math.round(Math.round(Number(net) * 100) * Math.round(Number(rate) * 100) / 10000) / 100
export const grossFor = (net, rate = DEFAULT_TAX_RATE) => roundMoney(Number(net) + taxFor(net, rate))
export const netSales = o => Number(o.net_amount ?? o.total_amount)
