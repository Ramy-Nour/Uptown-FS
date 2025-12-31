import React from 'react'
import LoadingButton from '../../components/LoadingButton.jsx'

export default function DealHeaderSection({
  deal,
  dealUnitId,
  canViewUnitHistory,
  unitDeals,
  dealStatusLabel,
  dealStatusColor,
  overrideLabel,
  overrideColor,
  unitAvailabilityLabel,
  unitStatusColor,
  autoApprovedOnBlock,
  hasPricingBreakdown,
  role,
  onBack,
  onViewUnitDeals,
  onViewUnitHistory
}) {
  if (!deal) return null

  const showUnitDealsButton = typeof dealUnitId === 'number' && dealUnitId > 0 && typeof onViewUnitDeals === 'function'
  const showUnitHistoryButton =
    typeof dealUnitId === 'number' &&
    dealUnitId > 0 &&
    !!canViewUnitHistory &&
    typeof onViewUnitHistory === 'function'

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ marginTop: 0 }}>Deal #{deal.id}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <LoadingButton onClick={onBack}>Back to Dashboard</LoadingButton>
          {showUnitDealsButton && (
            <LoadingButton
              onClick={onViewUnitDeals}
              title="View all deals created for this unit"
            >
              View Deals for This Unit
            </LoadingButton>
          )}
          {showUnitHistoryButton && (
            <LoadingButton
              onClick={onViewUnitHistory}
              title="Open full lifecycle history for this unit (blocks, reservations, contracts)"
            >
              View Unit History
            </LoadingButton>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        {/* Conflict banner: other deals for this unit */}
        {Array.isArray(unitDeals) && unitDeals.length > 0 && (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #fed7aa',
              background: '#fffbeb',
              color: '#9a3412',
              fontSize: 13
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Other deals exist for this unit: {unitDeals.length} deal(s).
            </div>
            <div>
              {unitDeals.slice(0, 4).map(d => (
                <span key={d.id} style={{ marginRight: 8 }}>
                  #{d.id} ({d.status || 'unknown'})
                </span>
              ))}
              {unitDeals.length > 4 && <span>…</span>}
            </div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              This does not change this deal’s validity, but Sales/Finance should be aware of potentially
              competing offers on the same unit.
            </div>
          </div>
        )}

        <p>
          <strong>Title:</strong> {deal.title}
        </p>
        <p>
          <strong>Amount:</strong>{' '}
          {Number(deal.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </p>

        {/* Compact status/override/unit summary */}
        <div
          style={{
            margin: '6px 0 10px 0',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #e6eaf0',
            background: '#f9fafb',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16
          }}
        >
          <div>
            <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280' }}>Deal Status</div>
            <div>
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  background: '#f8fafc',
                  color: dealStatusColor,
                  textTransform: 'none'
                }}
              >
                {dealStatusLabel}
              </span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280' }}>Override</div>
            <div>
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  background: '#f8fafc',
                  color: overrideColor,
                  textTransform: 'none'
                }}
              >
                {overrideLabel}
              </span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280' }}>Unit Availability</div>
            <div>
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  background: '#f8fafc',
                  color: unitStatusColor,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3
                }}
              >
                {unitAvailabilityLabel}
              </span>
            </div>
          </div>
        </div>
        {autoApprovedOnBlock && (
          <div style={{ margin: '-4px 0 10px 0', fontSize: 12, color: '#6b7280' }}>
            Note: This deal was automatically marked as &quot;approved&quot; when the Financial Manager
            approved the unit block (normal criteria path, no override).
          </div>
        )}

        <p>
          <strong>Unit Type:</strong> {deal.unit_type || '-'}
        </p>
        {/* Dates summary near header */}
        <div
          style={{
            margin: '6px 0 10px 0',
            padding: '8px 10px',
            borderRadius: 8,
            background: '#fbfaf7',
            border: '1px solid #ead9bd',
            display: 'inline-flex',
            gap: 16,
            flexWrap: 'wrap'
          }}
        >
          <div>
            <strong>Offer Date:</strong>{' '}
            {deal?.details?.calculator?.inputs?.offerDate || new Date().toISOString().slice(0, 10)}
          </div>
          <div>
            <strong>First Payment Date:</strong>{' '}
            {deal?.details?.calculator?.inputs?.firstPaymentDate ||
              deal?.details?.calculator?.inputs?.offerDate ||
              new Date().toISOString().slice(0, 10)}
          </div>
        </div>
        {!hasPricingBreakdown &&
          (role === 'property_consultant' || role === 'financial_admin' || role === 'financial_manager') && (
            <div
              style={{
                margin: '4px 0 10px 0',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #f97316',
                background: '#fff7ed',
                color: '#9a3412',
                fontSize: 13
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                Unit price breakdown is missing from this offer snapshot.
              </div>
              <div>
                Open “Edit Offer”, review the calculator, and click Save to refresh pricing before printing Client
                Offers or Reservation Forms.
              </div>
            </div>
          )}
        {deal.status === 'rejected' && deal.rejection_reason ? (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #ef4444',
              background: '#fef2f2',
              color: '#7f1d1d'
            }}
          >
            <strong>Rejection Reason:</strong>
            <div style={{ marginTop: 4 }}>{deal.rejection_reason}</div>
          </div>
        ) : null}
        <p style={{ marginTop: 16 }}>
          <strong>Created By:</strong> {deal.created_by_email || deal.created_by}
        </p>
        <p>
          <strong>Created At:</strong>{' '}
          {deal.created_at ? new Date(deal.created_at).toLocaleString() : ''}
        </p>
      </div>
    </>
  )
}