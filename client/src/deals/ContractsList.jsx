import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError } from '../lib/notifications.js'
import { th, td } from '../lib/ui.js'

export default function ContractsList() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesError, setCandidatesError] = useState('')
  const navigate = useNavigate()

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/contracts`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load contracts')
      }
      const list = Array.isArray(data.contracts) ? data.contracts : []
      setRows(list)
    } catch (e) {
      const msg = e.message || String(e)
      setError(msg)
      notifyError(msg, 'Failed to load contracts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function loadCandidates() {
    try {
      setCandidatesLoading(true)
      setCandidatesError('')
      const resp = await fetchWithAuth(`${API_URL}/api/contracts/candidates`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load reservation forms')
      }
      const list = Array.isArray(data.reservation_forms) ? data.reservation_forms : []
      setCandidates(list)
    } catch (e) {
      const msg = e.message || String(e)
      setCandidatesError(msg)
      notifyError(msg, 'Failed to load reservation forms')
      setCandidates([])
    } finally {
      setCandidatesLoading(false)
    }
  }

  function formatStatus(status) {
    if (!status) return '-'
    const s = String(status).toLowerCase()
    if (s === 'pending_cm') return 'Pending CM'
    if (s === 'pending_tm') return 'Pending TM'
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  function statusColor(status) {
    const s = String(status || '').toLowerCase()
    if (s === 'approved' || s === 'executed') return '#16a34a'
    if (s === 'pending_cm' || s === 'pending_tm') return '#2563eb'
    if (s === 'rejected') return '#dc2626'
    return '#64748b'
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Contracts Queue</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}
            onClick={async () => {
              const nextSelecting = !selecting
              setSelecting(nextSelecting)
              if (nextSelecting && candidates.length === 0) {
                await loadCandidates()
              }
            }}
          >
            {selecting ? 'Hide Reservation Forms' : 'New Contract from Reservation'}
          </button>
        </div>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}

      {selecting && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            background: '#f9fafb'
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Approved Reservation Forms (no contract yet)</h3>
          {candidatesError && (
            <p style={{ color: '#e11d48', fontSize: 13 }}>{candidatesError}</p>
          )}
          {!candidatesError && candidatesLoading && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Loading reservation forms…</p>
          )}
          {!candidatesLoading && candidates.length === 0 && !candidatesError && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              No approved reservation forms without contracts were found.
            </p>
          )}
          {!candidatesLoading && candidates.length > 0 && (
            <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>RF #</th>
                    <th style={th}>Deal #</th>
                    <th style={th}>Unit</th>
                    <th style={th}>Buyer</th>
                    <th style={th}>Reservation Date</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(rf => (
                    <tr key={rf.id}>
                      <td style={td}>{rf.id}</td>
                      <td style={td}>{rf.deal_id || '-'}</td>
                      <td style={td}>{rf.unit_code || '-'}</td>
                      <td style={td}>{rf.buyer_name || '-'}</td>
                      <td style={td}>
                        {rf.reservation_date
                          ? new Date(rf.reservation_date).toISOString().slice(0, 10)
                          : '-'}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button
                          type="button"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #10b981',
                            background: '#10b981',
                            color: '#fff',
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                          onClick={async () => {
                            try {
                              setCreating(true)
                              const resp = await fetchWithAuth(`${API_URL}/api/contracts`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reservation_form_id: rf.id })
                              })
                              const data = await resp.json().catch(() => ({}))
                              if (!resp.ok) {
                                throw new Error(data?.error?.message || 'Failed to create contract')
                              }
                              const created = data.contract
                              if (created && created.id) {
                                navigate(`/contracts/${created.id}`)
                              } else {
                                await load()
                              }
                            } catch (e) {
                              notifyError(e, 'Failed to create contract')
                            } finally {
                              setCreating(false)
                            }
                          }}
                          disabled={creating}
                        >
                          {creating ? 'Creating…' : 'Create Contract'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Contract #</th>
              <th style={th}>Deal #</th>
              <th style={th}>Unit</th>
              <th style={th}>Buyer</th>
              <th style={th}>Status</th>
              <th style={th}>Created At</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && rows.map(c => {
              const status = formatStatus(c.status)
              const color = statusColor(c.status)
              const unitCode = c.unit_code || c.unit?.unit_code || '-'
              const buyerName = c.buyer_name || c.buyer || c.client_name || '-'
              const createdAt = c.created_at ? new Date(c.created_at).toLocaleString() : '-'
              return (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/contracts/${c.id}`)}>
                  <td style={td}>{c.id}</td>
                  <td style={td}>{c.deal_id || '-'}</td>
                  <td style={td}>{unitCode}</td>
                  <td style={td}>{buyerName}</td>
                  <td style={td}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 500,
                        background: '#f9fafb',
                        color
                      }}
                    >
                      {status}
                    </span>
                  </td>
                  <td style={td}>{createdAt}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      type="button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #d1d9e6',
                        background: '#fff',
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/contracts/${c.id}`)
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr><td style={td} colSpan={7}>No contracts found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}