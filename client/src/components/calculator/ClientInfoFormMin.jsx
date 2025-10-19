import React from 'react'
import { t, isRTL } from '../../lib/i18n.js'

/**
 * Minimal, no-OCR client info form.
 * Plain controlled inputs only; no local buffering or OCR.
 * Restores all fields from the original form with same labels and autocomplete hints.
 * Adds support for multiple buyers (1..4). For buyers 2..N, fields are suffixed with _2, _3, _4 respectively.
 */
export default function ClientInfoFormMinimal({ role, clientInfo, setClientInfo, styles, language = 'en' }) {
  const input = (err) => styles.input ? styles.input(err) : { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff' }
  const textarea = (err) => styles.textarea ? styles.textarea(err) : { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff', minHeight: 80, resize: 'vertical' }

  const set = (k) => (e) => {
    const v = e.target.value
    setClientInfo(s => ({ ...s, [k]: v }))
  }

  const numberOfBuyers = Math.min(Math.max(Number(clientInfo.number_of_buyers || 1), 1), 4)

  const renderBuyerFields = (index) => {
    const suffix = index === 1 ? '' : `_${index}`
    return (
      <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: index === 1 ? 0 : 16 }}>
        {index > 1 && (
          <div style={{ gridColumn: '1 / span 2', marginBottom: 4 }}>
            <strong style={{ color: '#5b4630' }}>{isRTL(language) ? `بيانات المشترى رقم ${index}` : `Buyer ${index} Information`}</strong>
          </div>
        )}
        <div>
          <label htmlFor={`buyer_name${suffix}`} style={styles.label}>{t('buyer_name', language)} (<span style={styles.arInline}>[[اسم المشترى]]</span>)</label>
          <input
            id={`buyer_name${suffix}`}
            name={`buyer_name${suffix}`}
            dir="auto"
            autoComplete="name"
            style={input()}
            value={clientInfo[`buyer_name${suffix}`] || ''}
            onChange={set(`buyer_name${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`nationality${suffix}`} style={styles.label}>{t('nationality', language)} (<span style={styles.arInline}>[[الجنسية]]</span>)</label>
          <input
            id={`nationality${suffix}`}
            name={`nationality${suffix}`}
            dir="auto"
            autoComplete="country-name"
            style={input()}
            value={clientInfo[`nationality${suffix}`] || ''}
            onChange={set(`nationality${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`id_or_passport${suffix}`} style={styles.label}>{t('id_or_passport', language)} (<span style={styles.arInline}>[[رقم قومي/ رقم جواز]]</span>)</label>
          <input
            id={`id_or_passport${suffix}`}
            name={`id_or_passport${suffix}`}
            dir="auto"
            autoComplete="off"
            style={input()}
            value={clientInfo[`id_or_passport${suffix}`] || ''}
            onChange={set(`id_or_passport${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`id_issue_date${suffix}`} style={styles.label}>{t('id_issue_date', language)} (<span style={styles.arInline}>[[تاريخ الاصدار]]</span>)</label>
          <input
            id={`id_issue_date${suffix}`}
            name={`id_issue_date${suffix}`}
            type="date"
            style={input()}
            value={clientInfo[`id_issue_date${suffix}`] || ''}
            onChange={set(`id_issue_date${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`birth_date${suffix}`} style={styles.label}>{t('birth_date', language)} (<span style={styles.arInline}>[[تاريخ الميلاد]]</span>)</label>
          <input
            id={`birth_date${suffix}`}
            name={`birth_date${suffix}`}
            type="date"
            autoComplete="bday"
            style={input()}
            value={clientInfo[`birth_date${suffix}`] || ''}
            onChange={set(`birth_date${suffix}`)}
          />
        </div>
        <div style={styles.blockFull}>
          <label htmlFor={`address${suffix}`} style={styles.label}>{t('address', language)} (<span style={styles.arInline}>[[العنوان]]</span>)</label>
          <textarea
            id={`address${suffix}`}
            name={`address${suffix}`}
            dir="auto"
            autoComplete="street-address"
            style={textarea()}
            value={clientInfo[`address${suffix}`] || ''}
            onChange={set(`address${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`phone_primary${suffix}`} style={styles.label}>{t('primary_phone', language)} (<span style={styles.arInline}>[[رقم الهاتف]]</span>)</label>
          <input
            id={`phone_primary${suffix}`}
            name={`phone_primary${suffix}`}
            type="tel"
            autoComplete="tel"
            style={input()}
            value={clientInfo[`phone_primary${suffix}`] || ''}
            onChange={set(`phone_primary${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`phone_secondary${suffix}`} style={styles.label}>{t('secondary_phone', language)} (<span style={styles.arInline}>[[رقم الهاتف (2)]]</span>)</label>
          <input
            id={`phone_secondary${suffix}`}
            name={`phone_secondary${suffix}`}
            type="tel"
            autoComplete="tel-national"
            style={input()}
            value={clientInfo[`phone_secondary${suffix}`] || ''}
            onChange={set(`phone_secondary${suffix}`)}
          />
        </div>
        <div>
          <label htmlFor={`email${suffix}`} style={styles.label}>{t('email', language)} (<span style={styles.arInline}>[[البريد الالكتروني]]</span>)</label>
          <input
            id={`email${suffix}`}
            name={`email${suffix}`}
            type="email"
            autoComplete="email"
            style={input()}
            value={clientInfo[`email${suffix}`] || ''}
            onChange={set(`email${suffix}`)}
          />
        </div>
      </div>
    )
  }

  return (
    <section style={{ ...styles.section }} dir={isRTL(language) ? 'rtl' : 'ltr'}>
      <h2 style={{ ...styles.sectionTitle, textAlign: isRTL(language) ? 'right' : 'left' }}>{t('client_information', language)}</h2>

      {/* Number of Buyers selector (1..4) */}
      <div style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor="number_of_buyers" style={styles.label}>{isRTL(language) ? 'عدد المشترين' : 'Number of Buyers'}</label>
        <select
          id="number_of_buyers"
          name="number_of_buyers"
          value={numberOfBuyers}
          onChange={e => {
            const v = Math.min(Math.max(Number(e.target.value || 1), 1), 4)
            setClientInfo(s => ({ ...s, number_of_buyers: v }))
          }}
          style={input()}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </div>

      {/* Buyer 1 fields (original) */}
      {renderBuyerFields(1)}

      {/* Additional buyers */}
      {numberOfBuyers >= 2 && renderBuyerFields(2)}
      {numberOfBuyers >= 3 && renderBuyerFields(3)}
      {numberOfBuyers >= 4 && renderBuyerFields(4)}
    </section>
  )
}