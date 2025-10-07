import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import {
  calculateByMode,
  CalculationModes,
  Frequencies,
  getPaymentMonths
} from '../services/calculationService.js'
import convertToWords from '../utils/converter.js'
import { createRequire } from 'module'
import authRoutes from './authRoutes.js'
import { pool } from './db.js'
import dealsRoutes from './dealsRoutes.js'
import unitsRoutes from './unitsRoutes.js'
import salesPeopleRoutes from './salesPeopleRoutes.js'
import commissionPoliciesRoutes from './commissionPoliciesRoutes.js'
import commissionsRoutes from './commissionsRoutes.js'
import ocrRoutes from './ocrRoutes.js'
import { getCleanupMetrics } from './runtimeMetrics.js'
import workflowRoutes from './workflowRoutes.js'
import inventoryRoutes from './inventoryRoutes.js'
import reportsRoutes from './reportsRoutes.js'
import pricingRoutes from './pricingRoutes.js' // THIS LINE IS NEW
import configRoutes from './configRoutes.js'
import standardPlanRoutes from './standardPlanRoutes.js' // NEW
import calculateRoutes from './calculateRoutes.js' // NEW

// NEW IMPORTS - Add these
import roleManagementRoutes from './roleManagement.js'
import offerWorkflowRoutes from './offerWorkflow.js'
import blockManagementRoutes from './blockManagement.js'
import customerRoutes from './customerRoutes.js'
import notificationService from './notificationService.js'
import dashboardRoutes from './dashboardRoutes.js'
import { errorHandler } from './errorHandler.js'
import logger from './utils/logger.js'
import crypto from 'crypto'
import { validate, calculateSchema, generatePlanSchema, generateDocumentSchema } from './validation.js'

const require = createRequire(import.meta.url)
const libre = require('libreoffice-convert')

const app = express()

// Correlation ID + request logging
app.use((req, res, next) => {
  // Assign a correlation ID if not present
  req.id = req.headers['x-request-id'] || crypto.randomUUID()
  const start = Date.now()

  // Log incoming request
  logger.info({
    msg: 'Incoming request',
    reqId: req.id,
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip
  })

  res.on('finish', () => {
    const ms = Date.now() - start
    logger.info({
      msg: 'Request completed',
      reqId: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: ms,
      userId: req.user?.id || null
    })
  })

  next()
})

// Helper: fetch active approval policy limit (global fallback = 5%)
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
  } catch (e) {
    // swallow; fall back
  }
  return 5
}

// Security headers
app.use(helmet())

// Configurable CORS origins via env (comma-separated), default to localhost Vite
const CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:5173'
const allowedOrigins = CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true) // allow non-browser tools
    if (allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

// JSON body limit (configurable)
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }))

// Rate limit auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
})

// Auth routes
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/deals', dealsRoutes)
app.use('/api/units', unitsRoutes)
app.use('/api/sales', salesPeopleRoutes)
app.use('/api/commission-policies', commissionPoliciesRoutes)
app.use('/api/commissions', commissionsRoutes)
app.use('/api/ocr', ocrRoutes)
app.use('/api/workflow', workflowRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/pricing', pricingRoutes) // THIS LINE IS NEW
app.use('/api/config', configRoutes)
app.use('/api/standard-plan', standardPlanRoutes) // NEW
// Mount the legacy acceptance evaluator under a non-conflicting path.
// The main calculation endpoints are defined below as POST /api/calculate and /api/generate-plan.
app.use('/api/legacy', calculateRoutes) // legacy engine (POST /api/legacy/calculate)

// NEW ROUTE REGISTRATIONS - Add these
app.use('/api/roles', roleManagementRoutes)
app.use('/api/offers', offerWorkflowRoutes)
app.use('/api/blocks', blockManagementRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/dashboard', dashboardRoutes)

// Notification endpoints
app.get('/api/notifications', authLimiter, authMiddleware, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20)
    const offset = Number(req.query.offset || 0)
    const notifications = await notificationService.getUserNotifications(req.user.id, limit, offset)
    res.json({ ok: true, notifications })
  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

app.get('/api/notifications/unread-count', authLimiter, authMiddleware, async (req, res) => {
  try {
    const count = await notificationService.getUnreadNotificationCount(req.user.id)
    res.json({ ok: true, count })
  } catch (error) {
    console.error('Get unread count error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

app.patch('/api/notifications/:id/read', authLimiter, authMiddleware, async (req, res) => {
  try {
    const notificationId = Number(req.params.id)
    await notificationService.markNotificationAsRead(notificationId, req.user.id)
    res.json({ ok: true })
  } catch (error) {
    console.error('Mark as read error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

app.patch('/api/notifications/mark-all-read', authLimiter, authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    )
    res.json({ ok: true })
  } catch (error) {
    console.error('Mark all as read error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Simple in-process notifier for hold reminders (runs hourly)
setInterval(async () => {
  try {
    const now = new Date()
    const r = await pool.query(
      `SELECT h.id, h.unit_id, h.next_notify_at
       FROM holds h
       WHERE h.status='approved' AND (h.next_notify_at IS NULL OR h.next_notify_at <= now())`
    )
    for (const row of r.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
         SELECT u.id, 'hold_reminder', 'holds', $1, 'Hold requires decision: unblock or extend.'
         FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
        [row.id]
      )
      await pool.query(
        `UPDATE holds SET next_notify_at = now() + INTERVAL '7 days' WHERE id=$1`,
        [row.id]
      )
    }
  } catch (e) {
    console.error('Hold reminder scheduler error:', e)
  }
}, 60 * 60 * 1000)

// Daily job to expire holds past expires_at (runs every 24 hours)
setInterval(async () => {
  try {
    // Expire approved holds whose expires_at is in the past, and unit not reserved
    const rows = await pool.query(
      `SELECT h.id, h.unit_id, h.payment_plan_id
       FROM holds h
       WHERE h.status='approved' AND h.expires_at IS NOT NULL AND h.expires_at < now()`
    )
    for (const h of rows.rows) {
      // Check reservation exists
      let reserved = false
      if (h.payment_plan_id) {
        const rf = await pool.query(
          `SELECT 1 FROM reservation_forms WHERE payment_plan_id=$1 AND status='approved' LIMIT 1`,
          [h.payment_plan_id]
        )
        reserved = rf.rows.length > 0
      }
      if (!reserved) {
        await pool.query('UPDATE holds SET status=\'expired\', updated_at=now() WHERE id=$1', [h.id])
        await pool.query('UPDATE units SET available=TRUE, updated_at=now() WHERE id=$1', [h.unit_id])
        // notify FMs
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           SELECT u.id, 'hold_expired', 'holds', $1, 'Hold expired automatically and unit was unblocked.'
           FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
          [h.id]
        )
      }
    }
  } catch (e) {
    console.error('Daily hold expiry job error:', e)
  }
}, 24 * 60 * 60 * 1000)

// Health endpoint (now protected by middleware below)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  })
})

// Lightweight metrics endpoint (admin can wire auth if desired)
app.get('/api/metrics', (req, res) => {
  const m = getCleanupMetrics()
  res.json({
    ok: true,
    time: new Date().toISOString(),
    cleanup: m
  })
})

// --- Schema capability check utilities ---
async function getMissingColumns(table, columns) {
  try {
    const q = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1
    `
    const r = await pool.query(q, [table])
    const present = new Set(r.rows.map(row => row.column_name))
    return columns.filter(c => !present.has(c))
  } catch (e) {
    return columns // if introspection failed, assume all missing
  }
}

async function runSchemaCheck() {
  const required = {
    units: [
      'id','code','unit_type','unit_type_id','base_price','currency','model_id','area','orientation',
      'has_garden','garden_area','has_roof','roof_area','maintenance_price','garage_price','garden_price',
      'roof_price','storage_price','available','unit_status'
    ],
    unit_types: ['id','name'],
    unit_models: [
      'id','model_name','model_code','area','orientation','has_garden','garden_area','has_roof','roof_area',
      'garage_area','garage_standard_code'
    ]
  }
  const missing = {}
  for (const [table, cols] of Object.entries(required)) {
    const miss = await getMissingColumns(table, cols)
    if (miss.length) missing[table] = miss
  }
  return missing
}

// Endpoint to report schema readiness (restricted to admin and superadmin)
app.get('/api/schema-check', requireRole(['admin','superadmin']), async (req, res) => {
  try {
    const missing = await runSchemaCheck()
    const okAll = Object.keys(missing).length === 0
    res.json({
      ok: okAll,
      missing,
      timestamp: new Date().toISOString()
    })
  } catch (e) {
    console.error('Schema check error:', e)
    res.status(500).json({ ok: false, error: { message: 'Schema check failed' } })
  }
})

// Run check at startup and log readable warning
;(async () => {
  try {
    const missing = await runSchemaCheck()
    if (Object.keys(missing).length) {
      console.warn('Database schema check: missing columns detected:')
      console.warn(JSON.stringify(missing, null, 2))
      console.warn('Apply latest migrations to avoid runtime errors.')
    } else {
      console.log('Database schema check: OK')
    }
  } catch (e) {
    console.warn('Database schema check failed to run:', e?.message || e)
  }
})()

// Enforce auth on all /api routes except /api/auth/*
import { authMiddleware, requireRole } from './authRoutes.js'
app.use((req, res, next) => {
  if (req.path.startsWith('/api/auth')) return next()
  if (req.path.startsWith('/api/')) return authMiddleware(req, res, next)
  return next()
})

app.get('/api/message', (req, res) => {
  res.json({ message: 'Hello from Express API' })
})

/**
 * Minimal validation helpers
 */
function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}
function isBoolean(v) {
  return typeof v === 'boolean'
}
function bad(res, code, message, details) {
  return res.status(code).json({
    error: { message, details },
    timestamp: new Date().toISOString()
  })
}

const allowedModes = new Set(Object.values(CalculationModes))
const allowedFrequencies = new Set(Object.values(Frequencies))

/**
 * Validate inputs payload more granularly
 */
function validateInputs(inputs) {
  const errors = []

  // Required fields
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

  // dpType and value
  if (inputs.dpType && !['amount', 'percentage'].includes(inputs.dpType)) {
    errors.push({ field: 'dpType', message: 'Must be "amount" or "percentage"' })
  }
  if (inputs.downPaymentValue != null) {
    const v = Number(inputs.downPaymentValue)
    if (!isFinite(v) || v < 0) errors.push({ field: 'downPaymentValue', message: 'Must be non-negative number' })
  }

  // Handover
  if (inputs.handoverYear != null) {
    const hy = Number(inputs.handoverYear)
    if (!Number.isInteger(hy) || hy <= 0) errors.push({ field: 'handoverYear', message: 'Must be integer >= 1' })
  }
  if (inputs.additionalHandoverPayment != null) {
    const ah = Number(inputs.additionalHandoverPayment)
    if (!isFinite(ah) || ah < 0) errors.push({ field: 'additionalHandoverPayment', message: 'Must be non-negative number' })
  }

  // Flags and arrays
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
 * Body: { mode, stdPlan, inputs }
 *
 * stdPlan: { totalPrice, financialDiscountRate, calculatedPV }
 * inputs:  {
 *   salesDiscountPercent, dpType, downPaymentValue, planDurationYears,
 *   installmentFrequency, additionalHandoverPayment, handoverYear,
 *   splitFirstYearPayments, firstYearPayments[], subsequentYears[]
 * }
 */
app.post('/api/calculate', validate(calculateSchema), async (req, res) => {
  try {
    const { mode, stdPlan, inputs, standardPricingId, unitId } = req.body || {}

    if (!mode || !allowedModes.has(mode)) {
      return bad(res, 400, 'Invalid or missing mode', { allowedModes: [...allowedModes] })
    }

    let effectiveStdPlan = null

    if (standardPricingId || unitId) {
      // Load approved standard by id or unit id
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
        // Prefer latest approved pricing from unit_model_pricing via the unit's model_id
        const r = await pool.query(
          `SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
           FROM units u
           JOIN unit_model_pricing p ON p.model_id = u.model_id
           WHERE u.id=$1 AND p.status='approved'
           ORDER BY p.id DESC
           LIMIT 1`,
          [Number(unitId)]
        )
        row = r.rows[0] || null
        // If not found, fall back to legacy standard_pricing table if present
        if (!row) {
          const r2 = await pool.query(
            `SELECT price, std_financial_rate_percent, plan_duration_years, installment_frequency
             FROM standard_pricing
             WHERE status='approved' AND unit_id=$1
             ORDER BY id DESC
             LIMIT 1`,
            [Number(unitId)]
          )
          row = r2.rows[0] || null
        }
      }
      if (!row) {
        return bad(res, 404, 'Approved standard price not found for the selected unit/model')
      }
      // Build effective standard plan from available fields
      const totalPrice = Number(row.price) || 0
      const stdRate = Number(row.std_financial_rate_percent) || 0
      effectiveStdPlan = {
        totalPrice,
        financialDiscountRate: Number.isFinite(stdRate) ? stdRate : 0,
        calculatedPV: totalPrice
      }
      // Default inputs fields from standard if not provided (when available)
      if (!isObject(req.body.inputs)) req.body.inputs = {}
      if (row.plan_duration_years != null && req.body.inputs.planDurationYears == null) {
        req.body.inputs.planDurationYears = row.plan_duration_years
      }
      if (row.installment_frequency && !req.body.inputs.installmentFrequency) {
        req.body.inputs.installmentFrequency = row.installment_frequency
      }
    } else {
      if (!isObject(stdPlan)) {
        return bad(res, 400, 'Provide either standardPricingId/unitId or stdPlan object')
      }
      // Basic presence checks
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
    const inputErrors = validateInputs(effInputs)
    if (inputErrors.length > 0) {
      return bad(res, 422, 'Invalid inputs', inputErrors)
    }

    // Role-based authority warnings only (do not block calculations)
    const role = req.user?.role
    const disc = Number(effInputs.salesDiscountPercent) || 0
    let authorityLimit = null
    if (role === 'property_consultant') authorityLimit = 2
    if (role === 'financial_manager') authorityLimit = 5
    const overAuthority = authorityLimit != null ? disc > authorityLimit : false

    // Policy limit warning only (do not block; routing handled in workflow endpoints)
    const policyLimit = await getActivePolicyLimitPercent()
    const overPolicy = disc > policyLimit

    const result = calculateByMode(mode, effectiveStdPlan, effInputs)
    return res.json({ ok: true, data: result, meta: { policyLimit, overPolicy, authorityLimit, overAuthority } })
  } catch (err) {
    console.error('POST /api/calculate error:', err)
    return bad(res, 500, 'Internal error during calculation')
  }
})

/**
 * POST /api/generate-plan
 * Body: { mode, stdPlan, inputs, language, currency? }
 * - language: 'en' or 'ar'
 * - currency: optional. For English, can be code (EGP, USD, SAR, EUR, AED, KWD) or full name (e.g., "Egyptian Pounds")
 * Returns: { ok: true, schedule: [{label, month, amount, writtenAmount}], totals, meta }
 */
app.post('/api/generate-plan', validate(generatePlanSchema), async (req, res) => {
  try {
    const { mode, stdPlan, inputs, language, currency, languageForWrittenAmounts, standardPricingId, unitId } = req.body || {}
    if (!mode || !allowedModes.has(mode)) {
      return bad(res, 400, 'Invalid or missing mode', { allowedModes: [...allowedModes] })
    }

    let effectiveStdPlan = null
    const effInputs = req.body.inputs || inputs || {}

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
        // Prefer latest approved pricing from unit_model_pricing via the unit's model_id
        const r = await pool.query(
          `SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
           FROM units u
           JOIN unit_model_pricing p ON p.model_id = u.model_id
           WHERE u.id=$1 AND p.status='approved'
           ORDER BY p.id DESC
           LIMIT 1`,
          [Number(unitId)]
        )
        row = r.rows[0] || null
        // Fallback to legacy table if present
        if (!row) {
          const r2 = await pool.query(
            `SELECT price, std_financial_rate_percent, plan_duration_years, installment_frequency
             FROM standard_pricing
             WHERE status='approved' AND unit_id=$1
             ORDER BY id DESC
             LIMIT 1`,
            [Number(unitId)]
          )
          row = r2.rows[0] || null
        }
      }
      if (!row) {
        return bad(res, 404, 'Approved standard price not found for the selected unit/model')
      }
      effectiveStdPlan = {
        totalPrice: Number(row.price) || 0,
        financialDiscountRate: Number(row.std_financial_rate_percent) || 0,
        calculatedPV: Number(row.price) || 0
      }
      if (effInputs.planDurationYears == null && row.plan_duration_years != null) effInputs.planDurationYears = row.plan_duration_years
      if (!effInputs.installmentFrequency && row.installment_frequency) effInputs.installmentFrequency = row.installment_frequency
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

    // Backward compatibility: support legacy languageForWrittenAmounts
    const langInput = language || languageForWrittenAmounts || 'en'
    const lang = String(langInput).toLowerCase().startsWith('ar') ? 'ar' : 'en'

    // Enforce role-based discount limits
    const role = req.user?.role
    const disc = Number(effInputs.salesDiscountPercent) || 0
    if (role === 'property_consultant' && disc > 2) {
      return bad(res, 403, 'Sales consultants can apply a maximum discount of 2%.')
    }
    if (role === 'financial_manager' && disc > 5) {
      return bad(res, 403, 'Financial managers can apply a maximum discount of 5% (requires CEO approval in workflow if over 2%).')
    }

    const result = calculateByMode(mode, effectiveStdPlan, effInputs)

    // NPV tolerance warning check
    const policyLimit = await getActivePolicyLimitPercent()
    const npvTolerancePercent = 70 // default; could be read per project/type in future
    const toleranceValue = (Number(effectiveStdPlan.totalPrice) || 0) * (npvTolerancePercent / 100)
    const npvWarning = (Number(result.calculatedPV) || 0) < toleranceValue

    const schedule = []
    const pushEntry = (label, month, amount, baseDateStr) => {
      const amt = Number(amount) || 0
      if (amt <= 0) return
      const m = Number(month) || 0
      let dueDate = null
      if (baseDateStr) {
        const base = new Date(baseDateStr)
        if (!isNaN(base.getTime())) {
          const d = new Date(base)
          d.setMonth(d.getMonth() + m)
          dueDate = d.toISOString().slice(0, 10) // YYYY-MM-DD
        }
      }
      schedule.push({
        label,
        month: m,
        amount: amt,
        date: dueDate,
        writtenAmount: convertToWords(amt, lang, { currency })
      })
    }

    // Base date for computing absolute dates (optional)
    const baseDate = effInputs.baseDate || effInputs.contractDate || null

    // Down payment or split first year
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

    // Additional one-time fees (NOT included in PV calculation — appended only to schedule)
    const maintAmt = Number(effInputs.maintenancePaymentAmount) || 0
    const maintMonth = Number(effInputs.maintenancePaymentMonth) || 0
    if (maintAmt > 0) pushEntry('Maintenance Fee', maintMonth, maintAmt, baseDate)

    const garAmt = Number(effInputs.garagePaymentAmount) || 0
    const garMonth = Number(effInputs.garagePaymentMonth) || 0
    if (garAmt > 0) pushEntry('Garage Fee', garMonth, garAmt, baseDate)

    const eqMonths = result.equalInstallmentMonths || []
    const eqAmt = Number(result.equalInstallmentAmount) || 0
    eqMonths.forEach((m, i) => pushEntry('Equal Installment', m, eqAmt, baseDate))

    schedule.sort((a, b) => (a.month - b.month) || a.label.localeCompare(b.label))

    const totals = {
      count: schedule.length,
      totalNominal: schedule.reduce((s, e) => s + e.amount, 0)
    }

    return res.json({ ok: true, schedule, totals, meta: { ...result.meta, npvWarning } })
  } catch (err) {
    console.error('POST /api/generate-plan error:', err)
    return bad(res, 500, 'Internal error during plan generation')
  }
})

/**
 * POST /api/generate-document
 * Body: {
 *   templateName: string,              // must exist in /api/templates
 *   data: object,                      // flat key/value map for placeholders
 *   language?: 'en'|'ar',              // affects *_words auto-fields using convertToWords
 *   currency?: string                  // optional currency name/code for English words
 * }
 * Notes:
 * - Placeholders in the .docx should use Autocrat-style delimiters: <<placeholder_name>>
 * - Service will also add *_words fields for numeric values in data using the requested language
 */
app.post('/api/generate-document', validate(generateDocumentSchema), async (req, res) => {
  try {
    let { templateName, documentType, deal_id, data, language, currency } = req.body || {}
    const role = req.user?.role

    // Accept either templateName or documentType; enforce role-based rules when documentType is used
    const type = documentType && String(documentType).trim()
    // Accept either explicit "data" or the entire body as data if not provided
    let docData = isObject(data) ? data : (isObject(req.body) ? { ...req.body } : null)
    if (!docData) {
      return bad(res, 400, 'data must be an object with key/value pairs for placeholders')
    }
    // Remove control keys from docData so they don't appear as placeholders
    delete docData.templateName
    delete docData.documentType
    delete docData.deal_id

    // Role-based access control and default template mapping
    const TYPE_RULES = {
      pricing_form: {
        allowedRoles: ['property_consultant', 'sales_manager'],
        defaultTemplate: 'pricing_form.docx'
      },
      reservation_form: {
        allowedRoles: ['financial_admin'],
        defaultTemplate: 'reservation_form.docx'
      },
      contract: {
        allowedRoles: ['contract_person'],
        defaultTemplate: 'contract.docx'
      }
    }

    if (type) {
      const rules = TYPE_RULES[type]
      if (!rules) {
        return bad(res, 400, `Unknown documentType: ${type}`)
      }
      if (!rules.allowedRoles.includes(role)) {
        return bad(res, 403, `Forbidden: role ${role} cannot generate ${type}`)
      }
      // If a deal_id is provided, ensure the deal is approved before allowing generation
      if (deal_id != null) {
        const id = Number(deal_id)
        if (!Number.isFinite(id) || id <= 0) {
          return bad(res, 400, 'deal_id must be a positive number')
        }
        const dq = await pool.query('SELECT status FROM deals WHERE id=$1', [id])
        if (dq.rows.length === 0) {
          return bad(res, 404, 'Deal not found')
        }
        if (dq.rows[0].status !== 'approved') {
          return bad(res, 400, 'Deal must be approved before generating this document')
        }
        // Enforce override if required (acceptable criteria not met and override not approved)
        const dealRow = dq.rows[0]
        // If needs_override is true, require override_approved_at to be set
        if (dealRow.needs_override === true && !dealRow.override_approved_at) {
          return bad(res, 403, 'Top-Management override required before generating this document')
        }
      }
      // Use default template if templateName not provided
      if (!templateName) {
        templateName = rules.defaultTemplate
      }
    } else {
      // If not using documentType, require explicit templateName
      if (!templateName || typeof templateName !== 'string') {
        return bad(res, 400, 'Provide either documentType or templateName (string)')
      }
    }

    const lang = String(language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'

    // Resolve template path safely within /api/templates
    const templatesDir = path.join(process.cwd(), 'api', 'templates')
    const requestedPath = path.join(templatesDir, templateName)
    if (!requestedPath.startsWith(templatesDir)) {
      return bad(res, 400, 'Invalid template path')
    }
    if (!fs.existsSync(requestedPath)) {
      return bad(res, 404, `Template not found: ${templateName}`)
    }

    // Build rendering data:
    // - Original keys
    // - For numeric fields, add "<key>_words" using the convertToWords helper
    const renderData = { ...data }
    for (const [k, v] of Object.entries(data)) {
      const num = Number(v)
      if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(num))) {
        renderData[`${k}_words`] = convertToWords(num, lang, { currency })
      }
    }

    // Read, compile and render the docx
    const content = fs.readFileSync(requestedPath, 'binary')
    const zip = new PizZip(content)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '<<', end: '>>' } // Autocrat-style placeholders
    })

    doc.setData(renderData)
    try {
      doc.render()
    } catch (e) {
      console.error('Docxtemplater render error:', e)
      return bad(res, 400, 'Failed to render document. Check placeholders and provided data.')
    }

    const docxBuffer = doc.getZip().generate({ type: 'nodebuffer' })
    // Convert the filled DOCX to PDF
    let pdfBuffer
    try {
      pdfBuffer = await new Promise((resolve, reject) => {
        libre.convert(docxBuffer, '.pdf', undefined, (err, done) => {
          if (err) return reject(err)
          resolve(done)
        })
      })
    } catch (convErr) {
      console.error('DOCX -> PDF conversion error:', convErr)
      return bad(res, 500, 'Failed to convert DOCX to PDF')
    }

    const outName = path.basename(templateName, path.extname(templateName)) + '-filled.pdf'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`)
    return res.send(pdfBuffer)
  } catch (err) {
    console.error('POST /api/generate-document error:', err)
    return bad(res, 500, 'Internal error during document generation')
  }
})

// Global error handler
app.use(errorHandler)

export default app