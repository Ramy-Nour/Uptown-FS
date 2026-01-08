import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { notifyError, notifySuccess } from '../lib/notifications.js'

export default function SettingsUnlockRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('pending')

  async function loadRequests() {
    try {
      setLoading(true)
      setError('')
      const resp = await fetchWithAuth(`${API_URL}/api/deals/settings-unlock-requests?status=${filter}`)
      const data = await resp.json()
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load requests')
      }
      setRequests(data.requests || [])
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [filter])

  async function handleApprove(requestId) {
    if (!confirm('Approve this request? The contract settings will be unlocked for editing.')) return
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/deals/settings-unlock-requests/${requestId}/approve`, {
        method: 'POST'
      })
      const data = await resp.json()
      if (resp.ok) {
        notifySuccess('Request approved, settings unlocked')
        loadRequests()
      } else {
        notifyError(data?.error?.message || 'Failed to approve')
      }
    } catch (e) {
      notifyError(e.message)
    }
  }

  async function handleReject(requestId) {
    if (!confirm('Reject this request?')) return
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/deals/settings-unlock-requests/${requestId}/reject`, {
        method: 'POST'
      })
      const data = await resp.json()
      if (resp.ok) {
        notifySuccess('Request rejected')
        loadRequests()
      } else {
        notifyError(data?.error?.message || 'Failed to reject')
      }
    } catch (e) {
      notifyError(e.message)
    }
  }

  const formatDate = (d) => {
    if (!d) return '-'
    return new Date(d).toLocaleString('en-EG', { dateStyle: 'medium', timeStyle: 'short' })
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Contract Settings Unlock Requests</h1>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: filter === s ? '2px solid #2563eb' : '1px solid #d1d5db',
              background: filter === s ? '#eff6ff' : '#fff',
              fontWeight: filter === s ? 600 : 400,
              cursor: 'pointer',
              textTransform: 'capitalize'
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: '#e11d48' }}>{error}</p>}

      {!loading && requests.length === 0 && (
        <p style={{ color: '#6b7280' }}>No {filter} requests found.</p>
      )}

      {!loading && requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {requests.map(req => (
            <div 
              key={req.id} 
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 16
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    <Link to={`/contracts/${req.deal_id}`} style={{ color: '#2563eb' }}>
                      Deal #{req.deal_id}: {req.deal_title || 'Untitled'}
                    </Link>
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                    Requested by: <strong>{req.requested_by_name || req.requested_by_email}</strong>
                    <span style={{ marginLeft: 12 }}>on {formatDate(req.created_at)}</span>
                  </div>
                  {req.reason && (
                    <div style={{ fontSize: 13, padding: 8, background: '#f9fafb', borderRadius: 6, marginBottom: 8 }}>
                      <strong>Reason:</strong> {req.reason}
                    </div>
                  )}
                </div>
                
                {filter === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => handleApprove(req.id)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#10b981',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: '1px solid #ef4444',
                        background: '#fff',
                        color: '#ef4444',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                )}
                
                {filter !== 'pending' && (
                  <div style={{ 
                    padding: '4px 10px', 
                    borderRadius: 12, 
                    fontSize: 12, 
                    fontWeight: 600,
                    background: filter === 'approved' ? '#d1fae5' : '#fee2e2',
                    color: filter === 'approved' ? '#065f46' : '#b91c1c'
                  }}>
                    {filter === 'approved' ? '✓ Approved' : '✕ Rejected'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
