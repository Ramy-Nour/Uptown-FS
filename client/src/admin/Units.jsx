import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { th, td, ctrl, btn, btnPrimary, tableWrap, table, pageContainer, pageTitle, metaText, errorText } from '../lib/ui.js'
import BrandHeader from '../lib/BrandHeader.jsx'
import LoadingButton from '../components/LoadingButton.jsx'
import SkeletonRow from '../components/SkeletonRow.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'
import ConfirmModal from '../components/ConfirmModal.jsx'

export default function Units() {
  const [units, setUnits] = useState([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [deletingIds, setDeletingIds] = useState(new Set())

  // unit models (used for filter and FA linking)
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState('')
  const [filterModelId, setFilterModelId] = useState('')
  const modelMap = React.useMemo(() => {
    const m = {}
    models.forEach(x => { m[x.id] = x })
    return m
  }, [models])

  // current user role
  const role = JSON.parse(localStorage.getItem('auth_user') || '{}')?.role

  // form state
  const [form, setForm] = useState({
    code: '',
    description: '',
    unit_type: '',
    base_price: '',
    currency: 'EGP',
    model_id: '',
    // Optional inventory metadata (FA can send these on create)
    unit_number: '',
    floor: '',
    building_number: '',
    block_sector: '',
    zone: '',
    garden_details: ''
  })
  const [editingId, setEditingId] = useState(0)
  const [saving, setSaving] = useState(false)

  // Removed inline link-request state: link requests are disabled; units are created already linked to a model

  async function load(p = page) {
    try {
      setLoading(true)
      setError('')
      const q = new URLSearchParams()
      if (search) q.set('search', search)
      if (filterModelId) q.set('model_id', String(filterModelId))
      q.set('page', String(p))
      q.set('pageSize', String(pageSize))
      const resp = await fetchWithAuth(`${API_URL}/api/inventory/units?${q.toString()}`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load units')
      setUnits(data.units || [])
      setTotal(Number(data.pagination?.total || 0))
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load units')
    } finally {
      setLoading(false)
    }
  }

  // Load models for filter and FA linking (attempt for any role; ignore auth errors)
  useEffect(() => {
    let abort = false
    async function run() {
      try {
        setModelsError('')
        const resp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models?page=1&pageSize=500`)
        const data = await resp.json()
        if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load unit models')
        if (!abort) setModels(data.items || [])
      } catch (e) {
        // Silently ignore if not authorized; filter will be hidden
        if (!abort) setModelsError(String(e.message || e))
      }
    }
    run()
    return () => { abort = true }
  }, [role])

  useEffect(() => { load(1) }, [search, pageSize, filterModelId])
  useEffect(() => { load(page) }, [page])

  function resetForm() {
    setForm({
      code: '',
      description: '',
      unit_type: '',
      base_price: '',
      currency: 'EGP',
      model_id: '',
      unit_number: '',
      floor: '',
      building_number: '',
      block_sector: '',
      zone: '',
      garden_details: ''
    })
    setEditingId(0)
  }

  async function saveUnit(e) {
    e && e.preventDefault()
    try {
      setSaving(true)
      let resp
      let createdOrEditedId = editingId

      if (role === 'financial_admin') {
        // FA: require model selection and create unit already linked to model (draft)
        if (!form.model_id) {
          throw new Error('Please select a unit model to link. It is required.')
        }
        const faBody = {
          code: String(form.code || '').trim(),
          model_id: Number(form.model_id),
          // include optional inventory metadata if provided
          unit_number: form.unit_number || undefined,
          floor: form.floor || undefined,
          building_number: form.building_number || undefined,
          block_sector: form.block_sector || undefined,
          zone: form.zone || undefined,
          garden_details: form.garden_details || undefined
        }
        if (!faBody.code) throw new Error('Code is required')
        resp = await fetchWithAuth(`${API_URL}/api/inventory/units`, { // Use inventory route
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(faBody)
        })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data?.error?.message || 'Save failed')
        createdOrEditedId = data?.unit?.id
        notifySuccess('Unit draft created and linked to model. Awaiting Financial Manager approval.')
      } else { // Superadmin path
        const body = {
          ...form,
          base_price: Number(form.base_price) || 0,
          currency: (form.currency || 'EGP').toUpperCase(),
          ...(form.model_id ? { model_id: Number(form.model_id) } : {})
        }
        if (editingId) {
          resp = await fetchWithAuth(`${API_URL}/api/units/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
        } else {
          resp = await fetchWithAuth(`${API_URL}/api/units`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
        }
        const data = await resp.json()
        if (!resp.ok) throw new Error(data?.error?.message || 'Save failed')
        createdOrEditedId = editingId || data?.unit?.id
        notifySuccess(editingId ? 'Unit updated' : 'Unit created')
      }

      resetForm()
      await load()
    } catch (e) {
      notifyError(e, 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function edit(u) {
    setEditingId(u.id)
    setForm({
      code: u.code || '',
      description: u.description || '',
      unit_type: u.unit_type || '',
      base_price: String(u.base_price ?? ''),
      currency: u.currency || 'EGP',
      model_id: u.model_id ? String(u.model_id) : '',
      unit_number: u.unit_number || '',
      floor: u.floor || '',
      building_number: u.building_number || '',
      block_sector: u.block_sector || '',
      zone: u.zone || '',
      garden_details: u.garden_details || ''
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState(0)

  async function performDelete(id) {
    // optimistic removal
    const prev = units
    setUnits(u => u.filter(x => x.id !== id))
    setTotal(t => Math.max(0, t - 1))
    setDeletingIds(s => new Set([...s, id]))
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/units/${id}`, { method: 'DELETE' })
      let msg = ''
      try {
        const j = await resp.json()
        msg = j?.error?.message || ''
      } catch {}
      if (!resp.ok) {
        setUnits(prev)
        setTotal(t => t + 1)
        notifyError({ message: msg || 'Delete failed' })
      } else {
        notifySuccess('Unit deleted successfully.')
      }
    } catch (e) {
      setUnits(prev)
      setTotal(t => t + 1)
      notifyError(e, 'Delete failed')
    } finally {
      setDeletingIds(s => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }
  }

  // Removed submitLinkRequest: link requests are disabled; units must be created already linked to a model with approved pricing.

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
        <h2 style={pageTitle}>Units Catalog</h2>

        <form onSubmit={saveUnit} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 12 }}>
          <input placeholder="Code" value={form.code} onChange={e => setForm(s => ({ ...s, code: e.target.value }))} style={ctrl} required />
          {role !== 'financial_admin' && (
            <>
              <input placeholder="Description" value={form.description} onChange={e => setForm(s => ({ ...s, description: e.target.value }))} style={ctrl} />
              <input placeholder="Unit Type" value={form.unit_type} onChange={e => setForm(s => ({ ...s, unit_type: e.target.value }))} style={ctrl} />
              <input type="number" placeholder="Base Price" value={form.base_price} onChange={e => setForm(s => ({ ...s, base_price: e.target.value }))} style={ctrl} />
              <select value={form.currency} onChange={e => setForm(s => ({ ...s, currency: e.target.value }))} style={ctrl}>
                <option value="EGP">EGP</option>
                <option value="USD">USD</option>
                <option value="SAR">SAR</option>
                <option value="EUR">EUR</option>
                <option value="AED">AED</option>
                <option value="KWD">KWD</option>
              </select>
            </>
          )}
          {role === 'financial_admin' && (
            <>
              <input placeholder="Unit Number" value={form.unit_number} onChange={e => setForm(s => ({ ...s, unit_number: e.target.value }))} style={ctrl} />
              <input placeholder="Floor" value={form.floor} onChange={e => setForm(s => ({ ...s, floor: e.target.value }))} style={ctrl} />
              <input placeholder="Building Number" value={form.building_number} onChange={e => setForm(s => ({ ...s, building_number: e.target.value }))} style={ctrl} />
              <input placeholder="Block/Sector" value={form.block_sector} onChange={e => setForm(s => ({ ...s, block_sector: e.target.value }))} style={ctrl} />
              <input placeholder="Zone" value={form.zone} onChange={e => setForm(s => ({ ...s, zone: e.target.value }))} style={ctrl} />
              <input placeholder="Garden Details" value={form.garden_details} onChange={e => setForm(s => ({ ...s, garden_details: e.target.value }))} style={ctrl} />
            </>
          )}
          <div>
            <LoadingButton type="submit" loading={saving} variant="primary">{saving ? 'Saving…' : (editingId ? 'Update' : 'Create')}</LoadingButton>
            {editingId ? <LoadingButton type="button" onClick={resetForm} style={btn}>Cancel</LoadingButton> : null}
          </div>
        </form>

        {role === 'financial_admin' && (
          <div style={{ border: '1px solid #e6eaf0', borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={metaText}>Link to Unit Model (required)</div>
                <select value={form.model_id} onChange={e => setForm(s => ({ ...s, model_id: e.target.value }))} style={ctrl} required>
                  <option value="">— Select a model —</option>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.model_code ? `${m.model_code} — ` : ''}{m.model_name} {m.area ? `(${m.area} m²)` : ''}
                    </option>
                  ))}
                </select>
                {modelsError ? <div style={errorText}>{modelsError}</div> : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <span style={metaText}>Financial Admin must select a model with approved standard pricing. The unit will be created as a draft already linked to the selected model, with prices and areas propagated. Financial Manager approval is required to finalize.</span>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={ctrl} />
          {models.length > 0 && (
            <select value={filterModelId} onChange={e => setFilterModelId(e.target.value)} style={ctrl}>
              <option value="">All Models</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.model_code ? `${m.model_code} — ` : ''}{m.model_name}
                </option>
              ))}
            </select>
          )}
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={ctrl}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        {error ? <p style={errorText}>{error}</p> : null}

        {/* --- FIXED TABLE SECTION --- */}
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Code</th>
                <th style={th}>Unit No.</th>
                <th style={th}>Floor</th>
                <th style={th}>Building</th>
                <th style={th}>Block/Sector</th>
                <th style={th}>Zone</th>
                <th style={th}>Unit Model</th>
                <th style={th}>Area (m²)</th>
                <th style={th}>Garden</th>
                <th style={th}>Roof</th>
                <th style={th}>Total Price</th>
                <th style={th}>Currency</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <>
                  {Array.from({ length: pageSize }).map((_, i) => (
                    <SkeletonRow key={i} widths={['sm','lg','md','sm','sm','md','sm','lg','sm','sm','sm','lg','sm','sm','lg']} tdStyle={td} />
                  ))}
                </>
              )}
              {!loading && units.map(unit => (
                <tr key={unit.id}>
                  <td style={td}>{unit.id}</td>
                  <td style={td}>{unit.code}</td>
                  <td style={td}>{unit.unit_number || '-'}</td>
                  <td style={td}>{unit.floor || '-'}</td>
                  <td style={td}>{unit.building_number || '-'}</td>
                  <td style={td}>{unit.block_sector || '-'}</td>
                  <td style={td}>{unit.zone || '-'}</td>
                  <td style={td}>
                    {(() => {
                      // Prefer fields returned directly from API
                      const fromApi = unit.model_code ? `${unit.model_code} — ${unit.model_name || ''}`.trim() : (unit.model_name || '')
                      if (fromApi) return fromApi
                      // Fallback to loaded models map if available
                      const m = modelMap[unit.model_id]
                      if (m) return m.model_code ? `${m.model_code} — ${m.model_name}` : (m.model_name || `#${unit.model_id}`)
                      // Final fallback
                      return unit.model_id ? `#${unit.model_id}` : '-'
                    })()}
                  </td>
                  <td style={td}>{unit.area ? Number(unit.area).toLocaleString() : '-'}</td>
                  <td style={td}>{unit.garden_available ? `Yes (${Number(unit.garden_area).toLocaleString()} m²)` : 'No'}</td>
                  <td style={td}>{unit.roof_available ? `Yes (${Number(unit.roof_area).toLocaleString()} m²)` : 'No'}</td>
                  <td style={td}>{unit.total_price ? Number(unit.total_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                  <td style={td}>{unit.currency}</td>
                  <td style={td}>{unit.unit_status}</td>
                  <td style={{ ...td, display: 'flex', gap: 8 }}>
                    <LoadingButton onClick={() => edit(unit)}>Edit</LoadingButton>
                    <LoadingButton onClick={() => setConfirmDeleteId(unit.id)} loading={deletingIds.has(unit.id)} style={{ ...btn, border: '1px solid #dc262#dc2626' }}>
                      Delete
                    </LoadingButton>
                    {/* Link model UI removed: link requests are disabled; use model selection during creation */}
                  </td>
                </tr>
              ))}
              {units.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={15}>No units found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* --- END OF FIXED TABLE SECTION --- */}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <span style={metaText}>
            Page {page} of {totalPages} — {total} total
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <LoadingButton onClick={() => setPage(1)} disabled={page === 1 || loading}>First</LoadingButton>
            <LoadingButton onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading}>Prev</LoadingButton>
            <LoadingButton onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>Next</LoadingButton>
            <LoadingButton onClick={() => setPage(totalPages)} disabled={page >= totalPages || loading}>Last</LoadingButton>
          </div>
        </div>
      </div>
      <ConfirmModal
        open={!!confirmDeleteId}
        title="Delete Unit"
        message="Are you sure you want to delete this unit? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => { const id = confirmDeleteId; setConfirmDeleteId(0); performDelete(id) }}
        onCancel={() => setConfirmDeleteId(0)}
      />
    </div>
  )
}