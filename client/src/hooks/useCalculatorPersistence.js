import { useEffect } from 'react'

export function loadSavedCalculatorState(LS_KEY = 'uptown_calc_form_state_v2') {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    return saved || null
  } catch {
    return null
  }
}

export function usePersistCalculatorState(LS_KEY, snapshot) {
  useEffect(() => {
    try {
      if (snapshot && typeof snapshot === 'object') {
        localStorage.setItem(LS_KEY, JSON.stringify(snapshot))
      }
    } catch {}
  }, [LS_KEY, snapshot])
}