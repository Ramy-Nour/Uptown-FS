import React from 'react'
import { Routes, Route } from 'react-router-dom'
import MainLayout from '../components/layout/MainLayout.jsx'
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

export default function DealsApp() {
  return (
    <MainLayout>
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
      </Routes>
    </MainLayout>
  )
}
