import React, { useEffect, useState, useMemo } from 'react'
import { fetchWithAuth, API_URL } from '../lib/apiClient.js'
import BrandHeader from '../lib/BrandHeader.jsx'

export default function PaymentThresholds() {
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  const role = user?.role
  const isTopMgmt = ['ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role)
  const headerTitle = isTopMgmt ? 'Payment Threshold Approvals' : 'Payment Thresholds'
  const [selectedTab, setSelectedTab] = useState(isTopMgmt ? 'proposals' : 'active')
  const tabs = useMemo(() => ([
    { key: 'active', label: 'Active', disabled: isTopMgmt },
    { key: 'proposals', label: 'Proposals', disabled: false },
    { key: 'history', label: 'History', disabled: false }
  ]), [isTopMgmt])

  const [thresholds, setThresholds] = useState({
    firstYearPercentMin: '',
    firstYearPercentMax: '',
    secondYearPercentMin: '',
    secondYearPercentMax: '',
    handoverPercentMin: '',
    handoverPercentMax: ''
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [proposals, setProposals] = useState([])
  const [proposalsLoading, setProposalsLoading] = useState(false)
  const [proposalMsg, setProposalMsg] = useState('')

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyMsg, setHistoryMsg] = useState('')

  async function loadActive() {
    const resp = await fetchWithAuth(`${API_URL}/api/config/payment-thresholds`)
    const data = await resp.json()
    if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load thresholds')
    setThresholds({
      firstYearPercentMin: data.thresholds.firstYearPercentMin ?? '',
      firstYearPercentMax: data.thresholds.firstYearPercentMax ?? '',
      secondYearPercentMin: data.thresholds.secondYearPercentMin ?? '',
      secondYearPercentMax: data.thresholds.secondYearPercentMax ?? '',
      handoverPercentMin: data.thresholds.handoverPercentMin ?? '',
      handoverPercentMax: data.thresholds.handoverPercentMax ?? ''
    })
  }

  async function loadProposals() {
    setProposalsLoading(true)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/config/payment-thresholds/proposals`)
      const data = await resp.json()
      if (resp.ok) {
        setProposals(data.proposals || [])
      } else {
        setProposalMsg(data?.error?.message || 'Could not load proposals')
      }
    } catch (e) {
      setProposalMsg(e.message || String(e))
    } finally {
      setProposalsLoading(false)
    }
  }

  async function loadHistory() {
    setHistoryLoading(true)
    setHistoryMsg('')
    try {
      // canonical endpoint
      let resp = await fetchWithAuth(`${API_URL}/api/config/payment-thresholds/history`)
      let data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        // fallback: if server exposes history via proposals with status filter
        resp = await fetchWithAuth(`${API_URL}/api/config/payment-thresholds/proposals?status=approved`)
        data = await resp.json().catch(() => ({}))
      }
      if (resp.ok) {
        const items = data.history || data.items || data.proposals || []
        setHistory(items)
      } else {
        setHistory([])
        setHistoryMsg(data?.error?.message || 'Could not load approvals history')
      }
    } catch (e) {
      setHistoryMsg(e.message || String(e))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        await loadActive()
      } catch (e) {
        setError(e.message || String(e))
      } finally {
        setLoading(false)
      }
      // Load proposals and history for FM and top management roles
      if (['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role)) {
        loadProposals().catch(() => {})
        loadHistory().catch(() => {})
      }
    })()
    return () => { mounted = false }
  }, [])

  const onChange = (key) => (e) => {
    const val = e.target.value
    setThresholds(s => ({ ...s, [key]: val }))
  }

  // Financial Manager: submit proposal
  async function submitProposal() {
    try {
      setSaving(true)
      setError('')
      setSuccess('')
      setProposalMsg('')
      const body = Object.fromEntries(Object.entries(thresholds).map(([k, v]) => [k, v === '' ? null : Number(v)]))
      const resp = await fetchWithAuth(`${API_URL}/api/config/payment-thresholds/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error?.message || 'Failed to submit proposal')
      setSuccess('Proposal submitted for approval')
      await loadProposals()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // Top Management: approve/reject
  async function actOnProposal(id, action) {
    try {
      setProposalMsg('')
      const resp = await fetchWithAuth(`${API_URL}/api/config/payment-thresholds/proposals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: '' })
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error?.message || `Failed to ${action} proposal`)
      if (action === 'approve') {
        setSuccess('Proposal approved and thresholds updated')
        await loadActive()
      } else {
        setSuccess('Proposal rejected')
      }
      await loadProposals()
    } catch (e) {
      setProposalMsg(e.message || String(e))
    }
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <BrandHeader
          title={headerTitle}
          onLogout={async () => {
            try {
              const rt = localStorage.getItem('refresh_token')
              if (rt) {
                await fetch(`${API_URL}/api/auth/logout`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ refreshToken: rt })
                }).catch(() => {})
              }
            } finally {
              localStorage.removeItem('auth_token')
              localStorage.removeItem('refresh_token')
              localStorage.removeItem('auth_user')
              window.location.href = '/login'
            }
          }}
        />
      </div>
      <div style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>{headerTitle}</h2>
        <p style={{ color: '#64748b' }}>
          Financial Manager proposes thresholds. Top Management approves or rejects. Active thresholds are shown and used by the calculator.
        </p>
        <div style={{ marginTop: 12, borderBottom: '1px solid #e6eaf0', display: 'flex', gap: 8 }}>
          {tabs.map(t => {
            const active = selectedTab === t.key
            const disabled = t.disabled
            const btnStyle = {
              padding: '8px 12px',
              border: 'none',
              background: active ? '#f6efe3' : 'transparent',
              color: disabled ? '#94a3b8' : (active ? '#5b4630' : '#475569'),
              borderBottom: active ? '3px solid #A97E34' : '3px solid transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: active ? 700 : 500
            }
            return (
              <button
                key={t.key}
                style={btnStyle}
                onClick={() => !disabled && setSelectedTab(t.key)}
                disabled={disabled}
              >
                {t.label}
              </button>
            )
          })}
        </div>

      {loading ? <p>Loading...</p> : null}
      {error ? <p style={{ color: '#e11d48' }}>{error}</p> : null}
      {success ? <p style={{ color: '#10b981' }}>{success}</p> : null}

      {/* For Top Management: hide the editable/active thresholds section entirely.
          They should only see Pending Proposals and Approvals History. */}
      {!isTopMgmt && selectedTab === 'active' && (
        <>
          <h3 style={{ marginTop: 16 }}>Active Thresholds</h3>
          {/* Financial Manager and others: keep inputs (only FM can edit/submit) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 640 }}>
            <div>
              <label>First Year Min (%)</label>
              <input type="number" step="0.01" value={thresholds.firstYearPercentMin} onChange={onChange('firstYearPercentMin')} style={inputStyle} disabled={role !== 'financial_manager'} />
            </div>
            <div>
              <label>First Year Max (%)</label>
              <input type="number" step="0.01" value={thresholds.firstYearPercentMax} onChange={onChange('firstYearPercentMax')} style={inputStyle} disabled={role !== 'financial_manager'} />
            </div>
            <div>
              <label>Second Year Min (%)</label>
              <input type="number" step="0.01" value={thresholds.secondYearPercentMin} onChange={onChange('secondYearPercentMin')} style={inputStyle} disabled={role !== 'financial_manager'} />
            </div>
            <div>
              <label>Second Year Max (%)</label>
              <input type="number" step="0.01" value={thresholds.secondYearPercentMax} onChange={onChange('secondYearPercentMax')} style={inputStyle} disabled={role !== 'financial_manager'} />
            </div>
            <div>
              <label>Handover Min (%)</label>
              <input type="number" step="0.01" value={thresholds.handoverPercentMin} onChange={onChange('handoverPercentMin')} style={inputStyle} disabled={role !== 'financial_manager'} />
            </div>
            <div>
              <label>Handover Max (%)</label>
              <input type="number" step="0.01" value={thresholds.handoverPercentMax} onChange={onChange('handoverPercentMax')} style={inputStyle} disabled={role !== 'financial_manager'} />
            </div>
          </div>
        </>
      )}

      {role === 'financial_manager' && selectedTab === 'active' && (
        <div style={{ marginTop: 16 }}>
          <button onClick={submitProposal} disabled={saving} style={btnPrimaryStyle}>
            {saving ? 'Submitting...' : 'Submit for Approval'}
          </button>
        </div>
      )}

      {selectedTab === 'proposals' && ['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role) && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Pending Proposals</h3>
          {proposalsLoading ? <p>Loading proposals...</p> : null}
          {proposalMsg ? <p style={{ color: '#e11d48' }}>{proposalMsg}</p> : null}
          {proposals.length === 0 ? (
            <p style={{ color: '#64748b' }}>No pending proposals.</p>
          ) : (
            <div style={{ border: '1px solid #e6eaf0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>ID</th>
                    <th style={th}>Proposed By</th>
                    <th style={th}>Date</th>
                    <th style={th}>Summary</th>
                    {isTopMgmt && <th style={th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {proposals.map(p => (
                    <tr key={p.id}>
                      <td style={td}>{p.id}</td>
                      <td style={td}>{p.proposed_by}</td>
                      <td style={td}>{p.proposed_at ? new Date(p.proposed_at).toLocaleString() : ''}</td>
                      <td style={td}>
                        FY: {p.thresholds.firstYearPercentMin ?? '-'}–{p.thresholds.firstYearPercentMax ?? '-'}%,
                        SY: {p.thresholds.secondYearPercentMin ?? '-'}–{p.thresholds.secondYearPercentMax ?? '-'}%,
                        HO: {p.thresholds.handoverPercentMin ?? '-'}–{p.thresholds.handoverPercentMax ?? '-'}%
                      </td>
                      {isTopMgmt && (
                        <td style={td}>
                          <button onClick={() => actOnProposal(p.id, 'approve')} style={btnGreen}>Approve</button>
                          <button onClick={() => actOnProposal(p.id, 'reject')} style={btnRed}>Reject</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Approvals History for FM and Top Management */}
      {selectedTab === 'history' && ['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role) && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Approvals History</h3>
          {historyLoading ? <p>Loading history...</p> : null}
          {historyMsg ? <p style={{ color: '#e11d48' }}>{historyMsg}</p> : null}
          {(!history || history.length === 0) ? (
            <p style={{ color: '#64748b' }}>No approved threshold records.</p>
          ) : (
            <div style={{ border: '1px solid #e6eaf0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>ID</th>
                    <th style={th}>Approved By</th>
                    <th style={th}>Approved At</th>
                    <th style={th}>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id || `${h.approved_at}-${h.approved_by || ''}`}>
                      <td style={td}>{h.id ?? '-'}</td>
                      <td style={td}>{h.approved_by || h.actor || '-'}</td>
                      <td style={td}>{h.approved_at ? new Date(h.approved_at).toLocaleString() : (h.date ? new Date(h.date).toLocaleString() : '')}</td>
                      <td style={td}>
                        FY: {(h.thresholds?.firstYearPercentMin ?? h.firstYearPercentMin) ?? '-'}–{(h.thresholds?.firstYearPercentMax ?? h.firstYearPercentMax) ?? '-'}%,
                        SY: {(h.thresholds?.secondYearPercentMin ?? h.secondYearPercentMin) ?? '-'}–{(h.thresholds?.secondYearPercentMax ?? h.secondYearPercentMax) ?? '-'}%,
                        HO: {(h.thresholds?.handoverPercentMin ?? h.handoverPercentMin) ?? '-'}–{(h.thresholds?.handoverPercentMax ?? h.handoverPercentMax) ?? '-'}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const inputStyle = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d1d9e6',
  outline: 'none',
  width: '100%',
  fontSize: 14,
  background: '#fff'
}

const btnPrimaryStyle = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #1f6feb',
  background: '#1f6feb',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600
}

const th = { textAlign: 'left', padding: 10, borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569', background: '#f9fbfd' }
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }

const btnGreen = {
  marginRight: 8,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #10b981',
  background: '#ecfdf5',
  color: '#065f46',
  cursor: 'pointer'
}
const btnRed = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #ef4444',
  background: '#fef2f2',
  color: '#7f1d1d',
  cursor: 'pointer'
}