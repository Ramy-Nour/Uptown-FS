import React from 'react'
import LoadingButton from '../../components/LoadingButton.jsx'

export default function DealEditRequestModal({
  open,
  editFields,
  editReason,
  onChangeFields,
  onChangeReason,
  onCancel,
  onSubmit
}) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 16,
          width: 520,
          maxWidth: '90vw',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
        }}
      >
        <h3 style={{ marginTop: 0 }}>Request Edits From Consultant</h3>
        <p style={{ color: '#6b7280', marginTop: 4 }}>
          Select the fields that need correction and optionally add a comment. Identity and unit data
          are locked after block approval.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            marginTop: 8
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <input
              type="checkbox"
              checked={editFields.address}
              onChange={e =>
                onChangeFields({ ...editFields, address: e.target.checked })
              }
            />
            Address
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <input
              type="checkbox"
              checked={editFields.payment_plan}
              onChange={e =>
                onChangeFields({ ...editFields, payment_plan: e.target.checked })
              }
            />
            Payment Plan
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <input
              type="checkbox"
              checked={editFields.maintenance_date}
              onChange={e =>
                onChangeFields({
                  ...editFields,
                  maintenance_date: e.target.checked
                })
              }
            />
            Maintenance Deposit Date
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <input
              type="checkbox"
              checked={editFields.offer_dates}
              onChange={e =>
                onChangeFields({ ...editFields, offer_dates: e.target.checked })
              }
            />
            Offer/First Payment Dates
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <label
            style={{
              display: 'block',
              fontWeight: 600,
              fontSize: 13,
              color: '#374151',
              marginBottom: 4
            }}
          >
            Other (specify)
          </label>
          <input
            type="text"
            value={editFields.other}
            onChange={e =>
              onChangeFields({ ...editFields, other: e.target.value })
            }
            style={{
              padding: 10,
              borderRadius: 10,
              border: '1px solid #d1d9e6',
              width: '100%'
            }}
            placeholder="e.g., POA clause text or custom note"
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <label
            style={{
              display: 'block',
              fontWeight: 600,
              fontSize: 13,
              color: '#374151',
              marginBottom: 4
            }}
          >
            Comment
          </label>
          <textarea
            value={editReason}
            onChange={e => onChangeReason(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: '1px solid #d1d9e6',
              width: '100%',
              minHeight: 80
            }}
            placeholder="Describe what needs to be changed"
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 14
          }}
        >
          <LoadingButton onClick={onCancel}>Cancel</LoadingButton>
          <LoadingButton variant="primary" onClick={onSubmit}>
            Send Request
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}