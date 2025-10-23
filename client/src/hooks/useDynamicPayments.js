import { useCallback } from 'react'

export function useDynamicPayments(setFirstYearPayments, setSubsequentYears) {
  const addFirstYearPayment = useCallback(() => {
    setFirstYearPayments(s => [...s, { amount: 0, month: 1, type: 'regular' }])
  }, [setFirstYearPayments])

  const updateFirstYearPayment = useCallback((index, field, value) => {
    setFirstYearPayments(s => {
      const copy = [...s]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }, [setFirstYearPayments])

  const removeFirstYearPayment = useCallback((index) => {
    setFirstYearPayments(s => s.filter((_, i) => i !== index))
  }, [setFirstYearPayments])

  const addSubsequentYear = useCallback(() => {
    setSubsequentYears(s => [...s, { totalNominal: 0, frequency: 'annually' }])
  }, [setSubsequentYears])

  const updateSubsequentYear = useCallback((index, field, value) => {
    setSubsequentYears(s => {
      const copy = [...s]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }, [setSubsequentYears])

  const removeSubsequentYear = useCallback((index) => {
    setSubsequentYears(s => s.filter((_, i) => i !== index))
  }, [setSubsequentYears])

  return {
    addFirstYearPayment,
    updateFirstYearPayment,
    removeFirstYearPayment,
    addSubsequentYear,
    updateSubsequentYear,
    removeSubsequentYear
  }
}