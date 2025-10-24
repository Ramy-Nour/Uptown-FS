import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './Dashboard.jsx'
import CreateDeal from './CreateDeal.jsx'
import Approvals from './Approvals.jsx'
import DealDetail from './DealDetail.jsx'
import BrandHeader from '../lib/BrandHeader.jsx'
import PaymentPlanQueues from './PaymentPlanQueues.jsx'
import InventoryList from './InventoryList.jsx'
import MyProposals from './MyProposals.jsx'
import TeamProposals from './TeamProposals.jsx'
import BlockRequests from './BlockRequests.jsx'
import CurrentBlocks from './CurrentBlocks.jsx'
import ReservationsQueue from './ReservationsQueue.jsx'
import OfferProgress from './OfferProgress.jsx'
import RequireRole from '../components/RequireRole.jsx'

export default function DealsApp() {
  const handleLogout = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
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
  }

  return (
    <div>
      <BrandHeader title={import.meta.env.VITE_APP_TITLE || 'Uptown Financial System'} onLogout={handleLogout} />
      <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="create" element={<CreateDeal />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="queues" element={<PaymentPlanQueues />} />
          <Route path="inventory" element={<InventoryList />} />
          <Route path="my-proposals" element={<MyProposals />} />
          <Route path="team-proposals" element={<TeamProposals />} />
          <Route
            path="block-requests"
            element={
              <RequireRole allowed={['sales_manager','property_consultant','financial_manager']}>
                <BlockRequests />
              </RequireRole>
            }
          />
          <Route
            path="current-blocks"
            element={
              <RequireRole allowed={['financial_manager','financial_admin']}>
                <CurrentBlocks />
              </RequireRole>
            }
          />
          <Route
            path="reservations-queue"
            element={
              <RequireRole allowed={['financial_manager']}>
                <ReservationsQueue />
              </RequireRole>
            }
          />
          <Route
            path="offer-progress"
            element={
              <RequireRole allowed={['sales_manager','property_consultant']}>
                <OfferProgress />
              </RequireRole>
            }
          />
          <Route path=":id" element={<DealDetail />} />
          <Route path="*" element={<Navigate to="/deals" replace />} />
        </Routes>
      </div>
    </div>
  )
}