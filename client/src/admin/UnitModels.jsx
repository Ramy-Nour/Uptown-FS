import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { th, td, ctrl, btn, btnPrimary, btnDanger, tableWrap, table, pageContainer, pageTitle, metaText, errorText } from '../lib/ui.js'

/*
  Unit Models management for Financial Manager:
  Fields:
    - model_name (string, required)
    - area (number, required)
    - orientation (enum: left, right, whole_floor)
    - has_garden (boolean)
    - garden_area (number, optional)
    - has_roof (boolean)
    - roof_area (number, optional)
    - garage_area (number, optional)
    - garage_standard_code (string, optional)

  API (assumed):
    GET    /api/inventory/unit-models?search=&page=&pageSize=
    POST   /api/inventory/unit-models
    PATCH  /api/inventory/unit-models/:id
    DELETE /api/inventory/unit-models/:id
    GET    /api/inventory/unit-models/:id/audit   (for history)
*/

export default function UnitModels() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(0)
  const [form, setForm] = useState({
    model_name: '',
    model_code: '',
    area: '',
    orientation: 'left',
    has_garden: false,
    garden_area: '',
    has_roof: false,
    roof_area: '',
    garage_area: ''
  })

  // History modal
  const [historyForId, setHistoryForId] = useState(null)
  const [historyItems, setHistoryItems] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  function resetForm() {
    setForm({
      model_name: '',
      model_code: '',
      area: '',
      orientation: 'left',
      has_garden: false,
      garden_area: '',
      has_roof: false,
      roof_area: '',
      garage_area: ''
    })
    setEditingId(0)
  }

  function friendlyError(e, fallback) {
    const msg = (e && e.message) ? e.message : String(e || '')
    if (!navigator.onLine) return 'You appear to be offline.'
    if (/Failed to fetch|NetworkError|TypeError/i.test(msg)) {
      return 'Cannot reach the API server. Please ensure containers are running.'
    }
    return msg || fallback
  }

  async function load(p = page) {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      if (search) q.set('search', search)
      q.set('page', String(p))
      q.set('pageSize', String(pageSize))
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load models')
      setItems(data.items || data.models || [])
      setTotal(data.pagination?.total || data.total || 0)
    } catch (e) {
      setError(friendlyError(e, 'Failed to load models'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1) }, [search, pageSize])
  useEffect(() => { load(page) }, [page])

  async function save(e) {
    e && e.preventDefault()
    try {
      setSaving(true)
      const body = {
        model_name: (form.model_name || '').trim(),
        model_code: (form.model_code || '').trim() || null,
        area: Number(form.area) || 0,
        orientation: form.orientation || 'left',
        has_garden: !!form.has_garden,
        garden_area: form.has_garden ? (Number(form.garden_area) || 0) : 0,
        has_roof: !!form.has_roof,
        roof_area: form.has_roof ? (Number(form.roof_area) || 0) : 0,
        garage_area: Number(form.garage_area) || 0
      }
      let resp
      if (editingId) {
        resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      } else {
        resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      }
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Save failed')
      resetForm()
      await load()
    } catch (e) {
      alert(friendlyError(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setForm({
      model_name: item.model_name || '',
      model_code: item.model_code || '',
      area: String(item.area ?? ''),
      orientation: item.orientation || 'left',
      has_garden: !!item.has_garden,
      garden_area: String(item.garden_area ?? ''),
      has_roof: !!item.has_roof,
      roof_area: String(item.roof_area ?? ''),
      garage_area: String(item.garage_area ?? '')
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(id) {
    if (!confirm('Delete this model?')) return
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/${id}`, { method: 'DELETE' })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Delete failed')
      await load()
    } catch (e) {
      alert(friendlyError(e, 'Delete failed'))
    }
  }

  async function openHistory(id) {
    setHistoryForId(id)
    setHistoryLoading(true)
    setHistoryItems([])
    try {
      // Fetch applied audit entries
      const [auditResp, pendingResp, rejectedResp] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/inventory/unit-models/${id}/audit`),
        fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes?status=pending_approval`),
        fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes?status=rejected`)
      ])
      const auditData = await auditResp.json().catch(() => ({}))
      if (!auditResp.ok) throw new Error(auditData?.error?.message || 'Failed to load history')
      const auditItems = (auditData.audit || []).map(a => ({ ...a, _kind: 'audit' }))

      // Fetch pending and rejected change requests and filter for this model
      const pendingData = await pendingResp.json().catch(() => ({}))
      const rejectedData = await rejectedResp.json().catch(() => ({}))
      const byStatus = (src, status) => (src?.changes || []).filter(ch => Number(ch.model_id) === Number(id)).map(ch => ({
        id: `change-${ch.id}`,
        action: ch.action,
        changed_by: ch.requested_by,
        changed_by_email: ch.requested_by_email,
        created_at: ch.created_at,
        details: { status, payload: ch.payload, reason: ch.reason || null },
        _kind: 'change',
        _status: status
      }))
      const changeItems = [
        ...byStatus(pendingData, 'pending_approval'),
        ...byStatus(rejectedData, 'rejected')
      ]

      // Merge and sort by created_at desc
      const merged = [...auditItems, ...changeItems].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0
        return tb - ta
      })
      setHistoryItems(merged)
    } catch (e) {
      alert(friendlyError(e, 'Failed to load history'))
    } finally {
      setHistoryLoading(false)
    }
  }

  function closeHistory() {
    setHistoryForId(null)
    setHistoryItems([])
    setHistoryLoading(false)
  }

  const orientationOptions = [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
    { value: 'whole_floor', label: 'Whole Floor' }
  ]

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

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

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={pageTitle}>Unit Models</h2>
          {editingId ? <button type="button" onClick={resetForm} style={btn}>New</button> : null}
        </div>

        <div style={{ border: '1px solid #e6eaf0', borderRadius: 12, padding: 10, marginBottom: 10, background: '#fff' }}>
          <span style={metaText}>
            Note: All create/update/delete requests require approval from Top Management before they take effect.
            You can track status under <a href="/admin/unit-model-changes">Unit Model Changes</a>.
          </span>
        </div>

        <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 12 }}>
          <input placeholder="Model Name" value={form.model_name} onChange={e => setForm(s => ({ ...s, model_name: e.target.value }))} style={ctrl} required />
          <input placeholder="Model Code" value={form.model_code || ''} onChange={e => setForm(s => ({ ...s, model_code: e.target.value }))} style={ctrl} />
          <input type="number" placeholder="Area (m²)" value={form.area} onChange={e => setForm(s => ({ ...s, area: e.target.value }))} style={ctrl} required />
          <select value={form.orientation} onChange={e => setForm(s => ({ ...s, orientation: e.target.value }))} style={ctrl}>
            {orientationOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.has_garden} onChange={e => setForm(s => ({ ...s, has_garden: e.target.checked, garden_area: e.target.checked ? s.garden_area : '' }))} />
            <span style={metaText}>With Garden?</span>
          </label>
          <input type="number" placeholder="Garden Area (m²)" value={form.garden_area} onChange={e => setForm(s => ({ ...s, garden_area: e.target.value }))} style={ctrl} disabled={!form.has_garden} />
          <div>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving ? 'Submit Change…' : (editingId ? 'Submit Update' : 'Submit Create')}</button>
            {editingId ? <button type="button" onClick={resetForm} style={btn}>Cancel</button> : null}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.has_roof} onChange={e => setForm(s => ({ ...s, has_roof: e.target.checked, roof_area: e.target.checked ? s.roof_area : '' }))} />
            <span style={metaText}>With Roof?</span>
          </label>
          <input type="number" placeholder="Roof Area (m²)" value={form.roof_area} onChange={e => setForm(s => ({ ...s, roof_area: e.target.value }))} style={ctrl} disabled={!form.has_roof} />
          <input type="number" placeholder="Garage Area (m²)" value={form.garage_area} onChange={e => setForm(s => ({ ...s, garage_area: e.target.value }))} style={ctrl} />
          <div style={{ gridColumn: '1 / span 6' }}>
            <span style={metaText}>
              You can mark both Garden and Roof if applicable. Areas are optional when unchecked.
            </span>
          </div>
        </form>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={ctrl} />
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={ctrl}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        {error ? <p style={errorText}>{error}</p> : null}

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Model Name</th>
                <th style={th}>Area (m²)</th>
                <th style={th}>Orientation</th>
                <th style={th}>Garden</th>
                <th style={th}>Roof</th>
                <th style={th}>Garage Area</th>
                <th style={th}>Created</th>
                <th style={th}>Updated</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td style={td}>{it.id}</td>
                  <td style={td}>{it.model_name}</td>
                  <td style={td}>{Number(it.area || 0).toLocaleString()}</td>
                  <td style={td}>{String(it.orientation || '').replace(/_/g, ' ')}</td>
                  <td style={td}>{it.has_garden ? `Yes${it.garden_area ? ` (${it.garden_area} m²)` : ''}` : 'No'}</td>
                  <td style={td}>{it.has_roof ? `Yes${it.roof_area ? ` (${it.roof_area} m²)` : ''}` : 'No'}</td>
                  <td style={td}>{it.garage_area || 0}</td>
                  <td style={td}>{it.created_at ? new Date(it.created_at).toLocaleString() : '—'}</td>
                  <td style={td}>{it.updated_at ? new Date(it.updated_at).toLocaleString() : '—'}</td>
                  <td style={td}>
                    <button onClick={() => startEdit(it)} style={btn}>Edit</button>
                    <button onClick={() => openHistory(it.id)} style={btn}>History</button>
                    <button onClick={() => remove(it.id)} style={btnDanger}>Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={10}>No models.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <span style={metaText}>
            Page {page} of {totalPages} — {total} total
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(1)} disabled={page === 1} style={btn}>First</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={btn}>Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={btn}>Next</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} style={btn}>Last</button>
          </div>
        </div>

        {historyForId !== null && (
          <div className="fixed inset-0" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: 800 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Change History — Model #{historyForId}</h3>
                <button onClick={closeHistory} style={btn}>Close</button>
              </div>
              <div style={{ padding: 12, maxHeight: '65vh', overflowY: 'auto' }}>
                {historyLoading ? (
                  <div style={metaText}>Loading…</div>
                ) : historyItems.length === 0 ? (
                  <div style={metaText}>No history found.</div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {historyItems.map(h => (
                      <li key={h.id} style={{ borderBottom: '1px solid #f2f5fa', padding: '8px 0' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong>{h.action || 'update'}</strong>
                          {h._kind === 'change' ? (
                            <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, background: h._status === 'rejected' ? '#fee2e2' : '#fef3c7', color: '#374151' }}>
                              {h._status}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, background: '#dcfce7', color: '#065f46' }}>
                              applied
                            </span>
                          )}
                          <span style={metaText}>— {h.created_at ? new Date(h.created_at).toLocaleString() : ''}</span>
                        </div>
                        <div style={metaText}>By: {h.changed_by_email || h.changed_by || ''}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                          {h.details ? (typeof h.details === 'string' ? h.details : JSON.stringify(h.details, null, 2)) : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
                <button onClick={closeHistory} style={btn}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}