import { useMemo } from 'react'

export function useComparison({ stdPlan, preview, inputs, firstYearPayments, subsequentYears, genResult, thresholdsCfg }) {
  return useMemo(() => {
    const stdPV = Number(stdPlan?.calculatedPV ?? 0)
    const stdRate = Number(stdPlan?.financialDiscountRate ?? 0)
    const offerPV = Number((preview && preview.calculatedPV) ?? 0)
    const discountPercent = Number(inputs?.salesDiscountPercent ?? 0)
    const deltaPV = offerPV - stdPV
    const deltaPercentPV = stdPV ? (deltaPV / stdPV) * 100 : 0

    const totalsNominal = Number(
      (preview && preview.totalNominalPrice) ??
      (genResult && genResult.totals && genResult.totals.totalNominal) ??
      0
    )

    let firstYearNominal = 0
    if (inputs?.splitFirstYearPayments) {
      for (const p of (firstYearPayments || [])) {
        firstYearNominal += Number(p?.amount) || 0
      }
    } else {
      const offerTotal = Number(
        (preview && preview.totalNominalPrice) ??
        (genResult && genResult.totals && genResult.totals.totalNominal) ??
        0
      ) || 0
      const dpBase = offerTotal > 0 ? offerTotal : (Number(stdPlan?.totalPrice) || 0)
      const actualDP = inputs?.dpType === 'percentage'
        ? dpBase * ((Number(inputs?.downPaymentValue) || 0) / 100)
        : (Number(inputs?.downPaymentValue) || 0)
      firstYearNominal = actualDP
    }

    let secondYearNominal = 0
    if (Array.isArray(subsequentYears) && subsequentYears.length > 0) {
      secondYearNominal = Number(subsequentYears[0]?.totalNominal) || 0
    }

    const handoverNominal = Number(inputs?.additionalHandoverPayment) || 0

    const pct = (part, total) => {
      const t = Number(total) || 0
      const p = Number(part) || 0
      if (!t || t <= 0) return 0
      return (p / t) * 100
    }

    const firstYearPercent = pct(firstYearNominal, totalsNominal)
    const secondYearPercent = pct(secondYearNominal, totalsNominal)
    const handoverPercent = pct(handoverNominal, totalsNominal)

    const thresholds = thresholdsCfg || {}
    const check = (value, min, max) => {
      if (min == null && max == null) return null
      if (min != null && Number(value) < Number(min)) return false
      if (max != null && Number(value) > Number(max)) return false
      return true
    }

    const pvPass = Number(offerPV || 0) >= Number(stdPV || 0)
    const fyPass = check(firstYearPercent, thresholds.firstYearPercentMin, thresholds.firstYearPercentMax)
    const syPass = check(secondYearPercent, thresholds.secondYearPercentMin, thresholds.secondYearPercentMax)
    const hoPass = check(handoverPercent, thresholds.handoverPercentMin, thresholds.handoverPercentMax)

    const overallAcceptable =
      pvPass &&
      (fyPass !== false) &&
      (syPass !== false) &&
      (hoPass !== false)

    return {
      stdPV,
      stdRate,
      offerPV,
      discountPercent,
      deltaPV,
      deltaPercentPV,
      totalsNominal,
      firstYearNominal,
      secondYearNominal,
      handoverNominal,
      firstYearPercent,
      secondYearPercent,
      handoverPercent,
      thresholds,
      firstYearPass: fyPass,
      secondYearPass: syPass,
      handoverPass: hoPass,
      pvPass,
      overallAcceptable
    }
  }, [stdPlan, preview, inputs, firstYearPayments, subsequentYears, genResult, thresholdsCfg])
}