import * as XLSX from 'xlsx'

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
    if (/[\",\n]/.test(s)) return `"${s.replace(/\"/g, '""')}"`
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