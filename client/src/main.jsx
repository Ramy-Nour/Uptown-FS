import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import App from './App.jsx'
import Login from './Login.jsx'
import DealsApp from './deals/App.jsx'
import Users from './admin/Users.jsx'
import UserEdit from './admin/UserEdit.jsx'
import Units from './admin/Units.jsx'
import SalesTeam from './admin/SalesTeam.jsx'
import SalesManagerTeam from './admin/SalesManagerTeam.jsx'
import ContractsTeam from './admin/ContractsTeam.jsx'
import FinanceTeam from './admin/FinanceTeam.jsx'
import UnitModels from './admin/UnitModels.jsx'
import UnitModelChanges from './admin/UnitModelChanges.jsx'
import CommissionPolicies from './admin/CommissionPolicies.jsx'
import CommissionsReport from './admin/CommissionsReport.jsx'
import StandardPricing from './admin/StandardPricing.jsx'
import StandardPricingApprovals from './admin/StandardPricingApprovals.jsx'; // THIS LINE IS NEW
import RejectedPricings from './admin/RejectedPricings.jsx';
import InventoryDrafts from './admin/InventoryDrafts.jsx';
import HoldsFM from './admin/HoldsFM.jsx'
import HoldsCEO from './admin/HoldsCEO.jsx'
import WorkflowLogs from './admin/WorkflowLogs.jsx'
import PaymentThresholds from './admin/PaymentThresholds.jsx'

function RoleBasedRoute({ children, allowedRoles }) {
  const token = localStorage.getItem('auth_token');
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}');
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!allowedRoles.includes(user?.role)) {
    return <Navigate to="/deals" replace />;
  }

  return children;
}

function PrivateRoute({ children }) {
  const token = localStorage.getItem('auth_token')
  const location = useLocation()
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}

function HomeRedirect() {
  const token = localStorage.getItem('auth_token')
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  if (!token) {
    return <Navigate to="/login" replace />
  }
  const role = user?.role
  // Role-based landing
  if (role === 'superadmin') return <Navigate to="/admin/users" replace />
  if (role === 'admin') return <Navigate to="/admin/users" replace />
  if (role === 'property_consultant') return <Navigate to="/calculator" replace />
  if (role === 'sales_manager') return <Navigate to="/deals/queues" replace />
  if (role === 'financial_manager') return <Navigate to="/admin/standard-pricing" replace />
  if (role === 'financial_admin') return <Navigate to="/admin/standard-pricing" replace />
  if (role === 'contract_manager') return <Navigate to="/admin/hold-approvals" replace />
  if (role === 'ceo' || role === 'chairman' || role === 'vice_chairman' || role === 'top_management') {
    return <Navigate to="/deals/queues" replace />
  }
  // default
  return <Navigate to="/deals" replace />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/calculator"
          element={
            <PrivateRoute>
              <App />
            </PrivateRoute>
          }
        />
        <Route
          path="/deals/*"
          element={
            <PrivateRoute>
              <DealsApp />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RoleBasedRoute allowedRoles={['admin', 'superadmin']}>
              <Users />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <RoleBasedRoute allowedRoles={['admin', 'superadmin']}>
              <UserEdit />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/standard-pricing"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager', 'ceo']}>
              <StandardPricing />
            </RoleBasedRoute>
          }
        />
         {/* --- THIS IS THE NEW ROUTE --- */}
        <Route
          path="/admin/standard-pricing-approvals"
          element={
            <RoleBasedRoute allowedRoles={['ceo', 'chairman', 'vice_chairman']}>
              <StandardPricingApprovals />
            </RoleBasedRoute>
          }
        />
        {/* --- END OF NEW ROUTE --- */}
         <Route
           path="/admin/standard-pricing-rejected"
           element={
             <RoleBasedRoute allowedRoles={['financial_manager']}>
               <RejectedPricings />
             </RoleBasedRoute>
           }
         />
         <Route
           path="/admin/payment-thresholds"
           element={
             <RoleBasedRoute allowedRoles={['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management']}>
               <PaymentThresholds />
             </RoleBasedRoute>
           }
         />
        {/* Alias paths to avoid mismatched links */}
        <Route
          path="/admin/standard-pricing/rejected"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager']}>
              <RejectedPricings />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/rejected-pricings"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager']}>
              <RejectedPricings />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/inventory"
          element={
            <RoleBasedRoute allowedRoles={['financial_admin', 'superadmin']}>
              <Units />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/inventory-drafts"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager']}>
              <InventoryDrafts />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/units"
          element={
            <RoleBasedRoute allowedRoles={['superadmin']}>
              <Units />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/sales"
          element={
            <RoleBasedRoute allowedRoles={['admin', 'superadmin']}>
              <SalesTeam />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/sales-team"
          element={
            <RoleBasedRoute allowedRoles={['sales_manager', 'admin', 'superadmin']}>
              <SalesManagerTeam />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/contracts-team"
          element={
            <RoleBasedRoute allowedRoles={['contract_manager', 'admin', 'superadmin']}>
              <ContractsTeam />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/finance-team"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager', 'admin', 'superadmin']}>
              <FinanceTeam />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/unit-models"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager']}>
              <UnitModels />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/unit-model-changes"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager', 'ceo', 'chairman', 'vice_chairman']}>
              <UnitModelChanges />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/commission-policies"
          element={
            <RoleBasedRoute allowedRoles={['superadmin']}>
              <CommissionPolicies />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/commissions"
          element={
            <RoleBasedRoute allowedRoles={['superadmin']}>
              <CommissionsReport />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/holds"
          element={
            <RoleBasedRoute allowedRoles={['financial_manager', 'sales_manager', 'contract_manager']}>
              <HoldsFM />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/hold-approvals"
          element={
            <RoleBasedRoute allowedRoles={['ceo', 'contract_manager', 'sales_manager']}>
              <HoldsCEO />
            </RoleBasedRoute>
          }
        />
        <Route
          path="/admin/workflow-logs"
          element={
            <RoleBasedRoute allowedRoles={['ceo', 'chairman', 'vice_chairman', 'superadmin', 'sales_manager', 'contract_manager']}>
              <WorkflowLogs />
            </RoleBasedRoute>
          }
        />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<Navigate to="/deals" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)