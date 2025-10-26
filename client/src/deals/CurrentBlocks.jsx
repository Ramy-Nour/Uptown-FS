import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }
const ctrl = { padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d9e6' }

export default function CurrentBlocks() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(new Set())
  // keyed by block id: { selectedPlanId, reservationDate, preliminaryPayment, currency, language, plans: [] }
  const [form, setForm] = useState({})

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/current`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load current blocks')
      const blocks = data.blocks || []
      setRows(blocks)
      // prefetch plans per unit
      for (const b of blocks) {
        await loadPlansForBlock(b)
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function setBlockForm(id, patch) {
    setForm(f => ({ ...f, [id]: { ...(f[id] || {}), ...patch } }))
  }

  async function loadPlansForBlock(blockRow) {
    const unitId = blockRow.unit_id
    if (!unitId) return
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/approved-for-unit?unit_id=${unitId}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load approved plans')
      const plans = (data.payment_plans || []).map(p => ({
        id: p.id, label: `#${p.id} v${p.version || 1} (approved)`
      }))
      setBlockForm(blockRow.id, { plans, selectedPlanId: plans[0]?.id || '' })
    } catch (e) {
      // keep silent; form will show empty selector
      setBlockForm(blockRow.id, { plans: [], selectedPlanId: '' })
    }
  }

  async function createReservation(id) {
    try {
      const f = form[id] || {}
      const paymentPlanId = Number(f.selectedPlanId) || 0
      if (!paymentPlanId) {
        alert('Select an approved Payment Plan to create a reservation form.')
        return
      }
      setCreating(s => new Set([...s, id]))
      const row = rows.find(r => r.id === id)
      const details = {
        reservation_date: f.reservationDate || null,
        preliminary_payment: Number(f.preliminaryPayment || 0) || 0,
        currency_override: f.currency || 'EGP',
        language: f.language || 'en',
        unit_id: row?.unit_id || null
      }
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/reservation-forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_plan_id: paymentPlanId, details })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to create reservation form')
      alert(`Reservation Form #${data?.reservation_form?.id} created and sent for Financial Manager approval.`)
      setForm(fm => ({ ...fm, [id]: { ...fm[id], reservationDate: '', preliminaryPayment: '', currency: 'EGP', language: 'en' } }))
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setCreating(s => { const n = new Set(s); n.delete(id); return n })
    }
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
              <th style={th}>Reservation (FA)</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={7}>Loading…</td></tr>}
            {!loading && rows.map(r => {
              const f = form[r.id] || {}
              const plans = f.plans || []
              return (
                <tr key={r.id}>
                  <td style={td}>{r.id}</td>
                  <td style={td}>{r.unit_code}</td>
                  <td style={td}>{r.unit_status || 'BLOCKED'}</td>
                  <td style={td}>{r.requested_by_name || '-'}</td>
                  <td style={td}>{r.reason || '-'}</td>
                  <td style={td}>{r.blocked_until ? new Date(r.blocked_until).toLocaleString() : '-'}</td>
                  <td style={{ ...td, minWidth: 540 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <select
                        style={ctrl}
                        value={f.selectedPlanId || ''}
                        onChange={e => setBlockForm(r.id, { selectedPlanId: e.target.value })}
                        onFocus={() => { if (!plans.length) loadPlansForBlock(r) }}
                      >
                        {plans.length === 0 ? <option value="">No approved plans for this unit</option> : null}
                        {plans.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <input
                        style={ctrl}
                        type="date"
                        placeholder="Reservation Date"
                        value={f.reservationDate || ''}
                        onChange={e => setBlockForm(r.id, { reservationDate: e.target.value })}
                      />
                      <input
                        style={ctrl}
                        placeholder="Preliminary Payment"
                        value={f.preliminaryPayment || ''}
                        onChange={e => setBlockForm(r.id, { preliminaryPayment: e.target.value })}
                      />
                      <select
                        style={ctrl}
                        value={f.currency || 'EGP'}
                        onChange={e => setBlockForm(r.id, { currency: e.target.value })}
                      >
                        <option value="EGP">EGP</option>
                        <option value="USD">USD</option>
                      </select>
                      <select
                        style={ctrl}
                        value={f.language || 'en'}
                        onChange={e => setBlockForm(r.id, { language: e.target.value })}
                      >
                        <option value="en">English</option>
                        <option value="ar">العربية</option>
                      </select>
                      <div>
                        <button
                          style={btn}
                          onClick={() => createReservation(r.id)}
                          disabled={creating.has(r.id)}
                          title="Create reservation form for this blocked unit (sends to Financial Manager for approval)"
                        >
                          {creating.has(r.id) ? 'Creating…' : 'Create Reservation Form'}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && <tr><td style={td} colSpan={7}>No blocked units at the moment.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}