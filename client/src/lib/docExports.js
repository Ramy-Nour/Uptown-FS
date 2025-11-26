import * as XLSX from 'xlsx'
import { fetchWithAuth } from './apiClient.js'

export function exportScheduleCSV(genResult, language) {
  if (!genResult?.schedule?.length) return
  const rows = [
    ['#', 'Month', 'Label', 'Amount', 'Written Amount'],
    ...genResult.schedule.map((row, i) => {
      const amt = Number(row.amount || 0)
      const written = row.writtenAmount || ''
      return [
        i + 1,
        row.month,
        row.label,
        amt.toFixed(2),
        written
      ]
    })
  ]
  const totalIncl = Number(((genResult?.totals?.totalNominalIncludingMaintenance ?? genResult?.totals?.totalNominal)) || 0)
  const totalExcl = Number(genResult?.totals?.totalNominalExcludingMaintenance ?? totalIncl)
  rows.push([])
  rows.push(['', '', 'Total (excluding Maintenance Deposit)', totalExcl.toFixed(2), ''])
  rows.push(['', '', 'Total (including Maintenance Deposit)', totalIncl.toFixed(2), ''])

  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '')
    if (/[\"",\n]/.test(s)) return `"${s.replace(/\"/g, '""')}"`
    return s
  }).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  a.download = `payment_schedule_${ts}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportScheduleXLSX(genResult, language) {
  if (!genResult?.schedule?.length) return
  const aoa = [
    ['#', 'Month', 'Label', 'Amount', 'Written Amount'],
    ...genResult.schedule.map((row, i) => {
      const amt = Number(row.amount || 0)
      const written = row.writtenAmount || ''
      return [i + 1, row.month, row.label, amt.toFixed(2), written]
    })
  ]
  const totalIncl = Number(((genResult?.totals?.totalNominalIncludingMaintenance ?? genResult?.totals?.totalNominal)) || 0)
  const totalExcl = Number(genResult?.totals?.totalNominalExcludingMaintenance ?? totalIncl)
  aoa.push([])
  aoa.push(['', '', 'Total (excluding Maintenance Deposit)', totalExcl.toFixed(2), ''])
  aoa.push(['', '', 'Total (including Maintenance Deposit)', totalIncl.toFixed(2), ''])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 28 }, { wch: 16 }, { wch: 50 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  a.download = `payment_schedule_${ts}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function generateChecksSheetXLSX(genResult, clientInfo, unitInfo, currency, language) {
  if (!genResult?.schedule?.length) return
  const title = 'Checks Sheet'
  const buyer = clientInfo.buyer_name || ''
  const unit = unitInfo.unit_code || unitInfo.unit_number || ''
  const curr = currency || ''
  const headerRows = [
    [title],
    [`Buyer: ${buyer}     Unit: ${unit}     Currency: ${curr}`],
    [],
    ['#', 'Cheque No.', 'Date', 'Pay To', 'Amount', 'Amount in Words', 'Notes']
  ]
  const bodyRows = genResult.schedule.map((row, i) => {
    const amount = Number(row.amount || 0)
    const amountStr = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return [
      i + 1,
      '',
      '',
      buyer,
      amountStr,
      row.writtenAmount || '',
      `${row.label} (Month ${row.month})`
    ]
  })
  const aoa = [...headerRows, ...bodyRows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 60 }, { wch: 30 },
  ]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Checks')
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  a.download = `checks_sheet_${ts}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Generate Client Offer PDF via server-rendered HTML (Puppeteer).
 * body should include: language, currency, buyers[], schedule[], totals, offer_date, first_payment_date, unit{}, unit_pricing_breakdown{}
 */
export async function generateClientOfferPdf(body, API_URL, onProgress) {
  if (typeof onProgress === 'function') {
    const timer = setInterval(() => {
      onProgress(p => {
        const next = (typeof p === 'number' ? p : 0) + Math.random() * 7
        return next >= 85 ? 85 : next
      })
    }, 350)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/documents/client-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        let errMsg = 'Failed to generate Client Offer PDF'
        try {
          const j = await resp.json()
          errMsg = j?.error?.message || errMsg
        } catch {}
        throw new Error(errMsg)
      }
      onProgress(92)
      const blob = await resp.blob()
      onProgress(100)
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `client_offer_${ts}.pdf`
      return { blob, filename }
    } finally {
      clearInterval(timer)
      onProgress(0)
    }
  } else {
    const resp = await fetchWithAuth(`${API_URL}/api/documents/client-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!resp.ok) {
      let errMsg = 'Failed to generate Client Offer PDF'
      try {
        const j = await resp.json()
        errMsg = j?.error?.message || errMsg
      } catch {}
      throw new Error(errMsg)
    }
    const blob = await resp.blob()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `client_offer_${ts}.pdf`
    return { blob, filename }
  }
}

/**
 * Generate Reservation Form PDF via server-rendered HTML (Puppeteer).
 * body should include: deal_id, reservation_form_date, preliminary_payment_amount, currency_override, language
 */
export async function generateReservationFormPdf(body, API_URL) {
  const resp = await fetchWithAuth(`${API_URL}/api/documents/reservation-form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    let errMsg = 'Failed to generate Reservation Form PDF'
    try {
      const j = await resp.json()
      errMsg = j?.error?.message || errMsg
    } catch {}
    throw new Error(errMsg)
  }
  const blob = await resp.blob()
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `reservation_form_${ts}.pdf`
  return { blob, filename }
}

/**
 * Generate a DOCX-based PDF via /api/generate-document using a template or documentType.
 * Returns { blob, filename } to be downloaded by the caller.
 */
export async function generateDocumentFile(documentType, body, API_URL) {
  const resp = await fetchWithAuth(`${API_URL}/api/generate-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    let errMsg = 'Failed to generate document'
    try {
      const j = await resp.json()
      errMsg = j?.error?.message || errMsg
    } catch {}
    throw new Error(errMsg)
  }
  const blob = await resp.blob()
  const cd = resp.headers.get('Content-Disposition') || ''
  const match = /filename\*=UTF-8''([^;]+)|filename=\"?([^\\";]+)\"?/i.exec(cd)
  let filename = ''
  if (match) {
    filename = decodeURIComponent(match[1] || match[2] || '')
  }
  if (!filename) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    filename = `${documentType}_${ts}.pdf`
  }
  return { blob, filename }
}