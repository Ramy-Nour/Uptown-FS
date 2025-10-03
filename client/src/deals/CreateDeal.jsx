import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import CalculatorApp from '../App.jsx'

export default function CreateDeal() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // OCR state
  const [ocrFile, setOcrFile] = useState(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState('')
  const [ocrResult, setOcrResult] = useState(null)
  const [reviewFields, setReviewFields] = useState({ name: '', nationalId: '', address: '' })

  // Unit & Project Information (local UI state; synced to embedded calculator)
  const [unitForm, setUnitForm] = useState({
    unit_type: '',
    unit_code: '',
    description: '',
    unit_number: '',
    floor: '',
    building_number: '',
    block_sector: '',
    zone: '',
    garden_details: ''
  })

  const navigate = useNavigate()

  // On mount: if unit_id is provided, fetch unit and prefill calculator
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const unitId = Number(params.get('unit_id'))
    if (!Number.isFinite(unitId) || unitId <= 0) return
    ;(async () => {
      try {
        setLoading(true)
        const resp = await fetchWithAuth(`${API_URL}/api/units/${unitId}`)
        const data = await resp.json()
        if (!resp.ok) {
          setError(data?.error?.message || 'Failed to load unit')
          return
        }
        const u = data.unit || {}

        // Compute breakdown with all pricing components (current unit pricing)
        const base = Number(u.base_price || 0)
        const garden = Number(u.garden_price || 0)
        const roof = Number(u.roof_price || 0)
        const storage = Number(u.storage_price || 0)
        const garage = Number(u.garage_price || 0)
        const maintenance = Number(u.maintenance_price || 0)
        const total = base + garden + roof + storage + garage

        // Get standard pricing from the model (for proposal baseline)
        const stdBase = Number(u.standard_base_price || base)
        const stdGarden = Number(u.standard_garden_price || garden)
        const stdRoof = Number(u.standard_roof_price || roof)
        const stdStorage = Number(u.standard_storage_price || storage)
        const stdGarage = Number(u.standard_garage_price || garage)
        const stdMaintenance = Number(u.standard_maintenance_price || maintenance)
        const stdTotal = stdBase + stdGarden + stdRoof + stdStorage + stdGarage

        // Prefill embedded calculator via exposed bridge and sync local UI
        try {
          const applyPrefill = window.__uptown_calc_applyUnitPrefill
          if (typeof applyPrefill === 'function') {
            applyPrefill({
              unitInfo: {
                unit_type: u.unit_type || u.unit_type_name || '',
                unit_code: u.code || '',
                description: u.description || '',
                unit_number: u.unit_number || '',
                floor: u.floor || '',
                building_number: u.building_number || '',
                block_sector: u.block_sector || '',
                zone: u.zone || '',
                garden_details: u.garden_details || '',
                area: u.area || '',
                orientation: u.orientation || '',
                has_garden: u.has_garden || false,
                garden_area: u.garden_area || '',
                has_roof: u.has_roof || false,
                roof_area: u.roof_area || '',
                garage_area: u.garage_area || ''
              },
              stdPlan: {
                totalPrice: stdTotal,
                base_price: stdBase,
                maintenance_price: stdMaintenance
              },
              unitPricingBreakdown: {
                base: stdBase,
                garden: stdGarden,
                roof: stdRoof,
                storage: stdStorage,
                garage: stdGarage,
                maintenance: stdMaintenance,
                totalExclMaintenance: stdTotal
              },
              currency: u.currency || 'EGP'
            })
          }
          setUnitForm({
            unit_type: u.unit_type || u.unit_type_name || '',
            unit_code: u.code || '',
            description: u.description || '',
            unit_number: u.unit_number || '',
            floor: u.floor || '',
            building_number: u.building_number || '',
            block_sector: u.block_sector || '',
            zone: u.zone || '',
            garden_details: u.garden_details || ''
          })
        } catch (err) {
          console.error('Error applying unit prefill:', err)
        }
      } catch (err) {
        setError(err.message || 'Failed to load unit')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // One-time initial sync from embedded calculator snapshot (if available)
  useEffect(() => {
    try {
      const getSnap = window.__uptown_calc_getSnapshot
      if (typeof getSnap === 'function') {
        const snap = getSnap()
        const ui = snap?.unitInfo || {}
        setUnitForm(s => ({
          ...s,
          unit_type: ui.unit_type || s.unit_type,
          unit_code: ui.unit_code || s.unit_code,
          description: ui.description || s.description,
          unit_number: ui.unit_number || s.unit_number,
          floor: ui.floor || s.floor,
          building_number: ui.building_number || s.building_number,
          block_sector: ui.block_sector || s.block_sector,
          zone: ui.zone || s.zone,
          garden_details: ui.garden_details || s.garden_details
        }))
      }
    } catch {}
  }, [])

  function applyUnitUpdates(partial) {
    setUnitForm(s => ({ ...s, ...partial }))
    const apply = window.__uptown_calc_applyUnitInfo
    if (typeof apply === 'function') {
      apply(partial)
    }
  }

  async function buildPayloadFromSnapshot() {
    const snapFn = window.__uptown_calc_getSnapshot
    if (typeof snapFn !== 'function') {
      throw new Error('Calculator not ready yet. Please try again in a moment.')
    }
    const snap = snapFn()
    // Build title, amount, unit type from snapshot
    const titleParts = []
    if (snap?.clientInfo?.buyer_name) titleParts.push(snap.clientInfo.buyer_name)
    if (snap?.unitInfo?.unit_code || snap?.unitInfo?.unit_number) {
      titleParts.push(snap.unitInfo.unit_code || snap.unitInfo.unit_number)
    }
    const title = titleParts.join(' - ') || 'New Deal'
    const amount = Number(snap?.generatedPlan?.totals?.totalNominal ?? snap?.stdPlan?.totalPrice ?? 0)
    const unitType = snap?.unitInfo?.unit_type || null
    const details = { calculator: { ...snap } }
    return { title, amount, unitType, details }
  }

  // Minimal required fields for creating an offer:
  // - Client name and primary phone
  // - Unit data: at least unit_type and either unit_code or unit_number
  function validateOfferSnapshot(snap) {
    const client = snap?.clientInfo || {}
    const unit = snap?.unitInfo || {}
    const missing = []
    if (!client.buyer_name || !String(client.buyer_name).trim()) missing.push('Client Name')
    if (!client.phone_primary || !String(client.phone_primary).trim()) missing.push('Client Primary Phone')
    if (!unit.unit_type || !String(unit.unit_type).trim()) missing.push('Unit Type')
    if (!(unit.unit_code || unit.unit_number)) missing.push('Unit Code or Unit Number')
    return { ok: missing.length === 0, missing }
  }

  async function saveAsDraft() {
    try {
      setError('')
      setLoading(true)
      const payload = await buildPayloadFromSnapshot()
      // Validate minimal offer info
      const snap = payload.details?.calculator
      const v = validateOfferSnapshot(snap)
      if (!v.ok) {
        throw new Error(`Missing required fields: ${v.missing.join(', ')}`)
      }
      const resp = await fetchWithAuth(`${API_URL}/api/deals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to create deal')
      navigate(`/deals/${data.deal.id}`)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function saveAndSubmit() {
    try {
      setError('')
      setSubmitting(true)
      const payload = await buildPayloadFromSnapshot()
      // Validate minimal offer info
      const snap = payload.details?.calculator
      const v = validateOfferSnapshot(snap)
      if (!v.ok) {
        throw new Error(`Missing required fields: ${v.missing.join(', ')}`)
      }
      // Validation: ensure generated plan exists
      const plan = payload.details?.calculator?.generatedPlan
      if (!plan || !Array.isArray(plan.schedule) || plan.schedule.length === 0) {
        throw new Error('Please generate a payment plan before submitting.')
      }
      const resp = await fetchWithAuth(`${API_URL}/api/deals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to create deal')
      // Submit
      const submitResp = await fetchWithAuth(`${API_URL}/api/deals/${data.deal.id}/submit`, { method: 'POST' })
      const submitData = await submitResp.json()
      if (!submitResp.ok) throw new Error(submitData?.error?.message || 'Failed to submit deal')
      navigate(`/deals/${data.deal.id}`)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function runOCR() {
    try {
      setOcrError('')
      setOcrResult(null)
      if (!ocrFile) {
        setOcrError('Please select an ID image first.')
        return
      }
      setOcrLoading(true)
      const form = new FormData()
      form.append('image', ocrFile)
      const resp = await fetchWithAuth(`${API_URL}/api/ocr/egypt-id`, {
        method: 'POST',
        body: form
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'OCR failed')
      setOcrResult(data)
      const fields = data?.fields || {}
      setReviewFields({
        name: String(fields.name || ''),
        nationalId: String(fields.nationalId || ''),
        address: String(fields.address || '')
      })
    } catch (e) {
      setOcrError(e.message || String(e))
    } finally {
      setOcrLoading(false)
    }
  }

  function applyToForm() {
    const applyFn = window.__uptown_calc_applyClientInfo
    if (typeof applyFn !== 'function') {
      setOcrError('Form not ready to accept data. Please try again.')
      return
    }
    const updates = {}
    if (reviewFields.name) updates.buyer_name = reviewFields.name
    if (reviewFields.nationalId) updates.id_or_passport = reviewFields.nationalId
    if (reviewFields.address) updates.address = reviewFields.address
    // If national ID present, assume Egyptian nationality
    if (reviewFields.nationalId && !/\D/.test(reviewFields.nationalId)) {
      updates.nationality = 'Egyptian'
    }
    applyFn(updates)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={{ marginTop: 0 }}>Create Deal</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={saveAsDraft} disabled={loading || submitting} style={btnPrimary}>{loading ? 'Saving…' : 'Save as Draft'}</button>
          <button onClick={saveAndSubmit} disabled={loading || submitting} style={btnPrimaryAlt}>{submitting ? 'Submitting…' : 'Save and Submit'}</button>
        </div>
      </div>
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      {loading && !error ? <p style={{ color: '#64748b', fontSize: 14 }}>Loading unit data...</p> : null}

      {/* Egyptian ID OCR Module */}
      <div style={{ border: '1px solid #e6eaf0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Scan Egyptian National ID</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="file"
            accept="image/*"
            onChange={e => setOcrFile(e.target.files?.[0] || null)}
          />
          <button onClick={runOCR} disabled={ocrLoading} style={btnPrimary}>
            {ocrLoading ? 'Processing…' : 'Extract from ID'}
          </button>
          {ocrResult?.engine ? (
            <small style={{ color: '#64748b' }}>
              Engine: {ocrResult.engine === 'google_vision' ? 'Google Vision (cloud)' : 'Tesseract (local)'}
            </small>
          ) : null}
        </div>
        {ocrError ? <p style={{ color: '#e11d48' }}>{ocrError}</p> : null}

        {ocrResult && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: 0, color: '#374151' }}>Review and edit the extracted fields before applying:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Name</label>
                <input
                  value={reviewFields.name}
                  onChange={e => setReviewFields(s => ({ ...s, name: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>National ID</label>
                <input
                  value={reviewFields.nationalId}
                  onChange={e => setReviewFields(s => ({ ...s, nationalId: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ gridColumn: '1 / span 2' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Address</label>
                <textarea
                  value={reviewFields.address}
                  onChange={e => setReviewFields(s => ({ ...s, address: e.target.value }))}
                  style={textareaStyle}
                />
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={applyToForm} style={btnPrimaryAlt}>Apply to Form</button>
              <details>
                <summary style={{ cursor: 'pointer', color: '#64748b' }}>Show OCR Text</summary>
                <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 8, borderRadius: 8, border: '1px solid #eef2f7' }}>
{ocrResult?.rawText || ''}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>

      {/* Unit & Project Information */}
      <div style={{ border: '1px solid #e6eaf0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Unit & Project Information</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Unit Type</label>
            <input
              value={unitForm.unit_type}
              onChange={e => applyUnitUpdates({ unit_type: e.target.value })}
              style={inputStyle}
              placeholder='e.g., Apartment with roof'
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Unit Code</label>
            <input
              value={unitForm.unit_code}
              onChange={e => applyUnitUpdates({ unit_code: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Unit Number</label>
            <input
              value={unitForm.unit_number}
              onChange={e => applyUnitUpdates({ unit_number: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Description</label>
            <input
              value={unitForm.description}
              onChange={e => applyUnitUpdates({ description: e.target.value })}
              style={inputStyle}
              placeholder='3BR Apartment with roof'
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Floor</label>
            <input
              value={unitForm.floor}
              onChange={e => applyUnitUpdates({ floor: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Building Number</label>
            <input
              value={unitForm.building_number}
              onChange={e => applyUnitUpdates({ building_number: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Block / Sector</label>
            <input
              value={unitForm.block_sector}
              onChange={e => applyUnitUpdates({ block_sector: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Zone / Neighborhood</label>
            <input
              value={unitForm.zone}
              onChange={e => applyUnitUpdates({ zone: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / span 2' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Garden Details</label>
            <input
              value={unitForm.garden_details}
              onChange={e => applyUnitUpdates({ garden_details: e.target.value })}
              style={inputStyle}
              placeholder='e.g., Garden area 50 m²'
            />
          </div>
        </div>
        <small style={{ color: '#64748b' }}>These fields update the calculator below in real-time.</small>
      </div>

      <div style={{ border: '1px solid #e6eaf0', borderRadius: 12, overflow: 'hidden' }}>
        <CalculatorApp embedded />
      </div>
    </div>
  )
}

const inputStyle = { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff' }
const textareaStyle = { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff', minHeight: 70, resize: 'vertical' }
const btnPrimary = { padding: '10px 14px', borderRadius: 10, border: '1px solid #A97E34', background: '#A97E34', color: '#fff', fontWeight: 600 }
const btnPrimaryAlt = { padding: '10px 14px', borderRadius: 10, border: '1px solid #8B672C', background: '#8B672C', color: '#fff', fontWeight: 600 }