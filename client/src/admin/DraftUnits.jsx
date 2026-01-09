import React, { useEffect, useState } from 'react'
import BrandHeader from '../lib/BrandHeader.jsx'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import { th, td, btn, btnPrimary, tableWrap, table, pageContainer, pageTitle, metaText, errorText } from '../lib/ui.js'
import LoadingButton from '../components/LoadingButton.jsx'
import SkeletonRow from '../components/SkeletonRow.jsx'
import { notifyError, notifySuccess } from '../lib/notifications.js'

export default function DraftUnits() {
  const [units, setUnits] = useState([])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [linking, setLinking] = useState(false)

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

  async function load() {
    try {
      setLoading(true)
      setError('')
      // Load CODED UNITS (INVENTORY_DRAFT without model assigned)
      const resp = await fetchWithAuth(`${API_URL}/api/units?status=INVENTORY_DRAFT&noModel=true&pageSize=500`)
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load drafts')
      setUnits(data.units || data.items || [])

      // Load models for dropdown
      const mResp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models?pageSize=500`)
      const mData = await mResp.json()
      if (mResp.ok) setModels(mData.items || [])
    } catch (e) {
      setError(e.message || String(e))
      notifyError(e, 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const selectAll = () => {
    if (selectedIds.length === units.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(units.map(u => u.id))
    }
  }

  const handleLinkModel = async () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one unit')
      return
    }
    if (!selectedModelId) {
      alert('Please select a model')
      return
    }
    if (!confirm(`Link ${selectedIds.length} units to the selected model? TM approval will be required for them to become AVAILABLE.`)) return

    try {
      setLinking(true)
      const resp = await fetchWithAuth(`${API_URL}/api/units/bulk-link-model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitIds: selectedIds, modelId: Number(selectedModelId) })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Link failed')
      notifySuccess(data.message || `${data.updated} units linked to model`)
      setSelectedIds([])
      setSelectedModelId('')
      load() // Refresh list
    } catch (e) {
      notifyError(e, 'Failed to link model')
    } finally {
      setLinking(false)
    }
  }

  return (
    <div>
      <BrandHeader onLogout={handleLogout} />
      <div style={pageContainer}>
        <h2 style={pageTitle}>Draft Units (Pending Model Assignment)</h2>
        <p style={metaText}>
          These units were bulk-created and need to be linked to a Unit Model before becoming available.
        </p>

        {error && <p style={errorText}>{error}</p>}

        {/* Bulk Link Controls */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedModelId}
            onChange={e => setSelectedModelId(e.target.value)}
            style={{ padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, minWidth: 200 }}
          >
            <option value="">-- Select Model --</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.model_name} ({m.model_code})</option>
            ))}
          </select>
          <LoadingButton
            onClick={handleLinkModel}
            disabled={selectedIds.length === 0 || !selectedModelId || linking}
            loading={linking}
            variant="primary"
          >
            Link {selectedIds.length} Selected to Model
          </LoadingButton>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            {selectedIds.length} of {units.length} selected
          </span>
        </div>

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>
                  <input type="checkbox" checked={selectedIds.length === units.length && units.length > 0} onChange={selectAll} />
                </th>
                <th style={th}>ID</th>
                <th style={th}>Code</th>
                <th style={th}>Type</th>
                <th style={th}>Zone</th>
                <th style={th}>Block</th>
                <th style={th}>Building</th>
                <th style={th}>Status</th>
                <th style={th}>Created At</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonRow key={i} widths={['xs','sm','lg','sm','sm','sm','sm','sm','lg']} tdStyle={td} />
                  ))}
                </>
              )}
              {!loading && units.map(u => (
                <tr key={u.id} style={{ background: selectedIds.includes(u.id) ? '#f0fdf4' : undefined }}>
                  <td style={td}>
                    <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => toggleSelect(u.id)} />
                  </td>
                  <td style={td}>{u.id}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{u.code}</td>
                  <td style={td}>{u.unit_type || '-'}</td>
                  <td style={td}>{u.zone || '-'}</td>
                  <td style={td}>{u.block_sector || '-'}</td>
                  <td style={td}>{u.building_number || '-'}</td>
                  <td style={td}>{u.unit_status}</td>
                  <td style={td}>{(u.created_at || '').replace('T', ' ').substring(0, 16)}</td>
                </tr>
              ))}
              {units.length === 0 && !loading && (
                <tr>
                  <td style={td} colSpan={9}>No INVENTORY_DRAFT units found. Create some using Bulk Unit Creation.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
