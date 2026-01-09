import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandHeader from '../lib/BrandHeader'
import { fetchWithAuth, API_URL } from '../lib/apiClient'
import { notifyError, notifySuccess } from '../lib/notifications'
const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'Uptown Financial System'

export default function BulkUnitCreation() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  // Unit Type: UR (Uptown Residence) or CH (Custom Home)
  const [unitType, setUnitType] = useState('UR')

  // Common inputs
  const [zone, setZone] = useState('')
  const [block, setBlock] = useState('')

  // UR-specific inputs
  const [building, setBuilding] = useState('')
  const [floorStart, setFloorStart] = useState(1)
  const [floorEnd, setFloorEnd] = useState(1)
  const [unitsPerFloor, setUnitsPerFloor] = useState(2)

  // CH-specific inputs
  const [plotStart, setPlotStart] = useState(1)
  const [plotEnd, setPlotEnd] = useState(1)

  // Preview
  const [previewItems, setPreviewItems] = useState([])

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('auth_user')
    window.location.href = '/login'
  }

  const pad = (n, width) => String(n).padStart(width, '0')

  const generatePreview = () => {
    if (!zone || !block) {
      alert('Please fill in Zone and Block')
      return
    }

    const items = []
    const zonePad = pad(zone, 2)
    const blockPad = pad(block, 2)

    if (unitType === 'CH') {
      // Custom Home: CH-AAA-BB-CC (Plot-Block-Zone)
      const pStart = Number(plotStart) || 1
      const pEnd = Number(plotEnd) || pStart

      for (let plot = pStart; plot <= pEnd; plot++) {
        const plotPad = pad(plot, 3)
        const code = `CH${plotPad}${blockPad}${zonePad}`
        items.push({
          code,
          description: `Custom Home Plot ${plot}, Block ${block}, Zone ${zone}`,
          plot,
          type: 'CH'
        })
      }
    } else {
      // UR mode: UR-BB-CC-DDD-EE-FF (Apt-Floor-Bldg-Block-Zone)
      if (!building) {
        alert('Please fill in Building')
        return
      }

      const bldgPad = pad(building, 3)
      const perFloor = Number(unitsPerFloor) || 2
      let aptCounter = 1

      for (let fl = Number(floorStart); fl <= Number(floorEnd); fl++) {
        const floorPad = pad(fl, 2)
        for (let u = 0; u < perFloor; u++) {
          const aptPad = pad(aptCounter, 2)
          const code = `UR${aptPad}${floorPad}${bldgPad}${blockPad}${zonePad}`
          items.push({
            code,
            description: `Apartment ${aptCounter}, Floor ${fl}, Building ${building}`,
            floor: fl,
            unit: aptCounter,
            type: 'UR'
          })
          aptCounter++
        }
      }
    }

    setPreviewItems(items)
  }

  const handleSubmit = async () => {
    if (previewItems.length === 0) return
    if (!confirm(`Create ${previewItems.length} units as DRAFT?`)) return

    try {
      setLoading(true)

      let payload = { unitType, zone, block }

      if (unitType === 'CH') {
        payload.plotStart = Number(plotStart)
        payload.plotEnd = Number(plotEnd)
      } else {
        payload.building = building
        const floorsArr = []
        for (let f = Number(floorStart); f <= Number(floorEnd); f++) floorsArr.push(f)
        payload.floors = floorsArr
        payload.unitsPerFloor = Number(unitsPerFloor) || 2
      }

      const res = await fetchWithAuth(`${API_URL}/api/units/bulk-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'Creation failed')

      notifySuccess(`Created ${data.created} DRAFT units. ${data.duplicates > 0 ? `Skipped ${data.duplicates} duplicates.` : ''} Link them to a model on the Inventory Drafts page.`)
      setPreviewItems([])
    } catch (e) {
      notifyError(e, 'Bulk creation failed')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = { width: '100%', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'sans-serif' }}>
      <BrandHeader title={APP_TITLE} onLogout={handleLogout} />

      <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, marginBottom: 20, color: '#1e293b' }}>Bulk Unit Draft Creation</h1>

        <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          {/* Unit Type Selector */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Unit Type</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="unitType" value="UR" checked={unitType === 'UR'} onChange={() => setUnitType('UR')} />
                <span style={{ fontWeight: 500 }}>Uptown Residence (UR)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="unitType" value="CH" checked={unitType === 'CH'} onChange={() => setUnitType('CH')} />
                <span style={{ fontWeight: 500 }}>Custom Home (CH)</span>
              </label>
            </div>
          </div>

          {/* Common Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Zone (01-99)</label>
              <input type="text" maxLength={2} value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. 03" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Block (01-99)</label>
              <input type="text" maxLength={2} value={block} onChange={e => setBlock(e.target.value)} placeholder="e.g. 10" style={inputStyle} />
            </div>
          </div>

          {/* UR-specific Fields */}
          {unitType === 'UR' && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Building (001-999)</label>
                <input type="text" maxLength={3} value={building} onChange={e => setBuilding(e.target.value)} placeholder="e.g. 080" style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Floors Range</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" min="0" max="100" value={floorStart} onChange={e => setFloorStart(e.target.value)} style={{ width: 60, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
                    <span>to</span>
                    <input type="number" min="0" max="100" value={floorEnd} onChange={e => setFloorEnd(e.target.value)} style={{ width: 60, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Units Per Floor</label>
                  <input type="number" min="1" max="20" value={unitsPerFloor} onChange={e => setUnitsPerFloor(e.target.value)} style={{ width: 80, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
                </div>
              </div>
            </>
          )}

          {/* CH-specific Fields */}
          {unitType === 'CH' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Plot Range</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="1" max="999" value={plotStart} onChange={e => setPlotStart(e.target.value)} style={{ width: 80, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
                <span>to</span>
                <input type="number" min="1" max="999" value={plotEnd} onChange={e => setPlotEnd(e.target.value)} style={{ width: 80, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </div>
            </div>
          )}

          <div style={{ background: '#fef3c7', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13, color: '#92400e' }}>
            <strong>Note:</strong> Units are created as <strong>DRAFT</strong> without a model. Link them to a model on the <a href="/admin/inventory-drafts" style={{ color: '#92400e' }}>Inventory Drafts</a> page after creation.
          </div>

          <button onClick={generatePreview} style={{ width: '100%', background: '#3b82f6', color: '#fff', border: 'none', padding: 10, borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
            Generate Preview
          </button>
        </div>

        {/* Preview List */}
        {previewItems.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Preview ({previewItems.length} units)</h3>
              <button onClick={handleSubmit} disabled={loading} style={{ background: '#10b981', color: '#fff', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>
                {loading ? 'Creating...' : 'Confirm & Create as DRAFT'}
              </button>
            </div>

            <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <tr>
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Code</th>
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Description</th>
                    {unitType === 'UR' && <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Floor</th>}
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>{unitType === 'UR' ? 'Apt No' : 'Plot No'}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: 12, fontFamily: 'monospace', fontWeight: 600 }}>{it.code}</td>
                      <td style={{ padding: 12 }}>{it.description}</td>
                      {unitType === 'UR' && <td style={{ padding: 12 }}>{it.floor}</td>}
                      <td style={{ padding: 12 }}>{it.unit || it.plot}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
