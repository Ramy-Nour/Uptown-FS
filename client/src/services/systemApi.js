import { fetchWithAuth } from '../lib/apiClient.js'

const API_DEFAULT = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export async function fetchHealth(API_URL = API_DEFAULT) {
  const resp = await fetchWithAuth(`${API_URL}/api/health`)
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load health')
  return data
}

export async function fetchMessage(API_URL = API_DEFAULT) {
  const resp = await fetchWithAuth(`${API_URL}/api/message`)
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load message')
  return data
}