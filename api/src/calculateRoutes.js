import express from 'express'
import { authMiddleware, requireRole } from './authRoutes.js'
import { pool } from './db.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) { return res.json({ ok: true, ...payload }) }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v) }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

/**
 * Helpers
 */

// Sum safe
function sum(arr) { return (arr || []).reduce((s, v) => s + (Number(v) || 0), 0) }

// Frequency -> payments per year
const FREQS = {
  monthly: 12,
  quarterly: 4,
  biannually: 2,
  annually: 1
}

// Build a standard plan schedule (equal installments) given total, years, frequency
function buildEqualSchedule(total, years, frequency, baseDate) {
  const nPerYear = FREQS[String(frequency || '').toLowerCase()] || 12
  const totalPayments = Math.max(1, (Number(years) || 1) * nPerYear)
  const perPayment = (Number(total) || 0) / totalPayments
  const schedule = []
  for (let i = 0; i < totalPayments; i++) {
    const month = Math.floor((i) * (12 / nPerYear))
    schedule.push({
      label: 'Equal Installment',
      month,
      amount: perPayment,
      date: computeDueDate(baseDate, month)
    })
  }
  return schedule
}

// Compute due date from base date and months offset
function computeDueDate(baseDateStr, monthOffset) {
  if (!baseDateStr) return null
  const base = new Date(baseDateStr)
  if (isNaN(base.getTime())) return null
  const d = new Date(base)
  d.setMonth(d.getMonth() + (Number(monthOffset) || 0))
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

// Present Value at rate (percent) based on month offsets
function presentValue(schedule, ratePercent) {
  const r = (Number(ratePercent) || 0) / 100
  if (r <= 0) return sum(schedule.map(e => Number(e.amount) || 0))
  let pv = 0
  for (const e of schedule) {
    if (e.excludeFromPV) continue
    const m = Number(e.month) || 0
    const tYears = m / 12
    const amt = Number(e.amount) || 0
    pv += amt / Math.pow(1 + r, tYears)
  }
  return pv
}

// Build proposal schedule from inputs
function buildProposalSchedule(proposal, unit, standardPlan) {
  const schedule = []
  const baseDate = proposal.baseDate || proposal.contractDate || null

  // Determine total nominal price from unit (approved standard pricing)
  const sp = unit?.approved_standard_pricing || {}
  const totalNominalStd = ['price','garage_price','garden_price','roof_price','storage_price']
    .map(k => Number(sp?.[k]) || 0)
    .reduce((a, b) => a + b, 0)

  // Apply sales discount if provided
  const salesDisc = Number(proposal.salesDiscountPercent) || 0
  const totalNominal = totalNominalStd * (1 - (salesDisc / 100))

  // Down payment
  let dpAmt = 0
  if (proposal.dpType === 'percentage') {
    dpAmt = totalNominal * ((Number(proposal.downPaymentValue) || 0) / 100)
  } else {
    dpAmt = Number(proposal.downPaymentValue) || 0
  }
  if (dpAmt > 0) {
    schedule.push({ label: 'Down Payment', month: 0, amount: dpAmt, date: computeDueDate(baseDate, 0) })
  }

  // Optional: First year split payments
  if (proposal.splitFirstYearPayments && Array.isArray(proposal.firstYearPayments)) {
    for (const p of proposal.firstYearPayments) {
      const amt = Number(p?.amount) || 0
      const m = Number(p?.month) || 0
      if (amt > 0 && m >= 0) {
        schedule.push({
          label: p?.type === 'dp' ? 'Down Payment (Y1 split)' : 'First Year',
          month: m,
          amount: amt,
          date: computeDueDate(baseDate, m)
        })
      }
    }
  }

  // Handover payment
  const handoverAmt = Number(proposal.additionalHandoverPayment) || 0
  const handoverYear = Number(proposal.handoverYear) || 0
  if (handoverAmt > 0 && handoverYear > 0) {
    const hm = handoverYear * 12
    schedule.push({ label: 'Handover', month: hm, amount: handoverAmt, date: computeDueDate(baseDate, hm) })
  }

  // Remaining to be scheduled as equal installments
  // Remaining to be scheduled as equal installments (deduct separately paid garage amount if included in nominal)
  const allocated = sum(schedule.map(s => s.amount))
  const garageDed = Number(proposal.garagePaymentAmount) || 0
  const remaining = Math.max(0, totalNominal - allocated - garageDed)

  const years = proposal.planDurationYears != null ? Number(proposal.planDurationYears) : Number(standardPlan?.plan_duration_years) || 1
  const freq = proposal.installmentFrequency || standardPlan?.installment_frequency || 'monthly'

  const eq = buildEqualSchedule(remaining, years, freq, baseDate)
  schedule.push(...eq)

  // Additional one-time fees as separate entries if provided (not discounted by sales percent)
  const extraFees = [
    { key: 'maintenancePaymentAmount', label: 'Maintenance Fee', monthKey: 'maintenancePaymentMonth' },
    { key: 'garagePaymentAmount', label: 'Garage Fee', monthKey: 'garagePaymentMonth' }
  ]
  for (const ef of extraFees) {
    const amt = Number(proposal[ef.key]) || 0
    const month = Number(proposal[ef.monthKey]) || 0
    if (amt > 0) {
      schedule.push({
        label: ef.label,
        month,
        amount: amt,
        date: computeDueDate(baseDate, month),
        excludeFromPV: ef.key === 'maintenancePaymentAmount'
      })
    }
  }

  // Sort and normalize
  schedule.sort((a, b) => (a.month - b.month) || a.label.localeCompare(b.label))
  return schedule
}

// Build standard baseline schedule using standard plan settings and unit approved pricing
function buildStandardBaselineSchedule(unit, standardPlan, baseDate) {
  const sp = unit?.approved_standard_pricing || {}
  const totalNominal = ['price','garage_price','garden_price','roof_price','storage_price']
    .map(k => Number(sp?.[k]) || 0)
    .reduce((a, b) => a + b, 0)

  const years = Number(standardPlan?.plan_duration_years) || 1
  const freq = standardPlan?.installment_frequency || 'monthly'
  const schedule = []

  // Apply standard down payment if configured in unit model pricing
  const stdDpPct = Number(sp?.standard_down_payment_percent) || 0
  let remaining = totalNominal
  if (stdDpPct > 0) {
    const dpAmt = totalNominal * (stdDpPct / 100)
    schedule.push({ label: 'Down Payment (Standard)', month: 0, amount: dpAmt, date: computeDueDate(baseDate, 0) })
    remaining = Math.max(0, remaining - dpAmt)
  }

  const eq = buildEqualSchedule(remaining, years, freq, baseDate)
  schedule.push(...eq)
  schedule.sort((a, b) => (a.month - b.month) || a.label.localeCompare(b.label))
  return schedule
}

// Compute year cumulative totals
function cumulativeByYear(schedule, yearsLimit) {
  const map = {}
  for (const e of schedule) {
    const year = Math.floor((Number(e.month) || 0) / 12) + 1
    if (yearsLimit && year > yearsLimit) continue
    map[year] = (map[year] || 0) + (Number(e.amount) || 0)
  }
  const out = []
  const maxYear = yearsLimit || Math.max(0, ...Object.keys(map).map(n => Number(n)))
  for (let y = 1; y <= maxYear; y++) {
    out.push({ year: y, amount: Number(map[y] || 0) })
  }
  return out
}

// Acceptance conditions comparison between proposal and standard baseline
function evaluateAcceptance(proposalSchedule, standardSchedule, ratePercent, standardPlan) {
  const proposalPV = presentValue(proposalSchedule, ratePercent)
  const standardPV = presentValue(standardSchedule, ratePercent)

  const conditions = []

  // Condition A: Proposal PV must be >= Standard PV
  conditions.push({
    key: 'pv_vs_standard',
    label: 'Proposal PV compared to Standard PV',
    proposal: proposalPV,
    standard: standardPV,
    pass: proposalPV >= standardPV
  })

  // Condition B: Cumulative payments by end of Year 1 must be >= standard's Year 1
  const propCum = cumulativeByYear(proposalSchedule, 2) // collect at least first 2 years
  const stdCum = cumulativeByYear(standardSchedule, 2)
  const y1p = (propCum.find(x => x.year === 1)?.amount) || 0
  const y1s = (stdCum.find(x => x.year === 1)?.amount) || 0
  conditions.push({
    key: 'year1_cumulative',
    label: 'Cumulative payments by end of Year 1',
    proposal: y1p,
    standard: y1s,
    pass: y1p >= y1s
  })

  // Condition C: Cumulative by end of Year 2 must be >= standard's Year 2
  const y2p = (propCum.find(x => x.year === 2)?.amount) || 0
  const y2s = (stdCum.find(x => x.year === 2)?.amount) || 0
  conditions.push({
    key: 'year2_cumulative',
    label: 'Cumulative payments by end of Year 2',
    proposal: y2p,
    standard: y2s,
    pass: y2p >= y2s
  })

  // Optional NPV tolerance check against total nominal target
  let npvToleranceCheck = null
  const tol = Number(standardPlan?.npv_tolerance_percent)
  const sp = standardPlan
  if (Number.isFinite(tol) && tol > 0) {
    // Use standard plan PV as baseline target with tolerance percentage
    const minPv = standardPV * (tol / 100)
    npvToleranceCheck = {
      key: 'npv_tolerance',
      label: 'NPV Tolerance Check',
      proposal: proposalPV,
      threshold: minPv,
      percent: tol,
      pass: proposalPV >= minPv
    }
    conditions.push(npvToleranceCheck)
  }

  const allPass = conditions.every(c => c.pass)

  return {
    proposalPV,
    standardPV,
    difference: proposalPV - standardPV,
    decision: allPass ? 'accepted' : 'needs_override',
    conditions
  }
}

/**
 * POST /api/calculate
 * Body: { unit, standardPlan, proposal }
 */
router.post('/calculate', authMiddleware, requireRole(['property_consultant','sales_manager','financial_manager','admin','superadmin']), async (req, res) => {
  try {
    const { unit, standardPlan, proposal } = req.body || {}

    // Validation
    if (!isObject(unit) || !isObject(unit.approved_standard_pricing) || !isObject(unit.model)) {
      return bad(res, 400, 'unit must include embedded model and approved_standard_pricing')
    }
    if (!isObject(standardPlan)) {
      return bad(res, 400, 'standardPlan is required')
    }
    if (!isObject(proposal)) {
      return bad(res, 400, 'proposal is required')
    }

    // Refresh standard pricing configuration from DB to ensure latest down payment % is used
    if (unit.model?.id) {
      const spRes = await pool.query(
        `SELECT standard_down_payment_percent FROM unit_model_pricing WHERE model_id=$1 AND status='approved' ORDER BY id DESC LIMIT 1`,
        [unit.model.id]
      )
      if (spRes.rows.length > 0 && spRes.rows[0].standard_down_payment_percent != null) {
        unit.approved_standard_pricing.standard_down_payment_percent = Number(spRes.rows[0].standard_down_payment_percent)
      }
    }

    // Build proposal schedule
    const proposalSchedule = buildProposalSchedule(proposal, unit, standardPlan)

    // Build standard baseline schedule (equal installments)
    const baseDate = proposal.baseDate || proposal.contractDate || null
    const standardSchedule = buildStandardBaselineSchedule(unit, standardPlan, baseDate)

    // Evaluate acceptance
    const ratePercent = Number(standardPlan.std_financial_rate_percent) || 0
    const evaluation = evaluateAcceptance(proposalSchedule, standardSchedule, ratePercent, standardPlan)

    // Attach schedules for frontend display
    return ok(res, {
      result: {
        proposedPlanPV: evaluation.proposalPV,
        standardPlanPV: evaluation.standardPV,
        difference: evaluation.difference,
        decision: evaluation.decision,
        conditions: evaluation.conditions,
        proposalSchedule,
        standardSchedule
      }
    })
  } catch (e) {
    console.error('POST /api/calculate error:', e)
    return bad(res, 500, 'Internal error during calculation')
  }
})

export default router