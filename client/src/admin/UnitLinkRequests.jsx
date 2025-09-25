import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { pageContainer, pageTitle, ctrl, btn, btnPrimary, table, tableWrap, th, td, metaText, errorText } from '../lib/ui.js'

export default function UnitLinkRequests() {
  const [links, setLinks] = useState([])
  const [statusFilter, setStatusFilter] = useState('pending_approval')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      q.set('status', statusFilter)
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-link-requests?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load link requests')
      setLinks(data.links || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])

  async function approve(id) {
    if (!confirm('Approve this link request?')) return
    const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-link-requests/${id}/approve`, { method: 'PATCH' })
    const data = await resp.json()
    if (!resp.ok) {
      alert(data?.error?.message || 'Approve failed')
    } else {
      load()
    }
  }

  async function reject(id) {
    const reason = prompt('Optional: provide a reason for rejection', '')
    const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-link-requests/${id}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || null })
    })
    const data = await resp.json()
    if (!resp.ok) {
      alert(data?.error?.message || 'Reject failed')
    } else {
      load()
    }
  }

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

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>Inventory Link Requests</h2>
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={metaText}>Filter by status:</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={ctrl}>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button onClick={load} disabled={loading} style={btn}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        {error ? <div style={errorText}>{error}</div> : null}

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Unit</th>
                <th style={th}>Model</th>
                <th style={th}>Requested By</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.map(l => (
                <tr key={l.id}>
                  <td style={td}>{l.id}</td>
                  <td style={td}>{l.unit_code} — {l.unit_description || ''}</td>
                  <td style={td}>{l.model_code ? `${l.model_code} — ` : ''}{l.model_name}</td>
                  <td style={td}>{l.requested_by || ''}</td>
                  <td style={td}>{l.status}</td>
                  <td style={td}>
                    {l.status === 'pending_approval' ? (
                      <>
                        <button onClick={() => approve(l.id)} style={btnPrimary}>Approve</button>
                        <button onClick={() => reject(l.id)} style={btn}>Reject</button>
                      </>
                    ) : (
                      <span style={metaText}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {links.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={6}>No items.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}