import React from 'react'
import { t, isRTL } from '../../lib/i18n.js'

/**
 * Minimal, no-OCR client info form.
 * Patterned after InputsForm.jsx: plain controlled inputs, no local buffering or sync guards.
 * Goal: validate typing/focus stability with the simplest possible form.
 */
export default function ClientInfoFormMinimal({ role, clientInfo, setClientInfo, styles, language = 'en' }) {
  const input = (err) => styles.input ? styles.input(err) : { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff' }
  const textarea = (err) => styles.textarea ? styles.textarea(err) : { padding: '10px 12px', borderRadius: 10, border: '1px solid #dfe5ee', outline: 'none', width: '100%', fontSize: 14, background: '#fbfdff', minHeight: 80, resize: 'vertical' }

  const set = (k) => (e) => {
    const v = e.target.value
    setClientInfo(s => ({ ...s, [k]: v }))
  }

  return (
    <section style={{ ...styles.section }} dir={isRTL(language) ? 'rtl' : 'ltr'}>
      <h2 style={{ ...styles.sectionTitle, textAlign: isRTL(language) ? 'right' : 'left' }}>{t('client_information', language)}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label htmlFor="buyer_name" style={styles.label}>{t('buyer_name', language)} (<span style={styles.arInline}>[[اسم المشترى]]</span>)</label>
          <input
            id="buyer_name"
            name="buyer_name"
            dir="auto"
            autoComplete="name"
            style={input()}
            value={clientInfo.buyer_name || ''}
            onChange={set('buyer_name')}
          />
        </div>
        <div>
          <label htmlFor="id_or_passport" style={styles.label}>{t('id_or_passport', language)} (<span style={styles.arInline}>[[رقم قومي/ رقم جواز]]</span>)</label>
          <input
            id="id_or_passport"
            name="id_or_passport"
            dir="auto"
            autoComplete="off"
            style={input()}
            value={clientInfo.id_or_passport || ''}
            onChange={set('id_or_passport')}
          />
        </div>
        <div>
          <label htmlFor="phone_primary" style={styles.label}>{t('primary_phone', language)} (<span style={styles.arInline}>[[رقم الهاتف]]</span>)</label>
          <input
            id="phone_primary"
            name="phone_primary"
            type="tel"
            autoComplete="tel"
            style={input()}
            value={clientInfo.phone_primary || ''}
            onChange={set('phone_primary')}
          />
        </div>
        <div>
          <label htmlFor="email" style={styles.label}>{t('email', language)} (<span style={styles.arInline}>[[البريد الالكتروني]]</span>)</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            style={input()}
            value={clientInfo.email || ''}
            onChange={set('email')}
          />
        </div>
        <div style={styles.blockFull}>
          <label htmlFor="address" style={styles.label}>{t('address', language)} (<span style={styles.arInline}>[[العنوان]]</span>)</label>
          <textarea
            id="address"
            name="address"
            dir="auto"
            autoComplete="street-address"
            style={textarea()}
            value={clientInfo.address || ''}
            onChange={set('address')}
          />
        </div>
      </div>
    </section>
  )
}
