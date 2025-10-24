import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

export default function CurrentBlocks() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/current`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load current blocks')
      setRows(data.blocks || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreateDeal(unitId) {
    if (!unitId) return
    window.location.href = `/deals/create?unit_id=${unitId}`
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Currently Blocked Units</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={loading} style={btn}>Refresh</button>
        </div>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Block ID</th>
              <th style={th}>Unit</th>
              <th style={th}>Status</th>
              <th style={th}>Requested By</th>
              <th style={th}>Reason</th>
              <th style={th}>Blocked Until</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.id}</td>
                <td style={td}>{r.unit_code}</td>
                <td style={td}>{r.unit_status || 'BLOCKED'}</td>
                <td style={td}>{r.requested_by_name || '-'}</td>
                <td style={td}>{r.reason || '-'}</td>
                <td style={td}>{r.blocked_until ? new Date(r.blocked_until).toLocaleString() : '-'}</td>
                <td style={td}>
                  {r.unit_id
                    ? <button style={btn} onClick={() => openCreateDeal(r.unit_id)}>Open in Create Deal</button>
                    : <span style={{ color: '#64748b' }}>No actions</span>
                  }
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td style={td} colSpan={7}>No blocked units at the moment.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}