import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError } from '../lib/notifications.js'
import { th, td } from '../lib/ui.js'

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [contract, setContract] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/contracts/${id}`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load contract')
      }
      setContract(data.contract || data)
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
        margin: '8px 0 16px 0',
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

      <h3>Snapshot</h3>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
        This section will eventually show the full contract snapshot (reservation, down payment breakdown,
        calculator details, and approval trail). For Phase 1 it renders the raw payload for inspection only.
      </p>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#111827', color: '#e5e7eb', overflow: 'auto' }}>
        <pre style={{ margin: 0, fontSize: 12 }}>
{JSON.stringify(contract, null, 2)}
        </pre>
      </div>
    </div>
  )
}