import React from 'react'
import LoadingButton from '../../components/LoadingButton.jsx'
import ReservationFormModal from '../../components/ReservationFormModal.jsx'

export default function DealActionsBar({
  deal,
  role,
  canEdit,
  canSubmit,
  editCalc,
  evaluation,
  approvedReservation,
  reservationModalOpen,
  reservationGenerating,
  reservationProgress,
  calcCommissionLoading,
  onToggleEditCalc,
  onSubmitDeal,
  onApproveDealAsSM,
  onRequestOverride,
  onGenerateClientOfferPdf,
  onBlockOrUnblockUnit,
  onOpenReservationModal,
  onCloseReservationModal,
  onGenerateReservationFormPdf,
  onRequestEdits,
  onGenerateContractPdf,
  onGenerateChecksSheet,
  onCalculateCommission
}) {
  if (!deal) return null

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {canEdit && !editCalc && (
        <LoadingButton onClick={onToggleEditCalc}>Edit Offer</LoadingButton>
      )}

      {canSubmit && role !== 'property_consultant' && (
        <LoadingButton
          onClick={onSubmitDeal}
          variant="primary"
        >
          Submit for Approval
        </LoadingButton>
      )}

      {/* Sales Manager Approval Action */}
      {role === 'sales_manager' && deal.status === 'pending_approval' && (
        <LoadingButton
          onClick={onApproveDealAsSM}
          variant="primary"
          style={{ background: '#10b981', borderColor: '#10b981' }}
        >
          Approve Deal
        </LoadingButton>
      )}

      {/* Request Override button for Property Consultant or Managers when evaluation is REJECT */}
      {evaluation?.decision === 'REJECT' &&
        (role === 'property_consultant' ||
          role === 'sales_manager' ||
          role === 'financial_manager' ||
          role === 'admin' ||
          role === 'superadmin') && (
          <LoadingButton onClick={onRequestOverride}>
            Request Override
          </LoadingButton>
        )}

      {/* Property Consultant offer actions */}
      {role === 'property_consultant' &&
        (deal.status === 'approved' || deal.status === 'draft') && (
          <>
            <LoadingButton onClick={onGenerateClientOfferPdf}>
              Print Offer (Client Offer PDF)
            </LoadingButton>
            <LoadingButton onClick={onBlockOrUnblockUnit}>
              {/* The label/title are handled inside onBlockOrUnblockUnit using prompts and unit status */}
              Unit Block / Unblock
            </LoadingButton>
          </>
        )}

      {/* Financial Admin actions: Reservation Form + Edits */}
      {role === 'financial_admin' && (
        <>
          <LoadingButton
            onClick={onOpenReservationModal}
            title="Generate Reservation Form (after FM approval)"
          >
            Generate Reservation Form (PDF)
          </LoadingButton>

          <ReservationFormModal
            open={reservationModalOpen}
            defaultDate={
              approvedReservation?.reservation_date
                ? new Date(approvedReservation.reservation_date)
                    .toISOString()
                    .slice(0, 10)
                : new Date().toISOString().slice(0, 10)
            }
            defaultLanguage={approvedReservation?.language || 'en'}
            defaultCurrency=""
            defaultPreliminaryPayment={
              approvedReservation
                ? Number(approvedReservation.preliminary_payment || 0)
                : ''
            }
            preliminaryLocked={!!approvedReservation}
            loading={reservationGenerating}
            progress={reservationProgress}
            onCancel={onCloseReservationModal}
            onGenerate={onGenerateReservationFormPdf}
          />

          <LoadingButton onClick={onRequestEdits}>
            Request Edits From Consultant
          </LoadingButton>
        </>
      )}

      {/* Contract PDF generation */}
      {role === 'contract_person' && deal.status === 'approved' && (
        <LoadingButton onClick={onGenerateContractPdf}>
          Generate Contract (PDF)
        </LoadingButton>
      )}

      {/* Checks sheet generation */}
      {role === 'financial_admin' && (
        <LoadingButton onClick={onGenerateChecksSheet}>
          Generate Checks Sheet (.xlsx)
        </LoadingButton>
      )}

      {/* Commission calculation */}
      <LoadingButton
        onClick={onCalculateCommission}
        loading={calcCommissionLoading}
      >
        Calculate Commission
      </LoadingButton>
    </div>
  )
}