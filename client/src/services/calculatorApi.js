import { fetchWithAuth } from '../lib/apiClient.js'

const API_DEFAULT = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export async function fetchLatestStandardPlan(API_URL = API_DEFAULT) {
  const resp = await fetchWithAuth(`${API_URL}/api/standard-plan/latest`)
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error?.message || 'Failed to load standard plan')
  return data?.standardPlan || null
}

export async function calculateForUnit({ mode, unitId, inputs }, API_URL = API_DEFAULT) {
  const resp = await fetchWithAuth(`${API_URL}/api/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, unitId: Number(unitId), inputs })
  })
  const data = await resp.json().catch(() => null)
  if (!resp.ok) throw new Error(data?.error?.message || 'Calculation request failed')
  return data
}

export async function generatePlan(payload, API_URL = API_DEFAULT) {
  const resp = await fetchWithAuth(`${API_URL}/api/generate-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error?.message || 'Plan generation failed')
  return data
}