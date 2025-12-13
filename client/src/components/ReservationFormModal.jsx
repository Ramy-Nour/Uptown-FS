import React from 'react'
import LoadingButton from './LoadingButton.jsx'

export default function ReservationFormModal({
  open,
  defaultDate = new Date().toISOString().slice(0,10),
  defaultLanguage = 'en',
  defaultCurrency = '',
  defaultPreliminaryPayment = '',
  preliminaryLocked = false,
  onCancel,
  onGenerate
}) {
  const [date, setDate] = React.useState(defaultDate)
  const [prelim, setPrelim] = React.useState(
    defaultPreliminaryPayment === '' || defaultPreliminaryPayment == null
      ? ''
      : String(defaultPreliminaryPayment)
  )
  const [currency, setCurrency] = React.useState(defaultCurrency)
  const [language, setLanguage] = React.useState(defaultLanguage)

  React.useEffect(() => {
    if (open) {
      setDate(defaultDate)
      setPrelim(
        defaultPreliminaryPayment === '' || defaultPreliminaryPayment == null
          ? ''
          : String(defaultPreliminaryPayment)
      )
      setCurrency(defaultCurrency)
      setLanguage(defaultLanguage)
    }
  }, [open, defaultDate, defaultLanguage, defaultCurrency, defaultPreliminaryPayment])

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: 520, maxWidth: '90vw', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
        <h3 style={{ marginTop: 0 }}>Reservation Form Options</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ gridColumn: '1 / span 2' }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Reservation Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d9e6', width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Preliminary Payment</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={prelim}
              onChange={e => setPrelim(e.target.value)}
              disabled={preliminaryLocked}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d9e6', width: '100%', background: preliminaryLocked ? '#f9fafb' : '#fff' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Currency (optional)</label>
            <input
              type="text"
              placeholder="e.g., EGP, USD, SAR"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d9e6', width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Language</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d9e6', width: '100%' }}
            >
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <LoadingButton onClick={onCancel}>Cancel</LoadingButton>
          <LoadingButton
            variant="primary"
            onClick={() => {
              const preliminary_payment_amount = Number(prelim || 0)
              if (!Number.isFinite(preliminary_payment_amount) || preliminary_payment_amount &lt; 0) {
                alert('Preliminary payment must be a non-negative number')
                return
              }
              onGenerate({
                reservation_form_date: date || new Date().toISOString().slice(0,10),
                preliminary_payment_amount,
                currency_override: currency || '',
                language: language || 'en'
              })
            }}
          >
            Generate
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}