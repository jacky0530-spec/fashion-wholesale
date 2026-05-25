// ── PDF 匯出工具（使用 jsPDF + html2canvas）─────────────────
// jsPDF 和 html2canvas 透過 CDN 動態載入，不需要 npm install

const CDN_HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
const CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// ── 核心：把 DOM 元素轉成 PDF ──────────────────────────────
async function elementToPDF(elementId, filename, title) {
  await loadScript(CDN_HTML2CANVAS)
  await loadScript(CDN_JSPDF)

  const el = document.getElementById(elementId)
  if (!el) throw new Error('找不到報表區塊')

  // 暫時調整樣式讓截圖更清晰
  const origBg = el.style.background
  el.style.background = '#ffffff'

  const canvas = await window.html2canvas(el, {
    scale: 2,               // 2x 解析度
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: 1200,
  })

  el.style.background = origBg

  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pageW  = pdf.internal.pageSize.getWidth()   // 210mm
  const pageH  = pdf.internal.pageSize.getHeight()  // 297mm
  const margin = 12
  const printW = pageW - margin * 2
  const imgH   = (canvas.height / canvas.width) * printW

  // 頁首
  pdf.setFontSize(14)
  pdf.setTextColor(40, 40, 40)
  pdf.text(title, margin, margin + 4)

  pdf.setFontSize(8)
  pdf.setTextColor(140, 140, 140)
  pdf.text(`批發通 · ${new Date().toLocaleDateString('zh-TW')}`, margin, margin + 10)

  // 分頁插圖
  const contentTop = margin + 14
  const usableH = pageH - contentTop - margin
  let yOffset = 0

  while (yOffset < imgH) {
    if (yOffset > 0) pdf.addPage()

    const sliceH  = Math.min(usableH, imgH - yOffset)
    const srcY    = (yOffset / imgH) * canvas.height
    const srcH    = (sliceH / imgH) * canvas.height

    // 擷取這一頁的圖片區段
    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width  = canvas.width
    sliceCanvas.height = srcH
    const ctx = sliceCanvas.getContext('2d')
    ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH)

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92)
    const drawH   = (sliceH / imgH) * imgH

    pdf.addImage(imgData, 'JPEG', margin, yOffset === 0 ? contentTop : margin, printW, drawH)
    yOffset += usableH
  }

  // 頁碼
  const pageCount = pdf.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    pdf.setFontSize(8)
    pdf.setTextColor(180, 180, 180)
    pdf.text(`${i} / ${pageCount}`, pageW - margin, pageH - 5, { align: 'right' })
  }

  pdf.save(filename)
}

const today = () => new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')

// ── 各報表對外 API ──────────────────────────────────────────
export async function printRevenuePDF() {
  await elementToPDF('print-revenue', `營收報表_${today()}.pdf`, '營收總覽')
}
export async function printProductsPDF() {
  await elementToPDF('print-products', `熱銷款式_${today()}.pdf`, '熱銷款式排行')
}
export async function printCustomersPDF() {
  await elementToPDF('print-customers', `客戶排行_${today()}.pdf`, '客戶消費排行')
}
export async function printAnalysisPDF() {
  await elementToPDF('print-analysis', `色碼分析_${today()}.pdf`, '顏色尺碼分析')
}

// ── 列印（呼叫瀏覽器列印對話框）──────────────────────────────
export function printCurrentTab(tabId) {
  // 隱藏其他分頁內容，只印當前頁
  const tabs = ['revenue', 'products', 'customers', 'analysis']
  tabs.forEach(id => {
    const el = document.getElementById(`print-${id}`)
    if (el) el.dataset.printHide = id !== tabId ? '1' : '0'
  })

  // 注入一次性樣式
  const style = document.createElement('style')
  style.id = 'print-tab-style'
  style.textContent = tabs
    .filter(id => id !== tabId)
    .map(id => `#print-${id} { display: none !important; }`)
    .join('\n')
  document.head.appendChild(style)

  window.print()

  // 列印後還原
  setTimeout(() => {
    const s = document.getElementById('print-tab-style')
    if (s) s.remove()
  }, 500)
}
