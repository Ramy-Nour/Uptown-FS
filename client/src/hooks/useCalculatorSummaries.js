import { useMemo } from 'react'

export function useCalculatorSummaries(preview) {
  return useMemo(() => {
    if (!preview) return null
    const {
      totalNominalPrice,
      numEqualInstallments,
      equalInstallmentAmount,
      calculatedPV,
      meta
    } = preview
    return {
      totalNominalPrice,
      numEqualInstallments,
      equalInstallmentAmount,
      calculatedPV,
      effectiveStartYears: meta?.effectiveStartYears
    }
  }, [preview])
}