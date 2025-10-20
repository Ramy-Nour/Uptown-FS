import React from 'react'

export default function ContractDetailsForm({ role, contractInfo, setContractInfo, feeSchedule, setFeeSchedule, styles }) {
  const input = (err) => styles.input ? styles.input(err) : { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff' }

  if (!(role === 'financial_admin' || role === 'financial_manager' || role === 'contract_manager' || role === 'contract_person')) {
    return null
  }

  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Contract & Financial Details</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={styles.label}>Reservation Form Date (<span style={styles.arInline}>[[تاريخ استمارة الحجز]]</span>)</label>
          <input type="date" style={input()} value={contractInfo.reservation_form_date} onChange={e => setContractInfo(s => ({ ...s, reservation_form_date: e.target.value }))} />
        </div>
        <div>
          <label style={styles.label}>Contract Date (<span style={styles.arInline}>[[تاريخ العقد]]</span>)</label>
          <input type="date" style={input()} value={contractInfo.contract_date} onChange={e => setContractInfo(s => ({ ...s, contract_date: e.target.value }))} />
        </div>
        <div>
          <label style={styles.label}>Reservation Payment Amount (<span style={styles.arInline}>[[قيمة دفعة الحجز]]</span>)</label>
          <input type="number" style={input()} value={contractInfo.reservation_payment_amount} onChange={e => setContractInfo(s => ({ ...s, reservation_payment_amount: e.target.value }))} />
        </div>
        <div>
          <label style={styles.label}>Reservation Payment Date (<span style={styles.arInline}>[[تاريخ سداد دفعة الحجز]]</span>)</label>
          <input type="date" style={input()} value={contractInfo.reservation_payment_date} onChange={e => setContractInfo(s => ({ ...s, reservation_payment_date: e.target.value }))} />
        </div>
        <div>
          <label style={styles.label}>Maintenance Fee (<span style={styles.arInline}>[[مصاريف الصيانة بالأرقام]]</span>)</label>
          <input type="number" style={input()} value={contractInfo.maintenance_fee} onChange={e => setContractInfo(s => ({ ...s, maintenance_fee: e.target.value }))} />
        </div>
        <div>
          <label style={styles.label}>Delivery Period (<span style={styles.arInline}>[[مدة التسليم]]</span>)</label>
          <input dir="auto" style={input()} value={contractInfo.delivery_period} onChange={e => setContractInfo(s => ({ ...s, delivery_period: e.target.value }))} placeholder='مثال: "ثلاث سنوات ميلادية"' />
        </div>
      </div>

      <div style={{ marginTop: 12, borderTop: '1px dashed #ead9bd', paddingTop: 12 }}>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>Additional Fees Schedule (not included in PV)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <div>
            <label style={styles.label}>Maintenance Deposit Amount</label>
            <input type="number" style={input()} value={feeSchedule.maintenancePaymentAmount} onChange={e => setFeeSchedule(s => ({ ...s, maintenancePaymentAmount: e.target.value }))} placeholder="e.g. 150000" />
          </div>
          <div>
            <label style={styles.label}>Maintenance Deposit Due Month (defaults to Handover date)</label>
            <input type="number" min="0" style={input()} value={feeSchedule.maintenancePaymentMonth} onChange={e => setFeeSchedule(s => ({ ...s, maintenancePaymentMonth: e.target.value }))} placeholder="e.g. 72 if handover after 6 years" />
          </div>
          <div>
            <label style={styles.label}>Maintenance Deposit Date (optional — overrides month)</label>
            <input type="date" style={input()} value={feeSchedule.maintenancePaymentDate || ''} onChange={e => setFeeSchedule(s => ({ ...s, maintenancePaymentDate: e.target.value }))} />
          </div>
          <div>
            <label style={styles.label}>Garage Amount</label>
            <input type="number" style={input()} value={feeSchedule.garagePaymentAmount} onChange={e => setFeeSchedule(s => ({ ...s, garagePaymentAmount: e.target.value }))} placeholder="e.g. 200000" />
          </div>
          <div>
            <label style={styles.label}>Garage Due Month (from contract date)</label>
            <input type="number" min="0" style={input()} value={feeSchedule.garagePaymentMonth} onChange={e => setFeeSchedule(s => ({ ...s, garagePaymentMonth: e.target.value }))} placeholder="e.g. 12" />
          </div>
        </div>
        <small style={styles.metaText}>These amounts will be appended to the generated schedule with dates based on the contract date (or reservation form date if contract date is empty). They are not part of PV calculation.</small>
      </div>
    </section>
  )
}