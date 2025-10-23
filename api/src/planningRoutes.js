import express from 'express'
import { pool } from './db.js'
import { validate, calculateSchema, generatePlanSchema } from './validation.js'
import { authMiddleware } from './authRoutes.js'
import convertToWords from '../utils/converter.js'
import {
  calculateByMode,
  CalculationModes,
  Frequencies,
  getPaymentMonths
} from '../services/calculationService.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({
    error: { message, details },
    timestamp: new Date().toISOString()
  })
}
function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}
function isBoolean(v) { return typeof v === 'boolean' }

const allowedModes = new Set(Object.values(CalculationModes))
const allowedFrequencies = new Set(Object.values(Frequencies))

function normalizeFrequency(s) {
  if (!s) return null
  const v = String(s).trim().toLowerCase()
  let norm = v
  if (v === 'biannually') norm = 'bi-annually'
  const candidates = new Set(Object.values(Frequencies))
  if (candidates.has(norm)) return norm
  return null
}

async function getActivePolicyLimitPercent() {
  try {
    const r = await pool.query(
      `SELECT policy_limit_percent
       FROM approval_policies
       WHERE active=TRUE AND scope_type='global'
       ORDER BY id DESC
       LIMIT 1`
    )
    if (r.rows.length > 0) {
      const v = Number(r.rows[0].policy_limit_percent)
      if (Number.isFinite(v) && v > 0) return v
    }
  } catch (e) {}
  return 5
}

function validateInputs(inputs) {
  const errors = []
  if (inputs.installmentFrequency && !allowedFrequencies.has(inputs.installmentFrequency)) {
    errors.push({ field: 'installmentFrequency', message: 'Invalid frequency' })
  }
  if (inputs.planDurationYears == null) {
    errors.push({ field: 'planDurationYears', message: 'Required' })
  } else {
    const yrs = Number(inputs.planDurationYears)
    if (!Number.isInteger(yrs) || yrs <= 0) {
      errors.push({ field: 'planDurationYears', message: 'Must be integer >= 1' })
    } else if (yrs > 12) {
      errors.push({ field: 'planDurationYears', message: 'Max allowed is 12 years' })
    }
  }
  if (inputs.dpType && !['amount', 'percentage'].includes(inputs.dpType)) {
    errors.push({ field: 'dpType', message: 'Must be "amount" or "percentage"' })
  }
  if (inputs.downPaymentValue != null) {
    const v = Number(inputs.downPaymentValue)
    if (!isFinite(v) || v < 0) errors.push({ field: 'downPaymentValue', message: 'Must be non-negative number' })
  }
  if (inputs.handoverYear != null) {
    const hy = Number(inputs.handoverYear)
    if (!Number.isInteger(hy) || hy <= 0) errors.push({ field: 'handoverYear', message: 'Must be integer >= 1' })
  }
  if (inputs.additionalHandoverPayment != null) {
    const ah = Number(inputs.additionalHandoverPayment)
    if (!isFinite(ah) || ah < 0) errors.push({ field: 'additionalHandoverPayment', message: 'Must be non-negative number' })
  }
  if (inputs.splitFirstYearPayments != null && !isBoolean(inputs.splitFirstYearPayments)) {
    errors.push({ field: 'splitFirstYearPayments', message: 'Must be boolean' })
  }
  if (Array.isArray(inputs.firstYearPayments)) {
    inputs.firstYearPayments.forEach((p, idx) => {
      const amt = Number(p?.amount)
      const month = Number(p?.month)
      if (!isFinite(amt) || amt < 0) errors.push({ field: `firstYearPayments[${idx}].amount`, message: 'Must be non-negative number' })
      if (!Number.isInteger(month) || month < 1 || month > 12) errors.push({ field: `firstYearPayments[${idx}].month`, message: 'Must be integer 1..12' })
      if (p?.type && !['dp', 'regular'].includes(p.type)) errors.push({ field: `firstYearPayments[${idx}].type`, message: 'Must be "dp" or "regular"' })
    })
  }
  if (Array.isArray(inputs.subsequentYears)) {
    inputs.subsequentYears.forEach((y, idx) => {
      const total = Number(y?.totalNominal)
      if (!isFinite(total) || total < 0) errors.push({ field: `subsequentYears[${idx}].totalNominal`, message: 'Must be non-negative number' })
      if (!allowedFrequencies.has(y?.frequency)) errors.push({ field: `subsequentYears[${idx}].frequency`, message: 'Invalid frequency' })
    })
  }
  return errors
}

/**
 * POST /api/calculate
 * Body: { mode, stdPlan, inputs, standardPricingId?, unitId? }
 */
router.post('/calculate', authMiddleware, validate(calculateSchema), async (req, res) => {
  try {
    const { mode, stdPlan, inputs, standardPricingId, unitId } = req.body || {}

    if (!mode || !allowedModes.has(mode)) {
      return bad(res, 400, 'Invalid or missing mode', { allowedModes: [...allowedModes] })
    }

    let effectiveStdPlan = null

    if (standardPricingId || unitId) {
      let priceRow = null
      if (standardPricingId) {
        const r = await pool.query(
          `SELECT price, std_financial_rate_percent, plan_duration_years, installment_frequency
           FROM standard_pricing
           WHERE status='approved' AND id=$1
           ORDER BY id DESC
           LIMIT 1`,
          [Number(standardPricingId)]
        )
        priceRow = r.rows[0] || null
      } else if (unitId) {
        const r = await pool.query(
          `SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
           FROM units u
           JOIN unit_model_pricing p ON p.model_id = u.model_id
           WHERE u.id=$1 AND p.status='approved'
           ORDER BY p.id DESC
           LIMIT 1`,
          [Number(unitId)]
        )
        priceRow = r.rows[0] || null
      }
      if (!priceRow) {
        return bad(res, 404, 'Approved standard price not found for the selected unit/model')
      }

      const totalPrice =
        (Number(priceRow.price) || 0) +
        (Number(priceRow.garden_price) || 0) +
        (Number(priceRow.roof_price) || 0) +
        (Number(priceRow.storage_price) || 0) +
        (Number(priceRow.garage_price) || 0)

      let stdCfg = null
      try {
        const pr = await pool.query(
          `SELECT std_financial_rate_percent, plan_duration_years, installment_frequency
           FROM standard_plan
           WHERE active=TRUE
           ORDER BY id DESC
           LIMIT 1`
        )
        stdCfg = pr.rows[0] || null
      } catch {}

      const effRateRaw = stdCfg?.std_financial_rate_percent
      const durRaw = stdCfg?.plan_duration_years
      const freqRaw = stdCfg?.installment_frequency
      const effRate = Number(effRateRaw)
      const durYears = Number(durRaw)
      const freqCalc = normalizeFrequency(freqRaw)

      const rateValid = Number.isFinite(effRate) && effRate > 0
      const durValid = Number.isInteger(durYears) && durYears >= 1
      const freqValid = !!freqCalc

      let usedStoredFMpv = false
      let computedPVEqualsTotalNominal = false
      let annualRateUsedMeta = null
      let durationYearsUsedMeta = null
      let frequencyUsedMeta = null

      let rowRate = null, rowDur = null, rowFreq = null
      try {
        if (unitId) {
          const rExt = await pool.query(
            `SELECT p.std_financial_rate_percent, p.plan_duration_years, p.installment_frequency
             FROM units u
             JOIN unit_model_pricing p ON p.model_id = u.model_id
             WHERE u.id=$1 AND p.status='approved'
             ORDER BY p.id DESC
             LIMIT 1`,
            [Number(unitId)]
          )
          const rr = rExt.rows[0]
          if (rr) {
            rowRate = rr.std_financial_rate_percent != null ? Number(rr.std_financial_rate_percent) : null
            rowDur = rr.plan_duration_years != null ? Number(rr.plan_duration_years) : null
            rowFreq = normalizeFrequency(rr.installment_frequency)
          }
        }
        if (standardPricingId && (rowRate == null || rowDur == null || !rowFreq)) {
          const rSP = await pool.query(
            `SELECT std_financial_rate_percent, plan_duration_years, installment_frequency
             FROM standard_pricing
             WHERE id=$1`,
            [Number(standardPricingId)]
          )
          const sp = rSP.rows[0]
          if (sp) {
            rowRate = sp.std_financial_rate_percent != null ? Number(sp.std_financial_rate_percent) : rowRate
            rowDur = sp.plan_duration_years != null ? Number(sp.plan_duration_years) : rowDur
            rowFreq = rowFreq || normalizeFrequency(sp.installment_frequency)
          }
        }
      } catch (e) {}

      const rowRateValid = Number.isFinite(rowRate) && rowRate > 0
      const rowDurValid = Number.isInteger(rowDur) && rowDur >= 1
      const rowFreqValid = !!rowFreq

      if (rowRateValid && rowDurValid && rowFreqValid) {
        const stdInputsForPv = {
          salesDiscountPercent: 0,
          dpType: (req.body?.inputs?.dpType === 'percentage' || req.body?.inputs?.dpType === 'amount') ? req.body.inputs.dpType : 'percentage',
          downPaymentValue: Number(req.body?.inputs?.downPaymentValue) || 0,
          planDurationYears: rowDur,
          installmentFrequency: rowFreq,
          additionalHandoverPayment: 0,
          handoverYear: 1,
          splitFirstYearPayments: false,
          firstYearPayments: [],
          subsequentYears: []
        }
        const stdPvResult = calculateByMode(CalculationModes.EvaluateCustomPrice, { totalPrice, financialDiscountRate: rowRate, calculatedPV: 0 }, stdInputsForPv)
        const stdPVComputed = Number(stdPvResult?.calculatedPV) || 0
        computedPVEqualsTotalNominal = stdPVComputed === totalPrice

        effectiveStdPlan = {
          totalPrice,
          financialDiscountRate: rowRate,
          calculatedPV: Number(stdPVComputed.toFixed(2))
        }
        annualRateUsedMeta = rowRate
        durationYearsUsedMeta = rowDur
        frequencyUsedMeta = rowFreq
      } else if (rateValid && durValid && freqValid) {
        return bad(res, 422,
          'Per-pricing financial settings are required (std_financial_rate_percent, plan_duration_years, installment_frequency). Configure and approve them for the selected unit/model.'
        )
      } else {
        let fmPV = null
        try {
          if (unitId) {
            try {
              const q1 = await pool.query(
                `SELECT p.calculated_pv
                 FROM units u
                 JOIN unit_model_pricing p ON p.model_id = u.model_id
                 WHERE u.id=$1 AND p.status='approved'
                 ORDER BY p.id DESC
                 LIMIT 1`,
                [Number(unitId)]
              )
              fmPV = Number(q1.rows[0]?.calculated_pv) || null
            } catch (e) {}
            if (fmPV == null) {
              try {
                const q2 = await pool.query(
                  `SELECT calculated_pv
                   FROM standard_pricing
                   WHERE status='approved' AND unit_id=$1
                   ORDER BY id DESC
                   LIMIT 1`,
                  [Number(unitId)]
                )
                fmPV = Number(q2.rows[0]?.calculated_pv) || null
              } catch (e) {}
            }
          } else if (standardPricingId) {
            try {
              const q3 = await pool.query(
                `SELECT calculated_pv
                 FROM standard_pricing
                 WHERE id=$1`,
                [Number(standardPricingId)]
              )
              fmPV = Number(q3.rows[0]?.calculated_pv) || null
            } catch (e) {}
          }
        } catch (e) {}
        if (fmPV != null && fmPV > 0) {
          usedStoredFMpv = true
          annualRateUsedMeta = Number(stdCfg?.std_financial_rate_percent) || null
          durationYearsUsedMeta = Number(stdCfg?.plan_duration_years) || null
          frequencyUsedMeta = freqCalc || null

          effectiveStdPlan = {
            totalPrice,
            financialDiscountRate: annualRateUsedMeta,
            calculatedPV: fmPV
          }
        } else {
          return bad(res, 422,
            'Active standard plan is missing or invalid (rate/duration/frequency). Configure it under Top Management → Standard Plan. Alternatively, ensure FM Calculated PV exists for this unit model.'
          )
        }
      }

      if (!isObject(req.body.inputs)) req.body.inputs = {}
      if (durValid && req.body.inputs.planDurationYears == null) {
        req.body.inputs.planDurationYears = durYears
      }
      if (freqValid && !req.body.inputs.installmentFrequency) {
        req.body.inputs.installmentFrequency = frequencyUsedMeta
      }

      req._stdMeta = {
        rateUsedPercent: annualRateUsedMeta,
        durationYearsUsed: durationYearsUsedMeta,
        frequencyUsed: frequencyUsedMeta,
        computedPVEqualsTotalNominal,
        usedStoredFMpv,
        rateSource: usedStoredFMpv
          ? 'fm_stored_pv'
          : ((annualRateUsedMeta === effRate && durationYearsUsedMeta === durYears && frequencyUsedMeta === freqCalc)
              ? 'standard_plan'
              : 'per_pricing')
      }
    } else {
      if (!isObject(stdPlan)) {
        return bad(res, 400, 'Provide either standardPricingId/unitId or stdPlan object')
      }
      const stdTotal = Number(stdPlan.totalPrice)
      const stdRate = Number(stdPlan.financialDiscountRate)
      const stdPV = Number(stdPlan.calculatedPV)
      if (!isFinite(stdTotal) || stdTotal < 0) {
        return bad(res, 400, 'stdPlan.totalPrice must be a non-negative number')
      }
      if (!isFinite(stdRate)) {
        return bad(res, 400, 'stdPlan.financialDiscountRate must be a number (percent)')
      }
      if (!isFinite(stdPV) || stdPV < 0) {
        return bad(res, 400, 'stdPlan.calculatedPV must be a non-negative number')
      }
      effectiveStdPlan = stdPlan
    }

    const effInputs = req.body.inputs || inputs
    if (!isObject(effInputs)) {
      return bad(res, 400, 'inputs must be an object')
    }

    if (effInputs.installmentFrequency) {
      const nf = normalizeFrequency(effInputs.installmentFrequency)
      if (!nf) {
        return bad(res, 422, 'Invalid inputs', [{ field: 'installmentFrequency', message: 'Invalid frequency' }])
      }
      effInputs.installmentFrequency = nf
    }
    if (Array.isArray(effInputs.subsequentYears)) {
      effInputs.subsequentYears = effInputs.subsequentYears.map(y => ({
        ...y,
        frequency: y?.frequency ? normalizeFrequency(y.frequency) : effInputs.installmentFrequency
      }))
    }

    const inputErrors = validateInputs(effInputs)
    if (inputErrors.length > 0) {
      return bad(res, 422, 'Invalid inputs', inputErrors)
    }

    const role = req.user?.role
    const disc = Number(effInputs.salesDiscountPercent) || 0
    let authorityLimit = null
    if (role === 'property_consultant') authorityLimit = 2
    if (role === 'financial_manager') authorityLimit = 5
    const overAuthority = authorityLimit != null ? disc > authorityLimit : false

    const policyLimit = await getActivePolicyLimitPercent()
    const overPolicy = disc > policyLimit

    const result = calculateByMode(mode, effectiveStdPlan, effInputs)
    return res.json({ ok: true, data: result, meta: { policyLimit, overPolicy, authorityLimit, overAuthority, ...(req._stdMeta || {}) } })
  } catch (err) {
    console.error('POST /api/calculate error:', err)
    return bad(res, 500, 'Internal error during calculation')
  }
})

/**
 * POST /api/generate-plan
 * Body: { mode, stdPlan, inputs, language, currency?, standardPricingId?, unitId? }
 */
router.post('/generate-plan', authMiddleware, validate(generatePlanSchema), async (req, res) => {
  try {
    const { mode, stdPlan, inputs, language, currency, languageForWrittenAmounts, standardPricingId, unitId } = req.body || {}
    if (!mode || !allowedModes.has(mode)) {
      return bad(res, 400, 'Invalid or missing mode', { allowedModes: [...allowedModes] })
    }

    let effectiveStdPlan = null
    const effInputs = req.body.inputs || inputs || {}

    if (effInputs.installmentFrequency) {
      const nf = normalizeFrequency(effInputs.installmentFrequency)
      if (!nf) {
        return bad(res, 422, 'Invalid inputs', [{ field: 'installmentFrequency', message: 'Invalid frequency' }])
      }
      effInputs.installmentFrequency = nf
    }

    let maintFromPricing = 0

    if (standardPricingId || unitId) {
      let row = null
      if (standardPricingId) {
        const r = await pool.query(
          `SELECT price, std_financial_rate_percent, plan_duration_years, installment_frequency
           FROM standard_pricing
           WHERE status='approved' AND id=$1
           ORDER BY id DESC
           LIMIT 1`,
          [Number(standardPricingId)]
        )
        row = r.rows[0] || null
      } else if (unitId) {
        try {
          const r = await pool.query(
            `SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price,
                    p.calculated_pv, p.std_financial_rate_percent
             FROM units u
             JOIN unit_model_pricing p ON p.model_id = u.model_id
             WHERE u.id=$1 AND p.status='approved'
             ORDER BY p.id DESC
             LIMIT 1`,
            [Number(unitId)]
          )
          row = r.rows[0] || null
        } catch (e) {
          const r2 = await pool.query(
            `SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
             FROM units u
             JOIN unit_model_pricing p ON p.model_id = u.model_id
             WHERE u.id=$1 AND p.status='approved'
             ORDER BY p.id DESC
             LIMIT 1`,
            [Number(unitId)]
          )
          row = r2.rows[0] || null
        }
      }
      if (!row) {
        return bad(res, 404, 'Approved standard price not found for the selected unit/model')
      }

      maintFromPricing = Number(row.maintenance_price) || 0

      const totalPrice =
        (Number(row.price) || 0) +
        (Number(row.garden_price) || 0) +
        (Number(row.roof_price) || 0) +
        (Number(row.storage_price) || 0) +
        (Number(row.garage_price) || 0)

      let stdCfg = null
      try {
        const pr = await pool.query(
          `SELECT std_financial_rate_percent, plan_duration_years, installment_frequency
           FROM standard_plan
           WHERE active=TRUE
           ORDER BY id DESC
           LIMIT 1`
        )
        stdCfg = pr.rows[0] || null
      } catch {}

      const effRateRaw = stdCfg?.std_financial_rate_percent
      const durRaw = stdCfg?.plan_duration_years
      const freqRaw = stdCfg?.installment_frequency
      const effRate = Number(effRateRaw)
      const durYears = Number(durRaw)
      const freqCalc = normalizeFrequency(freqRaw)

      const rateValid = Number.isFinite(effRate) && effRate > 0
      const durValid = Number.isInteger(durYears) && durYears >= 1
      const freqValid = !!freqCalc

      let usedStoredFMpv = false
      let computedPVEqualsTotalNominal = false
      let annualRateUsedMeta = null
      let durationYearsUsedMeta = null
      let frequencyUsedMeta = null

      let rowRate = null, rowDur = null, rowFreq = null
      try {
        if (unitId) {
          const rExt = await pool.query(
            `SELECT p.std_financial_rate_percent, p.plan_duration_years, p.installment_frequency
             FROM units u
             JOIN unit_model_pricing p ON p.model_id = u.model_id
             WHERE u.id=$1 AND p.status='approved'
             ORDER BY p.id DESC
             LIMIT 1`,
            [Number(unitId)]
          )
          const rr = rExt.rows[0]
          if (rr) {
            rowRate = rr.std_financial_rate_percent != null ? Number(rr.std_financial_rate_percent) : null
            rowDur = rr.plan_duration_years != null ? Number(rr.plan_duration_years) : null
            rowFreq = normalizeFrequency(rr.installment_frequency)
          }
        }
        if (standardPricingId && (rowRate == null || rowDur == null || !rowFreq)) {
          const rSP = await pool.query(
            `SELECT std_financial_rate_percent, plan_duration_years, installment_frequency
             FROM standard_pricing
             WHERE id=$1`,
            [Number(standardPricingId)]
          )
          const sp = rSP.rows[0]
          if (sp) {
            rowRate = sp.std_financial_rate_percent != null ? Number(sp.std_financial_rate_percent) : rowRate
            rowDur = sp.plan_duration_years != null ? Number(sp.plan_duration_years) : rowDur
            rowFreq = rowFreq || normalizeFrequency(sp.installment_frequency)
          }
        }
      } catch (e) {}

      const rowRateValid = Number.isFinite(rowRate) && rowRate > 0
      const rowDurValid = Number.isInteger(rowDur) && rowDur >= 1
      const rowFreqValid = !!rowFreq

      if (rowRateValid && rowDurValid && rowFreqValid) {
        const stdInputsForPv = {
          salesDiscountPercent: 0,
          dpType: (effInputs?.dpType === 'percentage' || effInputs?.dpType === 'amount') ? effInputs.dpType : 'percentage',
          downPaymentValue: Number(effInputs?.downPaymentValue) || 0,
          planDurationYears: rowDur,
          installmentFrequency: rowFreq,
          additionalHandoverPayment: 0,
          handoverYear: 1,
          splitFirstYearPayments: false,
          firstYearPayments: [],
          subsequentYears: []
        }
        const stdPvResult = calculateByMode(
          CalculationModes.EvaluateCustomPrice,
          { totalPrice, financialDiscountRate: rowRate, calculatedPV: 0 },
          stdInputsForPv
        )
        const stdPVComputed = Number(stdPvResult?.calculatedPV) || 0
        computedPVEqualsTotalNominal = stdPVComputed === totalPrice

        effectiveStdPlan = {
          totalPrice,
          financialDiscountRate: rowRate,
          calculatedPV: Number(stdPVComputed.toFixed(2))
        }
        annualRateUsedMeta = rowRate
        durationYearsUsedMeta = rowDur
        frequencyUsedMeta = rowFreq
      } else if (rateValid && durValid && freqValid) {
        return bad(res, 422,
          'Per-pricing financial settings are required (std_financial_rate_percent, plan_duration_years, installment_frequency). Configure and approve them for the selected unit/model.'
        )
      } else {
        let fmPV = null
        try {
          if (unitId) {
            try {
              const q1 = await pool.query(
                `SELECT p.calculated_pv
                 FROM units u
                 JOIN unit_model_pricing p ON p.model_id = u.model_id
                 WHERE u.id=$1 AND p.status='approved'
                 ORDER BY p.id DESC
                 LIMIT 1`,
                [Number(unitId)]
              )
              fmPV = Number(q1.rows[0]?.calculated_pv) || null
            } catch (e) {}
            if (fmPV == null) {
              try {
                const q2 = await pool.query(
                  `SELECT calculated_pv
                   FROM standard_pricing
                   WHERE status='approved' AND unit_id=$1
                   ORDER BY id DESC
                   LIMIT 1`,
                  [Number(unitId)]
                )
                fmPV = Number(q2.rows[0]?.calculated_pv) || null
              } catch (e) {}
            }
          } else if (standardPricingId) {
            try {
              const q3 = await pool.query(
                `SELECT calculated_pv
                 FROM standard_pricing
                 WHERE id=$1`,
                [Number(standardPricingId)]
              )
              fmPV = Number(q3.rows[0]?.calculated_pv) || null
            } catch (e) {}
          }
        } catch (e) {}
        if (fmPV != null && fmPV > 0) {
          usedStoredFMpv = true
          annualRateUsedMeta = Number(stdCfg?.std_financial_rate_percent) || null
          durationYearsUsedMeta = Number(stdCfg?.plan_duration_years) || null
          frequencyUsedMeta = freqCalc || null

          effectiveStdPlan = {
            totalPrice,
            financialDiscountRate: annualRateUsedMeta,
            calculatedPV: fmPV
          }
        } else {
          return bad(res, 422,
            'Active standard plan is missing or invalid (rate/duration/frequency). Configure it under Top Management → Standard Plan. Alternatively, ensure FM Calculated PV exists for this unit model.'
          )
        }
      }

      if (stdCfg && effInputs.planDurationYears == null && durValid) effInputs.planDurationYears = durYears
      if (stdCfg && !effInputs.installmentFrequency && freqValid) effInputs.installmentFrequency = freqCalc
    } else {
      if (!isObject(stdPlan) || !isObject(effInputs)) {
        return bad(res, 400, 'Provide either standardPricingId/unitId or stdPlan with inputs')
      }
      effectiveStdPlan = stdPlan
    }

    const inputErrors = validateInputs(effInputs)
    if (inputErrors.length > 0) {
      return bad(res, 422, 'Invalid inputs', inputErrors)
    }

    const langInput = language || languageForWrittenAmounts || 'en'
    const lang = String(langInput).toLowerCase().startsWith('ar') ? 'ar' : 'en'

    const role = req.user?.role
    const disc = Number(effInputs.salesDiscountPercent) || 0
    if (role === 'property_consultant' && disc > 2) {
      return bad(res, 403, 'Sales consultants can apply a maximum discount of 2%.')
    }
    if (role === 'financial_manager' && disc > 5) {
      return bad(res, 403, 'Financial managers can apply a maximum discount of 5% (requires CEO approval in workflow if over 2%).')
    }

    const result = calculateByMode(mode, effectiveStdPlan, effInputs)

    const policyLimit = await getActivePolicyLimitPercent()
    const npvTolerancePercent = 70
    const toleranceValue = (Number(effectiveStdPlan.totalPrice) || 0) * (npvTolerancePercent / 100)
    const npvWarning = (Number(result.calculatedPV) || 0) < toleranceValue

    const schedule = []
    const pushEntry = (label, month, amount, baseDateStr) => {
      const amt = Number(amount) || 0
      if (amt <= 0) return
      const m = Number(month) || 0
      let dueDate = null
      if (baseDateStr) dueDate = computeDueDate(baseDateStr, m)
      schedule.push({
        label,
        month: m,
        amount: amt,
        date: dueDate,
        writtenAmount: convertToWords(amt, lang, { currency })
      })
    }

    function computeDueDate(baseDateStr, monthOffset) {
      if (!baseDateStr) return null
      const base = new Date(baseDateStr)
      if (isNaN(base.getTime())) return null
      const d = new Date(base)
      d.setMonth(d.getMonth() + (Number(monthOffset) || 0))
      return d.toISOString().slice(0, 10)
    }

    const baseDate = effInputs.baseDate || effInputs.contractDate || null

    const splitY1 = !!effInputs.splitFirstYearPayments
    if (splitY1) {
      for (const p of (effInputs.firstYearPayments || [])) {
        pushEntry(p.type === 'dp' ? 'Down Payment (Y1 split)' : 'First Year', p.month, p.amount, baseDate)
      }
    } else {
      pushEntry('Down Payment', 0, result.downPaymentAmount, baseDate)
    }

    const subs = effInputs.subsequentYears || []
    subs.forEach((y, idx) => {
      let nInYear = 0
      switch (y.frequency) {
        case Frequencies.Monthly: nInYear = 12; break;
        case Frequencies.Quarterly: nInYear = 4; break;
        case Frequencies.BiAnnually: nInYear = 2; break;
        case Frequencies.Annually: nInYear = 1; break;
        default: nInYear = 0;
      }
      const per = (Number(y.totalNominal) || 0) / (nInYear || 1)
      const startAfterYear = (splitY1 ? 1 : 0) + idx
      const months = getPaymentMonths(nInYear, y.frequency, startAfterYear)
      months.forEach((m, i) => pushEntry(`Year ${startAfterYear + 1} (${y.frequency})`, m, per, baseDate))
    })

    if ((Number(effInputs.additionalHandoverPayment) || 0) > 0 && (Number(effInputs.handoverYear) || 0) > 0) {
      pushEntry('Handover', Number(effInputs.handoverYear) * 12, effInputs.additionalHandoverPayment, baseDate)
    }

    let maintAmt = (Number(unitId) > 0) ? (Number(maintFromPricing) || 0) : (Number(effInputs.maintenancePaymentAmount) || 0)

    const maintDateStr = effInputs.maintenancePaymentDate || null
    let maintMonth
    if (maintDateStr) {
      try {
        const b = baseDate || new Date().toISOString().slice(0, 10)
        const base = new Date(b)
        const due = new Date(maintDateStr)
        if (!isNaN(base.getTime()) && !isNaN(due.getTime())) {
          const years = due.getFullYear() - base.getFullYear()
          const months = due.getMonth() - base.getMonth()
          const days = due.getDate() - base.getDate()
          maintMonth = years * 12 + months + (days >= 0 ? 0 : -1)
        }
      } catch {}
    }
    if (!Number.isFinite(maintMonth)) {
      maintMonth = Number(effInputs.maintenancePaymentMonth)
      if (!Number.isFinite(maintMonth) || maintMonth < 0) {
        const hy = Number(effInputs.handoverYear) || 0
        maintMonth = hy > 0 ? hy * 12 : 12
      }
    }
    if (maintAmt > 0) pushEntry('Maintenance Deposit', maintMonth, maintAmt, baseDate)

    const garAmt = Number(effInputs.garagePaymentAmount) || 0
    const garMonth = Number(effInputs.garagePaymentMonth) || 0
    if (garAmt > 0) pushEntry('Garage Fee', garMonth, garAmt, baseDate)

    const eqMonths = result.equalInstallmentMonths || []
    const eqAmt = Number(result.equalInstallmentAmount) || 0
    eqMonths.forEach((m, i) => pushEntry('Equal Installment', m, eqAmt, baseDate))

    schedule.sort((a, b) => (a.month - b.month) || a.label.localeCompare(b.label))

    const totalIncl = schedule.reduce((s, e) => s + e.amount, 0)
    const totalExcl = schedule
      .filter(e => e.label !== 'Maintenance Deposit' && e.label !== 'Maintenance Fee')
      .reduce((s, e) => s + e.amount, 0)
    const totals = {
      count: schedule.length,
      totalNominal: totalIncl,
      totalNominalIncludingMaintenance: totalIncl,
      totalNominalExcludingMaintenance: totalExcl
    }

    const annualRate = Number(effectiveStdPlan.financialDiscountRate) || 0
    const standardPV = Number(effectiveStdPlan.calculatedPV) || 0
    const proposedPV = Number(result.calculatedPV) || 0
    const pvTolerancePercent = 70
    const EPS = 1e-2
    const pvPass = proposedPV + EPS >= (standardPV * (pvTolerancePercent / 100))
    const pvDifference = standardPV - proposedPV

    const totalNominalForConditions = (Number(result.totalNominalPrice) || 0) + (Number(effInputs.additionalHandoverPayment) || 0)

    const sumUpTo = (monthCutoff) => schedule
      .filter(s => s.label !== 'Maintenance Deposit' && s.label !== 'Maintenance Fee')
      .reduce((sum, s) => sum + (s.month <= monthCutoff ? (Number(s.amount) || 0) : 0), 0)

    const cutoffY1 = 12
    const cutoffY2 = 24
    const cutoffY3 = 36
    const handoverCutoff = (Number(effInputs.handoverYear) || 0) * 12

    const paidY1 = sumUpTo(cutoffY1)
    const paidY2 = sumUpTo(cutoffY2)
    const paidY3 = sumUpTo(cutoffY3)
    const paidByHandover = handoverCutoff > 0 ? sumUpTo(handoverCutoff) : 0

    const pct = (a, base) => {
      const b = Number(base) || 0
      const x = Number(a) || 0
      return b > 0 ? (x / b) * 100 : (x > 0 ? 100 : 0)
    }

    const percentY1 = pct(paidY1, totalNominalForConditions)
    const percentY2 = pct(paidY2, totalNominalForConditions)
    const percentY3 = pct(paidY3, totalNominalForConditions)
    const percentHandover = pct(paidByHandover, totalNominalForConditions)

    const stdTargetY1 = Number(effectiveStdPlan?.targetPaymentAfter1Year) || ((Number(effectiveStdPlan.totalPrice) || 0) * (35 / 100))
    const cond1Pass = paidY1 >= stdTargetY1 - 1e-9

    const withinRange = (value, min, max) => {
      if (min != null && Number(value) < Number(min)) return false
      if (max != null && Number(value) > Number(max)) return false
      return true
    }

    const cond2Pass = withinRange(percentHandover, 65, null)
    const cond3Pass = withinRange(percentY1, 35, null)
    const cond4Pass = withinRange(percentY2, 50, null)
    const cond5Pass = withinRange(percentY3, 65, null)

    const evaluation = {
      decision: (pvPass && cond1Pass && cond2Pass && cond3Pass && cond4Pass && cond5Pass) ? 'ACCEPT' : 'REJECT',
      pv: {
        proposedPV,
        standardPV,
        tolerancePercent: pvTolerancePercent,
        pass: pvPass,
        difference: pvDifference
      },
      conditions: [
        { key: 'payment_after_y1', label: 'Payment After 1 Year', status: cond1Pass ? 'PASS' : 'FAIL', required: stdTargetY1, actual: paidY1 },
        { key: 'handover_percent', label: 'Payment by Handover', status: cond2Pass ? 'PASS' : 'FAIL',
          required: { min: 65, max: null },
          actual: { percent: percentHandover, amount: paidByHandover }, handoverYear: Number(effInputs.handoverYear) || 0
        },
        { key: 'cumulative_y1', label: 'Cumulative by End of Year 1', status: cond3Pass ? 'PASS' : 'FAIL',
          required: { min: 35, max: null },
          actual: { percent: percentY1, amount: paidY1 }
        },
        { key: 'cumulative_y2', label: 'Cumulative by End of Year 2', status: cond4Pass ? 'PASS' : 'FAIL',
          required: { min: 50, max: null },
          actual: { percent: percentY2, amount: paidY2 }
        },
        { key: 'cumulative_y3', label: 'Cumulative by End of Year 3', status: cond5Pass ? 'PASS' : 'FAIL',
          required: { min: 65, max: null },
          actual: { percent: percentY3, amount: paidY3 }
        }
      ],
      summary: {
        totalNominalForConditions,
        discountPercentApplied: Number(effInputs.salesDiscountPercent) || 0,
        equalInstallmentAmount: Number(result.equalInstallmentAmount) || 0,
        numEqualInstallments: Number(result.numEqualInstallments) || 0
      }
    }

    return res.json({
      ok: true,
      schedule,
      totals,
      meta: { ...result.meta, npvWarning, rateUsedPercent: Number(effectiveStdPlan.financialDiscountRate) || null, durationYearsUsed: req._stdMeta?.durationYearsUsed || (effInputs.planDurationYears || null), frequencyUsed: effInputs.installmentFrequency || null, computedPVEqualsTotalNominal: req._stdMeta?.computedPVEqualsTotalNominal || false, usedStoredFMpv: req._stdMeta?.usedStoredFMpv || false },
      evaluation
    })
  } catch (err) {
    console.error('POST /api/generate-plan error:', err)
    return bad(res, 500, 'Internal error during plan generation')
  }
})

export default router