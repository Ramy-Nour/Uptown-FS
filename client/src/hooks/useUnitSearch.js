import { useEffect, useState } from 'react'
import { fetchWithAuth } from '../lib/apiClient.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export function useUnitSearch() {
  const [unitsCatalog, setUnitsCatalog] = useState([])
  const [unitQuery, setUnitQuery] = useState('')
  const [unitSearchLoading, setUnitSearchLoading] = useState(false)
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false)

  useEffect(() => {
    let t = null
    const run = async () => {
      const q = unitQuery.trim()
      if (!q) {
        setUnitsCatalog([])
        setUnitDropdownOpen(false)
        return
      }
      try {
        setUnitSearchLoading(true)
        const resp = await fetchWithAuth(`${API_URL}/api/units?search=${encodeURIComponent(q)}&page=1&pageSize=20`)
        const data = await resp.json()
        if (resp.ok) {
          setUnitsCatalog(data.units || [])
          setUnitDropdownOpen(true)
        }
      } catch {
        // ignore errors
      } finally {
        setUnitSearchLoading(false)
      }
    }
    t = setTimeout(run, 300)
    return () => t && clearTimeout(t)
  }, [unitQuery])

  return {
    unitsCatalog,
    unitQuery,
    unitSearchLoading,
    unitDropdownOpen,
    setUnitQuery,
    setUnitDropdownOpen,
  }
}