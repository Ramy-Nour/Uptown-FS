import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { th, td, btn, tableWrap, table, pageContainer, pageTitle, metaText, errorText } from '../lib/ui.js'
import LoadingButton from '../components/LoadingButton.jsx'
import SkeletonRow from '../components/SkeletonRow.jsx'
import { notifyError } from '../lib/notifications.js'

function renderPayload(p) {
  try {
    const obj = typeof p === 'string' ? JSON.parse(p) : (p || {})
    const entries = Object.entries(obj)
    if (!entries.length) return '-'
    return (
      <div style={{ fontSize: 12, color: '#334155' }}>
        {entries.map(([k, v]) => (
          <div key={k}><strong>{k}:</strong> {v == null ? 'null' : String(v)}</div>
        ))}
      </div>
    )
  } catch {
    return String(p || '-')
  }
}

export default function InventoryChangeHistory() {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('all')

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

  async function load() {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      q.set('mine', '1')
      if (status) q.set('status', status)
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/changes?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load my change requests')
      setChanges(data.changes || [])
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load my change requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status])

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>My Inventory Change Requests</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label style={metaText}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6eaf0' }}>
            <option value="all">All</option>
            <option value="pending_approval">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <LoadingButton onClick={load}>Refresh</LoadingButton>
        </div>
        {error ? <p style={errorText}>{error}</p> : null}
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Unit</th>
                <th style={th}>Action</th>
                <th style={th}>Status</th>
                <th style={th}>Submitted</th>
                <th style={th}>Processed By</th>
                <th style={th}>Reason</th>
                <th style={th}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonRow key={i} widths={['sm','lg','sm','sm','lg','lg','lg','xl']} tdStyle={td} />
                  ))}
                </>
              )}
              {!loading && changes.map(ch => (
                <tr key={ch.id}>
                  <td style={td}>{ch.id}</td>
                  <td style={td}>{ch.unit_code ? `${ch.unit_code}` : `#${ch.unit_id}`}</td>
                  <td style={td}>{ch.action}</td>
                  <td style={td}>{ch.status}</td>
                  <td style={td}>{(ch.created_at || '').replace('T',' ').replace('Z','')}</td>
                  <td style={td}>{ch.approved_by_email || '-'}</td>
                  <td style={td}>{ch.reason || '-'}</td>
                  <td style={td}>{renderPayload(ch.payload)}</td>
                </tr>
              ))}
              {changes.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={8}>No requests.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p style={metaText}>This list shows your inventory change requests across all statuses for audit and traceability.</p>
      </div>
    </div>
  )
}