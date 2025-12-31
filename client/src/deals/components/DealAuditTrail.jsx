import React from 'react'

const th = {
  textAlign: 'left',
  padding: 10,
  borderBottom: '1px solid #eef2f7',
  fontSize: 13,
  color: '#475569',
  background: '#f9fbfd'
}
const td = { padding: 10, borderBottom: '1px solid #f2f5fa', fontSize: 14 }

export default function DealAuditTrail({ history, expandedNotes, onToggleNote }) {
  const rows = Array.isArray(history) ? history : []

  return (
    <>
      <h3>Audit Trail</h3>
      <div style={{ overflow: 'auto', border: '1px solid #e6eaf0', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Action</th>
              <th style={th}>User</th>
              <th style={th}>Notes</th>
              <th style={th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h, idx) => (
              <tr key={h.id}>
                <td style={td}>{idx + 1}</td>
                <td style={td}>{h.action}</td>
                <td style={td}>{h.user_email || h.user_id}</td>
                <td style={td}>
                  {(() => {
                    const raw = h.notes || ''
                    let parsed = null
                    try {
                      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
                        parsed = JSON.parse(raw)
                      }
                    } catch {
                      // ignore parse errors and fall back to raw text
                    }
                    if (!parsed) return raw
                    const isAuto = parsed.event === 'auto_commission'
                    const sum = isAuto
                      ? `Auto commission — Policy: ${
                          parsed?.policy?.name || parsed?.policy?.id || ''
                        }, Amount: ${Number(parsed?.amounts?.commission || 0).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2 }
                        )}`
                      : 'Details'
                    const open = !!expandedNotes[h.id]
                    return (
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            flexWrap: 'wrap'
                          }}
                        >
                          <span>{sum}</span>
                          <button
                            type="button"
                            onClick={() => onToggleNote && onToggleNote(h.id)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              border: '1px solid #d1d9e6',
                              background: '#fff',
                              cursor: 'pointer'
                            }}
                          >
                            {open ? 'Hide' : 'Show'} JSON
                          </button>
                        </div>
                        {open && (
                          <pre
                            style={{
                              background: '#f6f8fa',
                              padding: 8,
                              borderRadius: 6,
                              border: '1px solid #eef2f7',
                              marginTop: 6,
                              maxWidth: 640,
                              overflow: 'auto'
                            }}
                          >
{JSON.stringify(parsed, null, 2)}
                          </pre>
                        )}
                      </div>
                    )
                  })()}
                </td>
                <td style={td}>{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>
                  No history yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}