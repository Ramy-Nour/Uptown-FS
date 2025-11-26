export function validateCalculatorInputs(payload, inputs, firstYearPayments, subsequentYears) {
  const e = {}

  const inp = payload?.inputs || {}

  if (!isFiniteNumber(payload?.stdPlan?.totalPrice) || Number(payload.stdPlan.totalPrice) < 0) e.std_totalPrice = 'Must be non-negative number'
  if (!isFiniteNumber(payload?.stdPlan?.financialDiscountRate)) e.std_financialDiscountRate = 'Must be a number'
  if (!isFiniteNumber(payload?.stdPlan?.calculatedPV) || Number(payload.stdPlan.calculatedPV) < 0) e.std_calculatedPV = 'Must be non-negative number'

  if (!['monthly', 'quarterly', 'bi-annually', 'annually'].includes(inp.installmentFrequency)) {
    e.installmentFrequency = 'Invalid'
  }
  if (!Number.isInteger(inp.planDurationYears) || inp.planDurationYears <= 0) {
    e.planDurationYears = 'Must be integer >= 1'
  }
  if (inp.dpType && !['amount', 'percentage'].includes(inp.dpType)) e.dpType = 'Invalid'
  if (!isFiniteNumber(inp.downPaymentValue) || inp.downPaymentValue < 0) {
    e.downPaymentValue = 'Must be non-negative number'
  } else {
    if (inp.dpType === 'percentage' && inp.downPaymentValue > 100) {
      e.downPaymentValue = 'Cannot exceed 100%'
    }
    if (inp.dpType === 'amount' && isFiniteNumber(payload?.stdPlan?.totalPrice)) {
      const total = Number(payload.stdPlan.totalPrice)
      if (total > 0 && inp.downPaymentValue > total) {
        e.downPaymentValue = 'Cannot exceed 100% of total price'
      }
    }
  }
  if (!Number.isInteger(inp.handoverYear) || inp.handoverYear <= 0) e.handoverYear = 'Must be integer >= 1'
  if (!isFiniteNumber(inp.additionalHandoverPayment) || inp.additionalHandoverPayment < 0) e.additionalHandoverPayment = 'Must be non-negative number'

  if (inp.splitFirstYearPayments) {
    (firstYearPayments || []).forEach((p, idx) => {
      const keyAmt = `fyp_amount_${idx}`
      const keyMonth = `fyp_month_${idx}`
      if (!isFiniteNumber(p?.amount) || Number(p.amount) < 0) e[keyAmt] = '>= 0'
      const m = Number(p?.month)
      if (!Number.isInteger(m) || m < 1 || m > 12) e[keyMonth] = '1..12'
    })
  }

  (subsequentYears || []).forEach((y, idx) => {
    const keyTot = `sub_total_${idx}`
    const keyFreq = `sub_freq_${idx}`
    if (!isFiniteNumber(y?.totalNominal) || Number(y.totalNominal) < 0) e[keyTot] = '>= 0'
    if (!['monthly', 'quarterly', 'bi-annually', 'annually'].includes(y?.frequency)) e[keyFreq] = 'Invalid'
  })

  return e
}

function isFiniteNumber(v) {
  const n = Number(v)
  return Number.isFinite(n)
}