import React from 'react'

/**
 * UnitDetailsTable
 * Renders a detailed table of inventory units with pricing breakdown and features.
 *
 * Props:
 * - units: Array of unit objects as returned by /api/inventory/units
 * - loading: boolean (optional)
 * - onCreateOffer: function(unit) -> void (optional) called when Create Offer is clicked
 * - styles: optional { th, td, btn } to override defaults
 * - mode: 'compact' | 'expanded' (optional, default 'expanded')
 */
export default function UnitDetailsTable({ units, loading = false, onCreateOffer, styles = {}, mode = 'expanded' }) {
  const th = styles.th || { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
  const td = styles.td || { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }
  const btn = styles.btn || { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }

  const isExpanded = mode === 'expanded'

  return (
    <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>ID</th>
            <th style={th}>Code</th>
            {isExpanded && <th style={th}>Description</th>}
            <th style={th}>Type</th>
            <th style={th}>Model</th>
            <th style={{ ...th, textAlign: 'right' }}>Area (m²)</th>
            {isExpanded && <th style={th}>Orientation</th>}
            {isExpanded && <th style={th}>Garden</th>}
            {isExpanded && <th style={th}>Roof</th>}
            {isExpanded && <th style={th}>Garage</th>}
            {isExpanded && <th style={{ ...th, textAlign: 'right' }}>Base</th>}
            {isExpanded && <th style={{ ...th, textAlign: 'right' }}>Garden</th>}
            {isExpanded && <th style={{ ...th, textAlign: 'right' }}>Roof</th>}
            {isExpanded && <th style={{ ...th, textAlign: 'right' }}>Storage</th>}
            {isExpanded && <th style={{ ...th, textAlign: 'right' }}>Garage</th>}
            {isExpanded && <th style={{ ...th, textAlign: 'right' }}>Maintenance</th>}
            <th style={{ ...th, textAlign: 'right' }}>Total (excl. maint.)</th>
            <th style={th}>Currency</th>
            <th style={th}>Status</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(units || []).map(u => {
            const gardenLabel = u.garden_available ? `Yes (${Number(u.garden_area || 0).toLocaleString()} m²)` : 'No'
            const roofLabel = u.roof_available ? `Yes (${Number(u.roof_area || 0).toLocaleString()} m²)` : 'No'
            const garageLabel = (Number(u.garage_area || 0) > 0) ? `Yes (${Number(u.garage_area || 0).toLocaleString()} m²)` : 'No'
            const modelLabel = u.model_code ? `${u.model_code} — ${u.model_name || ''}`.trim() : (u.model_name || '')
            return (
              <tr key={u.id}>
                <td style={td}>{u.id}</td>
                <td style={td}>{u.code}</td>
                {isExpanded && <td style={td}>{u.description || ''}</td>}
                <td style={td}>{u.unit_type_name || u.unit_type || ''}</td>
                <td style={td}>{modelLabel || (u.model_id ? `#${u.model_id}` : '-')}</td>
                <td style={{ ...td, textAlign: 'right' }}>{u.area ? Number(u.area).toLocaleString() : '-'}</td>
                {isExpanded && <td style={td}>{u.orientation || '-'}</td>}
                {isExpanded && <td style={td}>{gardenLabel}</td>}
                {isExpanded && <td style={td}>{roofLabel}</td>}
                {isExpanded && <td style={td}>{garageLabel}</td>}
                {isExpanded && <td style={{ ...td, textAlign: 'right' }}>{Number(u.base_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                {isExpanded && <td style={{ ...td, textAlign: 'right' }}>{Number(u.garden_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                {isExpanded && <td style={{ ...td, textAlign: 'right' }}>{Number(u.roof_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                {isExpanded && <td style={{ ...td, textAlign: 'right' }}>{Number(u.storage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                {isExpanded && <td style={{ ...td, textAlign: 'right' }}>{Number(u.garage_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                {isExpanded && <td style={{ ...td, textAlign: 'right' }}>{Number(u.maintenance_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                <td style={{ ...td, textAlign: 'right' }}>{Number(u.total_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style={td}>{u.currency || 'EGP'}</td>
                <td style={td}>{u.unit_status}</td>
                <td style={td}>
                  {typeof onCreateOffer === 'function' ? (
                    <button style={btn} onClick={() => onCreateOffer(u)}>Create Offer</button>
                  ) : null}
                </td>
              </tr>
            )
          })}
          {(units || []).length === 0 && !loading && (
            <tr>
              <td style={td} colSpan={isExpanded ? 20 : 12}>No units found.</td>
            </tr>
          )}
          {loading && (
            <tr>
              <td style={td} colSpan={isExpanded ? 20 : 12}>Loading…</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}