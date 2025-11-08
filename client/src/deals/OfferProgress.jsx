import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'

const BRAND = { primary: '#A97E34', primaryDark: '#8B672C', muted: '#d1d5db' }
const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }
const badge = (bg, color) => ({ padding: '4px 8px', borderRadius: 999, fontSize: 12, background: bg, color })

function ProgressTrain({ status }) {
  // steps: Blocked -> Reserved -> Contracted
  const steps = [
    { key: 'blocked', label: 'Blocked' },
    { key: 'reserved', label: 'Reserved' },
    { key: 'contracted', label: 'Contracted' }
  ]
  const idx = status === 'contracted' ? 2 : status === 'reserved' ? 1 : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {steps.map((s, i) => {
        const active = i <= idx
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 999,
              background: active ? BRAND.primary : '#e5e7eb',
              border: `2px solid ${active ? BRAND.primaryDark : '#e5e7eb'}`
            }} />
            <div style={{ fontSize: 12, color: active ? BRAND.primaryDark : '#64748b', minWidth: 70 }}>{s.label}</div>
            {i < steps.length - 1 && (
              <div style={{
                width: 60, height: 4,
                background: (i < idx) ? BRAND.primary : '#e5e7eb',
                borderRadius: 4
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function OverrideBadges({ r }) {
  const fin = String(r.block_financial_decision || '').toUpperCase()
  const st = String(r.block_override_status || '').toLowerCase()
  const items = []
  if (fin === 'ACCEPT') {
    items.push(<span key="fin-accept" style={badge('#ecfdf5', '#065f46')}>Financial: ACCEPT</span>)
  } else if (fin === 'REJECT') {
    items.push(<span key="fin-reject" style={badge('#fef2f2', '#991b1b')}>Financial: REJECT</span>)
  }
  if (st) {
    const map = {
      pending_sm: { label: 'Override: Pending SM', bg: '#eff6ff', color: '#1e40af' },
      pending_fm: { label: 'Override: Pending FM', bg: '#eff6ff', color: '#1e40af' },
      pending_tm: { label: 'Override: Pending TM', bg: '#eff6ff', color: '#1e40af' },
      approved: { label: 'Override: Approved', bg: '#ecfdf5', color: '#065f46' },
      rejected: { label: 'Override: Rejected', bg: '#fef2f2', color: '#991b1b' }
    }
    const m = map[st] || { label: `Override: ${st}`, bg: '#f8fafc', color: '#334155' }
    items.push(<span key="ov-status" style={badge(m.bg, m.color)}>{m.label}</span>)
  }
  if (!items.length) return <span style={{ color: '#64748b' }}>—</span>
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{items}</div>
}

export default function OfferProgress() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/progress`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load progress')
      setRows(data.items || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function computeStatus(r) {
    if (r.contract_status === 'approved') return 'contracted'
    if (r.reservation_status === 'approved') return 'reserved'
    if (r.block_status === 'approved') return 'blocked'
    return 'blocked'
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Offer Progress</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={loading} style={btn}>Refresh</button>
        </div>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Unit</th>
              <th style={th}>Unit Status</th>
              <th style={th}>Block</th>
              <th style={th}>Reservation</th>
              <th style={th}>Contract</th>
              <th style={th}>Override</th>
              <th style={th}>Progress</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && rows.map(r => (
              <tr key={`${r.unit_id}-${r.block_id || 'n'}`}>
                <td style={td}>{r.unit_code}</td>
                <td style={td}>{r.unit_status}</td>
                <td style={td}>{r.block_status || '-'}</td>
                <td style={td}>{r.reservation_status || '-'}</td>
                <td style={td}>{r.contract_status || '-'}</td>
                <td style={td}><OverrideBadges r={r} /></td>
                <td style={td}><ProgressTrain status={computeStatus(r)} /></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td style={td} colSpan={7}>No items to display.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}