import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { th, td, btn, btnPrimary, tableWrap, table, pageContainer, pageTitle, metaText, errorText } from '../lib/ui.js'
import LoadingButton from '../components/LoadingButton.jsx'
import SkeletonRow from '../components/SkeletonRow.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import ConfirmModal from '../components/ConfirmModal.jsx'
import PromptModal from '../components/PromptModal.jsx'

export default function InventoryDrafts() {
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(0)
  // Removed linkMap: model linking requests are disabled; units are created already linked to a model

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
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/drafts`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load drafts')
      const list = data.units || []
      setUnits(list)

      // Model linking requests are disabled; units are created already linked to a model.
      // No additional fetch required here.
    } catch (e) {
      const msg = e.message || String(e)
      setError(msg)
      notifyError(e, 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const [confirmApproveId, setConfirmApproveId] = useState(0)
  const [promptRejectId, setPromptRejectId] = useState(0)

  async function approve(id) {
    setConfirmApproveId(id)
  }

  async function performApprove(id) {
    setBusyId(id)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/${id}/approve`, { method: 'PATCH' })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Approve failed')
      setUnits(list => list.filter(u => u.id !== id))
      notifySuccess('Unit approved')
    } catch (e) {
      notifyError(e, 'Approve failed')
    } finally {
      setBusyId(0)
    }
  }

  function reject(id) {
    setPromptRejectId(id)
  }

  async function performReject(id, reason) {
    setBusyId(id)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Reject failed')
      setUnits(list => list.filter(u => u.id !== id))
      notifySuccess('Unit rejected')
    } catch (e) {
      notifyError(e, 'Reject failed')
    } finally {
      setBusyId(0)
    }
  }

  // Removed renderLinkCell: drafts now show direct model info from API

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>Inventory Drafts Approval (Top Management)</h2>
        {error ? <p style={errorText}>{error}</p> : null}
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Code</th>
                <th style={th}>Unit Model</th>
                <th style={th}>Created By</th>
                <th style={th}>Status</th>
                <th style={th}>Created At</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonRow key={i} widths={['sm','lg','lg','lg','sm','lg','lg']} tdStyle={td} />
                  ))}
                </>
              )}
              {!loading && units.map(u => (
                <tr key={u.id}>
                  <td style={td}>{u.id}</td>
                  <td style={td}>{u.code}</td>
                  <td style={td}>{u.model_code ? `${u.model_code} — ${u.model_name || ''}`.trim() : (u.model_name || (u.model_id ? `#${u.model_id}` : '-'))}</td>
                  <td style={td}>{u.created_by_email || '-'}</td>
                  <td style={td}>{u.unit_status}</td>
                  <td style={td}>{(u.created_at || '').replace('T', ' ').replace('Z', '')}</td>
                  <td style={td}>
                    <LoadingButton disabled={busyId === u.id} onClick={() => approve(u.id)} loading={busyId === u.id} variant="primary">Approve</LoadingButton>
                    <LoadingButton disabled={busyId === u.id} onClick={() => reject(u.id)} loading={busyId === u.id} style={btn}>Reject</LoadingButton>
                  </td>
                </tr>
              ))}
              {units.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={8}>No drafts awaiting approval.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p style={metaText}>
          Notes: Draft units are created by CRM Admin already linked to a Unit Model with approved standard pricing. Once approved by Top Management, they become AVAILABLE.
        </p>
      </div>
      <ConfirmModal
        open={!!confirmApproveId}
        title="Approve Draft Unit"
        message="Approve this draft unit and mark it AVAILABLE?"
        confirmText="Approve"
        cancelText="Cancel"
        onConfirm={() => { const id = confirmApproveId; setConfirmApproveId(0); performApprove(id) }}
        onCancel={() => setConfirmApproveId(0)}
      />
      <PromptModal
        open={!!promptRejectId}
        title="Reject Draft Unit"
        message="Optionally provide a reason for rejection:"
        placeholder="Reason (optional)"
        confirmText="Reject"
        cancelText="Cancel"
        onSubmit={(val) => { const id = promptRejectId; setPromptRejectId(0); performReject(id, val || '') }}
        onCancel={() => setPromptRejectId(0)}
      />
    </div>
  )
}