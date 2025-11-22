import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import LoadingButton from '../components/LoadingButton.jsx'
import SkeletonRow from '../components/SkeletonRow.jsx'
import * as XLSX from 'xlsx'
import { useLoader } from '../lib/loaderContext.jsx'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const ctrl = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6' }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

export default function Dashboard() {
  const [deals, setDeals] = useState([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [creatorEmail, setCreatorEmail] = useState('')
  const [reviewerEmail, setReviewerEmail] = useState('')
  const [approverEmail, setApproverEmail] = useState('')
  const [unitType, setUnitType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sortBy, setSortBy] = useState('id')
  const [sortDir, setSortDir] = useState('desc')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [deletingIds, setDeletingIds] = useState(new Set())
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')

  async function load(p = page) {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      if (status) q.set('status', status)
      if (search) q.set('search', search)
      if (creatorEmail) q.set('creatorEmail', creatorEmail)
      if (reviewerEmail) q.set('reviewerEmail', reviewerEmail)
      if (approverEmail) q.set('approverEmail', approverEmail)
      if (unitType) q.set('unitType', unitType)
      if (startDate) q.set('startDate', startDate)
      if (endDate) q.set('endDate', endDate)
      if (minAmount) q.set('minAmount', minAmount)
      if (maxAmount) q.set('maxAmount', maxAmount)
      if (sortBy) q.set('sortBy', sortBy)
      if (sortDir) q.set('sortDir', sortDir)
      q.set('page', String(p))
      q.set('pageSize', String(pageSize))
      const resp = await fetchWithAuth(`${API_URL}/api/deals?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load deals')
      setDeals(data.deals || [])
      setTotal(data.pagination?.total || 0)
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load deals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, creatorEmail, reviewerEmail, approverEmail, unitType, startDate, endDate, minAmount, maxAmount, pageSize, sortBy, sortDir])

  useEffect(() => {
    load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Optional minimal callout for approver roles with pending queue items
  const [approverBanner, setApproverBanner] = useState({ show: false, url: '' })
  useEffect(() => {
    let mounted = true
    async function checkQueue() {
      try {
        const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
        const role = user?.role
        // Respect daily dismiss
        const todayKey = new Date().toISOString().slice(0, 10)
        const dismissed = localStorage.getItem('approver_queue_banner_dismissed')
        if (dismissed === todayKey) return

        let url = ''
        if (role === 'sales_manager') url = '/api/workflow/payment-plans/queue/sm'
        else if (role === 'financial_manager') url = '/api/workflow/payment-plans/queue/fm'
        else if (['ceo', 'vice_chairman', 'chairman', 'top_management'].includes(role)) url = '/api/workflow/payment-plans/queue/tm'
        if (!url) return
        const resp = await fetchWithAuth(`${API_URL}${url}`)
        const data = await resp.json()
        if (mounted && resp.ok) {
          const count = (data?.payment_plans || []).length
          if (count > 0) setApproverBanner({ show: true, url: '/deals/queues' })
        }
      } catch {}
    }
    checkQueue()
    return () => { mounted = false }
  }, [])

  async function handleDelete(deal) {
    const id = deal.id
    // optimistic remove
    const prevDeals = deals
    setDeals(d => d.filter(x => x.id !== id))
    setTotal(t => Math.max(0, t - 1))
    setDeletingIds(s => new Set([...s, id]))
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}`, { method: 'DELETE' })
      let msg = ''
      try {
        const j = await resp.json()
        msg = j?.error?.message || ''
      } catch {}
      if (!resp.ok) {
        // rollback
        setDeals(prevDeals)
        setTotal(t => t + 1)
        notifyError({ message: msg || 'Failed to delete deal' })
      } else {
        notifySuccess('Deal deleted')
      }
    } catch (e) {
      // rollback
      setDeals(prevDeals)
      setTotal(t => t + 1)
      notifyError(e, 'Failed to delete deal')
    } finally {
      setDeletingIds(s => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }
  }

  const { setShow, setMessage } = useLoader()

  async function exportAllMatching() {
    // Build base query params from current filters and sorting
    const base = new URLSearchParams()
    if (status) base.set('status', status)
    if (search) base.set('search', search)
    if (creatorEmail) base.set('creatorEmail', creatorEmail)
    if (reviewerEmail) base.set('reviewerEmail', reviewerEmail)
    if (approverEmail) base.set('approverEmail', approverEmail)
    if (unitType) base.set('unitType', unitType)
    if (startDate) base.set('startDate', startDate)
    if (endDate) base.set('endDate', endDate)
    if (minAmount) base.set('minAmount', minAmount)
    if (maxAmount) base.set('maxAmount', maxAmount)
    if (sortBy) base.set('sortBy', sortBy)
    if (sortDir) base.set('sortDir', sortDir)

    const all = []
    const pageSizeForExport = 100 // API caps at 100
    let p = 1
    while (true) {
      const q = new URLSearchParams(base.toString())
      q.set('page', String(p))
      q.set('pageSize', String(pageSizeForExport))
      const resp = await fetchWithAuth(`${API_URL}/api/deals?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Export fetch failed')
      const batch = data.deals || []
      all.push(...batch)
      const totalCount = data.pagination?.total || 0
      const totalPagesExport = Math.max(1, Math.ceil(totalCount / pageSizeForExport))
      if (p >= totalPagesExport) break
      p += 1
    }
    return all
  }

  async function exportCSV() {
    try {
      setMessage('Generating report, please wait...')
      setShow(true)
      const rows = await exportAllMatching()
      const header = ['ID', 'Title', 'Amount', 'Status', 'Unit Type', 'Creator', 'Offer Date', 'First Payment Date', 'Created', 'Updated']
      const body = rows.map(d => ([
        d.id,
        d.title,
        Number(d.amount || 0).toFixed(2),
        d.status,
        d.unit_type || '',
        d.created_by_email || '',
        d?.details?.calculator?.inputs?.offerDate || '',
        d?.details?.calculator?.inputs?.firstPaymentDate || d?.details?.calculator?.inputs?.offerDate || '',
        d.created_at ? new Date(d.created_at).toISOString() : '',
        d.updated_at ? new Date(d.updated_at).toISOString() : ''
      ]))
      const out = [header, ...body]
      const csv = out.map(r => r.map(cell => {
        const s = String(cell ?? '')
        return /[\\\",\\n]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s
      }).join(',')).join('\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `deals_export_${ts}.csv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      notifySuccess('Export completed successfully.')
    } catch (e) {
      notifyError(e, 'Unable to export CSV.')
    } finally {
      setShow(false)
    }
  }

  async function exportXLSX() {
    try {
      setMessage('Generating report, please wait...')
      setShow(true)
      const rows = await exportAllMatching()
      const aoa = [
        ['ID', 'Title', 'Amount', 'Status', 'Unit Type', 'Creator', 'Offer Date', 'First Payment Date', 'Created', 'Updated'],
        ...rows.map(d => ([
          d.id,
          d.title,
          Number(d.amount || 0),
          d.status,
          d.unit_type || '',
          d.created_by_email || '',
          d?.details?.calculator?.inputs?.offerDate || '',
          d?.details?.calculator?.inputs?.firstPaymentDate || d?.details?.calculator?.inputs?.offerDate || '',
          d.created_at ? new Date(d.created_at).toLocaleString() : '',
          d.updated_at ? new Date(d.updated_at).toLocaleString() : ''
        ]))
      ]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [
        { wch: 6 },   // ID
        { wch: 28 },  // Title
        { wch: 14 },  // Amount
        { wch: 16 },  // Status
        { wch: 18 },  // Unit Type
        { wch: 28 },  // Creator
        { wch: 16 },  // Offer Date
        { wch: 20 },  // First Payment Date
        { wch: 22 },  // Created
        { wch: 22 },  // Updated
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Deals')
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `deals_export_${ts}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      notifySuccess('Export completed successfully.')
    } catch (e) {
      notifyError(e, 'Unable to export Excel.')
    } finally {
      setShow(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>All Deals</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/deals/inventory" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>Browse Inventory</a>
          <a href="/deals/create" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>Create Offer</a>
          {(() => {
            try {
              const u = JSON.parse(localStorage.getItem('auth_user') || '{}')
              if (['sales_manager','property_consultant','financial_manager'].includes(u?.role)) {
                return <a href="/deals/block-requests" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>Block Requests</a>
              }
            } catch {}
            return null
          })()}
        </div>
      </div>

      {approverBanner.show && (
        <div style={{ margin: '8px 0 12px', padding: '10px 12px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ color: '#9a3412', marginRight: 8 }}>You have pending approvals in your queue.</span>
            <a href={approverBanner.url} style={{ color: '#1f6feb', textDecoration: 'none', fontWeight: 600 }}>Review Now</a>
          </div>
          <button
            type="button"
            onClick={() => {
              const todayKey = new Date().toISOString().slice(0, 10)
              localStorage.setItem('approver_queue_banner_dismissed', todayKey)
              setApproverBanner({ show: false, url: '' })
            }}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer', color: '#475569' }}
          >
            Hide for today
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, marginBottom: 12, gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} style={ctrl} disabled={loading}>
          <option value="">All statuses</option>
          <option value="draft">draft</option>
          <option value="pending_approval">pending_approval</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
        <input placeholder="Search title…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input placeholder="Creator email…" value={creatorEmail} onChange={e => { setCreatorEmail(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input placeholder="Reviewer email…" value={reviewerEmail} onChange={e => { setReviewerEmail(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input placeholder="Approver email…" value={approverEmail} onChange={e => { setApproverEmail(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input placeholder="Unit type…" value={unitType} onChange={e => { setUnitType(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input type="number" placeholder="Min amount" value={minAmount} onChange={e => { setMinAmount(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <input type="number" placeholder="Max amount" value={maxAmount} onChange={e => { setMaxAmount(e.target.value); setPage(1) }} style={ctrl} disabled={loading} />
        <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1) }} style={ctrl} disabled={loading}>
          <option value="id">Sort by id</option>
          <option value="title">Sort by title</option>
          <option value="amount">Sort by amount</option>
          <option value="status">Sort by status</option>
          <option value="created_at">Sort by created</option>
          <option value="updated_at">Sort by updated</option>
        </select>
        <select value={sortDir} onChange={e => { setSortDir(e.target.value); setPage(1) }} style={ctrl} disabled={loading}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }} style={ctrl} disabled={loading}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
        <LoadingButton onClick={() => load(1)} loading={loading} style={btn}>Refresh</LoadingButton>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>Title</th>
              <th style={th}>Amount</th>
              <th style={th}>Status</th>
              <th style={th}>Unit Type</th>
              <th style={th}>Creator</th>
              <th style={th}>Offer Date</th>
              <th style={th}>First Payment Date</th>
              <th style={th}>Created</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                {Array.from({ length: pageSize }).map((_, i) => (
                  <SkeletonRow key={i} widths={['sm','lg','sm','sm','lg','lg','sm','sm','sm','sm']} tdStyle={td} />
                ))}
              </>
            )}
            {!loading && deals.map(d => {
              const offerDate = d?.details?.calculator?.inputs?.offerDate || '';
              const firstPaymentDate = d?.details?.calculator?.inputs?.firstPaymentDate || offerDate || '';
              return (
                <tr key={d.id}>
                  <td style={td}>{d.id}</td>
                  <td style={td}>{d.title}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{Number(d.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td style={td}>{d.status}</td>
                  <td style={td}>{d.unit_type || '-'}</td>
                  <td style={td}>{d.created_by_email || '-'}</td>
                  <td style={td}>{offerDate}</td>
                  <td style={td}>{firstPaymentDate}</td>
                  <td style={td}>{d.created_at ? new Date(d.created_at).toLocaleString() : ''}</td>
                  <td style={{ ...td, display: 'flex', gap: 8 }}>
                    <Link to={`/deals/${d.id}`} style={{ textDecoration: 'none', color: '#1f6feb' }}>View</Link>
                    {(user?.role === 'sales_manager' && d.status === 'pending_approval') && (
                      <LoadingButton
                        onClick={async () => {
                          if (!window.confirm(`Approve deal #${d.id}?`)) return
                          try {
                            const resp = await fetchWithAuth(`${API_URL}/api/deals/${d.id}/approve`, { method: 'POST' })
                            if (!resp.ok) {
                                const data = await resp.json()
                                notifyError(data?.error?.message || 'Approval failed')
                            } else {
                                notifySuccess('Deal approved')
                                load(page)
                            }
                          } catch (e) { notifyError(e, 'Approval failed') }
                        }}
                        style={{ ...btn, color: '#10b981', borderColor: '#10b981' }}
                      >
                        Approve
                      </LoadingButton>
                    )}
                    <LoadingButton
                      onClick={() => handleDelete(d)}
                      loading={deletingIds.has(d.id)}
                      style={{ ...btn, border: '1px solid #dc2626', color: '#dc2626' }}
                    >
                      Delete
                    </LoadingButton>
                  </td>
                </tr>
              )
            })}
            {deals.length === 0 && !loading && (
              <tr>
                <td style={td} colSpan={10}>No deals match your criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          Page {page} of {totalPages} — {total} total
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <LoadingButton onClick={() => setPage(1)} disabled={page === 1 || loading}>First</LoadingButton>
          <LoadingButton onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading}>Prev</LoadingButton>
          <LoadingButton onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}>Next</LoadingButton>
          <LoadingButton onClick={() => setPage(totalPages)} disabled={page === totalPages || loading}>Last</LoadingButton>
          <LoadingButton onClick={exportCSV} loading={loading} disabled={total === 0}>Export CSV</LoadingButton>
          <LoadingButton onClick={exportXLSX} loading={loading} disabled={total === 0}>Export Excel</LoadingButton>
        </div>
      </div>
    </div>
  )
}