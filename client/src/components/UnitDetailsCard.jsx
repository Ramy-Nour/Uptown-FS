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
 * UnitCard — shows a single unit with compact or expanded details.
 * Props:
 * - unit
 * - mode: 'compact' | 'expanded'
 * - onCreateOffer: (unit) => void
 */
export function UnitCard({ unit, mode = 'compact', onCreateOffer }) {
  const isBlocked = String(unit.unit_status || '').toUpperCase() === 'BLOCKED'

  const box = {
    position: 'relative',
    border: '1px solid #e6eaf0',
    borderRadius: 12,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#fff',
    overflow: 'hidden'
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

  const statusLabel = unit.unit_status || ''
  const statusUpper = statusLabel.toString().toUpperCase()
  const isAvailable = statusUpper === 'AVAILABLE'

  return (
    <div style={box}>
      {isBlocked && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.08
          }}
        >
          <div
            style={{
              padding: '6px 40px',
              borderRadius: 999,
              border: '2px solid #dc2626',
              color: '#dc2626',
              fontWeight: 800,
              letterSpacing: 4,
              fontSize: 26,
              transform: 'rotate(-18deg)',
              textTransform: 'uppercase',
              background: 'transparent'
            }}
          >
            Blocked
          </div>
        </div>
      )}
      <div style={header}>
        <div>
          <div style={title}>{unit.code}</div>
          <div style={sub}>{unit.unit_type_name || unit.unit_type || ''} • {modelLabel || '-'}</div>
        </div>
        <div style={{ fontWeight: 700, color: '#A97E34' }}>
          {totalExclMaint} {unit.currency || 'EGP'}
        </div>
      </div>

      {/* Core facts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <InfoRow label="Area" value={unit.area ? `${Number(unit.area).toLocaleString()} m²` : '-'} />
        <InfoRow label="Orientation" value={unit.orientation || '-'} />
        <InfoRow label="Garden" value={gardenLabel} />
        <InfoRow label="Roof" value={roofLabel} />
      </div>

      {/* Expanded: price breakdown */}
      {mode === 'expanded' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <InfoRow label="Base" value={Number(unit.base_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
          <InfoRow label="Garden" value={Number(unit.garden_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
          <InfoRow label="Roof" value={Number(unit.roof_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
          <InfoRow label="Storage" value={Number(unit.storage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
          <InfoRow label="Garage" value={Number(unit.garage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
          <InfoRow label="Maintenance" value={Number(unit.maintenance_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={sub}>Status: {statusLabel || '-'}</span>
        {typeof onCreateOffer === 'function' ? (
          <button
            style={{
              ...btn,
              ...(isBlocked ? { opacity: 0.6, cursor: 'not-allowed', borderColor: '#fecaca', color: '#b91c1c' } : {})
            }}
            onClick={() => {
              if (isBlocked) return
              onCreateOffer(unit)
            }}
          >
            {isAvailable ? 'Create Offer' : 'Create Offer'}
          </button>
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
 * - mode: 'compact' | 'expanded'
 */
export function UnitCardsGrid({ units, onCreateOffer, mode = 'compact' }) {
  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12
  }
  return (
    <div style={grid}>
      {(units || []).map(u => (
        <UnitCard key={u.id} unit={u} onCreateOffer={onCreateOffer} mode={mode} />
      ))}
      {(units || []).length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 12 }}>No units found.</div>
      )}
    </div>
  )
}

export default UnitCard