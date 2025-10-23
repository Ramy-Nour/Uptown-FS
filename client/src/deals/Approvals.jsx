import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import LoadingButton from '../components/LoadingButton.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import PromptModal from '../components/PromptModal.jsx'

const th = {
  textAlign: 'left',
  padding: 10,
  borderBottom: '1px solid #eef2f7',
  fontSize: 13,
  color: '#475569',
  background: '#f9fbfd'
}

const td = {
  padding: 10,
  borderBottom: '1px solid #f2f5fa',
  fontSize: 14
}

export default function Approvals() {
  const [deals, setDeals] = useState([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(0)
  const [promptRejectId, setPromptRejectId] = useState(0)

  // Timeline modal state
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelineDeal, setTimelineDeal] = useState(null)
  const [timelineHistory, setTimelineHistory] = useState([])
  const [timelineLoading, setTimelineLoading] = useState(false)

  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  const role = user?.role || 'user'

  useEffect(() => {
    async function load() {
      try {
        setError('')
        const resp = await fetchWithAuth(`${API_URL}/api/deals/pending-sm`)
        const data = await resp.json()
        if (!resp.ok) throw new Error(data?.error?.message || 'Unable to load deals')
        setDeals(data.deals || [])
      } catch (e) {
        const msg = e.message || String(e)
        setError(msg)
        notifyError(e, 'Unable to load deals')
      }
    }
    load()

    // Real-time updates: listen for 'deal_submitted' notifications
    try {
      const authUserRaw = localStorage.getItem('auth_user')
      const authUser = authUserRaw ? JSON.parse(authUserRaw) : null
      const userId = authUser?.id || null
      // Initialize socket and listen for notifications
      // Dynamically import to avoid bundling issues if not needed elsewhere
      import('../socket.js').then(mod => {
        const sock = mod.initSocket(userId)
        const handler = (notif) => {
          if (notif?.type === 'deal_submitted') {
            // Refetch pending deals list
            load()
          }
        }
        sock.on('notification', handler)
        // Cleanup
        return () => {
          sock.off('notification', handler)
        }
      }).catch(() => {})
    } catch {}
  }, [])

  async function approve(id) {
    setBusyId(id)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/approve`, { method: 'POST' })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Unable to approve deal')
      setDeals(ds => ds.filter(d => d.id !== id))
      notifySuccess('Deal approved successfully.')
    } catch (e) {
      notifyError(e, 'Unable to approve deal')
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
      const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Unable to reject deal')
      setDeals(ds => ds.filter(d => d.id !== id))
      notifySuccess('Deal rejected successfully.')
    } catch (e) {
      notifyError(e, 'Unable to reject deal')
    } finally {
      setBusyId(0)
    }
  }

  // Helpers: render timeline badge; compute status badge
  function TimelineBadge({ deal }) {
    const stages = [
      { key: 'requested', label: 'Req', ts: deal?.override_requested_at, title: deal?.override_requested_at ? `Requested at ${new Date(deal.override_requested_at).toLocaleString()}` : 'Requested (pending)' },
      { key: 'sm', label: 'SM', ts: deal?.manager_review_at, title: deal?.manager_review_at ? `SM reviewed at ${new Date(deal.manager_review_at).toLocaleString()} by ${deal?.manager_review_by_email || ''}` : 'Sales Manager (pending)' },
      { key: 'fm', label: 'FM', ts: deal?.fm_review_at, title: deal?.fm_review_at ? `FM reviewed at ${new Date(deal.fm_review_at).toLocaleString()} by ${deal?.fm_review_by_email || ''}` : 'Financial Manager (pending)' },
      { key: 'tm', label: 'TM', ts: deal?.override_approved_at, title: deal?.override_approved_at ? `TM decision at ${new Date(deal.override_approved_at).toLocaleString()} by ${deal?.override_approved_by_email || ''}` : 'Top Management (pending)' }
    ]
    const activeIdx = stages.findIndex(s => !!s.ts)
    const circle = (active) => ({
      width: 10, height: 10, borderRadius: 9999,
      background: active ? '#A97E34' : '#e5e7eb',
      border: `2px solid ${active ? '#A97E34' : '#d1d5db'}`
    })
    const line = (active) => ({
      height: 2, width: 16, background: active ? '#A97E34' : '#e5e7eb'
    })
    const statusLabel = (() => {
      if (deal?.override_approved_at) return 'Override Approved'
      if (deal?.fm_review_at) return 'Awaiting TM'
      if (deal?.manager_review_at) return 'Awaiting FM'
      if (deal?.override_requested_at) return 'Awaiting SM'
      return 'No Override'
    })()
    const statusStyle = {
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: 9999,
      background: '#fffbeb',
      border: '1px solid #f59e0b',
      color: '#92400e',
      fontSize: 12,
      marginRight: 8
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={statusStyle}>{statusLabel}</span>
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          onClick={() => openTimeline(deal)}
          title="Click to view full audit timeline"
        >
          {stages.map((s, i) => (
            <React.Fragment key={s.key}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <div style={circle(i <= activeIdx)} title={s.title} />
                <div style={{ fontSize: 10, color: i <= activeIdx ? '#A97E34' : '#6b7280' }} title={s.title}>{s.label}</div>
              </div>
              {i < stages.length - 1 && <div style={line(i < activeIdx)} />}
            </React.Fragment>
          ))}
        </span>
      </span>
    )
  }

  async function openTimeline(deal) {
    try {
      setTimelineDeal(deal)
      setTimelineOpen(true)
      setTimelineLoading(true)
      const resp = await fetchWithAuth(`${API_URL}/api/deals/${deal.id}/history`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load history')
      setTimelineHistory(data.history || [])
    } catch (e) {
      notifyError(e, 'Failed to load history')
    } finally {
      setTimelineLoading(false)
    }
  }

  if (!(role === 'sales_manager' || role === 'admin')) {
    return <p>Access denied. Sales Manager role required.</p>
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Pending Approvals</h2>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>ID</th>
              <th style={th}>Title</th>
              <th style={th}>Amount</th>
              <th style={th}>Creator</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deals.map(d => (
              <tr key={d.id}>
                <td style={td}>{d.id}</td>
                <td style={td}>{d.title}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {Number(d.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td style={td}>{d.created_by_email || '-'}</td>
                <td style={td}>
                  {/* Override timeline badge with status and clickable audit modal */}
                  <TimelineBadge deal={d} />
                  <LoadingButton disabled={busyId === d.id} onClick={() => approve(d.id)}>
                    Approve
                  </LoadingButton>
                  <LoadingButton
                    disabled={busyId === d.id}
                    onClick={() => reject(d.id)}
                    style={{ marginLeft: 8 }}
                  >
                    Reject
                  </LoadingButton>
                </td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>
                  No pending deals.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Reject Reason Prompt */}
      <PromptModal
        open={!!promptRejectId}
        title="Reject Deal"
        message="Optionally provide a reason for rejection:"
        placeholder="Reason (optional)"
        confirmText="Reject"
        cancelText="Cancel"
        onSubmit={(val) => {
          const id = promptRejectId
          setPromptRejectId(0)
          performReject(id, val || '')
        }}
        onCancel={() => setPromptRejectId(0)}
      />

      {/* Timeline Audit Modal */}
      {timelineOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: 720, maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0 }}>Override Audit Timeline — Deal #{timelineDeal?.id}</h3>
              <LoadingButton onClick={() => { setTimelineOpen(false); setTimelineDeal(null); setTimelineHistory([]) }}>Close</LoadingButton>
            </div>
            <p style={{ color: '#6b7280', marginTop: 4 }}>Click any row to view JSON details (when available).</p>

            {/* Reuse the same timeline visual at top */}
            {timelineDeal && (
              <div style={{ marginTop: 8, padding: 10, border: '1px dashed #d1d9e6', borderRadius: 10 }}>
                {(() => {
                  const d = timelineDeal
                  const stages = [
                    { key: 'requested', label: 'Requested', ts: d?.override_requested_at },
                    { key: 'sm', label: 'Sales Manager', ts: d?.manager_review_at },
                    { key: 'fm', label: 'Financial Manager', ts: d?.fm_review_at },
                    { key: 'tm', label: 'Top Management', ts: d?.override_approved_at }
                  ]
                  const activeIdx = stages.findIndex(s => !!s.ts)
                  const circle = (active) => ({
                    width: 16, height: 16, borderRadius: 9999,
                    background: active ? '#A97E34' : '#e5e7eb',
                    border: `2px solid ${active ? '#A97E34' : '#d1d5db'}`
                  })
                  const line = (active) => ({
                    height: 2, flex: 1, background: active ? '#A97E34' : '#e5e7eb'
                  })
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {stages.map((s, i) => (
                        <React.Fragment key={s.key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={circle(i <= activeIdx)} />
                            <div style={{ fontSize: 13, color: i <= activeIdx ? '#A97E34' : '#6b7280' }}>
                              {s.label}{s.ts ? ` (${new Date(s.ts).toLocaleString()})` : ''}
                            </div>
                          </div>
                          {i < stages.length - 1 && <div style={line(i < activeIdx)} />}
                        </React.Fragment>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* History table */}
            <div style={{ marginTop: 12, border: '1px solid #e6eaf0', borderRadius: 12, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>Action</th>
                    <th style={th}>User</th>
                    <th style={th}>Notes</th>
                    <th style={th}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {timelineLoading ? (
                    <tr><td style={td} colSpan={5}>Loading...</td></tr>
                  ) : (
                    (timelineHistory || []).map((h, idx) => (
                      <tr key={h.id || `${idx}-${h.action}`}>
                        <td style={td}>{idx + 1}</td>
                        <td style={td}>{h.action}</td>
                        <td style={td}>{h.user_email || h.user_id}</td>
                        <td style={td} title={typeof h.notes === 'string' ? h.notes : ''}>
                          {(() => {
                            const raw = h.notes || ''
                            let parsed = null
                            try {
                              if (typeof raw === 'string' && raw.trim().startsWith('{')) parsed = JSON.parse(raw)
                            } catch {}
                            if (!parsed) return raw
                            return (
                              <details>
                                <summary>Details</summary>
                                <pre style={{ background: '#f6f8fa', padding: 8, borderRadius: 6, border: '1px solid #eef2f7', marginTop: 6, maxWidth: 640, overflow: 'auto' }}>
{JSON.stringify(parsed, null, 2)}
                                </pre>
                              </details>
                            )
                          })()}
                        </td>
                        <td style={td}>{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</td>
                      </tr>
                    ))
                  )}
                  {(!timelineLoading && (!timelineHistory || timelineHistory.length === 0)) && (
                    <tr><td style={td} colSpan={5}>No audit events.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}