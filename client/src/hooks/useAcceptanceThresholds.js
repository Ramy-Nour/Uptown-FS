import { useEffect, useState } from 'react'
import { fetchWithAuth } from '../lib/apiClient.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export function useAcceptanceThresholds() {
  const [thresholdsCfg, setThresholdsCfg] = useState({})

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const resp = await fetchWithAuth(`${API_URL}/api/config/acceptance-thresholds`)
        const data = await resp.json()
        if (mounted && resp.ok) {
          setThresholdsCfg(data.thresholds || {})
        }
      } catch {
        // ignore
      }
    })()
    return () => { mounted = false }
  }, [])

  return thresholdsCfg
}