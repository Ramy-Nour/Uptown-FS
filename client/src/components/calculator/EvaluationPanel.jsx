import React from 'react'
import * as ui from '../../lib/ui.js'

export default function EvaluationPanel({ evaluation, role, dealId, API_URL, showInlineOverride = false, onInlineOverride }) {
  if (!evaluation) return null

  const ok = evaluation.decision === 'ACCEPT'

  // Collect unmet criteria for REJECT banner
  const failedCriteria = []
  if (!evaluation?.pv?.pass) failedCriteria.push('PV below standard')
  if (Array.isArray(evaluation?.conditions)) {
    for (const c of evaluation.conditions) {
      if (c?.status && c.status !== 'PASS') {
        failedCriteria.push(
          c.label +
          (c.required && typeof c.required === 'object' && c.required.min != null
            ? ` (requires at least ${Number(c.required.min).toLocaleString()}%)`
            : '')
        )
      }
    }
  }

  const box = {
    marginBottom: 12,
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${ok ? '#10b981' : '#ef4444'}`,
    background: ok ? '#ecfdf5' : '#fee2e2', // stronger red background for reject
    color: ok ? '#065f46' : '#7f1d1d',
    fontWeight: 600
  }

  const requestOverride = async () => {
    const reason = window.prompt('Provide a reason for override request (optional):', '')
    try {
      const resp = await fetch(`${API_URL}/api/deals/${dealId}/request-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
        body: JSON.stringify({ reason: reason || null })
      })
      const data = await resp.json()
      if (!resp.ok) alert(data?.error?.message || 'Failed to request override')
      else alert('Override requested. Waiting for review.')
    } catch (err) {
      alert(err?.message || 'Failed to request override')
    }
  }

  return (
    <div>
      <div style={box}>
        <div>NPV-based Decision: {evaluation.decision}</div>
        {!ok && failedCriteria.length > 0 && (
          <div style={{ marginTop: 6, fontWeight: 500, fontSize: 13 }}>
            Unmet criteria: {failedCriteria.join(', ')}
          </div>
        )}
        {!ok && (role === 'property_consultant' || role === 'sales_manager' || role === 'financial_manager' || role === 'admin' || role === 'superadmin') && dealId && (
          <div style={{ marginTop: 8 }}>
            <button type="button" style={ui.btnPrimary} onClick={requestOverride}>
              Request Override
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ border: '1px dashed #ead9bd', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0, fontSize: 16, color: '#5b4630' }}>PV Comparison</h3>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>Proposed PV: {Number(evaluation.pv.proposedPV || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</li>
            <li>Standard PV: {Number(evaluation.pv.standardPV || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</li>
            <li>Difference (Std - Prop): {Number(evaluation.pv.difference || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</li>
            <li>PV Tolerance: {Number(evaluation.pv.tolerancePercent || 0).toLocaleString()}%</li>
            <li>Status: {evaluation.pv.pass ? 'PASS' : 'FAIL'}</li>
          </ul>
          {/* Inline override action space below PV comparison */}
          {!ok && showInlineOverride && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={onInlineOverride}
                style={{ ...ui.btnPrimary, minWidth: 200 }}
                title="Create a draft deal and request an override"
              >
                Request Override
              </button>
            </div>
          )}
        </div>
        <div style={{ border: '1px dashed #ead9bd', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0, fontSize: 16, color: '#5b4630' }}>Conditions</h3>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {evaluation.conditions.map((c, idx) => (
              <li key={idx} style={{ marginBottom: 6 }}>
                <div><strong>{c.label}</strong> — <span style={{ color: c.status === 'PASS' ? '#065f46' : '#7f1d1d' }}>{c.status}</span></div>
                {'required' in c && typeof c.required === 'number' && <div>Required: {Number(c.required).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                {'required' in c && typeof c.required === 'object' && (
                  <div>
                    Required: {c.required.min != null ? `Min ${Number(c.required.min).toLocaleString()}% ` : ''}{c.required.max != null ? `Max ${Number(c.required.max).toLocaleString()}%` : ''}
                  </div>
                )}
                {'actual' in c && typeof c.actual === 'number' && <div>Actual: {Number(c.actual).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                {'actual' in c && typeof c.actual === 'object' && (
                  <div>
                    Actual: {c.actual.amount != null ? `${Number(c.actual.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}{c.actual.percent != null ? ` (${Number(c.actual.percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%)` : ''}
                  </div>
                )}
                {c.handoverYear != null && <div>Handover Year: {c.handoverYear}</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}