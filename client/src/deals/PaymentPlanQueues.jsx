import React, { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import { fetchWithAuth } from '../lib/apiClient.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export default function QueuesPage() {
  const [role, setRole] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('auth_user')
      if (raw) {
        const user = JSON.parse(raw)
        setRole(user?.role || null)
      } else {
        setRole(null)
      }
    } catch {
      setRole(null)
    }
  }, [])

  const fetchData = async (currentRole) => {
    setLoading(true)
    setError('')
    try {
      if (!currentRole) {
        setItems([])
        return
      }

      // Sales Manager: show Payment Plan approval queue, not Unit Model queue
      if (currentRole === 'sales_manager') {
        const response = await fetchWithAuth(`${API_URL}/api/workflow/payment-plans/queue/sm`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to fetch payment plans')
        }
        setItems(Array.isArray(data.payment_plans) ? data.payment_plans : [])
        return
      }

      // Top Management / Financial Manager: show Unit Model approval queue
      if (['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management'].includes(currentRole)) {
        const response = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to fetch unit model approvals')
        }
        setItems(Array.isArray(data.changes) ? data.changes : [])
        return
      }

      // Everyone else: no access
      setItems([])
      setError('You do not have access to this queue.')
    } catch (err) {
      setItems([])
      setError(err.message || 'Failed to load queue.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (role === null) return
    fetchData(role)
  }, [role])

  const handleApproveUnitModel = async (id) => {
    if (!window.confirm('Are you sure you want to approve this change?')) return
    try {
      const response = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes/${id}/approve`, { method: 'PATCH' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error?.message || 'Approval failed')
      }
      toast.success('Change approved successfully!')
      fetchData(role)
    } catch (err) {
      toast.error(err.message || 'Failed to approve change.')
      console.error(err)
    }
  }

  const handleRejectUnitModel = async (id) => {
    const reason = prompt('Please provide a reason for rejection:')
    if (!reason) return
    try {
      const response = await fetchWithAuth(`${API_URL}/api/inventory/unit-models/changes/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error?.message || 'Rejection failed')
      }
      toast.warn('Change rejected.')
      fetchData(role)
    } catch (err) {
      toast.error(err.message || 'Failed to reject change.')
      console.error(err)
    }
  }

  const renderPayload = (payload) => {
    const entries = Object.entries(payload || {})
    if (entries.length === 0) return <span className="text-gray-500">No details</span>
    return (
      <div className="overflow-x-auto">
        <table className="min-w-[400px] border border-gray-200 rounded text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1 text-left text-gray-600 font-medium">Field</th>
              <th className="px-2 py-1 text-left text-gray-600 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-t">
                <td className="px-2 py-1 font-semibold whitespace-nowrap">{key}</td>
                <td className="px-2 py-1">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const isSalesManager = role === 'sales_manager'
  const isUnitModelApprover = ['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role || '')

  const title = isSalesManager
    ? 'Payment Plan Approval Queue'
    : isUnitModelApprover
    ? 'Unit Model Approval Queue'
    : 'Queues'

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>
      {loading && <p>Loading...</p>}
      {error && !loading && <p className="text-red-500">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p>No items are currently waiting for approval.</p>
      )}

      {/* Sales Manager view: payment plan queue summary only (no inline approve/reject for now) */}
      {!loading && !error && isSalesManager && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200 shadow-sm rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deal ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-4 whitespace-nowrap">{p.id}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{p.deal_id || '-'}</td>
                  <td className="px-4 py-4 whitespace-nowrap capitalize">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Unit Model approver view (FM/TM) */}
      {!loading && !error && isUnitModelApprover && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200 shadow-sm rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-4 whitespace-nowrap capitalize font-semibold">{item.action}</td>
                  <td className="px-4 py-4">{renderPayload(item.payload)}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{item.requested_by_email}</td>
                  <td className="px-4 py-4 whitespace-nowrap space-x-2">
                    <button
                      onClick={() => handleApproveUnitModel(item.id)}
                      className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-3 rounded text-sm"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectUnitModel(item.id)}
                      className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-3 rounded text-sm"
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}