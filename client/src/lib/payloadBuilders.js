export function buildCalculationPayload({ mode, stdPlan, unitInfo, inputs, firstYearPayments, subsequentYears }) {
  const isStandardMode = mode === 'standardMode'

  const baseInputs = {
    salesDiscountPercent: Number(inputs?.salesDiscountPercent),
    dpType: inputs?.dpType,
    downPaymentValue: Number(inputs?.downPaymentValue),
    planDurationYears: Number(inputs?.planDurationYears),
    installmentFrequency: inputs?.installmentFrequency,
    additionalHandoverPayment: Number(inputs?.additionalHandoverPayment),
    handoverYear: Number(inputs?.handoverYear),
    splitFirstYearPayments: !!inputs?.splitFirstYearPayments,
    firstYearPayments: (firstYearPayments || []).map(p => ({
      amount: Number(p.amount) || 0,
      month: Number(p.month) || 0,
      type: p.type || 'regular'
    })),
    subsequentYears: (subsequentYears || []).map(y => ({
      totalNominal: Number(y.totalNominal) || 0,
      frequency: y.frequency || 'annually'
    }))
  }

  const standardInputs = isStandardMode
    ? {
        ...baseInputs,
        dpType: 'percentage',
        downPaymentValue: 20,
        planDurationYears: 6,
        installmentFrequency: 'quarterly',
        handoverYear: 3,
        additionalHandoverPayment: 0,
        splitFirstYearPayments: false,
        firstYearPayments: [],
        subsequentYears: []
      }
    : baseInputs

  return {
    mode,
    unitId: Number(unitInfo?.unit_id) || undefined,
    stdPlan: {
      totalPrice: Number(stdPlan?.totalPrice),
      financialDiscountRate: Number(stdPlan?.financialDiscountRate),
      calculatedPV: Number(stdPlan?.calculatedPV)
    },
    inputs: standardInputs
  }
}