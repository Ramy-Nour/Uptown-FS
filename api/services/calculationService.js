// Pure calculation utilities for Uptown October Sales Proposal Tool (Node.js backend)

// Frequency options supported by the tool
export const Frequencies = Object.freeze({
  Monthly: 'monthly',
  Quarterly: 'quarterly',
  BiAnnually: 'bi-annually',
  Annually: 'annually'
});

// Calculation modes as used by the frontend
export const CalculationModes = Object.freeze({
  EvaluateCustomPrice: 'evaluateCustomPrice',
  CalculateForTargetPV: 'calculateForTargetPV',
  CustomYearlyThenEqual_TargetPV: 'customYearlyThenEqual_targetPV',
  CustomYearlyThenEqual_UseStdPrice: 'customYearlyThenEqual_useStdPrice',
  StandardMode: 'standardMode'
});

/**
 * Convert an annual rate percent (e.g., 12 -> 12% per annum) to monthly rate.
 * Special cases:
 *  - null/undefined/NaN -> 0
 *  - <= 0 -> 0
 */
export function monthlyRateFromAnnual(annualRatePercent) {
  const r = Number(annualRatePercent);
  if (!isFinite(r) || r <= 0) return 0;
  return Math.pow(1 + r / 100, 1 / 12) - 1;
}

/**
 * Get installment month offsets given a count and frequency.
 * Month offsets start at 1-based months from contract date.
 * startAfterYear adds a 12-month offset per year before scheduling begins.
 */
export function getPaymentMonths(numberOfInstallments, frequency, startAfterYear = 0) {
  const n = Number(numberOfInstallments) || 0;
  if (n <= 0) return [];

  let periodInMonths = 0;
  let firstInstallmentOffset = 1;
  switch (frequency) {
    case Frequencies.Monthly:
      periodInMonths = 1; firstInstallmentOffset = 1; break;
    case Frequencies.Quarterly:
      periodInMonths = 3; firstInstallmentOffset = 3; break;
    case Frequencies.BiAnnually:
      periodInMonths = 6; firstInstallmentOffset = 6; break; // keep parity with FE
    case Frequencies.Annually:
      periodInMonths = 12; firstInstallmentOffset = 12; break; // keep parity with FE
    default:
      throw new Error(`Invalid frequency: ${frequency}`);
  }

  const baseOffset = (Number(startAfterYear) || 0) * 12;
  const months = [];
  months.push(baseOffset + firstInstallmentOffset);
  for (let i = 1; i < n; i++) months.push(months[i - 1] + periodInMonths);
  return months;
}

/**
 * Present Value of a cashflow schedule.
 * - downPayment (at month 0) is included unless using structured first year payments (handled by caller by passing 0 here).
 * - equalInstallmentAmount across equalInstallmentMonths
 * - customYearlyDetails: [{ yearNumber: 1-based from contract year, totalNominal, frequency }]
 * - firstYearPayments: [{ amount, month, type: 'dp'|'regular' }]
 */
export function calculatePV({
  downPayment = 0,
  equalInstallmentAmount = 0,
  equalInstallmentMonths = [],
  monthlyRate = 0,
  additionalHandoverPayment = 0,
  handoverYear = 0,
  customYearlyDetails = [],
  firstYearPayments = []
}) {
  const r = Number(monthlyRate) || 0;
  let pv = 0;

  // DP at t=0
  if (downPayment > 0) pv += downPayment;

  // Detailed Y1 payments
  if (Array.isArray(firstYearPayments) && firstYearPayments.length > 0) {
    for (const p of firstYearPayments) {
      const amt = Number(p?.amount) || 0;
      const m = Number(p?.month) || 0;
      if (amt > 0 && m > 0) {
        pv += amt / Math.pow(1 + r, m);
      }
    }
  }

  // Custom subsequent years
  if (Array.isArray(customYearlyDetails) && customYearlyDetails.length > 0) {
    for (const y of customYearlyDetails) {
      const total = Number(y?.totalNominal) || 0;
      if (total <= 0) continue;

      let installmentsInYear = 0;
      switch (y?.frequency) {
        case Frequencies.Monthly: installmentsInYear = 12; break;
        case Frequencies.Quarterly: installmentsInYear = 4; break;
        case Frequencies.BiAnnually: installmentsInYear = 2; break;
        case Frequencies.Annually: installmentsInYear = 1; break;
        default: installmentsInYear = 0;
      }
      if (installmentsInYear === 0) continue;

      const perInst = total / installmentsInYear;
      const months = getPaymentMonths(installmentsInYear, y.frequency, (Number(y?.yearNumber) || 1) - 1);
      for (const m of months) pv += perInst / Math.pow(1 + r, m);
    }
  }

  // Equal installments
  if (equalInstallmentAmount > 0 && Array.isArray(equalInstallmentMonths) && equalInstallmentMonths.length > 0) {
    for (const m of equalInstallmentMonths) {
      if (m > 0) pv += equalInstallmentAmount / Math.pow(1 + r, m);
    }
  }

  // Additional handover
  const hy = Number(handoverYear) || 0;
  const add = Number(additionalHandoverPayment) || 0;
  if (add > 0 && hy > 0) {
    pv += add / Math.pow(1 + r, hy * 12);
  }

  return pv;
}

/**
 * PVAF for an installment stream
 */
export function calculatePVAF(numberOfInstallments, frequency, monthlyRate, startAfterYear = 0) {
  const months = getPaymentMonths(numberOfInstallments, frequency, startAfterYear);
  let pvaf = 0;
  const r = Number(monthlyRate) || 0;
  for (const m of months) if (m > 0) pvaf += 1 / Math.pow(1 + r, m);
  return pvaf;
}

/**
 * Compute base values common across modes
 */
function computeEqualInstallmentsMeta({
  planDurationYears,
  installmentFrequency,
  splitFirstYearPayments,
  numCustomSubsequentYears
}) {
  const effectiveStartYears = (splitFirstYearPayments ? 1 : 0) + (Number(numCustomSubsequentYears) || 0);
  const equalYears = (Number(planDurationYears) || 0) - effectiveStartYears;

  let numEqualInstallments = 0;
  if (equalYears >= 0) {
    switch (installmentFrequency) {
      case Frequencies.Monthly: numEqualInstallments = equalYears * 12; break;
      case Frequencies.Quarterly: numEqualInstallments = equalYears * 4; break;
      case Frequencies.BiAnnually: numEqualInstallments = equalYears * 2; break;
      case Frequencies.Annually: numEqualInstallments = equalYears * 1; break;
      default: numEqualInstallments = 0;
    }
  }
  return { effectiveStartYears, numEqualInstallments };
}

/**
 * Evaluate Synced Price (with sales discount) mode.
 * Inputs:
 *  - stdPlan: { totalPrice, financialDiscountRate, calculatedPV }
 *  - inputs:
 *      { salesDiscountPercent, dpType, downPaymentValue, planDurationYears,
 *        installmentFrequency, additionalHandoverPayment, handoverYear,
 *        splitFirstYearPayments, firstYearPayments[], subsequentYears[] }
 */
export function evaluateCustomPrice(stdPlan, inputs) {
  const stdPrice = Number(stdPlan?.totalPrice) || 0;
  const salesDiscountPct = Number(inputs?.salesDiscountPercent) || 0;
  const netTotalPrice = stdPrice * (1 - salesDiscountPct / 100);

  return commonDistributeForNominalTotal(netTotalPrice, stdPlan, inputs);
}

/**
 * Standard Mode:
 * - Uses Standard Price as baseline.
 * - Allows sales discount (up to policy limits), applied to the Standard Price.
 * - Enforces a fixed structure:
 *    - Down Payment: 20% (of the discounted nominal price).
 *    - Plan Duration: 6 years.
 *    - Frequency: quarterly.
 *    - First 3 years: each year takes 15% of the (discounted) total as custom yearly blocks,
 *      scheduled quarterly (3.75% per quarter).
 *    - Remaining 35% is distributed as equal installments over the next 3 years (12 quarters),
 *      ~2.917% per quarter.
 *    - Handover year forced to 3; no additional handover lump sum.
 *    - Maintenance/garage handling is done at the plan-generation layer.
 */
export function standardMode(stdPlan, inputs) {
  const stdPrice = Number(stdPlan?.totalPrice) || 0;
  const salesDiscountPct = Number(inputs?.salesDiscountPercent) || 0;
  const netTotalPrice = stdPrice * (1 - salesDiscountPct / 100);

  // Enforce the Standard Mode structure regardless of incoming inputs
  const forcedInputs = {
    ...inputs,
    dpType: 'percentage',
    downPaymentValue: 20,
    planDurationYears: 6,
    installmentFrequency: Frequencies.Quarterly,
    additionalHandoverPayment: 0,
    handoverYear: 3,
    splitFirstYearPayments: false,
    firstYearPayments: [],
    subsequentYears: [
      { totalNominal: netTotalPrice * 0.15, frequency: Frequencies.Quarterly },
      { totalNominal: netTotalPrice * 0.15, frequency: Frequencies.Quarterly },
      { totalNominal: netTotalPrice * 0.15, frequency: Frequencies.Quarterly }
    ]
  };

  return commonDistributeForNominalTotal(netTotalPrice, stdPlan, forcedInputs);
}

/**
 * Calculate price for Target PV (standard structure or with current structure but objective is PV match).
 * Uses the current structure described in inputs (DP/custom/handover/frequency/duration) to
 * solve for equal installment amount to match the benchmark PV, then derives nominal total.
 *
 * Returns: { totalNominalPrice, equalInstallmentAmount, numEqualInstallments, ...details }
 */
export function calculateForTargetPV(stdPlan, inputs) {
  const targetPV = Number(stdPlan?.calculatedPV) || 0;
  return commonTargetPVObject(stdPlan, inputs, targetPV);
}

/**
 * Custom structure, objective: use Standard Nominal Price.
 * Returns: same shape as evaluateCustomPrice/commonDistribute...
 */
export function customYearlyThenEqualUseStdPrice(stdPlan, inputs) {
  const stdPrice = Number(stdPlan?.totalPrice) || 0;
  return commonDistributeForNominalTotal(stdPrice, stdPlan, inputs);
}

/**
 * Custom structure, objective: match Standard PV.
 * Returns: same shape as calculateForTargetPV/commonTarget...
 */
export function customYearlyThenEqualTargetPV(stdPlan, inputs) {
  const targetPV = Number(stdPlan?.calculatedPV) || 0;
  return commonTargetPVObject(stdPlan, inputs, targetPV);
}

/**
 * Shared path when we know the total nominal price up-front (evaluate price, useStdPrice)
 */
function commonDistributeForNominalTotal(totalNominalPrice, stdPlan, inputs) {
  const {
    dpType = 'amount',
    downPaymentValue = 0,
    planDurationYears,
    installmentFrequency,
    additionalHandoverPayment = 0,
    handoverYear = 0,
    splitFirstYearPayments = false,
    firstYearPayments = [],
    subsequentYears = []
  } = inputs || {};

  // Down payment actual amount
  let baseForPercentage = Number(totalNominalPrice) || 0;
  const actualDP = dpType === 'percentage'
    ? baseForPercentage * ((Number(downPaymentValue) || 0) / 100)
    : (Number(downPaymentValue) || 0);

  // Sum of nominal for custom parts
  let sumFirstYearNominal = 0;
  if (splitFirstYearPayments) {
    for (const p of (firstYearPayments || [])) sumFirstYearNominal += Number(p?.amount) || 0;
  }
  let sumSubsequentNominal = 0;
  for (const y of (subsequentYears || [])) sumSubsequentNominal += Number(y?.totalNominal) || 0;

  let preEqualNominal = sumSubsequentNominal + (Number(additionalHandoverPayment) || 0);
  if (splitFirstYearPayments) {
    preEqualNominal += sumFirstYearNominal;
  } else {
    preEqualNominal += sumFirstYearNominal + actualDP;
  }

  const { effectiveStartYears, numEqualInstallments } = computeEqualInstallmentsMeta({
    planDurationYears, installmentFrequency, splitFirstYearPayments,
    numCustomSubsequentYears: (subsequentYears || []).length
  });

  let equalInstallmentAmount = 0;
  const remainder = (Number(totalNominalPrice) || 0) - preEqualNominal;
  if (numEqualInstallments > 0 && remainder >= -1e-9) {
    equalInstallmentAmount = remainder / numEqualInstallments;
    if (equalInstallmentAmount < 0) equalInstallmentAmount = 0;
  } else if (Math.abs(remainder) < 1e-9) {
    equalInstallmentAmount = 0;
  } else if (remainder < -1e-9) {
    // Over-defined upfront
    equalInstallmentAmount = 0;
  }

  const monthlyRate = monthlyRateFromAnnual(stdPlan?.financialDiscountRate);
  const equalMonths = getPaymentMonths(numEqualInstallments, installmentFrequency, effectiveStartYears);

  // For PV: if first-year is split, DP at t=0 is not included (already split among first year payments)
  const dpForPV = splitFirstYearPayments ? 0 : actualDP;

  const pv = calculatePV({
    downPayment: dpForPV,
    equalInstallmentAmount,
    equalInstallmentMonths: equalMonths,
    monthlyRate,
    additionalHandoverPayment,
    handoverYear,
    customYearlyDetails: normalizeSubsequentYears(subsequentYears, splitFirstYearPayments, installmentFrequency),
    firstYearPayments: splitFirstYearPayments ? firstYearPayments : []
  });

  return {
    totalNominalPrice: Number(totalNominalPrice) || 0,
    downPaymentAmount: actualDP,
    numEqualInstallments,
    equalInstallmentAmount,
    equalInstallmentMonths: equalMonths,
    monthlyRate,
    calculatedPV: pv,
    meta: {
      effectiveStartYears,
      splitFirstYearPayments: !!splitFirstYearPayments
    }
  };
}

/**
 * Shared path when we need to hit a target PV (solve equal installment amount first, then derive total nominal)
 */
function commonTargetPVObject(stdPlan, inputs, targetPV) {
  const {
    dpType = 'amount',
    downPaymentValue = 0,
    planDurationYears,
    installmentFrequency,
    additionalHandoverPayment = 0,
    handoverYear = 0,
    splitFirstYearPayments = false,
    firstYearPayments = [],
    subsequentYears = []
  } = inputs || {};

  // Down payment amount (if not split Y1)
  // In target-PV modes, treat downPaymentValue strictly as an absolute amount to avoid circular dependencies.
  // Using percentage here creates a loop because the final nominal price is solved after matching PV.
  const actualDP = (Number(downPaymentValue) || 0);

  // PV of defined parts
  const monthlyRate = monthlyRateFromAnnual(stdPlan?.financialDiscountRate);

  let pvFirstYear = 0;
  let sumFirstYearNominal = 0;
  if (splitFirstYearPayments) {
    for (const p of (firstYearPayments || [])) {
      const amt = Number(p?.amount) || 0;
      const m = Number(p?.month) || 0;
      sumFirstYearNominal += amt;
      if (amt > 0 && m > 0) pvFirstYear += amt / Math.pow(1 + monthlyRate, m);
    }
  }

  let pvSubsequent = 0;
  let sumSubsequentNominal = 0;
  const normalizedYears = normalizeSubsequentYears(subsequentYears, splitFirstYearPayments, installmentFrequency);
  for (const y of normalizedYears) {
    const total = Number(y.totalNominal) || 0;
    sumSubsequentNominal += total;

    let n = 0;
    switch (y.frequency) {
      case Frequencies.Monthly: n = 12; break;
      case Frequencies.Quarterly: n = 4; break;
      case Frequencies.BiAnnually: n = 2; break;
      case Frequencies.Annually: n = 1; break;
      default: n = 0;
    }
    if (n > 0 && total > 0) {
      const perInst = total / n;
      const months = getPaymentMonths(n, y.frequency, y.yearNumber - 1);
      for (const m of months) pvSubsequent += perInst / Math.pow(1 + monthlyRate, m);
    }
  }

  let pvHandover = 0;
  if ((Number(additionalHandoverPayment) || 0) > 0 && (Number(handoverYear) || 0) > 0) {
    pvHandover = Number(additionalHandoverPayment) / Math.pow(1 + monthlyRate, Number(handoverYear) * 12);
  }

  const dpForPV = splitFirstYearPayments ? 0 : actualDP;
  const pvDefined = dpForPV + pvFirstYear + pvSubsequent + pvHandover;

  const { effectiveStartYears, numEqualInstallments } = computeEqualInstallmentsMeta({
    planDurationYears, installmentFrequency, splitFirstYearPayments,
    numCustomSubsequentYears: (subsequentYears || []).length
  });

  let equalInstallmentAmount = 0;
  let totalNominalPrice = 0;

  const pvToHit = (Number(targetPV) || 0) - pvDefined;

  if (pvToHit < -1e-9) {
    // Upfront PV already exceeds target -> no equal installments
    equalInstallmentAmount = 0;
    totalNominalPrice = (splitFirstYearPayments ? sumFirstYearNominal : (sumFirstYearNominal + actualDP))
                      + sumSubsequentNominal
                      + (Number(additionalHandoverPayment) || 0);
  } else if (Math.abs(pvToHit) <= 1e-9) {
    equalInstallmentAmount = 0;
    totalNominalPrice = (splitFirstYearPayments ? sumFirstYearNominal : (sumFirstYearNominal + actualDP))
                      + sumSubsequentNominal
                      + (Number(additionalHandoverPayment) || 0);
  } else if (numEqualInstallments > 0) {
    const pvaf = calculatePVAF(numEqualInstallments, installmentFrequency, monthlyRate, effectiveStartYears);
    if (pvaf <= 1e-9) {
      equalInstallmentAmount = 0; // cannot compute
      totalNominalPrice = (splitFirstYearPayments ? sumFirstYearNominal : (sumFirstYearNominal + actualDP))
                        + sumSubsequentNominal
                        + (Number(additionalHandoverPayment) || 0);
    } else {
      equalInstallmentAmount = pvToHit / pvaf;
      totalNominalPrice = (splitFirstYearPayments ? sumFirstYearNominal : (sumFirstYearNominal + actualDP))
                        + sumSubsequentNominal
                        + (Number(additionalHandoverPayment) || 0)
                        + (equalInstallmentAmount * numEqualInstallments);
    }
  } else {
    // No room for equal installments
    equalInstallmentAmount = 0;
    totalNominalPrice = (splitFirstYearPayments ? sumFirstYearNominal : (sumFirstYearNominal + actualDP))
                      + sumSubsequentNominal
                      + (Number(additionalHandoverPayment) || 0);
  }

  const equalMonths = getPaymentMonths(numEqualInstallments, installmentFrequency, effectiveStartYears);
  const pv = calculatePV({
    downPayment: dpForPV,
    equalInstallmentAmount,
    equalInstallmentMonths: equalMonths,
    monthlyRate,
    additionalHandoverPayment,
    handoverYear,
    customYearlyDetails: normalizedYears,
    firstYearPayments: splitFirstYearPayments ? firstYearPayments : []
  });

  return {
    totalNominalPrice,
    downPaymentAmount: actualDP,
    numEqualInstallments,
    equalInstallmentAmount,
    equalInstallmentMonths: equalMonths,
    monthlyRate,
    calculatedPV: pv,
    meta: {
      effectiveStartYears,
      splitFirstYearPayments: !!splitFirstYearPayments
    }
  };
}

/**
 * Normalize subsequentYears to attach absolute yearNumber correctly depending on whether
 * first year is split or not.
 * Input shape: [{ totalNominal, frequency }]
 * When splitFirstYearPayments === true, subsequent block starts at yearNumber 2, else yearNumber 1.
 * Defaults to the main plan frequency if a year's frequency is not specified.
 */
function normalizeSubsequentYears(subsequentYears, splitFirstYearPayments, mainFrequency) {
  const startYear = splitFirstYearPayments ? 2 : 1; // UI: if split Y1, next blocks are Y2/Y3
  const res = [];
  let i = 0;
  for (const y of (subsequentYears || [])) {
    i += 1;
    res.push({
      yearNumber: startYear + (i - 1),
      totalNominal: Number(y?.totalNominal) || 0,
      frequency: y?.frequency || mainFrequency
    });
  }
  return res;
}

/**
 * Dispatcher helper (optional) that mirrors frontend modes.
 * mode: one of CalculationModes
 */
export function calculateByMode(mode, stdPlan, inputs) {
  switch (mode) {
    case CalculationModes.EvaluateCustomPrice:
      return evaluateCustomPrice(stdPlan, inputs);
    case CalculationModes.CalculateForTargetPV:
      return calculateForTargetPV(stdPlan, inputs);
    case CalculationModes.CustomYearlyThenEqual_UseStdPrice:
      return customYearlyThenEqualUseStdPrice(stdPlan, inputs);
    case CalculationModes.CustomYearlyThenEqual_TargetPV:
      return customYearlyThenEqualTargetPV(stdPlan, inputs);
    case CalculationModes.StandardMode:
      return standardMode(stdPlan, inputs);
    default:
      throw new Error(`Unknown calculation mode: ${mode}`);
  }
}