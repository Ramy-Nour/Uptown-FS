import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
}

const modalStyle = {
  background: '#fff',
  borderRadius: 12,
  padding: 16,
  width: 640,
  maxWidth: '90vw',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
}

const badge = (bg, color) => ({
  padding: '2px 6px',
  borderRadius: 999,
  fontSize: 11,
  background: bg,
  color
})

function formatTs(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

export default function BlockHistoryModal({ open, unitId, unitCode, onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [events, setEvents] = useState([])

  useEffect(() => {
    if (!open || !unitId) return

    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError('')
        const resp = await fetchWithAuth(`${API_URL}/api/blocks/history?unit_id=${unitId}`)
        const data = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load block history')
        const rows = Array.isArray(data.history) ? data.history : []
        if (cancelled) return
        setEvents(buildEvents(rows))
      } catch (e) {
        if (cancelled) return
        setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [open, unitId])

  if (!open) return null

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>
          Block / Unblock History — Unit {unitCode || unitId}
        </h3>
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 12, color: '#64748b' }}>
          Timeline of block and unblock actions for this unit across all blocks. TM overrides and expiry-based
          unblock requests are annotated explicitly.
        </p>
        {error && <p style={{ color: '#e11d48', fontSize: 13 }}>{error}</p>}
        {loading && <p style={{ fontSize: 13 }}>Loading history…</p>}
        {!loading && !error && events.length === 0 && (
          <p style={{ fontSize: 13, color: '#64748b' }}>No block history recorded for this unit.</p>
        )}
        {!loading && !error && events.length > 0 && (
          <div>
            {events.map((ev, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ width: 160, fontSize: 12, color: '#6b7280' }}>{formatTs(ev.at)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{ev.label}</div>
                  {ev.detail && (
                    <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
                      {ev.detail}
                    </div>
                  )}
                  {ev.badges && ev.badges.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {ev.badges.map((b, i) => (
                        <span key={i} style={badge(b.bg, b.color)}>{b.text}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #d1d9e6',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function buildEvents(rows) {
  const all = []
  for (const row of rows) {
    const blockId = row.id
    const baseRef = `Block #${blockId}`

    if (row.created_at) {
      all.push({
        at: row.created_at,
        label: `${baseRef} requested`,
        detail: `Requested by ${row.requested_by_email || 'Unknown'}` + (row.reason ? ` — Reason: ${row.reason}` : ''),
        badges: []
      })
    }

    if (row.approved_at) {
      const badges = []
      if (row.financial_decision) {
        const fin = String(row.financial_decision).toUpperCase()
        if (fin === 'ACCEPT') {
          badges.push({ text: 'Financial: ACCEPT', bg: '#ecfdf5', color: '#065f46' })
        } else {
          badges.push({ text: `Financial: ${fin}`, bg: '#fef2f2', color: '#991b1b' })
        }
      }
      if (row.override_status) {
        const st = String(row.override_status).toLowerCase()
        const map = {
          pending_sm: { text: 'Override: Pending SM', bg: '#eff6ff', color: '#1e40af' },
          pending_fm: { text: 'Override: Pending FM', bg: '#eff6ff', color: '#1e40af' },
          pending_tm: { text: 'Override: Pending TM', bg: '#eff6ff', color: '#1e40af' },
          approved:   { text: 'Override: Approved', bg: '#ecfdf5', color: '#065f46' },
          rejected:   { text: 'Override: Rejected', bg: '#fef2f2', color: '#991b1b' }
        }
        badges.push(map[st] || { text: `Override: ${st}`, bg: '#f8fafc', color: '#334155' })
      }
      all.push({
        at: row.approved_at,
        label: `${baseRef} approved`,
        detail: `Approved by ${row.approved_by_email || 'Unknown'}`,
        badges
      })
    }

    if (row.rejected_at) {
      all.push({
        at: row.rejected_at,
        label: `${baseRef} rejected`,
        detail: `Rejected by ${row.rejected_by_email || 'Unknown'}` + (row.rejection_reason ? ` — Reason: ${row.rejection_reason}` : ''),
        badges: []
      })
    }

    if (row.extension_count && row.extension_count > 0 && row.last_extended_at) {
      all.push({
        at: row.last_extended_at,
        label: `${baseRef} extended`,
        detail: `Extended by ${row.last_extended_by_email || 'Unknown'} — Total extensions: ${row.extension_count}${row.last_extension_reason ? ` — Reason: ${row.last_extension_reason}` : ''}`,
        badges: []
      })
    }

    if (row.unblock_requested_at) {
      const isExpired = (row.unblock_reason || '').startsWith('Block duration expired')
      const badges = []
      if (isExpired) {
        badges.push({ text: 'Expired block – system-created request', bg: '#fffbeb', color: '#92400e' })
      }
      all.push({
        at: row.unblock_requested_at,
        label: `${baseRef} unblock requested`,
        detail: `Requested by ${row.unblock_requested_by_email || 'Unknown'}` + (row.unblock_reason ? ` — Reason: ${row.unblock_reason}` : ''),
        badges
      })
    }

    if (row.unblock_fm_at) {
      all.push({
        at: row.unblock_fm_at,
        label: `${baseRef} unblock approved by FM`,
        detail: `Financial Manager: ${row.unblock_fm_email || 'Unknown'}`,
        badges: []
      })
    }

    if (row.unblock_tm_at) {
      const isOverride = !row.unblock_fm_id && row.unblock_status === 'approved'
      const badges = []
      if (isOverride) {
        badges.push({ text: 'TM override: FM stage bypassed', bg: '#fee2e2', color: '#b91c1c' })
      } else if (row.unblock_fm_id) {
        badges.push({ text: 'FM approved before TM', bg: '#e0f2fe', color: '#075985' })
      }
      all.push({
        at: row.unblock_tm_at,
        label: `${baseRef} unblock approved by TM`,
        detail: `Top Management: ${row.unblock_tm_email || 'Unknown'}`,
        badges
      })
    }
  }

  all.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0
    const tb = b.at ? new Date(b.at).getTime() : 0
    return ta - tb
  })

  return all
}