import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import LoadingButton from '../components/LoadingButton.jsx'
import { useLoader } from '../lib/loaderContext.jsx'
import CalculatorApp from '../App.jsx'
import * as XLSX from 'xlsx'

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }

export default function DealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [deal, setDeal] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [editCalc, setEditCalc] = useState(false)
  const [savingCalc, setSavingCalc] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [calcCommissionLoading, setCalcCommissionLoading] = useState(false)
  const { setShow, setMessage } = useLoader()
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  const role = user?.role || 'user'

  // Edit request modal state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editFields, setEditFields] = useState({
    address: false,
    payment_plan: false,
    maintenance_date: false,
    offer_dates: false,
    other: ''
  })
  const [editReason, setEditReason] = useState('')

  async function load() {
    try {
      setError('')
      const dealResp = await fetchWithAuth(`${API_URL}/api/deals/${id}`)
      const dealData = await dealResp.json()
      if (!dealResp.ok) throw new Error(dealData?.error?.message || 'Failed to load deal')
      const d = dealData.deal
      setDeal(d || null)

      const histResp = await fetchWithAuth(`${API_URL}/api/deals/${id}/history`)
      const histData = await histResp.json()
      if (!histResp.ok) throw new Error(histData?.error?.message || 'Failed to load history')
      setHistory(histData.history || [])
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load deal')
    }
  }

  useEffect(() => { load() }, [id])

  const isOwner = deal && user && deal.created_by === user.id
  const canEdit = deal && deal.status === 'draft' && (isOwner || role === 'admin')
  const canSubmit = deal && deal.status === 'draft' && (isOwner || role === 'admin')

  const [salesList, setSalesList] = useState([])
  const [salesError, setSalesError] = useState('')
  const [policies, setPolicies] = useState([])
  const [policiesError, setPoliciesError] = useState('')
  const [expandedNotes, setExpandedNotes] = useState({})
  const [assigning, setAssigning] = useState(false)
  const [settingPolicy, setSettingPolicy] = useState(false)

  useEffect(() => {
    async function loadAux() {
      try {
        const [sres, pres] = await Promise.all([
          fetchWithAuth(`${API_URL}/api/sales?page=1&pageSize=200`).then(r => r.json()),
          fetchWithAuth(`${API_URL}/api/commission-policies?page=1&pageSize=200`).then(r => r.json())
        ])
        if (sres && sres.sales) setSalesList(sres.sales)
        if (pres && pres.policies) setPolicies(pres.policies)
      } catch (e) {
        const msg = e.message || String(e)
        setSalesError(msg)
        setPoliciesError(msg)
      }
    }
    loadAux()
  }, [])

  async function saveCalculator() {
    try {
      setSavingCalc(true)
      const snapFn = window.__uptown_calc_getSnapshot
      if (typeof snapFn !== 'function') {
        throw new Error('Calculator not ready yet.')
      }
      const snap = snapFn()
      const titleParts = []
      if (snap?.clientInfo?.buyer_name) titleParts.push(snap.clientInfo.buyer_name)
      if (snap?.unitInfo?.unit_code || snap?.unitInfo?.unit_number) {
        titleParts.push(snap.unitInfo.unit_code || snap.unitInfo.unit_number)
      }
      const title = titleParts.join(' - ') || (deal?.title || 'Deal')
      const amount = Number(snap?.generatedPlan?.totals?.totalNominal ?? snap?.stdPlan?.totalPrice ?? deal?.amount ?? 0)
      const unitType = snap?.unitInfo?.unit_type || deal?.unit_type || null
      const details = {
        calculator: { ...snap }
      }
      const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount, unitType, details })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to save')
      setEditCalc(false)
      notifySuccess('Deal updated successfully.')
      await load()
    } catch (e) {
      notifyError(e, 'Failed to save')
    } finally {
      setSavingCalc(false)
    }
  }

  // When starting calculator edit, hydrate the calculator from saved details (if present)
  useEffect(() => {
    if (editCalc) {
      const snap = deal?.details?.calculator
      if (snap) {
        try {
          const snapshot = {
            mode: snap.mode,
            language: snap.language,
            currency: snap.currency,
            stdPlan: snap.stdPlan,
            inputs: snap.inputs,
            firstYearPayments: snap.firstYearPayments,
            subsequentYears: snap.subsequentYears,
            clientInfo: snap.clientInfo,
            unitInfo: snap.unitInfo,
            contractInfo: snap.contractInfo,
            customNotes: snap.customNotes
          }
          localStorage.setItem('uptown_calc_form_state_v2', JSON.stringify(snapshot))
        } catch {}
      }
    }
  }, [editCalc, deal])

  if (error) return <p style={{ color: '#e11d48' }}>{error}</p>
  if (!deal) return <p>Loading…</p>

  const schedule = deal?.details?.calculator?.generatedPlan?.schedule || []
  const totals = deal?.details?.calculator?.generatedPlan?.totals || null
  const evaluation = deal?.details?.calculator?.generatedPlan?.evaluation || null

  async function generateDocFromSaved(documentType) {
    try {
      const snap = deal?.details?.calculator
      if (!snap) {
        notifyError('No saved calculator details found.')
        return
      }
      const body = {
        documentType,
        deal_id: Number(deal.id),
        language: snap.language,
        currency: snap.currency,
        mode: snap.mode,
        stdPlan: snap.stdPlan,
        inputs: snap.inputs,
        generatedPlan: snap.generatedPlan,
        data: {
          offer_date: snap?.inputs?.offerDate || new Date().toISOString().slice(0, 10),
          first_payment_date: snap?.inputs?.firstPaymentDate || snap?.inputs?.offerDate || new Date().toISOString().slice(0, 10)
        }
      }
      // Show full-page loader for this heavy operation
      const label = documentType === 'pricing_form'
        ? 'Generating Pricing Form…'
        : documentType === 'reservation_form'
        ? 'Generating Reservation Form…'
        : documentType === 'contract'
        ? 'Generating Contract…'
        : 'Generating document…'
      setMessage(label)
      setShow(true)

      const resp = await fetchWithAuth(`${API_URL}/api/generate-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        let errMsg = 'Failed to generate document'
        try {
          const j = await resp.json()
          errMsg = j?.error?.message || errMsg
        } catch {}
        notifyError(errMsg)
        return
      }
      const blob = await resp.blob()
      const cd = resp.headers.get('Content-Disposition') || ''
      const match = /filename\*=UTF-8''([^;]+)|filename=\\"?([^\\";]+)\\"?/i.exec(cd)
      let filename = ''
      if (match) filename = decodeURIComponent(match[1] || match[2] || '')
      if (!filename) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        filename = `${documentType}_${ts}.pdf`
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      notifySuccess('Document generated successfully.')
    } catch (e) {
      notifyError(e, 'Failed to generate document')
    } finally {
      setShow(false)
    }
  }

  function printSchedule() {
    const win = window.open('', 'printwin')
    if (!win) return
    const rows = schedule.map((r, i) => `
      <tr>
        <td style="padding:6px;border:1px solid #e5e7eb;">${i + 1}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${r.month}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${r.label}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;text-align:right;">${Number(r.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:6px;border:1px solid #e5e7eb;">${r.writtenAmount || ''}</td>
      </tr>
    `).join('')
    const totalHtml = totals ? `
      <tfoot>
        <tr>
          <td colspan="3" style="padding:8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;">Total</td>
          <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;">
            ${Number(totals.totalNominal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td style="padding:8px;border:1px solid #e5e7eb;"></td>
        </tr>
      </tfoot>
    ` : ''
    win.document.write(`
      <html>
      <head>
        <title>Deal #${deal?.id} — Payment Schedule</title>
        <meta charset="utf-8"/>
        <style>
          body { font-family: Arial, sans-serif; padding: 16px; color: #111827; }
          h1 { font-size: 18px; margin: 0 0 10px 0; }
          table { width: 100%; border-collapse: collapse; }
          thead th { background: #f3f4f6; text-align: left; padding: 8px; border: 1px solid #e5e7eb; }
        </style>
      </head>
      <body>
        <h1>Deal #${deal?.id} — ${deal?.title || ''}</h1>
        <p><strong>Status:</strong> ${deal?.status || ''} &nbsp; <strong>Unit Type:</strong> ${deal?.unit_type || '-'}</p>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Month</th><th>Label</th><th>Amount</th><th>Written Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          ${totalHtml}
        </table>
        <script>window.onload = function(){ window.print(); }</script>
      </body>
      </html>
    `)
    win.document.close()
  }

  function generateChecksSheetFromSaved() {
    const snap = deal?.details?.calculator
    const plan = snap?.generatedPlan
    if (!plan || !Array.isArray(plan.schedule) || plan.schedule.length === 0) {
      notifyError('No saved schedule found to generate checks sheet.')
      return
    }
    const buyer = snap?.clientInfo?.buyer_name || ''
    const unit = snap?.unitInfo?.unit_code || snap?.unitInfo?.unit_number || ''
    const curr = snap?.currency || ''

    // Contract metadata
    const ci = snap?.contractInfo || {}
    const notes = snap?.customNotes || {}
    const fmt = (d) => d ? new Date(d).toLocaleDateString() : ''
    const money = (v) => {
      const n = Number(v || 0)
      return isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
    }

    const metaLines = [
      `Buyer: ${buyer}    Unit: ${unit}    Currency: ${curr}`,
      `Contract Date: ${fmt(ci.contract_date)}    Reservation Form Date: ${fmt(ci.reservation_form_date)}`,
      `Reservation Payment: ${money(ci.reservation_payment_amount)} on ${fmt(ci.reservation_payment_date)}`,
      `Maintenance Fee: ${money(ci.maintenance_fee)}    Delivery Period: ${ci.delivery_period || ''}`,
    ]

    const extraNotes = []
    if (notes.dp_explanation) extraNotes.push(`DP Notes: ${notes.dp_explanation}`)
    if (notes.poa_clause) extraNotes.push(`POA: ${notes.poa_clause}`)

    const headerRows = [
      ['Checks Sheet'],
      ...metaLines.map(line => [line]),
      ...(extraNotes.length ? extraNotes.map(line => [line]) : []),
      [],
      ['#', 'Cheque No.', 'Date', 'Pay To', 'Amount', 'Amount in Words', 'Notes']
    ]
    const bodyRows = (plan.schedule || []).map((row, i) => {
      const amount = Number(row.amount || 0)
      const amountStr = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      return [
        i + 1,
        '',
        '',
        buyer,
        amountStr,
        row.writtenAmount || '',
        `${row.label} (Month ${row.month})`
      ]
    })

    const aoa = [...headerRows, ...bodyRows]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [
      { wch: 5 },
      { wch: 14 },
      { wch: 14 },
      { wch: 28 },
      { wch: 16 },
      { wch: 60 },
      { wch: 30 },
    ]

    // Merge all header/meta lines across A..G
    const mergeCount = 1 /* title */ + metaLines.length + extraNotes.length
    const merges = []
    for (let r = 0; r < mergeCount; r++) {
      merges.push({ s: { r, c: 0 }, e: { r, c: 6 } })
    }
    ws['!merges'] = merges

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Checks')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `checks_sheet_${ts}.xlsx`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    notifySuccess('Checks sheet generated')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Deal #{deal.id}</h2>
        <LoadingButton onClick={() => navigate('/deals')}>Back to Dashboard</LoadingButton>
      </div>

      {!editCalc ? (
        <div style={{ marginBottom: 16 }}>
          <p><strong>Title:</strong> {deal.title}</p>
          <p><strong>Amount:</strong> {Number(deal.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          <p><strong>Status:</strong> {deal.status}</p>
          <p><strong>Unit Type:</strong> {deal.unit_type || '-'}</p>
          {/* Dates summary near header */}
          <div style={{ margin: '6px 0 10px 0', padding: '8px 10px', borderRadius: 8, background: '#fbfaf7', border: '1px solid #ead9bd', display: 'inline-flex', gap: 16, flexWrap: 'wrap' }}>
            <div><strong>Offer Date:</strong> {(deal?.details?.calculator?.inputs?.offerDate) || new Date().toISOString().slice(0, 10)}</div>
            <div><strong>First Payment Date:</strong> {(deal?.details?.calculator?.inputs?.firstPaymentDate) || (deal?.details?.calculator?.inputs?.offerDate) || new Date().toISOString().slice(0, 10)}</div>
          </div>
          {deal.status === 'rejected' && deal.rejection_reason ? (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid #ef4444', background: '#fef2f2', color: '#7f1d1d' }}>
              <strong>Rejection Reason:</strong>
              <div style={{ marginTop: 4 }}>{deal.rejection_reason}</div>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
            <strong>Sales Rep:</strong>
            <select
              disabled={!canEdit || assigning}
              value={deal.sales_rep_id || ''}
              onChange={async (e) => {
                const salesRepId = e.target.value ? Number(e.target.value) : null
                setAssigning(true)
                // optimistic UI
                setDeal(d => ({ ...d, sales_rep_id: salesRepId }))
                try {
                  const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ salesRepId })
                  })
                  const data = await resp.json()
                  if (!resp.ok) {
                    notifyError(data?.error?.message || 'Failed to assign sales rep')
                    // revert optimistic update
                    setDeal(d => ({ ...d, sales_rep_id: deal.sales_rep_id || null }))
                  } else {
                    notifySuccess('Sales rep assigned successfully.')
                  }
                } catch (err) {
                  notifyError(err, 'Failed to assign sales rep')
                  setDeal(d => ({ ...d, sales_rep_id: deal.sales_rep_id || null }))
                } finally {
                  setAssigning(false)
                }
              }}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #d1d9e6' }}
            >
              <option value="">— Unassigned —</option>
              {salesList.map(s => (
                <option key={s.id} value={s.id}>{s.name} {s.email ? `(${s.email})` : ''}</option>
              ))}
            </select>
            {salesError ? <small style={{ color: '#e11d48' }}>{salesError}</small> : null}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
            <strong>Commission Policy:</strong>
            <select
              disabled={!canEdit || settingPolicy}
              value={deal.policy_id || ''}
              onChange={async (e) => {
                const policyId = e.target.value ? Number(e.target.value) : null
                setSettingPolicy(true)
                // optimistic
                setDeal(d => ({ ...d, policy_id: policyId }))
                try {
                  const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ policyId })
                  })
                  const data = await resp.json()
                  if (!resp.ok) {
                    notifyError(data?.error?.message || 'Failed to set policy')
                    setDeal(d => ({ ...d, policy_id: deal.policy_id || null }))
                  } else {
                    notifySuccess('Commission policy updated successfully.')
                  }
                } catch (err) {
                  notifyError(err, 'Failed to set policy')
                  setDeal(d => ({ ...d, policy_id: deal.policy_id || null }))
                } finally {
                  setSettingPolicy(false)
                }
              }}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #d1d9e6' }}
            >
              <option value="">— Use Active Policy —</option>
              {policies.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.active ? '' : '(inactive)'}</option>
              ))}
            </select>
            {policiesError ? <small style={{ color: '#e11d48' }}>{policiesError}</small> : null}
          </div>

          <h3>Payment Schedule</h3>
          {/* Dates summary for visibility */}
          <div style={{ margin: '6px 0 10px 0', padding: '8px 10px', borderRadius: 8, background: '#fbfaf7', border: '1px solid #ead9bd', display: 'inline-flex', gap: 16, flexWrap: 'wrap' }}>
            <div><strong>Offer Date:</strong> {(deal?.details?.calculator?.inputs?.offerDate) || new Date().toISOString().slice(0, 10)}</div>
            <div><strong>First Payment Date:</strong> {(deal?.details?.calculator?.inputs?.firstPaymentDate) || (deal?.details?.calculator?.inputs?.offerDate) || new Date().toISOString().slice(0, 10)}</div>
          </div>
          {schedule.length === 0 ? (
            <p style={{ color: '#64748b' }}>No saved schedule. Use Edit in Calculator to generate and save one.</p>
          ) : (
            <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>Month</th>
                    <th style={th}>Label</th>
                    <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                    <th style={th}>Written Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((row, idx) => (
                    <tr key={idx}>
                      <td style={td}>{idx + 1}</td>
                      <td style={td}>{row.month}</td>
                      <td style={td}>{row.label}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{Number(row.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={td}>{row.writtenAmount}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>Total</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {Number(totals.totalNominal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Acceptance Evaluation summary */}
          {evaluation && (
            <div style={{ marginTop: 16, border: '1px solid #e6eaf0', borderRadius: 12, padding: 12 }}>
              <h3 style={{ marginTop: 0 }}>Acceptance Evaluation</h3>
              {(() => {
                const ok = evaluation.decision === 'ACCEPT'
                const box = {
                  marginBottom: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${ok ? '#10b981' : '#ef4444'}`,
                  background: ok ? '#ecfdf5' : '#fef2f2',
                  color: ok ? '#065f46' : '#7f1d1d',
                  fontWeight: 600
                }
                return (
                  <div style={box}>
                    NPV-based Decision: {evaluation.decision}
                  </div>
                )
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ border: '1px dashed #d1d9e6', borderRadius: 10, padding: 10 }}>
                  <strong>PV Comparison</strong>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li>Proposed PV: {Number(evaluation.pv?.proposedPV || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</li>
                    <li>Standard PV: {Number(evaluation.pv?.standardPV || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</li>
                    <li>Difference (Std - Prop): {Number(evaluation.pv?.difference || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</li>
                    <li>Status: {evaluation.pv?.pass ? 'PASS' : 'FAIL'}</li>
                  </ul>
                </div>
                <div style={{ border: '1px dashed #d1d9e6', borderRadius: 10, padding: 10 }}>
                  <strong>Conditions</strong>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {evaluation.conditions?.map((c, idx) => (
                      <li key={idx} style={{ marginBottom: 6 }}>
                        <div><strong>{c.label}</strong> — <span style={{ color: c.status === 'PASS' ? '#065f46' : '#7f1d1d' }}>{c.status}</span></div>
                        {'required' in c && typeof c.required === 'number' && <div>Required: {Number(c.required).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                        {'required' in c && typeof c.required === 'object' && (
                          <div>
                            Required: {c.required.min != null ? `Min ${Number(c.required.min).toLocaleString()}% ` : ''}{c.required.max != null ? `Max ${Number(c.required.max).toLocaleString()}%` : ''}
                          </div>
                        )}
                        {'actual' in c && typeof c.actual === 'number' && <div>Actual: {Number(c.actual).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                        {'actual' in c && typeof c.actual === 'object' && (
                          <div>
                            Actual: {c.actual.amount != null ? `${Number(c.actual.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}{c.actual.percent != null ? ` (${Number(c.actual.percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%)` : ''}
                          </div>
                        )}
                        {c.handoverYear != null && <div>Handover Year: {c.handoverYear}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Override Workflow — visible when evaluation REJECT */}
              {evaluation.decision === 'REJECT' && (
                <div style={{ marginTop: 12, padding: '10px 12px', border: '1px dashed #d1d9e6', borderRadius: 10 }}>
                  <strong>Override Workflow</strong>
                  <div style={{ marginTop: 6, color: '#6b7280' }}>
                    Request → Sales Manager review → Financial Manager review → Top Management decision
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(role === 'property_consultant' || role === 'admin' || role === 'superadmin') && (
                      <LoadingButton
                        onClick={async () => {
                          const reason = window.prompt('Provide a reason for override request (optional):', '')
                          try {
                            const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/request-override`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ reason: reason || '' })
                            })
                            const data = await resp.json()
                            if (!resp.ok) notifyError(data?.error?.message || 'Failed to request override')
                            else { notifySuccess('Override requested. Waiting for Sales Manager review.'); await load() }
                          } catch (err) {
                            notifyError(err, 'Failed to request override')
                          }
                        }}
                        variant="primary"
                      >
                        Request Override
                      </LoadingButton>
                    )}
                    {(role === 'sales_manager' || role === 'admin' || role === 'superadmin') && (
                      <>
                        <LoadingButton
                          onClick={async () => {
                            const notes = window.prompt('Notes (optional):', '')
                            try {
                              const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/override-sm-approve`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notes: notes || '' })
                              })
                              const data = await resp.json()
                              if (!resp.ok) notifyError(data?.error?.message || 'Failed to approve override')
                              else { notifySuccess('Override approved (SM). Forwarded to FM.'); await load() }
                            } catch (err) {
                              notifyError(err, 'Failed to approve override')
                            }
                          }}
                        >
                          SM Approve
                        </LoadingButton>
                        <LoadingButton
                          onClick={() => setPromptRejectId(id)}
                          style={{ marginLeft: 8 }}
                        >
                          SM Reject
                        </LoadingButton>
                      </>
                    )}
                    {(role === 'financial_manager' || role === 'admin' || role === 'superadmin') && (
                      <>
                        <LoadingButton
                          onClick={async () => {
                            const notes = window.prompt('Notes (optional):', '')
                            try {
                              const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/override-fm-approve`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notes: notes || '' })
                              })
                              const data = await resp.json()
                              if (!resp.ok) notifyError(data?.error?.message || 'Failed to approve override')
                              else { notifySuccess('Override approved (FM). Forwarded to Top Management.'); await load() }
                            } catch (err) {
                              notifyError(err, 'Failed to approve override')
                            }
                          }}
                        >
                          FM Approve
                        </LoadingButton>
                        <LoadingButton
                          onClick={async () => {
                            const notes = window.prompt('Rejection reason (optional):', '')
                            try {
                              const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/override-fm-reject`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notes: notes || '' })
                              })
                              const data = await resp.json()
                              if (!resp.ok) notifyError(data?.error?.message || 'Failed to reject override')
                              else { notifySuccess('Override rejected (FM).'); await load() }
                            } catch (err) {
                              notifyError(err, 'Failed to reject override')
                            }
                          }}
                          style={{ marginLeft: 8 }}
                        >
                          FM Reject
                        </LoadingButton>
                      </>
                    )}
                    {(role === 'ceo' || role === 'chairman' || role === 'vice_chairman' || role === 'top_management' || role === 'admin' || role === 'superadmin') && (
                      <>
                        <LoadingButton
                          onClick={async () => {
                            const notes = window.prompt('Approval notes (optional):', '')
                            try {
                              const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/override-approve`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notes: notes || '' })
                              })
                              const data = await resp.json()
                              if (!resp.ok) notifyError(data?.error?.message || 'Failed to approve override')
                              else { notifySuccess('Override approved (TM).'); await load() }
                            } catch (err) {
                              notifyError(err, 'Failed to approve override')
                            }
                          }}
                        >
                          TM Approve
                        </LoadingButton>
                        <LoadingButton
                          onClick={async () => {
                            const notes = window.prompt('Rejection reason (optional):', '')
                            try {
                              const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/override-reject`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notes: notes || '' })
                              })
                              const data = await resp.json()
                              if (!resp.ok) notifyError(data?.error?.message || 'Failed to reject override')
                              else { notifySuccess('Override rejected (TM).'); await load() }
                            } catch (err) {
                              notifyError(err, 'Failed to reject override')
                            }
                          }}
                          style={{ marginLeft: 8 }}
                        >
                          TM Reject
                        </LoadingButton>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <p style={{ marginTop: 16 }}><strong>Created By:</strong> {deal.created_by_email || deal.created_by}</p>
          <p><strong>Created At:</strong> {deal.created_at ? new Date(deal.created_at).toLocaleString() : ''}</p>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Edit in Calculator</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <LoadingButton onClick={saveCalculator} loading={savingCalc} variant="primary">Save</LoadingButton>
              <LoadingButton onClick={() => setEditCalc(false)} disabled={savingCalc}>Cancel</LoadingButton>
            </div>
          </div>
          <div style={{ border: '1px solid #e6eaf0', borderRadius: 12, overflow: 'hidden' }}>
            <CalculatorApp embedded dealId={deal.id} />
          </div>
        </div>
      )}

      {/* Outstanding edit request banner */}
      {(() => {
        // Find last request_edits and last edits_addressed in history
        const lastReqIdx = [...history].reverse().findIndex(h => h.action === 'request_edits')
        const lastAddrIdx = [...history].reverse().findIndex(h => h.action === 'edits_addressed')
        const outstanding = lastReqIdx !== -1 && (lastAddrIdx === -1 || lastAddrIdx > lastReqIdx)
        if (!outstanding) return null
        const isConsultant = role === 'property_consultant' || role === 'sales_manager'
        const bannerStyle = {
          border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e',
          padding: '10px 12px', borderRadius: 10, marginBottom: 12
        }
        return (
          <div style={bannerStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Edits Requested</div>
            <div>Financial team has requested edits to this deal. Please review and update the allowed fields (payment plan, address, etc.). Identity and unit data remain locked.</div>
            {isConsultant && (
              <div style={{ marginTop: 8 }}>
                <LoadingButton
                  onClick={async () => {
                    const notes = window.prompt('Optional note to confirm edits addressed:', '')
                    try {
                      const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/edits-addressed`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ notes: notes || '' })
                      })
                      const data = await resp.json().catch(() => null)
                      if (!resp.ok) {
                        notifyError(data?.error?.message || 'Failed to mark edits addressed')
                      } else {
                        notifySuccess('Marked edits addressed.')
                        await load()
                      }
                    } catch (err) {
                      notifyError(err, 'Failed to mark edits addressed')
                    }
                  }}
                >
                  Mark Edits Addressed
                </LoadingButton>
              </div>
            )}
          </div>
        )
      })()}

      {/* Actions — restrict printing offer until approved */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {canEdit && !editCalc && <LoadingButton onClick={() => setEditCalc(true)}>Edit in Calculator</LoadingButton>}
        {canSubmit && (
          <LoadingButton
            onClick={async () => {
              const savedPlan = deal?.details?.calculator?.generatedPlan
              if (!savedPlan || !Array.isArray(savedPlan.schedule) || savedPlan.schedule.length === 0) {
                notifyError('Please generate and save a payment plan before submitting.')
                return
              }
              setSubmitting(true)
              try {
                const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/submit`, { method: 'POST' })
                const data = await resp.json()
                if (!resp.ok) {
                  notifyError(data?.error?.message || 'Submit failed')
                } else {
                  notifySuccess('Deal submitted successfully.')
                  await load()
                }
              } catch (err) {
                notifyError(err, 'Submit failed')
              } finally {
                setSubmitting(false)
              }
            }}
            loading={submitting}
            variant="primary"
          >
            Submit for Approval
          </LoadingButton>
        )}

        {/* Request Override button for Property Consultant or Managers when evaluation is REJECT */}
        {evaluation?.decision === 'REJECT' && (role === 'property_consultant' || role === 'sales_manager' || role === 'financial_manager' || role === 'admin' || role === 'superadmin') && (
          <LoadingButton
            onClick={async () => {
              const reason = window.prompt('Provide a reason for override request (optional):', '')
              try {
                const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/request-override`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reason: reason || null })
                })
                const data = await resp.json()
                if (!resp.ok) {
                  notifyError(data?.error?.message || 'Failed to request override')
                } else {
                  notifySuccess('Override requested. Waiting for Sales Manager review.')
                  await load()
                }
              } catch (err) {
                notifyError(err, 'Failed to request override')
              }
            }}
          >
            Request Override
          </LoadingButton>
        )}
        <LoadingButton onClick={printSchedule}>Print Schedule</LoadingButton>
        {(role === 'property_consultant' && deal.status === 'approved') && (
          <LoadingButton onClick={() => generateDocFromSaved('pricing_form')}>Print Offer (Pricing Form PDF)</LoadingButton>
        )}
        {(role === 'financial_admin' && deal.status === 'approved') && (
          <>
            <LoadingButton onClick={() => generateDocFromSaved('reservation_form')}>Generate Reservation Form (PDF)</LoadingButton>
            <LoadingButton onClick={() => setShowEditModal(true)}>
              Request Edits From Consultant
            </LoadingButton>
          </>
        )}
        {(role === 'contract_person' && deal.status === 'approved') && (
          <LoadingButton onClick={() => generateDocFromSaved('contract')}>Generate Contract (PDF)</LoadingButton>
        )}
        <LoadingButton onClick={generateChecksSheetFromSaved}>Generate Checks Sheet (.xlsx)</LoadingButton>
        <LoadingButton
          onClick={async () => {
            if (!deal.sales_rep_id) {
              notifyError('Assign a Sales Rep first.')
              return
            }
            setCalcCommissionLoading(true)
            try {
              const resp = await fetchWithAuth(`${API_URL}/api/commissions/calc-and-save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deal_id: deal.id, sales_person_id: deal.sales_rep_id })
              })
              const data = await resp.json()
              if (!resp.ok) {
                notifyError(data?.error?.message || 'Failed to calculate commission')
              } else {
                notifySuccess(`Commission calculated: ${Number(data.commission.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
                await load()
              }
            } catch (err) {
              notifyError(err, 'Failed to calculate commission')
            } finally {
              setCalcCommissionLoading(false)
            }
          }}
          loading={calcCommissionLoading}
        >
          Calculate Commission
        </LoadingButton>
      </div>

      <h3>Audit Trail</h3>
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
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
            {history.map((h, idx) => (
              <tr key={h.id}>
                <td style={td}>{idx + 1}</td>
                <td style={td}>{h.action}</td>
                <td style={td}>{h.user_email || h.user_id}</td>
                <td style={td}>
                  {(() => {
                    const raw = h.notes || ''
                    let parsed = null
                    try {
                      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
                        parsed = JSON.parse(raw)
                      }
                    } catch {}
                    if (!parsed) return raw
                    const isAuto = parsed.event === 'auto_commission'
                    const sum = isAuto
                      ? `Auto commission — Policy: ${parsed?.policy?.name || parsed?.policy?.id || ''}, Amount: ${Number(parsed?.amounts?.commission || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      : 'Details'
                    const open = !!expandedNotes[h.id]
                    return (
                      <div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{sum}</span>
                          <button
                            type="button"
                            onClick={() => setExpandedNotes(s => ({ ...s, [h.id]: !s[h.id] }))}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}
                          >
                            {open ? 'Hide' : 'Show'} JSON
                          </button>
                        </div>
                        {open && (
                          <pre style={{ background: '#f6f8fa', padding: 8, borderRadius: 6, border: '1px solid #eef2f7', marginTop: 6, maxWidth: 640, overflow: 'auto' }}>
{JSON.stringify(parsed, null, 2)}
                          </pre>
                        )}
                      </div>
                    )
                  })()}
                </td>
                <td style={td}>{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>No history yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    {/* Edit Request Modal */}
      {showEditModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: 520, maxWidth: '90vw', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
            <h3 style={{ marginTop: 0 }}>Request Edits From Consultant</h3>
            <p style={{ color: '#6b7280', marginTop: 4 }}>Select the fields that need correction and optionally add a comment. Identity and unit data are locked after block approval.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={editFields.address} onChange={e => setEditFields(s => ({ ...s, address: e.target.checked }))} />
                Address
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={editFields.payment_plan} onChange={e => setEditFields(s => ({ ...s, payment_plan: e.target.checked }))} />
                Payment Plan
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={editFields.maintenance_date} onChange={e => setEditFields(s => ({ ...s, maintenance_date: e.target.checked }))} />
                Maintenance Deposit Date
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={editFields.offer_dates} onChange={e => setEditFields(s => ({ ...s, offer_dates: e.target.checked }))} />
                Offer/First Payment Dates
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Other (specify)</label>
              <input
                type="text"
                value={editFields.other}
                onChange={e => setEditFields(s => ({ ...s, other: e.target.value }))}
                style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d9e6', width: '100%' }}
                placeholder="e.g., POA clause text or custom note"
              />
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Comment</label>
              <textarea
                value={editReason}
                onChange={e => setEditReason(e.target.value)}
                style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d9e6', width: '100%', minHeight: 80 }}
                placeholder="Describe what needs to be changed"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <LoadingButton onClick={() => { setShowEditModal(false); setEditFields({ address: false, payment_plan: false, maintenance_date: false, offer_dates: false, other: '' }); setEditReason('') }}>Cancel</LoadingButton>
              <LoadingButton
                variant="primary"
                onClick={async () => {
                  const fields = ['address','payment_plan','maintenance_date','offer_dates'].filter(k => editFields[k])
                  if (editFields.other && editFields.other.trim()) fields.push(editFields.other.trim())
                  try {
                    const resp = await fetchWithAuth(`${API_URL}/api/deals/${id}/request-edits`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ reason: editReason || '', fields, comment: editReason || '' })
                    })
                    const data = await resp.json().catch(() => null)
                    if (!resp.ok) {
                      notifyError(data?.error?.message || 'Failed to request edits')
                    } else {
                      notifySuccess('Edit request sent to consultant.')
                      setShowEditModal(false)
                      setEditFields({ address: false, payment_plan: false, maintenance_date: false, offer_dates: false, other: '' })
                      setEditReason('')
                      await load()
                    }
                  } catch (err) {
                    notifyError(err, 'Failed to request edits')
                  }
                }}
              >
                Send Request
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}