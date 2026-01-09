import { notifyError } from './notifications.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

async function refreshTokens() {
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) throw new Error('No refresh token')
  const resp = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  })
  if (!resp.ok) {
    let msg = 'Refresh failed'
    try {
      const j = await resp.json()
      msg = j?.error?.message || msg
    } catch {}
    throw new Error(msg)
  }
  const data = await resp.json()
  const access = data.accessToken
  const newRefresh = data.refreshToken
  if (access) localStorage.setItem('auth_token', access)
  if (newRefresh) localStorage.setItem('refresh_token', newRefresh)
  return access
}

export async function fetchWithAuth(input, init = {}, retry = true) {
  const token = localStorage.getItem('auth_token')
  const headers = { ...(init.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const resp = await fetch(input, { ...init, headers })
  if (resp.status === 401 && retry) {
    try {
      await refreshTokens()
      return fetchWithAuth(input, init, false)
    } catch (e) {
      // Refresh failed, force logout
      localStorage.removeItem('auth_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('auth_user')
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      // Suppress "No refresh token" error (harmless race condition on logout)
      if (e.message !== 'No refresh token') {
        notifyError(e, 'Session expired, please login again.')
      }
      throw e
    }
  }
  return resp
}

export async function apiJson(path, options = {}) {
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`
  const resp = await fetchWithAuth(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  let data = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }
  if (!resp.ok) {
    notifyError(data || { message: 'Request failed' })
    const msg = data?.error?.message || 'Request failed'
    throw new Error(msg)
  }
  return data
}

export { API_URL }