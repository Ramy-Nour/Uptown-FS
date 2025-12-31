import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import BrandHeader from '../lib/BrandHeader.jsx'
import { pageContainer, pageTitle, ctrl, btn, metaText, errorText } from '../lib/ui.js'
import LoadingButton from '../components/LoadingButton.jsx'

const badgeStyle = (bg, color) => ({
  padding: '2px 6px',
  borderRadius: 999,
  fontSize: 11,
  background: bg,
  color
})

function formatTs(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

function UnitHistoryEvents({ events }) {
  if (!events || events.length === 0) {
    return <p style={metaText}>No history events recorded for this unit.</p>
  }
  return (
    <div style={{ marginTop: 8 }}>
      {events.map((ev, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            gap: 8,
            padding: '6px 0',
            borderBottom: '1px solid #f1f5f9'
          }}
        >
          <div style={{ width: 170, fontSize: 12, color: '#6b7280' }}>
            {formatTs(ev.at)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
              {ev.label}
            </div>
            {ev.detail && (
              <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
                {ev.detail}
              </div>
            )}
            {Array.isArray(ev.badges) && ev.badges.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {ev.badges.map((b, i) => (
                  <span
                    key={i}
                    style={badgeStyle(b.bg || '#f8fafc', b.color || '#334155')}
                  >
                    {b.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function UnitHistory() {
  const [unitIdInput, setUnitIdInput] = useState('')
  const [unit, setUnit] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const location = useLocation()

  const handleLogout = async () => {
    try {
      const rt = localStorage.getItem('refresh_token')
      if (rt) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt })
        }).catch(() => {})
      }
    } finally {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('auth_user')
      window.location.href = '/login'
    }
  }

  async function loadHistory(e, explicitUnitId) {
    e && e.preventDefault()
    setError('')
    setUnit(null)
    setEvents([])

    const idNum = explicitUnitId != null ? Number(explicitUnitId) : Number(unitIdInput)
    if (!Number.isFinite(idNum) || idNum <= 0) {
      setError('Please enter a valid Unit ID (positive number). You can copy it from the Inventory page or use the search below.')
      return
    }

    try {
      setLoading(true)
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-history?unit_id=${idNum}`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to load unit history')
      }
      setUnit(data.unit || null)
      setEvents(Array.isArray(data.events) ? data.events : [])
      setUnitIdInput(String(idNum))
    } catch (e2) {
      setError(e2.message || String(e2))
    } finally {
      setLoading(false)
    }
  }

  async function runSearch(e) {
    e && e.preventDefault()
    setError('')
    setSearchResults([])
    const q = String(searchQuery || '').trim()
    if (!q) {
      setError('Enter a unit code, type, or keyword to search.')
      return
    }
    try {
      setSearchLoading(true)
      const params = new URLSearchParams()
      params.set('search', q)
      params.set('page', '1')
      params.set('pageSize', '20')
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units?${params.toString()}`)
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Failed to search units')
      }
      setSearchResults(Array.isArray(data.units) ? data.units : [])
    } catch (e2) {
      setError(e2.message || String(e2))
    } finally {
      setSearchLoading(false)
    }
  }

  // When opened with /admin/unit-history?unitId=123, auto-load that unit
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || '')
      const fromQuery = params.get('unitId') || params.get('unit_id')
      if (fromQuery && Number(fromQuery) > 0) {
        setUnitIdInput(fromQuery)
        loadHistory(null, fromQuery)
      }
    } catch {
      // ignore malformed query strings
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>Unit Lifecycle History</h2>
        <p style={metaText}>
          View a chronological history of a unit across Block, Reservation, and Contract stages.
          This includes who blocked and unblocked the unit, reservation approvals/rejections, and
          contract lifecycle (draft &rarr; approvals &rarr; executed) where available.
        </p>
        <form
          onSubmit={loadHistory}
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}
        >
          <input
            type="number"
            min={1}
            placeholder="Enter Unit ID (e.g., 123)"
            value={unitIdInput}
            onChange={e => setUnitIdInput(e.target.value)}
            style={{ ...ctrl, maxWidth: 220 }}
          />
          <LoadingButton type="submit" loading={loading} style={btn}>
            {loading ? 'Loading…' : 'Load History'}
          </LoadingButton>
          <span style={metaText}>
            Tip: You can either enter a Unit ID directly or search by unit code/name below.
          </span>
        </form>

        <form
          onSubmit={runSearch}
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}
        >
          <input
            type="text"
            placeholder="Search units by code, type, or zone…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ ...ctrl, maxWidth: 260 }}
          />
          <LoadingButton type="submit" loading={searchLoading} style={btn}>
            {searchLoading ? 'Searching…' : 'Search Units'}
          </LoadingButton>
        </form>

        {error ? <p style={errorText}>{error}</p> : null}

        {searchResults.length > 0 && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 10,
              marginBottom: 12,
              background: '#f9fafb'
            }}
          >
            <div style={{ ...metaText, marginBottom: 6 }}>
              Select a unit from the search results to load its history:
            </div>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {searchResults.map(u => (
                <div
                  key={u.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 0',
                    borderBottom: '1px solid #e5e7eb'
                  }}
                >
                  <div style={{ fontSize: 13 }}>
                    <strong>{u.code}</strong> (ID: {u.id}) — {u.unit_status || '-'} — {u.unit_type || ''}
                  </div>
                  <LoadingButton
                    type="button"
                    style={btn}
                    onClick={() => loadHistory(null, u.id)}
                  >
                    View History
                  </LoadingButton>
                </div>
              ))}
            </div>
          </div>
        )}

        {unit && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              background: '#f9fafb'
            }}
          >
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <strong>Unit:</strong> {unit.code} (ID: {unit.id})
            </div>
            <div style={{ fontSize: 12, color: '#4b5563', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>
                <strong>Status:</strong> {unit.unit_status || '-'}
              </span>
              <span>
                <strong>Availability:</strong> {unit.available === false ? 'UNAVAILABLE' : 'AVAILABLE'}
              </span>
              <span>
                <strong>Type:</strong> {unit.unit_type || '-'}
              </span>
            </div>
          </div>
        )}
        <UnitHistoryEvents events={events} />
      </div>
    </div>
  )
}