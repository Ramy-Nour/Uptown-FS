import React, { useEffect, useState } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import LoadingButton from './LoadingButton.jsx'
import SkeletonRow from './SkeletonRow.jsx'
import { th, td, tableWrap, table, metaText, errorText, btn } from '../lib/ui.js'

function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}>
      <div style={{ color: '#64748b', fontSize: 12, minWidth: 140 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{(value ?? '-') === '' ? '-' : String(value ?? '-')}</div>
    </div>
  )
}

function renderPayload(p) {
  try {
    const obj = typeof p === 'string' ? JSON.parse(p) : (p || {})
    const entries = Object.entries(obj)
    if (!entries.length) return '-'
    return (
      <div style={{ fontSize: 12, color: '#334155' }}>
        {entries.map(([k, v]) => (
          <div key={k}><strong>{k}:</strong> {v == null ? 'null' : String(v)}</div>
        ))}
      </div>
    )
  } catch {
    return String(p || '-')
  }
}

export default function UnitDetailsDrawer({ unit, open, onClose }) {
  const [full, setFull] = useState(null)
  const [history, setHistory] = useState([])
  const [modelAudit, setModelAudit] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !unit) return
    let abort = false
    async function load() {
      try {
        setLoading(true)
        setError('')
        // Unit details via admin route (works for any status)
        const uResp = await fetchWithAuth(`${API_URL}/api/units/${unit.id}`)
        const uData = await uResp.json()
        let effectiveUnit = null
        if (uResp.ok) {
          effectiveUnit = uData.unit || null
          if (!abort) setFull(effectiveUnit)
        } else {
          // Fallback to inventory lookup if unavailable
          const iv = await fetchWithAuth(`${API_URL}/api/inventory/units/${unit.id}`)
          const j = await iv.json().catch(() => ({}))
          effectiveUnit = j.unit || null
          if (!abort) setFull(effectiveUnit)
        }
        // History (all statuses) for this unit
        const hResp = await fetchWithAuth(`${API_URL}/api/inventory/units/changes?status=all&unit_id=${unit.id}`)
        const hData = await hResp.json()
        if (!abort) setHistory(hResp.ok ? (hData.changes || []) : [])

        // Model audit if model_id is present
        const mid = effectiveUnit?.model_id || effectiveUnit?.model?.id
        if (mid) {
          const aResp = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/${mid}/audit`)
          const aData = await aResp.json()
          if (!abort) setModelAudit(aResp.ok ? (aData.audit || []) : [])
        } else {
          if (!abort) setModelAudit([])
        }
      } catch (e) {
        if (!abort) {
          setError(e.message || String(e))
        }
      } finally {
        if (!abort) setLoading(false)
      }
    }
    load()
    return () => { abort = true }
  }, [open, unit?.id])

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 2000
    }} onClick={onClose}>
      <div style={{
        width: 'min(560px, 95vw)', height: '100%', background: '#fff',
        borderLeft: '1px solid #e5e7eb', padding: 16, overflow: 'auto'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Unit Details</h3>
          <button onClick={onClose} style={{ ...btn }}>Close</button>
        </div>

        {error ? <p style={errorText}>{error}</p> : null}

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>Summary</h4>
          {!full && loading ? (
            <>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}><SkeletonRow widths={['lg']} tdStyle={{ padding: 0, borderBottom: 0 }} /></div>
              ))}
            </>
          ) : (
            <>
              <Field label="ID" value={unit?.id} />
              <Field label="Code" value={full?.code || unit?.code} />
              <Field label="Status" value={full?.unit_status || unit?.unit_status} />
              <Field label="Model" value={full?.model_code ? `${full.model_code} — ${full.model_name || ''}` : (full?.model_name || '-')} />
              <Field label="Area (m²)" value={full?.area} />
              <Field label="Unit No." value={full?.unit_number} />
              <Field label="Floor" value={full?.floor} />
              <Field label="Building" value={full?.building_number} />
              <Field label="Block/Sector" value={full?.block_sector} />
              <Field label="Zone" value={full?.zone} />
              <Field label="Garden" value={(full?.garden_available ? `Yes (${Number(full?.garden_area || 0)} m²)` : 'No')} />
              <Field label="Roof" value={(full?.roof_available ? `Yes (${Number(full?.roof_area || 0)} m²)` : 'No')} />
              <Field label="Currency" value={full?.currency || 'EGP'} />
              <Field label="Total (excl. maint.)" value={Number(full?.total_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
            </>
          )}
        </section>

        <section style={{ marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>Change History</h4>
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>ID</th>
                  <th style={th}>Action</th>
                  <th style={th}>Status</th>
                  <th style={th}>Requested By</th>
                  <th style={th}>Approved By</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Created</th>
                  <th style={th}>Payload</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonRow key={i} widths={['sm','sm','sm','lg','lg','lg','lg','xl']} tdStyle={td} />
                    ))}
                  </>
                )}
                {!loading && history.map(ch => (
                  <tr key={ch.id}>
                    <td style={td}>{ch.id}</td>
                    <td style={td}>{ch.action}</td>
                    <td style={td}>{ch.status}</td>
                    <td style={td}>{ch.requested_by_email || '-'}</td>
                    <td style={td}>{ch.approved_by_email || '-'}</td>
                    <td style={td}>{ch.reason || '-'}</td>
                    <td style={td}>{(ch.created_at || '').replace('T',' ').replace('Z','')}</td>
                    <td style={td}>{renderPayload(ch.payload)}</td>
                  </tr>
                ))}
                {!loading && history.length === 0 && (
                  <tr>
                    <td style={td} colSpan={8}>No history for this unit.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={metaText}>History includes edit and delete requests related to this unit, with final decisions.</span>
          </div>
        </section>

        <section>
          <h4 style={{ marginTop: 0 }}>Model Audit</h4>
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>ID</th>
                  <th style={th}>Action</th>
                  <th style={th}>Changed By</th>
                  <th style={th}>At</th>
                  <th style={th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonRow key={i} widths={['sm','sm','lg','lg','xl']} tdStyle={td} />
                    ))}
                  </>
                )}
                {!loading && modelAudit.map(a => (
                  <tr key={a.id}>
                    <td style={td}>{a.id}</td>
                    <td style={td}>{a.action}</td>
                    <td style={td}>{a.changed_by_email || a.changed_by || '-'}</td>
                    <td style={td}>{(a.created_at || '').replace('T',' ').replace('Z','')}</td>
                    <td style={td}>{renderPayload(a.details)}</td>
                  </tr>
                ))}
                {!loading && modelAudit.length === 0 && (
                  <tr>
                    <td style={td} colSpan={5}>No model audit records.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={metaText}>Model audit reflects create/update/delete events on the associated unit model.</span>
          </div>
        </section>
      </div>
    </div>
  )
}