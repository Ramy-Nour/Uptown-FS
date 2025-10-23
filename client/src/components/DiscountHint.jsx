import React from 'react'

export default function DiscountHint({ role, value }) {
  const v = Number(value) || 0
  const noteStyle = { color: '#6b7280', fontSize: 12, marginTop: 4 }
  if (!role) return null
  if (role === 'property_consultant') {
    if (v <= 2) return <div style={noteStyle}>Within sales consultant authority. Sales manager review required.</div>
    return <div style={{ ...noteStyle, color: '#b45309' }}>Exceeds 2%. Not permitted for sales consultant.</div>
  }
  if (role === 'sales_manager') {
    if (v <= 2) return <div style={noteStyle}>Within sales consultant/sales manager authority.</div>
    return <div style={{ ...noteStyle, color: '#b45309' }}>Over 2% requires escalation to Financial Manager and CEO.</div>
  }
  if (role === 'financial_manager') {
    if (v <= 2) return <div style={noteStyle}>Within 2% band.</div>
    if (v > 2 && v <= 5) return <div style={{ ...noteStyle, color: '#b45309' }}>Selected discount requires CEO approval.</div>
    return <div style={{ ...noteStyle, color: '#e11d48' }}>Exceeds 5%. Not permitted.</div>
  }
  return null
}