import React from 'react'

export default function CustomNotesSection({ styles, language, role, customNotes, setCustomNotes }) {
  if (!(role === 'contract_manager' || role === 'contract_person')) return null
  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>Custom Text Notes</h2>
      <div>
        <label style={styles.label}>
          Down Payment Explanation (<span style={styles.arInline}>[[بيان الباقي من دفعة التعاقد]]</span>)
        </label>
        <textarea
          dir="auto"
          style={styles.textarea()}
          value={customNotes.dp_explanation}
          onChange={e => setCustomNotes(s => ({ ...s, dp_explanation: e.target.value }))}
          placeholder='مثال: "يسدد الباقي على شيكين"'
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={styles.label}>
          Power of Attorney Clause (<span style={styles.arInline}>[[بيان التوكيل]]</span>)
        </label>
        <textarea
          style={styles.textarea()}
          value={customNotes.poa_clause}
          onChange={e => setCustomNotes(s => ({ ...s, poa_clause: e.target.value }))}
          placeholder='بنود قانونية خاصة إن وجدت'
        />
      </div>
    </section>
  )
}