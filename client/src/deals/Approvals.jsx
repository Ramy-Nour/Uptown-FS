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
                  {/* Override timeline badge */}
                  {(() => {
                    const stages = [
                      { key: 'requested', label: 'Req', ts: d?.override_requested_at },
                      { key: 'sm', label: 'SM', ts: d?.manager_review_at },
                      { key: 'fm', label: 'FM', ts: d?.fm_review_at },
                      { key: 'tm', label: 'TM', ts: d?.override_approved_at }
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
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
                        {stages.map((s, i) => (
                          <React.Fragment key={s.key}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <div style={circle(i <= activeIdx)} />
                              <div style={{ fontSize: 10, color: i <= activeIdx ? '#A97E34' : '#6b7280' }}>{s.label}</div>
                            </div>
                            {i < stages.length - 1 && <div style={line(i < activeIdx)} />}
                          </React.Fragment>
                        ))}
                      </div>
                    )
                  })()}
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
    </div>
  )
}