import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import { th, td } from '../lib/ui.js'
import { generateReservationFormPdf } from '../lib/docExports.js'

export default function ReservationFormDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [rf, setRf] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/workflow/reservation-forms/${id}`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load reservation form')
      }
      setRf(data.reservation_form || data)
    } catch (e) {
      const msg = e.message || String(e)
      setError(msg)
      notifyError(msg, 'Failed to load reservation form')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  if (loading && !rf) return <p>Loading…</p>
  if (error && !rf) return <p style={{ color: '#e11d48' }}>{error}</p>
  if (!rf) return <p>No reservation form found.</p>

  const status = String(rf.status || '').toUpperCase()
  const dealId = rf.deal_id || rf.details?.deal_id || null
  const unitCode = rf.unit_code || rf.details?.unit_code || '-'
  const buyerName = rf.buyer_name || rf.details?.clientInfo?.buyer_name || '-'
  const reservationDate =
    rf.reservation_date || rf.details?.reservation_date || null
  const prelimAmount =
    rf.preliminary_payment != null
      ? rf.preliminary_payment
      : rf.details?.preliminary_payment ?? null
  const dp = rf.details?.dp || {}
  const dpTotal = dp.total
  const dpPrelim = dp.preliminary_amount
  const dpPrelimDate = dp.preliminary_date
  const dpPaidAmount = dp.paid_amount
  const dpPaidDate = dp.paid_date
  const dpRemaining = dp.remaining

  function statusColor() {
    const s = status.toLowerCase()
    if (s === 'approved') return '#16a34a'
    if (s === 'pending_approval') return '#2563eb'
    if (s === 'rejected' || s === 'cancelled') return '#dc2626'
    return '#64748b'
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          marginBottom: 12,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid #d1d9e6',
          background: '#fff',
          cursor: 'pointer'
        }}
      >
        ← Back
      </button>

      <h2 style={{ marginTop: 0 }}>Reservation Form #{rf.id}</h2>

      {/* Header summary */}
      <div
        style={{
          margin: '8px 0 12px 0',
          padding: '10px 12px',
          borderRadius: 10,
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16
        }}
      >
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
            <Link to={`/deals/${dealId}`}>#{dealId}</Link>
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
          <strong>Reservation Date:</strong>{' '}
          {reservationDate
            ? new Date(reservationDate).toISOString().slice(0, 10)
            : '-'}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button
          type="button"
          onClick={async () => {
            try {
              setPdfLoading(true)
              const body = {
                deal_id: dealId ? Number(dealId) : undefined,
                reservation_form_id: Number(rf.id)
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
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #4b5563',
            background: '#fff',
            color: '#111827',
            cursor: 'pointer'
          }}
        >
          {pdfLoading ? 'Generating…' : 'View Reservation Form PDF'}
        </button>
      </div>

      {/* Down payment breakdown */}
      <h3>Down Payment Breakdown</h3>
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
          <strong>Total Down Payment:</strong>{' '}
          {dpTotal != null
            ? Number(dpTotal).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            : '-'}
        </div>
        <div>
          <strong>Preliminary Payment:</strong>{' '}
          {dpPrelim != null
            ? Number(dpPrelim).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            : prelimAmount != null
            ? Number(prelimAmount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            : '-'}
        </div>
        <div>
          <strong>Preliminary Payment Date:</strong>{' '}
          {dpPrelimDate
            ? new Date(dpPrelimDate).toISOString().slice(0, 10)
            : '-'}
        </div>
        <div>
          <strong>Paid from Down Payment:</strong>{' '}
          {dpPaidAmount != null
            ? Number(dpPaidAmount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            : '-'}
        </div>
        <div>
          <strong>Paid Down Payment Date:</strong>{' '}
          {dpPaidDate
            ? new Date(dpPaidDate).toISOString().slice(0, 10)
            : '-'}
        </div>
        <div>
          <strong>Remaining Down Payment:</strong>{' '}
          {dpRemaining != null
            ? Number(dpRemaining).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            : '-'}
        </div>
      </div>

      {/* Raw JSON snapshot */}
      <h3>Raw Snapshot</h3>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        Full reservation_form row as returned by /api/workflow/reservation-forms/:id.
        This is kept for debugging and will be refined over time.
      </p>
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 12,
          background: '#111827',
          color: '#e5e7eb',
          overflow: 'auto'
        }}
      >
        <pre style={{ margin: 0, fontSize: 12 }}>
{JSON.stringify(rf, null, 2)}
        </pre>
      </div>
    </div>
  )
}