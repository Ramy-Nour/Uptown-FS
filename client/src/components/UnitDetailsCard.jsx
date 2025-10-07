import React from 'react'

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151' }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

/**
 * UnitCard — shows a single unit with compact details and pricing breakdown.
 * Props:
 * - unit
 * - onCreateOffer: (unit) => void
 */
export function UnitCard({ unit, onCreateOffer }) {
  const box = {
    border: '1px solid #e6eaf0',
    borderRadius: 12,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#fff'
  }
  const header = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline'
  }
  const title = {
    fontWeight: 700,
    color: '#1f2937'
  }
  const sub = { fontSize: 12, color: '#6b7280' }
  const btn = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

  const modelLabel = unit.model_code ? `${unit.model_code} — ${unit.model_name || ''}`.trim() : (unit.model_name || '')
  const gardenLabel = unit.garden_available ? `Yes (${Number(unit.garden_area || 0).toLocaleString()} m²)` : 'No'
  const roofLabel = unit.roof_available ? `Yes (${Number(unit.roof_area || 0).toLocaleString()} m²)` : 'No'
  const totalExclMaint = Number(unit.total_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })

  return (
    <div style={box}>
      <div style={header}>
        <div>
          <div style={title}>{unit.code}</div>
          <div style={sub}>{unit.unit_type_name || unit.unit_type || ''} • {modelLabel || '-'}</div>
        </div>
        <div style={{ fontWeight: 700, color: '#A97E34' }}>
          {totalExclMaint} {unit.currency || 'EGP'}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <InfoRow label="Area" value={unit.area ? `${Number(unit.area).toLocaleString()} m²` : '-'} />
        <InfoRow label="Orientation" value={unit.orientation || '-'} />
        <InfoRow label="Garden" value={gardenLabel} />
        <InfoRow label="Roof" value={roofLabel} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        <InfoRow label="Base" value={Number(unit.base_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <InfoRow label="Garden" value={Number(unit.garden_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <InfoRow label="Roof" value={Number(unit.roof_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <InfoRow label="Storage" value={Number(unit.storage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <InfoRow label="Garage" value={Number(unit.garage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <InfoRow label="Maintenance" value={Number(unit.maintenance_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={sub}>Status: {unit.unit_status}</span>
        {typeof onCreateOffer === 'function' ? (
          <button style={btn} onClick={() => onCreateOffer(unit)}>Create Offer</button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * UnitCardsGrid — renders a grid of UnitCard components.
 * Props:
 * - units
 * - onCreateOffer
 */
export function UnitCardsGrid({ units, onCreateOffer }) {
  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12
  }
  return (
    <div style={grid}>
      {(units || []).map(u => (
        <UnitCard key={u.id} unit={u} onCreateOffer={onCreateOffer} />
      ))}
      {(units || []).length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 12 }}>No units found.</div>
      )}
    </div>
  )
}

export default UnitCard