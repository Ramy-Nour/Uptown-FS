import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { generateReservationFormPdf } from '../lib/docExports.js'
import BlockHistoryModal from '../components/BlockHistoryModal.jsx'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }
const ctrl = { padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d9e6' }

function toDdMmYyyy(value) {
  if (!value) return ''
  const parts = String(value).split('-')
  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts
    if (dd && mm && yyyy) return `${dd}/${mm}/${yyyy}`
  }
  return value
}

export default function CurrentBlocks() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(new Set())
  // keyed by block id: { selectedPlanId, reservationDate, preliminaryPayment, language, plans: [] }
  const [form, setForm] = useState({})
  const [historyTarget, setHistoryTarget] = useState(null) // { unitId, unitCode }
  // keyed by payment_plan_id: latest approved reservation form row
  const [approvedReservationsByPlanId, setApprovedReservationsByPlanId] = useState({})
  // keyed by payment_plan_id: latest pending reservation form row (status='pending_approval')
  const [pendingReservationsByPlanId, setPendingReservationsByPlanId] = useState({})

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/current`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load current blocks')
      const blocks = data.blocks || []
      setRows(blocks)
      // load approved & pending reservation forms once so we can gate PDF generation / creation on FM approval
      await loadApprovedReservations()
      await loadPendingReservations()
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

  async function loadApprovedReservations() {
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/reservation-forms?status=approved`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load approved reservations')
      const map = {}
      const rows = Array.isArray(data.reservation_forms) ? data.reservation_forms : []
      for (const rf of rows) {
        const planId = Number(rf.payment_plan_id)
        if (Number.isFinite(planId)) {
          map[planId] = rf
        }
      }
      setApprovedReservationsByPlanId(map)
    } catch (e) {
      console.error('Failed to load approved reservation forms for CurrentBlocks:', e)
      setApprovedReservationsByPlanId({})
    }
  }

  async function loadPendingReservations() {
    try {
      const resp = await fetchWithAuth(
        `${API_URL}/api/workflow/reservation-forms?status=pending_approval`
      )
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load pending reservations')
      const map = {}
      const rows = Array.isArray(data.reservation_forms) ? data.reservation_forms : []
      for (const rf of rows) {
        const planId = Number(rf.payment_plan_id)
        if (Number.isFinite(planId)) {
          map[planId] = rf
        }
      }
      setPendingReservationsByPlanId(map)
    } catch (e) {
      console.error('Failed to load pending reservation forms for CurrentBlocks:', e)
      setPendingReservationsByPlanId({})
    }
  }

  async function loadPlansForBlock(blockRow) {
    const unitId = blockRow.unit_id
    if (!unitId) return
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/approved-for-unit?unit_id=${unitId}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load approved plans')
      const plans = (data.payment_plans || []).map(p => ({
        id: p.id,
        label: `Approved Payment Plan #${p.id}${p.version ? ` (v${p.version})` : ''}`,
        dealId: p.deal_id || null
      }))
      // Auto-select the latest plan (first in DESC list) and default language (Arabic)
      const first = plans[0] || {}
      setBlockForm(blockRow.id, {
        plans,
        selectedPlanId: first.id || '',
        selectedPlanDealId: first.dealId || null,
        language: 'ar'
      })
    } catch (e) {
      // keep silent; form will show empty selector
      setBlockForm(blockRow.id, { plans: [], selectedPlanId: '', selectedPlanDealId: null, language: 'ar' })
    }
  }

  async function createReservation(id) {
    try {
      const f = form[id] || {}
      const paymentPlanId = Number(f.selectedPlanId) || 0
      if (!paymentPlanId) {
        alert('No approved payment plan is available for this unit.')
        return
      }
      if (approvedReservationsByPlanId[paymentPlanId]) {
        alert(
          'This reservation has already been approved by the Financial Manager. You cannot create another reservation form for the same payment plan from this view.'
        )
        return
      }
      if (pendingReservationsByPlanId[paymentPlanId]) {
        alert(
          'A reservation request for this payment plan is already pending Financial Manager approval. You can cancel it first if you need to correct the data.'
        )
        return
      }
      if (f.preliminaryPayment === '' || f.preliminaryPayment == null) {
        alert('Preliminary Payment is required (enter 0 if there is no upfront payment).')
        return
      }
      const prelim = Number(f.preliminaryPayment)
      if (!Number.isFinite(prelim) || prelim < 0) {
        alert('Preliminary Payment must be a non-negative number.')
        return
      }
      if (!f.reservationDate) {
        alert('Reservation Date is required.')
        return
      }
      setCreating(s => new Set([...s, id]))
      const row = rows.find(r => r.id === id)
      const details = {
        unit_id: row?.unit_id || null
      }
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/reservation-forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_plan_id: paymentPlanId,
          reservation_date: f.reservationDate,
          preliminary_payment: prelim,
          language: f.language || 'ar',
          details
        })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to create reservation form')
      alert(
        `Reservation Form #${data?.reservation_form?.id} created. The request has been sent to the Financial Manager for approval. ` +
        'Please wait for their decision before creating another reservation for this payment plan.'
      )
      setForm(fm => ({ ...fm, [id]: { ...fm[id], reservationDate: '', preliminaryPayment: '', language: 'ar' } }))
      // refresh pending reservations so FA can cancel a request if they need to correct data
      await loadPendingReservations()
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setCreating(s => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  async function printReservationPdf(id) {
    try {
      const f = form[id] || {}
      const plans = f.plans || []
      const plan = plans.find(p => p.id === f.selectedPlanId) || plans[0]
      const dealId = plan?.dealId
      if (!dealId) {
        alert('Unable to determine the related deal for this plan. Reservation PDF requires a deal_id.')
        return
      }
      const paymentPlanId = Number(plan?.id) || 0
      if (!paymentPlanId) {
        alert('No approved payment plan is available for this unit.')
        return
      }
      const approved = approvedReservationsByPlanId[paymentPlanId]
      if (!approved) {
        alert('Reservation Form must be approved by the Financial Manager before printing the Reservation PDF.')
        return
      }
      const body = {
        deal_id: Number(dealId),
        // Reservation date and Preliminary Payment come from the approved reservation_form row;
        // the API ignores client-sent values when an approved reservation exists.
        currency_override: '',
        language: f.language || approved.language || 'ar'
      }
      const { blob, filename } = await generateReservationFormPdf(body, API_URL)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  async function cancelPendingReservation(paymentPlanId) {
    const pending = pendingReservationsByPlanId[paymentPlanId]
    if (!pending) return
    if (!window.confirm(`Cancel reservation request #${pending.id} for this payment plan?`)) return
    try {
      const resp = await fetchWithAuth(
        `${API_URL}/api/workflow/reservation-forms/${pending.id}/cancel`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      )
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to cancel reservation request')
      alert(`Reservation request #${pending.id} has been cancelled. You can create a new reservation with corrected data.`)
      await loadPendingReservations()
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  async function requestApprovedReservationAmendment(reservationRow) {
    if (!reservationRow) return
    try {
      const details = reservationRow.details || {}
      const existingAmendment = details.amendment_request
      if (existingAmendment && existingAmendment.state === 'pending') {
        alert('An amendment request is already pending for this reservation.')
        return
      }

      const currentDateRaw =
        reservationRow.reservation_date || details.reservation_date || ''
      const currentDateForPrompt = currentDateRaw
        ? toDdMmYyyy(String(currentDateRaw).slice(0, 10))
        : ''
      const currentPrelim =
        reservationRow.preliminary_payment != null
          ? reservationRow.preliminary_payment
          : details.preliminary_payment != null
          ? details.preliminary_payment
          : ''

      const newDateInput = window.prompt(
        'New Reservation Date (dd/MM/YYYY or YYYY-MM-DD):',
        currentDateForPrompt
      )
      if (!newDateInput) return

      const newPrelimInput = window.prompt(
        'New Preliminary Payment amount:',
        currentPrelim !== '' ? String(currentPrelim) : ''
      )
      if (newPrelimInput == null) return

      const reason = window.prompt(
        'Reason for change (visible to the Financial Manager):',
        ''
      ) || ''

      const resp = await fetchWithAuth(
        `${API_URL}/api/workflow/reservation-forms/${reservationRow.id}/request-amendment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservation_date: newDateInput,
            preliminary_payment: newPrelimInput,
            reason
          })
        }
      )
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to request amendment')
      alert('Amendment request has been sent to the Financial Manager for approval.')
      await loadApprovedReservations()
    } catch (e) {
      alert(e.message || String(e))
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
              const selectedPlanId = f.selectedPlanId || (plans[0] && plans[0].id)
              const selectedPlan = plans.find(p => p.id === selectedPlanId) || plans[0]
              const selectedPlanLabel = selectedPlan ? selectedPlan.label : 'No approved payment plans for this unit'
              const approvedForPlan = selectedPlan ? approvedReservationsByPlanId[selectedPlan.id] : null
              const pendingForPlan = selectedPlan ? pendingReservationsByPlanId[selectedPlan.id] : null
              const isApproved = !!approvedForPlan

              let reservationDateValue = f.reservationDate || ''
              if (isApproved) {
                const raw = approvedForPlan.reservation_date || approvedForPlan.details?.reservation_date
                if (raw) {
                  const d = new Date(raw)
                  if (!Number.isNaN(d.getTime())) {
                    reservationDateValue = d.toISOString().slice(0, 10)
                  }
                }
              }

              let preliminaryValue = f.preliminaryPayment || ''
              if (isApproved) {
                const fromColumn = approvedForPlan.preliminary_payment
                const fromDetails = approvedForPlan.details?.preliminary_payment
                const v = fromColumn != null ? fromColumn : fromDetails
                if (v != null) {
                  preliminaryValue = String(v)
                }
              }

              let languageValue = f.language || ''
              if (!languageValue) {
                languageValue = (approvedForPlan && approvedForPlan.language) || 'ar'
              }

              const hasPendingAmendment =
                approvedForPlan &&
                approvedForPlan.details &&
                approvedForPlan.details.amendment_request &&
                approvedForPlan.details.amendment_request.state === 'pending'

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
                      {/* Approved plan is auto-fetched and locked; show as read-only */}
                      <input
                        style={{ ...ctrl, background: '#f8fafc' }}
                        value={selectedPlanLabel}
                        readOnly
                        title="Approved payment plan for this blocked unit (auto-selected)"
                        onFocus={() => { if (!plans.length) loadPlansForBlock(r) }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          style={{ ...ctrl, background: isApproved ? '#f8fafc' : '#fff' }}
                          type="date"
                          placeholder="Reservation Date"
                          value={reservationDateValue}
                          onChange={e => setBlockForm(r.id, { reservationDate: e.target.value })}
                          disabled={isApproved}
                          title={isApproved
                            ? 'Reservation Date is locked after Financial Manager approval.'
                            : 'Reservation Date for this reservation request.'}
                        />
                        <span style={{ fontSize: 11, color: '#64748b' }}>Format: dd/MM/YYYY</span>
                      </div>
                      <input
                        style={{ ...ctrl, background: isApproved ? '#f8fafc' : '#fff' }}
                        placeholder="Preliminary Payment"
                        value={preliminaryValue}
                        onChange={e => setBlockForm(r.id, { preliminaryPayment: e.target.value })}
                        disabled={isApproved}
                        title={isApproved
                          ? 'Preliminary Payment is locked after Financial Manager approval.'
                          : 'Preliminary Reservation Payment to be approved by the Financial Manager (enter 0 if none).'}
                      />
                      <select
                        style={ctrl}
                        value={languageValue}
                        onChange={e => setBlockForm(r.id, { language: e.target.value })}
                        title="Language to use for the Reservation Form PDF (can be changed even after approval)."
                      >
                        <option value="ar">العربية</option>
                        <option value="en">English</option>
                      </select>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          style={btn}
                          onClick={() => createReservation(r.id)}
                          disabled={creating.has(r.id) || isApproved || !!pendingForPlan}
                          title={
                            isApproved
                              ? 'Reservation has already been approved by the Financial Manager for this plan.'
                              : pendingForPlan
                              ? 'A reservation request for this plan is already pending FM approval.'
                              : 'Create reservation form for this blocked unit (sends to Financial Manager for approval)'
                          }
                        >
                          {isApproved
                            ? 'Reservation Approved'
                            : pendingForPlan
                            ? 'Pending FM Approval'
                            : creating.has(r.id)
                            ? 'Creating…'
                            : 'Create Reservation Form'}
                        </button>
                        {pendingForPlan ? (
                          <button
                            style={{ ...btn, borderColor: '#f97316', color: '#c2410c' }}
                            onClick={() => cancelPendingReservation(selectedPlan.id)}
                            title="Cancel this pending reservation request so you can create a new one with corrected data."
                          >
                            Cancel Reservation Request
                          </button>
                        ) : null}
                        <button
                          style={btn}
                          onClick={() => printReservationPdf(r.id)}
                          disabled={!isApproved}
                          title={isApproved
                            ? 'Generate Reservation Form PDF using the approved reservation (date and Preliminary Payment are locked).'
                            : 'Reservation PDF can only be printed after the reservation is approved by the Financial Manager.'}
                        >
                          Print Reservation PDF
                        </button>
                        {isApproved && (
                          <button
                            style={{ ...btn, borderColor: '#6366f1', color: '#4338ca' }}
                            onClick={() => requestApprovedReservationAmendment(approvedForPlan)}
                            disabled={hasPendingAmendment}
                            title={
                              hasPendingAmendment
                                ? 'An amendment request for this approved reservation is already pending FM decision.'
                                : 'Request a change to the approved Reservation Date / Preliminary Payment (goes to the Financial Manager for approval).'
                            }
                          >
                            {hasPendingAmendment ? 'Amendment Pending' : 'Request Change to Approved Reservation'}
                          </button>
                        )}
                        <button
                          style={{ ...btn, borderColor: '#9ca3af', color: '#374151' }}
                          onClick={() => setHistoryTarget({ unitId: r.unit_id, unitCode: r.unit_code })}
                          title="View full block/unblock history for this unit"
                        >
                          Block History
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
      <BlockHistoryModal
        open={!!historyTarget}
        unitId={historyTarget?.unitId || null}
        unitCode={historyTarget?.unitCode || ''}
        onClose={() => setHistoryTarget(null)}
      />
    </div>
  )
}