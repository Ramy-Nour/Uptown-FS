import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import LoadingButton from '../components/LoadingButton.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

export default function BlockRequests() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(new Set())

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
              <th style={th}>Duration (days)</th>
              <th style={th}>Reason</th>
              <th style={th}>Requested</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td style={td} colSpan={7}>Loading…</td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.id}</td>
                <td style={td}>{r.unit_code} — {r.unit_type}</td>
                <td style={td}>{r.requested_by_email}</td>
                <td style={td}>{r.duration_days}</td>
                <td style={td}>{r.reason || '-'}</td>
                <td style={td}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                <td style={{ ...td, display: 'flex', gap: 8 }}>
                  {canCancelRow(r) ? (
                    <LoadingButton
                      onClick={() => cancelRequest(r.id)}
                      loading={cancelling.has(r.id)}
                      style={{ ...btn, border: '1px solid #dc2626', color: '#dc2626' }}
                    >
                      Cancel
                    </LoadingButton>
                  ) : <span style={{ color: '#64748b' }}>No actions</span>}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td style={td} colSpan={7}>No pending block requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}