import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import { th, td } from '../lib/ui.js'
import { generateReservationFormPdf } from '../lib/docExports.js'

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [contract, setContract] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [dpSummary, setDpSummary] = useState(null)
  const [dpSummaryError, setDpSummaryError] = useState('')
  const [historyRows, setHistoryRows] = useState([])

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('auth_user') || '{}')
    } catch {
      return {}
    }
  })()
  const role = user?.role || 'user'

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/contracts/${id}`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load contract')
      }
      const c = data.contract || data
      setContract(c)

      // Load financial summary when we know deal_id
      const dealIdNum = Number(c.deal_id || 0)
      if (dealIdNum) {
        try {
          setDpSummaryError('')
          const sResp = await fetchWithAuth(`${API_URL}/api/deals/${dealIdNum}/financial-summary`)
          const sData = await sResp.json().catch(() => null)
          if (!sResp.ok) {
            setDpSummary(null)
            setDpSummaryError(sData?.error?.message || 'Failed to load financial summary')
          } else {
            setDpSummary(sData?.summary || null)
          }
        } catch (e) {
          setDpSummary(null)
          setDpSummaryError(e?.message || String(e))
        }
      } else {
        setDpSummary(null)
        setDpSummaryError('')
      }

      // Load contracts history
      try {
        const hResp = await fetchWithAuth(`${API_URL}/api/contracts/${c.id}/history`)
        const hData = await hResp.json().catch(() => ({}))
        if (hResp.ok && Array.isArray(hData.history)) {
          setHistoryRows(hData.history)
        } else {
          setHistoryRows([])
        }
      } catch {
        setHistoryRows([])
      }
    } catch (e) {
      const msg = e.message || String(e)
      setError(msg)
      notifyError(msg, 'Failed to load contract')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  if (loading && !contract) {
    return <p>Loading…</p>
  }

  if (error && !contract) {
    return <p style={{ color: '#e11d48' }}>{error}</p>
  }

  if (!contract) {
    return <p>No contract found.</p>
  }

  const status = String(contract.status || '').toUpperCase()
  const dealId = contract.deal_id || null
  const reservationFormId = contract.reservation_form_id || null
  const unitCode = contract.unit_code || contract.unit?.unit_code || '-'
  const buyerName = contract.buyer_name || contract.buyer || contract.client_name || '-'
  const createdAt = contract.created_at ? new Date(contract.created_at).toLocaleString() : '-'
  const updatedAt = contract.updated_at ? new Date(contract.updated_at).toLocaleString() : '-'

  function statusColor() {
    const s = status.toLowerCase()
    if (s === 'approved' || s === 'executed') return '#16a34a'
    if (s === 'pending_cm' || s === 'pending_tm') return '#2563eb'
    if (s === 'rejected') return '#dc2626'
    return '#64748b'
  }

  const canSubmitToCm = role === 'contract_person' && status === 'DRAFT'
  const canApproveAsCm = role === 'contract_manager' && status === 'DRAFT'
  const canApproveAsTm = (role === 'ceo' || role === 'chairman' || role === 'vice_chairman' || role === 'top_management') && status === 'PENDING_TM'
  const canRejectAsManager =
    (role === 'contract_manager' && (status === 'DRAFT' || status === 'PENDING_CM' || status === 'PENDING_TM')) ||
    (canApproveAsTm && status === 'PENDING_TM')
  const canExecute = role === 'contract_person' && status === 'APPROVED'
  const canGeneratePdf = !!dealId && (status === 'APPROVED' || status === 'EXECUTED')

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/contracts')}
        style={{ marginBottom: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}
      >
        ← Back to Contracts
      </button>

      <h2 style={{ marginTop: 0 }}>Contract #{contract.id}</h2>

      <div style={{
        margin: '8px 0 12px 0',
        padding: '10px 12px',
        borderRadius: 10,
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div>
          <strong>Status:</strong>{' '}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              background: '#fff',
              color: statusColor()
            }}
          >
            {status || '-'}
          </span>
        </div>
        <div>
          <strong>Deal:</strong>{' '}
          {dealId ? (
            <Link to={`/deals/${dealId}`}>
              #{dealId}
            </Link>
          ) : (
            '-'
          )}
        </div>
        <div>
          <strong>Reservation Form:</strong>{' '}
          {reservationFormId ? (
            <Link to={`/reservation-forms/${reservationFormId}`}>
              #{reservationFormId}
            </Link>
          ) : (
            '-'
          )}
        </div>
        <div>
          <strong>Unit:</strong> {unitCode}
        </div>
        <div>
          <strong>Buyer:</strong> {buyerName}
        </div>
        <div>
          <strong>Created:</strong> {createdAt}
        </div>
        <div>
          <strong>Last Updated:</strong> {updatedAt}
        </div>
      </div>

      {/* Actions bar – Phase 2: status transitions and PDF generation */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {canSubmitToCm && (
          <button
            type="button"
            onClick={async () => {
              try {
                setActionLoading(true)
                const resp = await fetchWithAuth(`${API_URL}/api/contracts/${contract.id}/approve-cm`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' }
                })
                const data = await resp.json().catch(() => ({}))
                if (!resp.ok) throw new Error(data?.error?.message || 'Failed to submit to CM')
                notifySuccess('Contract submitted to Contract Manager (pending TM).')
                await load()
              } catch (e) {
                notifyError(e, 'Failed to submit contract to CM')
              } finally {
                setActionLoading(false)
              }
            }}
            disabled={actionLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #1f6feb', background: '#1f6feb', color: '#fff', cursor: 'pointer' }}
          >
            {actionLoading ? 'Submitting…' : 'Submit to CM (draft → pending TM)'}
          </button>
        )}

        {canApproveAsCm && (
          <button
            type="button"
            onClick={async () => {
              try {
                setActionLoading(true)
                const resp = await fetchWithAuth(`${API_URL}/api/contracts/${contract.id}/approve-cm`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' }
                })
                const data = await resp.json().catch(() => ({}))
                if (!resp.ok) throw new Error(data?.error?.message || 'Failed to approve as CM')
                notifySuccess('Contract approved by CM (pending TM).')
                await load()
              } catch (e) {
                notifyError(e, 'Failed to approve contract (CM)')
              } finally {
                setActionLoading(false)
              }
            }}
            disabled={actionLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #10b981', background: '#10b981', color: '#fff', cursor: 'pointer' }}
          >
            {actionLoading ? 'Approving…' : 'Approve (CM → pending TM)'}
          </button>
        )}

        {canApproveAsTm && (
          <button
            type="button"
            onClick={async () => {
              try {
                setActionLoading(true)
                const resp = await fetchWithAuth(`${API_URL}/api/contracts/${contract.id}/approve-tm`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' }
                })
                const data = await resp.json().catch(() => ({}))
                if (!resp.ok) throw new Error(data?.error?.message || 'Failed to approve as TM')
                notifySuccess('Contract approved by Top Management.')
                await load()
              } catch (e) {
                notifyError(e, 'Failed to approve contract (TM)')
              } finally {
                setActionLoading(false)
              }
            }}
            disabled={actionLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', cursor: 'pointer' }}
          >
            {actionLoading ? 'Approving…' : 'Approve (TM → approved)'}
          </button>
        )}

        {canRejectAsManager && (
          <button
            type="button"
            onClick={async () => {
              const reason = window.prompt('Rejection reason (optional, stored server-side when supported):', '') || ''
              try {
                setActionLoading(true)
                const resp = await fetchWithAuth(`${API_URL}/api/contracts/${contract.id}/reject`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reason })
                })
                const data = await resp.json().catch(() => ({}))
                if (!resp.ok) throw new Error(data?.error?.message || 'Failed to reject contract')
                notifySuccess('Contract rejected.')
                await load()
              } catch (e) {
                notifyError(e, 'Failed to reject contract')
              } finally {
                setActionLoading(false)
              }
            }}
            disabled={actionLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #dc2626', background: '#fff', color: '#dc2626', cursor: 'pointer' }}
          >
            {actionLoading ? 'Rejecting…' : 'Reject'}
          </button>
        )}

        {canExecute && (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('Mark this contract as executed?')) return
              try {
                setActionLoading(true)
                const resp = await fetchWithAuth(`${API_URL}/api/contracts/${contract.id}/execute`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' }
                })
                const data = await resp.json().catch(() => ({}))
                if (!resp.ok) throw new Error(data?.error?.message || 'Failed to execute contract')
                notifySuccess('Contract marked as executed.')
                await load()
              } catch (e) {
                notifyError(e, 'Failed to execute contract')
              } finally {
                setActionLoading(false)
              }
            }}
            disabled={actionLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #a16207', background: '#a16207', color: '#fff', cursor: 'pointer' }}
          >
            {actionLoading ? 'Executing…' : 'Mark as Executed'}
          </button>
        )}

        {canGeneratePdf && (
          <button
            type="button"
            onClick={async () => {
              try {
                setPdfLoading(true)
                const body = {
                  documentType: 'contract',
                  deal_id: Number(dealId)
                }
                const resp = await fetchWithAuth(`${API_URL}/api/generate-document`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body)
                })
                if (!resp.ok) {
                  let errMsg = 'Failed to generate contract PDF'
                  try {
                    const j = await resp.json()
                    errMsg = j?.error?.message || errMsg
                  } catch {}
                  throw new Error(errMsg)
                }
                const blob = await resp.blob()
                const ts = new Date().toISOString().replace(/[:.]/g, '-')
                const filename = `contract_${contract.id || dealId || ts}.pdf`
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = filename
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                notifySuccess('Contract PDF generated successfully.')
              } catch (e) {
                notifyError(e, 'Failed to generate contract PDF')
              } finally {
                setPdfLoading(false)
              }
            }}
            disabled={pdfLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #4b5563', background: '#fff', color: '#111827', cursor: 'pointer' }}
          >
            {pdfLoading ? 'Generating PDF…' : 'Generate Contract PDF'}
          </button>
        )}

        {reservationFormId && (
          <button
            type="button"
            onClick={async () => {
              try {
                setPdfLoading(true)
                const body = {
                  deal_id: dealId ? Number(dealId) : undefined,
                  reservation_form_id: Number(reservationFormId)
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
                notifySuccess('Reservation Form PDF generated successfully.')
              } catch (e) {
                notifyError(e, 'Failed to generate Reservation Form PDF')
              } finally {
                setPdfLoading(false)
              }
            }}
            disabled={pdfLoading}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #4b5563', background: '#fff', color: '#111827', cursor: 'pointer' }}
          >
            {pdfLoading ? 'Generating…' : 'View Reservation Form PDF'}
          </button>
        )}
      </div>

      {/* Financial summary (down payment and remaining price) */}
      <h3>Financial Summary</h3>
      {dpSummaryError && (
        <p style={{ fontSize: 13, color: '#e11d48', marginTop: 0 }}>{dpSummaryError}</p>
      )}
      {dpSummary ? (
        <div
          style={{
            margin: '6px 0 16px 0',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #e5e7eb',
            background: '#fefce8',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16
          }}
        >
          <div>
            <strong>Total Price (excl. maintenance):</strong>{' '}
            {Number(dpSummary.total_excl || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          <div>
            <strong>Maintenance Deposit:</strong>{' '}
            {Number(dpSummary.maintenance_deposit || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          <div>
            <strong>Total Down Payment:</strong>{' '}
            {Number(dpSummary.dp_total || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          <div>
            <strong>Preliminary Payment:</strong>{' '}
            {Number(dpSummary.preliminary_amount || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          <div>
            <strong>Paid from Down Payment:</strong>{' '}
            {Number(dpSummary.paid_amount || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          <div>
            <strong>Remaining Down Payment:</strong>{' '}
            {Number(dpSummary.dp_remaining || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
          <div>
            <strong>Remaining Price after DP:</strong>{' '}
            {Number(dpSummary.remaining_after_dp || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </div>
        </div>
      ) : (
        !dpSummaryError && (
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
            No financial summary available for this contract&apos;s deal yet.
          </p>
        )
      )}

      {/* History table */}
      <h3>Approval History</h3>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        History entries are recorded whenever a contract is created, approved, rejected, or executed.
      </p>
      <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>When</th>
              <th style={th}>Action</th>
              <th style={th}>By</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.length === 0 && (
              <tr>
                <td style={td} colSpan={4}>No history entries yet.</td>
              </tr>
            )}
            {historyRows.map((h, idx) => (
              <tr key={h.id}>
                <td style={td}>{idx + 1}</td>
                <td style={td}>
                  {h.created_at ? new Date(h.created_at).toLocaleString() : '-'}
                </td>
                <td style={td}>{h.change_type || '-'}</td>
                <td style={td}>{h.changed_by_name || h.changed_by || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Raw JSON snapshot for debugging */}
      <h3>Raw Snapshot</h3>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        Full contract row as returned by /api/contracts/:id. This is kept for debugging and will be
        gradually replaced by structured sections.
      </p>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#111827', color: '#e5e7eb', overflow: 'auto' }}>
        <pre style={{ margin: 0, fontSize: 12 }}>
{JSON.stringify(contract, null, 2)}
        </pre>
      </div>
    </div>
  )
}