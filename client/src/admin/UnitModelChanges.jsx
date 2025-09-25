import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { pageContainer, pageTitle, tableWrap, table, th, td, ctrl, btn, btnPrimary, btnDanger, metaText, errorText } from '../lib/ui.js'

export default function UnitModelChanges() {
  const [changes, setChanges] = useState([])
  const [status, setStatus] = useState('pending_approval')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rejectReason, setRejectReason] = useState({})
  const me = JSON.parse(localStorage.getItem('auth_user') || '{}')
  const role = me?.role
  const isTop = role === 'ceo' || role === 'chairman' || role === 'vice_chairman'

  async function load() {
    try {
      setLoading(true); setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes?status=${encodeURIComponent(status)}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load changes')
      setChanges(data.changes || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status])

  async function approveChange(id) {
    if (!isTop) return alert('Only Top Management can approve.')
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes/${id}/approve`, { method: 'PATCH' })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Approve failed')
      await load()
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  async function rejectChange(id) {
    if (!isTop) return alert('Only Top Management can reject.')
    const reason = (rejectReason[id] || '').trim()
    if (!reason) return alert('Please provide a reason for rejection')
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Reject failed')
      setRejectReason(s => ({ ...s, [id]: '' }))
      await load()
    } catch (e) {
      alert(e.message || String(e))
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={pageTitle}>Unit Model Changes</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={status} onChange={e => setStatus(e.target.value)} style={ctrl}>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {error ? <p style={errorText}>{error}</p> : null}
        {loading ? <p style={metaText}>Loading…</p> : null}

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Action</th>
                <th style={th}>Model ID</th>
                <th style={th}>Requested By</th>
                <th style={th}>Approved By</th>
                <th style={th}>Reason</th>
                <th style={th}>Requested At</th>
                <th style={th}>Updated At</th>
                <th style={th}>Payload</th>
                {status === 'pending_approval' && isTop ? <th style={th}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {changes.map(ch => (
                <tr key={ch.id}>
                  <td style={td}>{ch.id}</td>
                  <td style={td}>{ch.action}</td>
                  <td style={td}>{ch.model_id || '—'}</td>
                  <td style={td}>{ch.requested_by_email || ch.requested_by}</td>
                  <td style={td}>{ch.approved_by_email || (ch.approved_by || '—')}</td>
                  <td style={td}>{ch.reason || '—'}</td>
                  <td style={td}>{ch.created_at ? new Date(ch.created_at).toLocaleString() : ''}</td>
                  <td style={td}>{ch.updated_at ? new Date(ch.updated_at).toLocaleString() : ''}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {(() => {
                      const src = ch.payload || {}
                      const cleaned = {}
                      for (const [k, v] of Object.entries(src)) {
                        if (k === 'garage_standard_code') continue
                        if (v === null || v === undefined || v === '') continue
                        cleaned[k] = v
                      }
                      return JSON.stringify(cleaned, null, 2)
                    })()}
                  </td>
                  {status === 'pending_approval' && isTop ? (
                    <td style={td}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <button onClick={() => approveChange(ch.id)} style={btnPrimary}>Approve</button>
                        <div>
                          <input
                            placeholder="Reason (required to reject)"
                            value={rejectReason[ch.id] || ''}
                            onChange={e => setRejectReason(s => ({ ...s, [ch.id]: e.target.value }))}
                            style={{ ...ctrl, width: '100%' }}
                          />
                          <button onClick={() => rejectChange(ch.id)} style={{ ...btnDanger, marginTop: 6 }}>Reject</button>
                        </div>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {changes.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={status === 'pending_approval' && isTop ? 10 : 9}>No changes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 8 }}>
          <span style={metaText}>
            Only CEO, Chairman, or Vice Chairman can approve or reject changes. All timestamps and reasons are preserved.
          </span>
        </div>
      </div>
    </div>
  )
}