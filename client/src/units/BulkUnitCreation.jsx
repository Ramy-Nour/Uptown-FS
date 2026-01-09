import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandHeader from '../lib/BrandHeader'
import { fetchWithAuth } from '../lib/apiClient'
import { notifyError, notifySuccess } from '../lib/notifications'
const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'Uptown Financial System'

export default function BulkUnitCreation() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState([])
  
  // Inputs
  const [zone, setZone] = useState('')
  const [block, setBlock] = useState('')
  const [building, setBuilding] = useState('') // "080"
  
  const [floorStart, setFloorStart] = useState(1)
  const [floorEnd, setFloorEnd] = useState(1)
  
  const [unitStart, setUnitStart] = useState(1)
  const [unitEnd, setUnitEnd] = useState(1)
  
  const [selectedModelId, setSelectedModelId] = useState('')
  const [basePrice, setBasePrice] = useState(0)

  // Computed Preview
  const [previewItems, setPreviewItems] = useState([])

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    try {
      // Use existing endpoint that lists unit models
      const res = await fetchWithAuth('/api/inventory/unit-models?pageSize=1000') // fetch enough
      if (res.ok) {
        const data = await res.json()
        setModels(data.items || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user_role')
    localStorage.removeItem('user_id')
    window.location.href = '/login'
  }

  const pad = (n, width) => {
    const s = String(n)
    return s.length >= width ? s : new Array(width - s.length + 1).join('0') + s
  }

  const generatePreview = () => {
    if (!zone || !block || !building) {
      alert('Please fill in Zone, Block and Building')
      return
    }

    const items = []
    const floors = []
    for (let f = Number(floorStart); f <= Number(floorEnd); f++) floors.push(f)
    
    const units = []
    for (let u = Number(unitStart); u <= Number(unitEnd); u++) units.push(u)

    // Code: UR-BB-CC-DDD-EE-FF
    // BB: Apt (2), CC: Floor (2), DDD: Bldg (3), EE: Block (2), FF: Zone (2)
    const zPad = pad(zone, 2)
    const bPad = pad(block, 2)
    const bldgPad = pad(building, 3)

    for (const fl of floors) {
      const flPad = pad(fl, 2)
      for (const apt of units) {
        const aptPad = pad(apt, 2)
        const code = `UR${aptPad}${flPad}${bldgPad}${bPad}${zPad}`
        items.push({
          code,
          description: `Apartment ${apt}, Floor ${fl}, Building ${building}, Block ${block}, Zone ${zone}`,
          floor: fl,
          unit: apt,
          basePrice: basePrice || 0
        })
      }
    }
    setPreviewItems(items)
  }

  const handleSubmit = async () => {
    if (previewItems.length === 0) return
    if (!confirm(`Create ${previewItems.length} units?`)) return

    try {
      setLoading(true)

      const floorsArr = []
      for (let f = Number(floorStart); f <= Number(floorEnd); f++) floorsArr.push(f)

      const unitsArr = []
      for (let u = Number(unitStart); u <= Number(unitEnd); u++) unitsArr.push(u)

      const payload = {
        zone,
        block,
        building,
        floors: floorsArr,
        unitsPerFloor: unitsArr,
        model_id: selectedModelId || null,
        base_price: Number(basePrice)
      }

      const res = await fetchWithAuth('/api/units/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || 'Creation failed')
      
      notifySuccess(`Created ${data.created} units. ${data.duplicates > 0 ? `Skipped ${data.duplicates} duplicates.` : ''}`)
      setPreviewItems([]) 
      // navigate('/units') // optional
    } catch (e) {
      notifyError(e, 'Bulk creation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'sans-serif' }}>
      <BrandHeader title={APP_TITLE} onLogout={handleLogout} />
      
      <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, marginBottom: 20, color: '#1e293b' }}>Bulk Unit Draft Creation</h1>
        
        <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Zone (01-99)</label>
              <input 
                type="text" 
                maxLength={2}
                value={zone}
                onChange={e => setZone(e.target.value)}
                placeholder="e.g. 03"
                style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Block (01-99)</label>
              <input 
                type="text" 
                maxLength={2}
                value={block}
                onChange={e => setBlock(e.target.value)}
                placeholder="e.g. 01"
                style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Building (001-999)</label>
              <input 
                type="text" 
                maxLength={3}
                value={building}
                onChange={e => setBuilding(e.target.value)}
                placeholder="e.g. 080"
                style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Floors Range</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <input type="number" min="0" max="100" value={floorStart} onChange={e => setFloorStart(e.target.value)} style={{ width: 60, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
                 <span>to</span>
                 <input type="number" min="0" max="100" value={floorEnd} onChange={e => setFloorEnd(e.target.value)} style={{ width: 60, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </div>
            </div>
            <div>
               <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Units Per Floor Range</label>
               <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <input type="number" min="1" max="20" value={unitStart} onChange={e => setUnitStart(e.target.value)} style={{ width: 60, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
                 <span>to</span>
                 <input type="number" min="1" max="20" value={unitEnd} onChange={e => setUnitEnd(e.target.value)} style={{ width: 60, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
             <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Unit Model</label>
             <select 
               value={selectedModelId} 
               onChange={e => {
                  const mid = e.target.value
                  setSelectedModelId(mid)
                  // Auto-set price if possible (optional)
                  // const m = models.find(x => x.id === Number(mid))
                  // if (m) setBasePrice(0) // Logic is backend anyway or we need to fetch pricing separately
               }}
               style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }}
             >
               <option value="">-- No Model --</option>
               {models.map(m => (
                 <option key={m.id} value={m.id}>{m.model_name} ({m.model_code})</option>
               ))}
             </select>
          </div>
          
           <div style={{ marginBottom: 24 }}>
             <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Base Price Override (Optional)</label>
             <input type="number" value={basePrice} onChange={e => setBasePrice(e.target.value)} style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 }} />
           </div>

          <button 
            onClick={generatePreview}
            style={{ width: '100%', background: '#3b82f6', color: '#fff', border: 'none', padding: 10, borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
          >
            Generate Preview
          </button>
        </div>

        {/* Preview List */}
        {previewItems.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Preview ({previewItems.length} units)</h3>
              <button 
                onClick={handleSubmit} 
                className="btn-primary" 
                disabled={loading}
                style={{ background: '#10b981', color: '#fff', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}
              >
                {loading ? 'Creating...' : 'Confirm & Create'}
              </button>
            </div>
            
            <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <tr>
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Code</th>
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Description</th>
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Floor</th>
                    <th style={{ padding: 12, borderBottom: '1px solid #e2e8f0' }}>Unit No</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: 12, fontFamily: 'monospace', fontWeight: 600 }}>{it.code}</td>
                      <td style={{ padding: 12 }}>{it.description}</td>
                      <td style={{ padding: 12 }}>{it.floor}</td>
                      <td style={{ padding: 12 }}>{it.unit}</td>
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
