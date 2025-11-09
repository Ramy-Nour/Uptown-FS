import React from 'react'
import { fetchWithAuth } from '../../lib/apiClient.js'

export default function BlockUnitButton({ role, unitInfo, clientInfo, genResult, language, styles, API_URL }) {
  // Only consultants and sales managers see the control
  if (!(role === 'property_consultant' || role === 'sales_manager')) return null

  const uid = Number(unitInfo?.unit_id) || 0

  // Require all client info except secondary phone to be present before enabling block
  const ci = clientInfo || {}
  const requiredFields = ['buyer_name','nationality','id_or_passport','id_issue_date','birth_date','address','phone_primary','email']
  const hasAllClientInfo = requiredFields.every(k => {
    const v = ci[k]
    return v != null && String(v).trim() !== ''
  })

  const planDecision = genResult?.evaluation?.decision
  const planAccepted = (planDecision === 'ACCEPT')
  const canBlock = uid > 0 && planAccepted && hasAllClientInfo

  async function requestUnitBlock() {
    try {
      if (!uid) return
      if (!hasAllClientInfo) {
        alert(language?.startsWith('ar')
          ? 'يجب إدخال جميع بيانات العميل أولاً (باستثناء رقم الهاتف الثانوي).'
          : 'Please fill all client information first (except Secondary Phone).')
        return
      }
      const durationStr = window.prompt('Block duration in days (default 7):', '7')
      if (durationStr === null) return
      const durationDays = Number(durationStr) || 7
      const reason = window.prompt('Reason for block (optional):', '') || ''
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: uid, durationDays, reason, decision: planDecision })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to request unit block')
      alert('Block request submitted for approval.')
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  return (
    <div style={{ marginTop: 8, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        onClick={requestUnitBlock}
        disabled={!canBlock}
        style={{
          ...(styles?.btnPrimary || {}),
          opacity: canBlock ? 1 : 0.6,
          cursor: canBlock ? 'pointer' : 'not-allowed',
          minWidth: 180
        }}
        title={
          canBlock
            ? (language?.startsWith('ar') ? 'طلب حجز مؤقت للوحدة' : 'Request a temporary block on this unit')
            : (language?.startsWith('ar')
                ? 'ستصبح متاحة بعد قبول الخطة — اختر وحدة من الجرد أولاً'
                : 'Available after plan is ACCEPT and a unit is selected')
        }
      >
        {language?.startsWith('ar') ? 'طلب حجز الوحدة' : 'Request Unit Block'}
      </button>
    </div>
  )
}