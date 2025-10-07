import { useEffect, useState, useCallback } from 'react'

/**
 * Hook and helpers to interact with the embedded calculator's window bridge.
 * Provides safe wrappers that no-op if the bridge is not yet ready.
 */

export function getCalculatorSnapshot() {
  const fn = typeof window !== 'undefined' ? window.__uptown_calc_getSnapshot : null
  return typeof fn === 'function' ? fn() : null
}

export function applyCalculatorClientInfo(partial) {
  const fn = typeof window !== 'undefined' ? window.__uptown_calc_applyClientInfo : null
  if (typeof fn === 'function' && partial && typeof partial === 'object') {
    try { fn(partial) } catch {}
  }
}

export function applyCalculatorUnitInfo(partial) {
  const fn = typeof window !== 'undefined' ? window.__uptown_calc_applyUnitInfo : null
  if (typeof fn === 'function' && partial && typeof partial === 'object') {
    try { fn(partial) } catch {}
  }
}

export function applyCalculatorUnitPrefill(payload) {
  const fn = typeof window !== 'undefined' ? window.__uptown_calc_applyUnitPrefill : null
  if (typeof fn === 'function' && payload && typeof payload === 'object') {
    try { fn(payload) } catch {}
  }
}

/**
 * React hook returning readiness booleans and memoized safe functions.
 */
export function useCalculatorSnapshot() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const check = () => {
      const ok = typeof window !== 'undefined'
        && typeof window.__uptown_calc_getSnapshot === 'function'
      setReady(ok)
    }
    check()
    const t = setInterval(check, 500)
    return () => clearInterval(t)
  }, [])

  const getSnap = useCallback(() => getCalculatorSnapshot(), [])
  const applyClient = useCallback((p) => applyCalculatorClientInfo(p), [])
  const applyUnit = useCallback((p) => applyCalculatorUnitInfo(p), [])
  const applyPrefill = useCallback((p) => applyCalculatorUnitPrefill(p), [])

  return { ready, getSnap, applyClient, applyUnit, applyPrefill }
}