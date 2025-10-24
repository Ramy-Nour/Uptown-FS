import React from 'react'
import { fetchWithAuth } from '../../lib/apiClient.js'

export default function BlockUnitButton({ role, unitInfo, genResult, language, styles, API_URL }) {
  // Only consultants and sales managers see the control
  if (!(role === 'property_consultant' || role === 'sales_manager')) return null

  const uid = Number(unitInfo?.unit_id) || 0
  const canBlock = uid > 0 && (genResult?.evaluation?.decision === 'ACCEPT')

  async function requestUnitBlock() {
    try {
      if (!uid) return
      const durationStr = window.prompt('Block duration in days (default 7):', '7')
      if (durationStr === null) return
      const durationDays = Number(durationStr) || 7
      const reason = window.prompt('Reason for block (optional):', '') || ''
      const resp = await fetchWithAuth(`${API_URL}/api/blocks/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: uid, durationDays, reason })
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