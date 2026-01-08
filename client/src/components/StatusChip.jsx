import React from 'react'
import { Tag } from 'antd'

/**
 * Reusable status chip for payment plan workflow statuses.
 * Colors/labels centralized for consistency.
 */
export default function StatusChip({ status }) {
  const map = {
    pending_sm: { color: 'orange', label: 'Waiting for Sales Manager' },
    pending_fm: { color: 'blue', label: 'With Finance' },
    pending_tm: { color: 'volcano', label: 'Executive Approval' },
    approved:   { color: 'success', label: 'Approved' },
    rejected:   { color: 'error', label: 'Rejected' }
  }
  const s = map[status] || { color: 'default', label: status }
  
  return (
    <Tag color={s.color} className="font-semibold rounded-full px-3">
      {s.label}
    </Tag>
  )
}
