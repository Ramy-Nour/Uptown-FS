import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import LoadingButton from '../components/LoadingButton.jsx'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

export default function ReservationsQueue() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(new Set())
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/reservation-forms?status=pending_approval`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load reservations')
      setRows(data.reservation_forms || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function fmDecision(id, action) {
    try {
      setActing(s => new Set([...s, id]))
      const url = `${API_URL}/api/workflow/reservation-forms/${id}/${action}`
      const resp = await fetchWithAuth(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || `Failed to ${action}`)
      setRows(rs => rs.filter(r => r.id !== id))
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setActing(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  async function requestEdits(paymentPlanId) {
    try {
      const reason = window.prompt('Describe requested edits for the consultant:', '') || ''
      const fieldsStr = window.prompt('Which fields? (comma-separated, optional):', '') || ''
      const fields = fieldsStr.split(',').map(s => s.trim()).filter(Boolean)
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/${paymentPlanId}/request-edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, fields })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to request edits')
      alert('Edit request sent to the consultant.')
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Reservation Forms — Pending Approval</h2>
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
              <th style={th}>Payment Plan</th>
              <th style={th}>Status</th>
              <th style={th}>Reservation Date</th>
              <th style={th}>Preliminary Payment</th>
              <th style={th}>Currency</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && rows.map(r => {
              const d = r.details || {}
              return (
                <tr key={r.id}>
                  <td style={td}>{r.id}</td>
                  <td style={td}>
                    {r.payment_plan_id}{' '}
                    <button style={{ ...btn, marginLeft: 6 }} onClick={() => requestEdits(r.payment_plan_id)}>
                      Request Edits
                    </button>
                  </td>
                  <td style={td}>{r.status}</td>
                  <td style={td}>{d.reservation_date || '-'}</td>
                  <td style={td}>{Number(d.preliminary_payment || 0).toLocaleString()}</td>
                  <td style={td}>{d.currency_override || 'EGP'}</td>
                  <td style={{ ...td, display: 'flex', gap: 8 }}>
                    <LoadingButton
                      onClick={() => fmDecision(r.id, 'approve')}
                      loading={acting.has(r.id)}
                      style={{ ...btn, border: '1px solid #16a34a', color: '#16a34a' }}
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
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && <tr><td style={td} colSpan={7}>No reservations pending approval.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}