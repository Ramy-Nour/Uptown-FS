import React from 'react'
import UnitPicker from './UnitPicker.jsx'

export default function UnitInfoSection({
  role,
  styles,
  mode,
  inputs,
  unitInfo, setUnitInfo,
  setStdPlan,
  setInputs,
  setCurrency,
  setFeeSchedule,
  setUnitPricingBreakdown
}) {
  const input = (err) => styles.input ? styles.input(err) : { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff' }
  const unitBlocked = Boolean(unitInfo?.blocked_until) || (Number(unitInfo?.unit_id) > 0 && (unitInfo?.available === false))
  const lockUnitEdits = role === 'property_consultant' && unitBlocked

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Unit & Project Information</h2>
      <div style={styles.grid2}>
        <div>
          <label style={styles.label}>Unit Type</label>
          <UnitPicker
            styles={styles}
            mode={mode}
            inputs={inputs}
            unitInfo={unitInfo}
            setUnitInfo={setUnitInfo}
            setStdPlan={setStdPlan}
            setInputs={setInputs}
            setCurrency={setCurrency}
            setFeeSchedule={setFeeSchedule}
            setUnitPricingBreakdown={setUnitPricingBreakdown}
          />
          <small style={styles.metaText}>
            Choose a type to view available inventory. Selecting a unit will set price and details automatically.
          </small>
        </div>
        <div>
          <label style={styles.label}>Unit Type (<span style={styles.arInline}>[[نوع الوحدة]]</span>)</label>
          <input
            dir="auto"
            style={input()}
            value={unitInfo.unit_type}
            onChange={e => setUnitInfo(s => ({ ...s, unit_type: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
            placeholder='مثال: "شقة سكنية بالروف"'
          />
        </div>
        <div>
          <label style={styles.label}>Unit Code (<span style={styles.arInline}>[[كود الوحدة]]</span>)</label>
          <input
            dir="auto"
            style={input()}
            value={unitInfo.unit_code}
            onChange={e => setUnitInfo(s => ({ ...s, unit_code: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
          />
        </div>
        <div>
          <label style={styles.label}>Unit Number (<span style={styles.arInline}>[[وحدة رقم]]</span>)</label>
          <input
            style={input()}
            value={unitInfo.unit_number}
            onChange={e => setUnitInfo(s => ({ ...s, unit_number: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
          />
        </div>
        <div>
          <label style={styles.label}>Floor (<span style={styles.arInline}>[[الدور]]</span>)</label>
          <input
            style={input()}
            value={unitInfo.floor}
            onChange={e => setUnitInfo(s => ({ ...s, floor: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
          />
        </div>
        <div>
          <label style={styles.label}>Building Number (<span style={styles.arInline}>[[مبنى رقم]]</span>)</label>
          <input
            style={input()}
            value={unitInfo.building_number}
            onChange={e => setUnitInfo(s => ({ ...s, building_number: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
          />
        </div>
        <div>
          <label style={styles.label}>Block / Sector (<span style={styles.arInline}>[[قطاع]]</span>)</label>
          <input
            dir="auto"
            style={input()}
            value={unitInfo.block_sector}
            onChange={e => setUnitInfo(s => ({ ...s, block_sector: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
          />
        </div>
        <div>
          <label style={styles.label}>Zone / Neighborhood (<span style={styles.arInline}>[[مجاورة]]</span>)</label>
          <input
            dir="auto"
            style={input()}
            value={unitInfo.zone}
            onChange={e => setUnitInfo(s => ({ ...s, zone: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
          />
        </div>
        <div>
          <label style={styles.label}>Garden Details (<span style={styles.arInline}>[[مساحة الحديقة]]</span>)</label>
          <input
            dir="auto"
            style={input()}
            value={unitInfo.garden_details}
            onChange={e => setUnitInfo(s => ({ ...s, garden_details: e.target.value }))}
            disabled={lockUnitEdits}
            title={lockUnitEdits ? 'Locked after unit block approval (consultant cannot change unit data)' : undefined}
            placeholder='مثال: "و حديقة بمساحة ٥٠ م٢"'
          />
        </div>
      </div>
    </section>
  )
}