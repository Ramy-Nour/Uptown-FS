import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import LoadingButton from '../components/LoadingButton.jsx'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

export default function PaymentPlanEdits() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(new Set())
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/my`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load payment plans')
      const items = (data.payment_plans || []).filter(p => {
        const meta = (p.details && p.details.meta) || {}
        return !!meta.pending_edit_request
      })
      setRows(items)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function lastEditRequest(plan) {
    const meta = (plan.details && plan.details.meta) || {}
    const edits = Array.isArray(meta.edit_requests) ? meta.edit_requests : []
    return edits.length ? edits[edits.length - 1] : null
  }

  async function markEditsAddressed(id) {
    try {
      const notes = window.prompt('Optional notes about the edits you made:', '') || ''
      setActing(s => new Set([...s, id]))
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/${id}/edits-addressed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to mark edits addressed')
      setRows(rs => rs.filter(r => r.id !== id))
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setActing(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  async function createNewVersion(id) {
    try {
      if (!window.confirm('Create a new version of this plan?')) return
      setActing(s => new Set([...s, id]))
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/${id}/new-version`, { method: 'POST' })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to create new version')
      alert(`New version created (#${data?.payment_plan?.id}). You can continue editing it from your deals flow.`)
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setActing(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Payment Plans — Edit Requests</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <LoadingButton onClick={load} loading={loading} style={btn}>Refresh</LoadingButton>
        </div>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Plan ID</th>
              <th style={th}>Version</th>
              <th style={th}>Requested By</th>
              <th style={th}>Reason</th>
              <th style={th}>Fields</th>
              <th style={th}>Requested At</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && rows.map(p => {
              const last = lastEditRequest(p) || {}
              const fields = Array.isArray(last.fields) ? last.fields.join(', ') : ''
              const unitId = Number(p?.details?.calculator?.unitInfo?.unit_id) || 0
              return (
                <tr key={p.id}>
                  <td style={td}>{p.id}</td>
                  <td style={td}>{p.version || 1}</td>
                  <td style={td}>{last.by_role || '-'}</td>
                  <td style={td}>{last.reason || '-'}</td>
                  <td style={td}>{fields || '-'}</td>
                  <td style={td}>{last.at ? new Date(last.at).toLocaleString() : '-'}</td>
                  <td style={{ ...td, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {unitId ? (
                      <a
                        href={`/deals/create?unit_id=${unitId}&plan_id=${p.id}`}
                        style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}
                        title="Open Create Deal with this unit preselected"
                      >
                        Open in Create Deal
                      </a>
                    ) : null}
                    <button
                      style={btn}
                      onClick={() => createNewVersion(p.id)}
                      disabled={acting.has(p.id)}
                      title="Create a new version to apply requested edits"
                    >
                      New Version
                    </button>
                    <LoadingButton
                      onClick={() => markEditsAddressed(p.id)}
                      loading={acting.has(p.id)}
                      style={{ ...btn, border: '1px solid #16a34a', color: '#16a34a' }}
                    >
                      Mark Edits Addressed
                    </LoadingButton>
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && <tr><td style={td} colSpan={7}>No pending edit requests.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}