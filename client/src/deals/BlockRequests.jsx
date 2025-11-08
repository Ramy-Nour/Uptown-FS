import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import LoadingButton from '../components/LoadingButton.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }
const badge = (bg, color) => ({ padding: '4px 8px', borderRadius: 999, fontSize: 12, background: bg, color })

export default function BlockRequests() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(new Set())
  const [acting, setActing] = useState(new Set())

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('auth_user') || '{}') } catch { return {} }
  })()
  const role = user?.role
  const userId = user?.id

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/pending`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load requests')
      setRows(data.requests || [])
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load block requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const canCancelRow = (r) => {
    if (role === 'sales_manager') return true
    if (role === 'property_consultant') return r.requested_by === userId
    return false
  }

  const canFM = role === 'financial_manager'
  const isSM = role === 'sales_manager'
  const isTM = ['ceo','chairman','vice_chairman','top_management'].includes(role)

  async function cancelRequest(id) {
    try {
      setCancelling(s => new Set([...s, id]))
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/${id}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '' }) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to cancel')
      notifySuccess('Request cancelled')
      setRows(rs => rs.filter(r => r.id !== id))
    } catch (e) {
      notifyError(e, 'Unable to cancel request')
    } finally {
      setCancelling(s => {
        const n = new Set(s); n.delete(id); return n
      })
    }
  }

  async function fmDecision(id, action) {
    try {
      const reason = window.prompt(`Enter ${action} reason (optional):`, '') || ''
      setActing(s => new Set([...s, id]))
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || `Failed to ${action}`)
      notifySuccess(`Request ${action}ed`)
      setRows(rs => rs.filter(r => r.id !== id))
    } catch (e) {
      notifyError(e, `Unable to ${action} request`)
    } finally {
      setActing(s => {
        const n = new Set(s); n.delete(id); return n
      })
    }
  }

  async function overrideAction(id, endpoint) {
    try {
      setActing(s => new Set([...s, id]))
      const url = `${API_URL}/api/blocks/${id}/${endpoint}`
      const resp = await fetchWithAuth(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: '' }) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || `Failed to ${endpoint.replace('-', ' ')}`)
      notifySuccess(`Override ${endpoint.replace('-', ' ')} successful`)
      // Refresh list to reflect new override_status
      await load()
    } catch (e) {
      notifyError(e, `Unable to ${endpoint.replace('-', ' ')} request`)
    } finally {
      setActing(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  function renderOverrideHints(r) {
    const st = String(r.override_status || '').toLowerCase()
    const fin = String(r.financial_decision || '').toUpperCase()
    const items = []
    if (fin === 'ACCEPT') {
      items.push(<span key="fin-accept" style={badge('#ecfdf5', '#065f46')}>Financial: ACCEPT</span>)
    } else if (fin) {
      items.push(<span key="fin-reject" style={badge('#fef2f2', '#991b1b')}>Financial: REJECT</span>)
    } else {
      items.push(<span key="fin-unknown" style={badge('#f8fafc', '#334155')}>Financial: Unknown</span>)
    }

    if (st) {
      const map = {
        pending_sm: { label: 'Override: Pending SM', bg: '#eff6ff', color: '#1e40af' },
        pending_fm: { label: 'Override: Pending FM', bg: '#eff6ff', color: '#1e40af' },
        pending_tm: { label: 'Override: Pending TM', bg: '#eff6ff', color: '#1e40af' },
        approved: { label: 'Override: Approved', bg: '#ecfdf5', color: '#065f46' },
        rejected: { label: 'Override: Rejected', bg: '#fef2f2', color: '#991b1b' }
      }
      const m = map[st] || { label: `Override: ${st}`, bg: '#f8fafc', color: '#334155' }
      items.push(<span key="ov-status" style={badge(m.bg, m.color)}>{m.label}</span>)
    }
    return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{items}</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Pending Unit Block Requests</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <LoadingButton onClick={load} loading={loading} style={btn}>Refresh</LoadingButton>
        </div>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>Unit</th>
              <th style={th}>Requested By</th>
              <th style={th}>Duration</th>
              <th style={th}>Reason</th>
              <th style={th}>Requested</th>
              <th style={th}>Override</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td style={td} colSpan={8}>Loading…</td></tr>
            )}
            {!loading && rows.map(r => {
              const st = String(r.override_status || '').toLowerCase()
              return (
                <tr key={r.id}>
                  <td style={td}>{r.id}</td>
                  <td style={td}>{r.unit_code} — {r.unit_type}</td>
                  <td style={td}>{r.requested_by_email}</td>
                  <td style={td}>{r.duration_days}</td>
                  <td style={td}>{r.reason || '-'}</td>
                  <td style={td}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                  <td style={td}>{renderOverrideHints(r)}</td>
                  <td style={{ ...td, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {/* Normal FM decision buttons */}
                    {canFM && (
                      <>
                        <LoadingButton
                          onClick={() => fmDecision(r.id, 'approve')}
                          loading={acting.has(r.id)}
                          style={{ ...btn, border: '1px solid #16a34a', color: '#16a34a' }}
                          title="Approve block (requires financial ACCEPT or TM override approved)"
                        >
                          Approve
                        </LoadingButton>
                        <LoadingButton
                          onClick={() => fmDecision(r.id, 'reject')}
                          loading={acting.has(r.id)}
                          style={{ ...btn, border: '1px solid #dc2626', color: '#dc2626' }}
                        >
                          Reject
                        </LoadingButton>
                      </>
                    )}
                    {/* Override chain buttons */}
                    {isSM && st === 'pending_sm' && (
                      <LoadingButton
                        onClick={() => overrideAction(r.id, 'override-sm')}
                        loading={acting.has(r.id)}
                        style={{ ...btn, border: '1px solid #1e40af', color: '#1e40af' }}
                        title="Approve override (Sales Manager) → moves to FM"
                      >
                        SM Approve Override
                      </LoadingButton>
                    )}
                    {canFM && st === 'pending_fm' && (
                      <LoadingButton
                        onClick={() => overrideAction(r.id, 'override-fm')}
                        loading={acting.has(r.id)}
                        style={{ ...btn, border: '1px solid #1e40af', color: '#1e40af' }}
                        title="Approve override (Financial Manager) → moves to TM"
                      >
                        FM Approve Override
                      </LoadingButton>
                    )}
                    {isTM && (st === 'pending_tm' || st === 'pending_sm' || st === 'pending_fm') && (
                      <LoadingButton
                        onClick={() => overrideAction(r.id, 'override-tm')}
                        loading={acting.has(r.id)}
                        style={{ ...btn, border: '1px solid #1e40af', color: '#1e40af' }}
                        title="TM can approve override directly (bypass recorded if SM/FM not approved)"
                      >
                        TM Approve Override
                      </LoadingButton>
                    )}
                    {(isSM || canFM || isTM) && st && st !== 'approved' && st !== 'rejected' && (
                      <LoadingButton
                        onClick={() => overrideAction(r.id, 'override-reject')}
                        loading={acting.has(r.id)}
                        style={{ ...btn, border: '1px solid #991b1b', color: '#991b1b' }}
                        title="Reject override"
                      >
                        Reject Override
                      </LoadingButton>
                    )}
                    {canCancelRow(r) && (
                      <LoadingButton
                        onClick={() => cancelRequest(r.id)}
                        loading={cancelling.has(r.id)}
                        style={{ ...btn, border: '1px solid #9ca3af', color: '#374151' }}
                      >
                        Cancel
                      </LoadingButton>
                    )}
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr><td style={td} colSpan={8}>No pending block requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}