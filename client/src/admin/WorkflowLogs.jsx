import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import * as XLSX from 'xlsx'
import { th, td, ctrl, btn, tableWrap, table, pageContainer, pageTitle, errorText } from '../lib/ui.js'
import BrandHeader from '../lib/BrandHeader.jsx'
import LoadingButton from '../components/LoadingButton.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import { useLoader } from '../lib/loaderContext.jsx'

export default function WorkflowLogs() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [type, setType] = useState('')
  const [consultantId, setConsultantId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      if (startDate) q.set('startDate', startDate)
      if (endDate) q.set('endDate', endDate)
      if (type) q.set('type', type)
      if (consultantId) q.set('consultant_id', consultantId)
      if (managerId) q.set('manager_id', managerId)
      const resp = await fetchWithAuth(`${API_URL}/api/reports/workflow-logs?${q.toString()}`)
      const j = await resp.json()
      if (!resp.ok) throw new Error(j?.error?.message || 'Failed to load report')
      setData(j)
      notifySuccess('Report loaded successfully.')
    } catch (e) {
      const msg = e.message || String(e)
      setError(msg)
      notifyError(e, 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleLogout = async () => {
    try {
      const rt = localStorage.getItem('refresh_token')
      if (rt) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt })
        }).catch(() => {})
      }
    } finally {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('auth_user')
      window.location.href = '/login'
    }
  }

  const { setShow, setMessage } = useLoader()

  function exportXLSX() {
    if (!data) return
    try {
      setMessage('Generating report, please wait...')
      setShow(true)

      const wb = XLSX.utils.book_new()

      const makeSheet = (rows, headers) => {
        const aoa = [headers.map(h => h.label), ...rows.map(r => headers.map(h => r[h.key]))]
        const ws = XLSX.utils.aoa_to_sheet(aoa)
        ws['!cols'] = headers.map(() => ({ wch: 16 }))
        return ws
      }

      const offerHeaders = [
        { key: 'id', label: 'ID' },
        { key: 'deal_id', label: 'Deal ID' },
        { key: 'deal_title', label: 'Deal Title' },
        { key: 'unit_id', label: 'Unit ID' },
        { key: 'unit_code', label: 'Unit Code' },
        { key: 'unit_type', label: 'Unit Type' },
        { key: 'status', label: 'Status' },
        { key: 'version', label: 'Version' },
        { key: 'accepted', label: 'Accepted' },
        { key: 'created_by', label: 'Consultant ID' },
        { key: 'created_by_email', label: 'Consultant Email' },
        { key: 'manager_user_id', label: 'Manager ID' },
        { key: 'manager_email', label: 'Manager Email' },
        { key: 'created_at', label: 'Created At' },
        { key: 'total_nominal', label: 'Total Nominal' }
      ]
      const resHeaders = [
        { key: 'id', label: 'ID' },
        { key: 'payment_plan_id', label: 'Offer ID' },
        { key: 'unit_id', label: 'Unit ID' },
        { key: 'unit_code', label: 'Unit Code' },
        { key: 'unit_type', label: 'Unit Type' },
        { key: 'status', label: 'Status' },
        { key: 'created_by', label: 'Consultant ID' },
        { key: 'created_by_email', label: 'Consultant Email' },
        { key: 'manager_user_id', label: 'Manager ID' },
        { key: 'manager_email', label: 'Manager Email' },
        { key: 'created_at', label: 'Created At' },
        { key: 'total_nominal', label: 'Total Nominal' }
      ]
      const conHeaders = [
        { key: 'id', label: 'ID' },
        { key: 'reservation_form_id', label: 'Reservation ID' },
        { key: 'unit_id', label: 'Unit ID' },
        { key: 'unit_code', label: 'Unit Code' },
        { key: 'unit_type', label: 'Unit Type' },
        { key: 'status', label: 'Status' },
        { key: 'created_by', label: 'Consultant ID' },
        { key: 'created_by_email', label: 'Consultant Email' },
        { key: 'manager_user_id', label: 'Manager ID' },
        { key: 'manager_email', label: 'Manager Email' },
        { key: 'created_at', label: 'Created At' },
        { key: 'total_nominal', label: 'Total Nominal' }
      ]

      const offers = (data.offers?.rows || []).map(r => ({
        ...r,
        created_at: r.created_at ? new Date(r.created_at).toLocaleString() : ''
      }))
      const reservations = (data.reservations?.rows || []).map(r => ({
        ...r,
        created_at: r.created_at ? new Date(r.created_at).toLocaleString() : ''
      }))
      const contracts = (data.contracts?.rows || []).map(r => ({
        ...r,
        created_at: r.created_at ? new Date(r.created_at).toLocaleString() : ''
      }))

      XLSX.utils.book_append_sheet(wb, makeSheet(offers, offerHeaders), 'Offers')
      XLSX.utils.book_append_sheet(wb, makeSheet(reservations, resHeaders), 'Reservations')
      XLSX.utils.book_append_sheet(wb, makeSheet(contracts, conHeaders), 'Contracts')

      const offersTotal = (data.offers?.rows || []).reduce(
        (s, r) => s + (Number(r.total_nominal) || 0),
        0
      )
      const reservationsTotal = (data.reservations?.rows || []).reduce(
        (s, r) => s + (Number(r.total_nominal) || 0),
        0
      )
      const contractsTotal = (data.contracts?.rows || []).reduce(
        (s, r) => s + (Number(r.total_nominal) || 0),
        0
      )

      const offersCount = offers.length
      const reservationsCount = reservations.length
      const contractsCount = contracts.length

      const sumSheet = XLSX.utils.aoa_to_sheet([
        ['Type', 'Count', 'Total Value'],
        ['Offers', offersCount, offersTotal],
        ['Reservations', reservationsCount, reservationsTotal],
        ['Contracts', contractsCount, contractsTotal]
      ])
      sumSheet['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, sumSheet, 'Totals')

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `workflow_logs_${ts}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      notifySuccess('Export completed successfully.')
    } catch (e) {
      notifyError(e, 'Export failed')
    } finally {
      setShow(false)
    }
  }

  function exportCSV() {
    if (!data) return
    try {
      setMessage('Generating report, please wait...')
      setShow(true)
      const ts = new Date().toISOString().replace(/[:.]/g, '-')

      const makeCSV = (rows) => {
        if (!rows || rows.length === 0) return ''
        const headers = Object.keys(rows[0])
        const body = rows.map(r => headers.map(h => {
          const v = r[h]
          const s = v == null ? '' : String(v)
          return /[\",\n]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s
        }).join(','))
        return [headers.join(','), ...body].join('\n')
      }

      const sections = [
        { name: 'offers', rows: data.offers?.rows || [] },
        { name: 'reservations', rows: data.reservations?.rows || [] },
        { name: 'contracts', rows: data.contracts?.rows || [] }
      ]
      sections.forEach(sec => {
        if (!sec.rows.length) return
        const csv = makeCSV(sec.rows)
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `workflow_logs_${sec.name}_${ts}.csv`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      })
      notifySuccess('Export completed successfully.')
    } catch (e) {
      notifyError(e, 'Export failed')
    } finally {
      setShow(false)
    }
  }

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>Workflow Logs</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 12 }}>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={ctrl} />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={ctrl} />
          <select value={type} onChange={e => setType(e.target.value)} style={ctrl}>
            <option value="">All Types</option>
            <option value="offers">Offers</option>
            <option value="reservations">Reservations</option>
            <option value="contracts">Contracts</option>
          </select>
          <input type="number" placeholder="Consultant User ID" value={consultantId} onChange={e => setConsultantId(e.target.value)} style={ctrl} />
          <input type="number" placeholder="Sales Manager User ID" value={managerId} onChange={e => setManagerId(e.target.value)} style={ctrl} />
          <div>
            <LoadingButton onClick={load} loading={loading}>Apply</LoadingButton>
            <LoadingButton onClick={exportXLSX} disabled={!data}>Export XLSX</LoadingButton>
            <LoadingButton onClick={exportCSV} disabled={!data}>Export CSV</LoadingButton>
          </div>
        </div>

        {error ? <p style={errorText}>{error}</p> : null}

        {data && (
          <>
            <Section
              title="Offers"
              rows={data.offers?.rows}
              total={data.offers?.total}
              byStatus={data.offers?.byStatus}
            />
            <Section
              title="Reservations"
              rows={data.reservations?.rows}
              total={data.reservations?.total}
              byStatus={data.reservations?.byStatus}
            />
            <Section
              title="Contracts"
              rows={data.contracts?.rows}
              total={data.contracts?.total}
              byStatus={data.contracts?.byStatus}
            />
            <SummaryFooter data={data} />
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, rows, total, byStatus }) {
  const list = rows || []
  const numCols = list.length > 0 ? Object.keys(list[0]).length : 1

  const breakdown =
    Array.isArray(byStatus) && byStatus.length
      ? byStatus
      : buildStatusBreakdown(list)

  // Fallback: recompute total from rows if API total is missing or zero but we have data.
  const computedTotal = list.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)
  const displayTotal = Number(total || 0) || computedTotal

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>
            Total:{' '}
            {Number(displayTotal || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          {breakdown.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
              {breakdown.map((b, idx) => (
                <span key={b.status || idx} style={{ marginLeft: idx ? 12 : 0 }}>
                  {(b.status || 'unknown').toUpperCase()}: {b.count} /{' '}
                  {formatTotal(b.total_nominal)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              {list.length > 0 && Object.keys(list[0]).map(k => <th key={k} style={th}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.map((r, idx) => (
              <tr key={idx}>
                {Object.keys(r).map(k => <td key={k} style={td}>{formatCell(k, r[k])}</td>)}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td style={{ ...td, textAlign: 'center' }} colSpan={numCols}>No records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function buildStatusBreakdown(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const status = r.status || 'unknown'
    const existing = map.get(status) || { status, count: 0, total_nominal: 0 }
    existing.count += 1
    existing.total_nominal += Number(r.total_nominal) || 0
    map.set(status, existing)
  }
  return Array.from(map.values())
}

function SummaryFooter({ data }) {
  const offersRows = data.offers?.rows || []
  const reservationsRows = data.reservations?.rows || []
  const contractsRows = data.contracts?.rows || []

  const offersTotal = offersRows.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)
  const reservationsTotal = reservationsRows.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)
  const contractsTotal = contractsRows.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)

  const offersCount = offersRows.length
  const reservationsCount = reservationsRows.length
  const contractsCount = contractsRows.length

  return (
    <div style={{ marginTop: 12, fontWeight: 700 }}>
      <div>
        Offers: {offersCount} — {formatTotal(offersTotal)}
      </div>
      <div>
        Reservations: {reservationsCount} — {formatTotal(reservationsTotal)}
      </div>
      <div>
        Contracts: {contractsCount} — {formatTotal(contractsTotal)}
      </div>
    </div>
  )
}

function formatTotal(v) {
  const n = Number(v) || 0
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatCell(k, v) {
  if (k.includes('created_at') || k.includes('updated_at')) {
    return v ? new Date(v).toLocaleString() : ''
  }
  if (k.includes('total')) {
    return formatTotal(v)
  }
  return String(v ?? '')
}

