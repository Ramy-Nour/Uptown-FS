import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { th, td, btn, btnPrimary, tableWrap, table, pageContainer, pageTitle, metaText, errorText } from '../lib/ui.js'
import LoadingButton from '../components/LoadingButton.jsx'
import SkeletonRow from '../components/SkeletonRow.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import ConfirmModal from '../components/ConfirmModal.jsx'
import PromptModal from '../components/PromptModal.jsx'
import UnitDetailsDrawer from '../components/UnitDetailsDrawer.jsx'

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

export default function InventoryChanges() {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(0)
  const [promptRejectId, setPromptRejectId] = useState(0)
  const [status, setStatus] = useState('pending_approval')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsUnit, setDetailsUnit] = useState(null)

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
      if (status) q.set('status', status)
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/changes?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load change requests')
      setChanges(data.changes || [])
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load change requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status])

  async function approve(id) {
    setBusyId(id)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/changes/${id}/approve`, { method: 'PATCH' })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Approve failed')
      setChanges(list => list.filter(c => c.id !== id))
      notifySuccess('Change approved')
    } catch (e) {
      notifyError(e, 'Approve failed')
    } finally {
      setBusyId(0)
    }
  }

  async function reject(id, reason) {
    setBusyId(id)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/changes/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || '' })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Reject failed')
      setChanges(list => list.filter(c => c.id !== id))
      notifySuccess('Change rejected')
    } catch (e) {
      notifyError(e, 'Reject failed')
    } finally {
      setBusyId(0)
    }
  }

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>Inventory Change Requests (Financial Manager)</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label style={metaText}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6eaf0' }}>
            <option value="pending_approval">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
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
                <th style={th}>Requested By</th>
                <th style={th}>Requested At</th>
                <th style={th}>Payload</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonRow key={i} widths={['sm','lg','sm','lg','lg','xl','lg']} tdStyle={td} />
                  ))}
                </>
              )}
              {!loading && changes.map(ch => (
                <tr key={ch.id}>
                  <td style={td}>{ch.id}</td>
                  <td style={td}>{ch.unit_code ? `${ch.unit_code}` : `#${ch.unit_id}`}</td>
                  <td style={td}>{ch.action}</td>
                  <td style={td}>{ch.requested_by_email || '-'}</td>
                  <td style={td}>{(ch.created_at || '').replace('T',' ').replace('Z','')}</td>
                  <td style={td}>{renderPayload(ch.payload)}</td>
                  <td style={td}>
                    <LoadingButton
                      onClick={() => {
                        setDetailsUnit({ id: ch.unit_id, code: ch.unit_code || `#${ch.unit_id}`, unit_status: ch.unit_status })
                        setDetailsOpen(true)
                      }}
                    >
                      Details
                    </LoadingButton>
                    <LoadingButton disabled={busyId === ch.id} onClick={() => approve(ch.id)} loading={busyId === ch.id} variant="primary">Approve</LoadingButton>
                    <LoadingButton disabled={busyId === ch.id} onClick={() => setPromptRejectId(ch.id)} loading={busyId === ch.id} style={btn}>Reject</LoadingButton>
                  </td>
                </tr>
              ))}
              {changes.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={7}>No pending change requests.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p style={metaText}>Change requests are submitted by Financial Admin on approved units. Approving an update applies the proposed fields; approving a delete removes the unit.</p>
      </div>
      <PromptModal
        open={!!promptRejectId}
        title="Reject Change Request"
        message="Optionally provide a reason for rejection:"
        placeholder="Reason (optional)"
        confirmText="Reject"
        cancelText="Cancel"
        onSubmit={(val) => { const id = promptRejectId; setPromptRejectId(0); reject(id, val || '') }}
        onCancel={() => setPromptRejectId(0)}
      />
      <UnitDetailsDrawer unit={detailsUnit} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
    </div>
  )
}