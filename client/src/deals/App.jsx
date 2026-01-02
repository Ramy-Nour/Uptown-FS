import React from 'react'
import { Routes, Route } from 'react-router-dom'
import BrandHeader from '../lib/BrandHeader.jsx'
import Dashboard from './Dashboard.jsx'
import CreateDeal from './CreateDeal.jsx'
import DealDetail from './DealDetail.jsx'
import MyProposals from './MyProposals.jsx'
import TeamProposals from './TeamProposals.jsx'
import Approvals from './Approvals.jsx'
import PaymentPlanQueues from './PaymentPlanQueues.jsx'
import OfferProgress from './OfferProgress.jsx'
import CurrentBlocks from './CurrentBlocks.jsx'
import BlockRequests from './BlockRequests.jsx'
import ReservationsQueue from './ReservationsQueue.jsx'
import InventoryList from './InventoryList.jsx'
import PaymentPlanEdits from './PaymentPlanEdits.jsx'
import ContractsList from './ContractsList.jsx'
import ContractDetail from './ContractDetail.jsx'

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
        <Route path="/" element={<Dashboard />} />
        <Route path="create" element={<CreateDeal />} />
        <Route path=":id" element={<DealDetail />} />
        <Route path="my-proposals" element={<MyProposals />} />
        <Route path="team-proposals" element={<TeamProposals />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="queues" element={<PaymentPlanQueues />} />
        <Route path="offer-progress" element={<OfferProgress />} />
        <Route path="current-blocks" element={<CurrentBlocks />} />
        <Route path="block-requests" element={<BlockRequests />} />
        <Route path="reservations-queue" element={<ReservationsQueue />} />
        <Route path="inventory" element={<InventoryList />} />
        <Route path="plan-edits" element={<PaymentPlanEdits />} />
        {/* Contracts list/detail live under /contracts at the top router, not under /deals.
            These routes are not added here to avoid path confusion. */}
      </Routes>
      </div>
    </div>
  )
}