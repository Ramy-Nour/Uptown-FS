import React from 'react'
import { tableWrap as wrapDefault, table as tableDefault, th as thDefault, td as tdDefault } from '../../lib/ui.js'
import numberToArabic from '../../lib/numberToArabic.js'
import { t } from '../../lib/i18n.js'

function translateLabel(label, language) {
  const isAr = String(language) === 'ar'
  if (!isAr || !label) return label
  const map = {
    'Down Payment': 'الدفعة المقدمة',
    'Down Payment (Y1 split)': 'الدفعة المقدمة (تقسيم السنة الأولى)',
    'Equal Installment': 'قسط متساوي',
    'First Year': 'السنة الأولى',
    'Handover': 'التسليم',
    'Maintenance Fee': 'وديعة الصيانة',
    'Maintenance Deposit': 'وديعة الصيانة',
    'Garage Fee': 'رسوم الجراج'
  }
  if (map[label]) return map[label]

  // Year N (frequency)
  const m = String(label).match(/^Year\\s+(\\d+)\\s+\\((.+)\\)$/i)
  if (m) {
    const n = m[1]
    const freqRaw = m[2].toLowerCase()
    const freqKey = ({
      'monthly': 'monthly',
      'quarterly': 'quarterly',
      'bi-annually': 'bi_annually',
      'annually': 'annually'
    })[freqRaw] || freqRaw
    return `السنة ${n} (${t(freqKey, 'ar')})`
  }
  return label
}

export default function PaymentSchedule({ schedule = [], totals = null, language = 'en', onExportCSV, onExportXLSX, onGenerateChecks }) {
  const rtl = String(language) === 'ar'
  return (
    <div style={wrapDefault} dir={rtl ? 'rtl' : 'ltr'}>
      <table style={tableDefault}>
        <thead>
          <tr>
            <th style={thDefault}>#</th>
            <th style={thDefault}>{t('month', language)}</th>
            <th style={thDefault}>{t('date', language)}</th>
            <th style={{ ...thDefault, textAlign: 'center' }}>{t('label', language)}</th>
            <th style={{ ...thDefault, textAlign: 'right' }}>{t('amount_label', language)}</th>
            <th style={{ ...thDefault, textAlign: rtl ? 'right' : 'left' }}>{t('written_amount', language)}</th>
          </tr>
        </thead>
        <tbody>
          {(schedule || []).map((row, idx) => (
            <tr key={idx}>
              <td style={tdDefault}>{idx + 1}</td>
              <td style={tdDefault}>{row.month}</td>
              <td style={tdDefault}>{row.date || ''}</td>
              <td style={{ ...tdDefault, textAlign: 'center' }}>{translateLabel(row.label, language)}</td>
              <td style={{ ...tdDefault, textAlign: 'right' }}>
                {Number(row.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td style={{ ...tdDefault, direction: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }}>
                {rtl ? numberToArabic(row.amount, 'جنيه مصري', 'قرش') : row.writtenAmount}
              </td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              <td colSpan="3" style={{ padding: 12, fontWeight: 700, background: '#fbfaf7', textAlign: 'right' }}>{t('total', language)}</td>
              <td style={{ padding: 12, fontWeight: 700, background: '#fbfaf7', textAlign: 'right' }}>
                {Number(totals.totalNominal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td style={{ padding: 12, fontWeight: 700, background: '#fbfaf7' }}></td>
            </tr>
          </tfoot>
        )}
      </table>
      <div style={{ display: 'flex', gap: 8, padding: 10, justifyContent: rtl ? 'flex-end' : 'flex-start' }}>
        <button type="button" onClick={onExportXLSX} disabled={!schedule.length} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}>
          {t('export_xlsx', language)}
        </button>
        <button type="button" onClick={onGenerateChecks} disabled={!schedule.length} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}>
          {t('generate_checks_sheet', language)}
        </button>
        <button type="button" onClick={onExportCSV} disabled={!schedule.length} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d9e6', background: '#fff', cursor: 'pointer' }}>
          {t('export_csv', language)}
        </button>
      </div>
    </div>
  )
}