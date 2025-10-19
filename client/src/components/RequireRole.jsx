import React from 'react'
import { Navigate } from 'react-router-dom'

/**
 * RequireRole
 * - allowed: array of roles permitted to view the route
 * - redirectTo: path to redirect unauthorized users (default: '/deals')
 * - fallback: optional element to render instead of redirect
 */
export default function RequireRole({ allowed = [], redirectTo = '/deals', fallback = null, children }) {
  let role = null
  try {
    const raw = localStorage.getItem('auth_user')
    if (raw) role = JSON.parse(raw)?.role || null
  } catch {
    role = null
  }
  if (allowed.length > 0 && !allowed.includes(role)) {
    return fallback ? fallback : <Navigate to={redirectTo} replace />
  }
  return children
}