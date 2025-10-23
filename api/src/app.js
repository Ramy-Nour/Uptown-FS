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
import puppeteer from 'puppeteer'
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

// Puppeteer singleton (reuse browser instance to reduce latency)
let browserPromise = null
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
  }
  return browserPromise
}

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
// Also allow GitHub Codespaces subdomains by default so the Vite dev server (port 5173)
// can call the API (port 3000) across *.app.github.dev.
const CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:5173'
const allowedOrigins = CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
const isAllowedOrigin = (origin) => {
  if (!origin) return true // non-browser tools
  try {
    // Exact allow-list
    if (allowedOrigins.includes(origin)) return true
    // Local dev
    if (origin.startsWith('http://localhost:')) return true
    if (origin.startsWith('http://127.0.0.1:')) return true
    // GitHub Codespaces (both API and Vite dev server live under *.app.github.dev)
    const { hostname } = new URL(origin)
    if (hostname.endsWith('.app.github.dev')) return true
  } catch { /* ignore parse errors */ }
  return false
}
app.use(cors({
  origin: function (origin, callback) {
    const ok = isAllowedOrigin(origin)
    // Return false rather than throwing to avoid noisy errors on preflight
    return callback(null, ok)
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
  // Public endpoints: allow without auth
  if (req.path.startsWith('/api/auth')) return next()
  if (req.path === '/api/health' || req.path === '/api/message' || req.path === '/api/metrics') return next()
  // Protect all other /api routes
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
 * Frequency normalization utility
 * - trims spaces
 * - accepts case-insensitive variants
 * - maps 'biannually' -> 'bi-annually'
 * - validates against engine enum; returns null if unknown
 */
function normalizeFrequency(s) {
  if (!s) return null
  const v = String(s).trim().toLowerCase()
  let norm = v
  if (v === 'biannually') norm = 'bi-annually'
  // Direct matches to enum values
  const candidates = new Set(Object.values(Frequencies))
  if (candidates.has(norm)) return norm
  return null
}

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
      // Load approved standard pricing components (nominal) and global standard plan (rate/duration/freq)
      let priceRow = null
      if (standardPricingId) {
        // Legacy path: keep for compatibility
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
        // Preferred: latest approved pricing from model
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

      // Sum total excluding maintenance
      const totalPrice =
        (Number(priceRow.price) || 0) +
        (Number(priceRow.garden_price) || 0) +
        (Number(priceRow.roof_price) || 0) +
        (Number(priceRow.storage_price) || 0) +
        (Number(priceRow.garage_price) || 0)

      // Global standard plan (authoritative for rate/duration/frequency)
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

      // Determine validity of stdCfg
      const effRateRaw = stdCfg?.std_financial_rate_percent
      const durRaw = stdCfg?.plan_duration_years
      const freqRaw = stdCfg?.installment_frequency
      const effRate = Number(effRateRaw)
      const durYears = Number(durRaw)
      const freqCalc = normalizeFrequency(freqRaw)

      // Real-world: require a positive annual rate (> 0), valid duration, and normalized frequency
      const rateValid = Number.isFinite(effRate) && effRate > 0
      const durValid = Number.isInteger(durYears) && durYears >= 1
      const freqValid = !!freqCalc

      let usedStoredFMpv = false
      let computedPVEqualsTotalNominal = false
      let annualRateUsedMeta = null
      let durationYearsUsedMeta = null
      let frequencyUsedMeta = null

      // Prefer per-pricing financial settings when available; then fall back to Active Standard Plan; then FM stored PV
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
      } catch (e) { /* ignore */ }

      const rowRateValid = Number.isFinite(rowRate) && rowRate > 0
      const rowDurValid = Number.isInteger(rowDur) && rowDur >= 1
      const rowFreqValid = !!rowFreq

      if (rowRateValid && rowDurValid && rowFreqValid) {
        // Compute the true Standard PV by running the standard structure (including Down Payment) through the engine.
        // We intentionally use the request's inputs Down Payment definition here so Target-PV modes can solve back to the Standard Price when consultants
        // enter the same DP amount/percent used by the standard plan configuration.
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
        // Policy: When a unit/model is selected, per-pricing financial settings are REQUIRED.
        // Do not fall back to Active Standard Plan for calculations in unit/model flows.
        return bad(res, 422,
          'Per-pricing financial settings are required (std_financial_rate_percent, plan_duration_years, installment_frequency). Configure and approve them for the selected unit/model.'
        )
      } else {
        // Fallback: FM stored PV
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
            } catch (e) { /* column may not exist; ignore */ }

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
              } catch (e) { /* ignore */ }
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
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }

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

      // Default inputs fields from standard if not provided
      if (!isObject(req.body.inputs)) req.body.inputs = {}
      if (durValid && req.body.inputs.planDurationYears == null) {
        req.body.inputs.planDurationYears = durYears
      }
      if (freqValid && !req.body.inputs.installmentFrequency) {
        req.body.inputs.installmentFrequency = frequencyUsedMeta
      }

      // Diagnostics meta attached via result later
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
      // Only accept stdPlan when no unitId/standardPricingId is provided
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

    // Normalize frequency strings in inputs before validation/use
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
    return res.json({ ok: true, data: result, meta: { policyLimit, overPolicy, authorityLimit, overAuthority, ...(req._stdMeta || {}) } })
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

    // Normalize main input frequency before any switch logic
    if (effInputs.installmentFrequency) {
      const nf = normalizeFrequency(effInputs.installmentFrequency)
      if (!nf) {
        return bad(res, 422, 'Invalid inputs', [{ field: 'installmentFrequency', message: 'Invalid frequency' }])
      }
      effInputs.installmentFrequency = nf
    }

    // Will hold auto-resolved maintenance amount when unitId provided
    let maintFromPricing = 0

    if (standardPricingId || unitId) {
      // Resolve nominal base from approved pricing and authoritative rate/duration/frequency from global standard_plan
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
        // Try to also fetch stored FM PV/rate if columns exist
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
          // Fallback when optional columns don't exist
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

      // Persist maintenance from pricing to use later if consultant didn't enter one
      maintFromPricing = Number(row.maintenance_price) || 0

      const totalPrice =
        (Number(row.price) || 0) +
        (Number(row.garden_price) || 0) +
        (Number(row.roof_price) || 0) +
        (Number(row.storage_price) || 0) +
        (Number(row.garage_price) || 0)

      // Fetch global standard plan (active)
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

      // Real-world: require a positive annual rate (> 0), valid duration, and normalized frequency
      const rateValid = Number.isFinite(effRate) && effRate > 0
      const durValid = Number.isInteger(durYears) && durYears >= 1
      const freqValid = !!freqCalc

      let usedStoredFMpv = false
      let computedPVEqualsTotalNominal = false
      let annualRateUsedMeta = null
      let durationYearsUsedMeta = null
      let frequencyUsedMeta = null

      // Prefer per-pricing financial settings when available; then Active Standard Plan; then FM stored PV
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
      } catch (e) { /* ignore */ }

      const rowRateValid = Number.isFinite(rowRate) && rowRate > 0
      const rowDurValid = Number.isInteger(rowDur) && rowDur >= 1
      const rowFreqValid = !!rowFreq

      if (rowRateValid && rowDurValid && rowFreqValid) {
        // Compute the true Standard PV by running the standard structure (including Down Payment) through the engine,
        // using the current request's DP definition to avoid mismatches with the form.
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
        // Policy: When a unit/model is selected, per-pricing financial settings are REQUIRED.
        // Do not fall back to Active Standard Plan for plan generation in unit/model flows.
        return bad(res, 422,
          'Per-pricing financial settings are required (std_financial_rate_percent, plan_duration_years, installment_frequency). Configure and approve them for the selected unit/model.'
        )
      } else {
        // Fallback: FM stored PV (if per-pricing terms are not available/valid)
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
            } catch (e) { /* ignore */ }

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
              } catch (e) { /* ignore */ }
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
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }

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

      // Default inputs from stdCfg when not provided
      if (stdCfg && effInputs.planDurationYears == null && durValid) effInputs.planDurationYears = durYears
      if (stdCfg && !effInputs.installmentFrequency && freqValid) effInputs.installmentFrequency = freqCalc
    } else {
      // Only accept stdPlan when unitId/standardPricingId not supplied
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
    // Maintenance Deposit amount ALWAYS sourced from unit model pricing when a unit is selected; consultant input is ignored.
    let maintAmt = (Number(unitId) > 0) ? (Number(maintFromPricing) || 0) : (Number(effInputs.maintenancePaymentAmount) || 0)

    // Support explicit maintenance calendar date; otherwise compute by month offset (default: handover)
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
          maintMonth = years * 12 + months + (days >= 0 ? 0 : -1) // adjust if due day before base day
        }
      } catch { /* ignore and fall back */ }
    }
    if (!Number.isFinite(maintMonth)) {
      maintMonth = Number(effInputs.maintenancePaymentMonth)
      if (!Number.isFinite(maintMonth) || maintMonth < 0) {
        const hy = Number(effInputs.handoverYear) || 0
        // Default to handover; if handoverYear is not set/zero, use 12 months by policy.
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

    // Totals: provide both excluding and including Maintenance Deposit
    const totalIncl = schedule.reduce((s, e) => s + e.amount, 0)
    const totalExcl = schedule
      .filter(e => e.label !== 'Maintenance Deposit' && e.label !== 'Maintenance Fee')
      .reduce((s, e) => s + e.amount, 0)
    const totals = {
      count: schedule.length,
      totalNominal: totalIncl, // preserve existing meaning (including all)
      totalNominalIncludingMaintenance: totalIncl,
      totalNominalExcludingMaintenance: totalExcl
    }

    // ----- Dynamic acceptance thresholds (TM-approved) -----
    let thresholds = {
      firstYearPercentMin: null,
      firstYearPercentMax: null,
      secondYearPercentMin: null,
      secondYearPercentMax: null,
      thirdYearPercentMin: null,
      thirdYearPercentMax: null,
      handoverPercentMin: null,
      handoverPercentMax: null,
      pvTolerancePercent: null
    }
    try {
      const tr = await pool.query('SELECT * FROM payment_thresholds ORDER BY id DESC LIMIT 1')
      if (tr.rows.length) {
        const row = tr.rows[0]
        thresholds.firstYearPercentMin = row.first_year_percent_min == null ? null : Number(row.first_year_percent_min)
        thresholds.firstYearPercentMax = row.first_year_percent_max == null ? null : Number(row.first_year_percent_max)
        thresholds.secondYearPercentMin = row.second_year_percent_min == null ? null : Number(row.second_year_percent_min)
        thresholds.secondYearPercentMax = row.second_year_percent_max == null ? null : Number(row.second_year_percent_max)
        thresholds.thirdYearPercentMin = row.third_year_percent_min == null ? null : Number(row.third_year_percent_min)
        thresholds.thirdYearPercentMax = row.third_year_percent_max == null ? null : Number(row.third_year_percent_max)
        thresholds.handoverPercentMin = row.handover_percent_min == null ? null : Number(row.handover_percent_min)
        thresholds.handoverPercentMax = row.handover_percent_max == null ? null : Number(row.handover_percent_max)
        thresholds.pvTolerancePercent = row.pv_tolerance_percent == null ? null : Number(row.pv_tolerance_percent)
      }
    } catch (e) {
      // keep defaults
    }
    // Fallback sensible defaults if null (mirror ver6.2)
    if (thresholds.firstYearPercentMin == null) thresholds.firstYearPercentMin = 35
    if (thresholds.secondYearPercentMin == null) thresholds.secondYearPercentMin = 50
    if (thresholds.thirdYearPercentMin == null) thresholds.thirdYearPercentMin = 65
    if (thresholds.handoverPercentMin == null) thresholds.handoverPercentMin = 65
    if (thresholds.pvTolerancePercent == null) thresholds.pvTolerancePercent = 100

    // ----- Standard PV baseline -----
    const annualRate = Number(effectiveStdPlan.financialDiscountRate) || 0
    const monthlyRate = annualRate > 0 ? Math.pow(1 + annualRate / 100, 1 / 12) - 1 : 0
    let standardPV = Number(effectiveStdPlan.calculatedPV) || 0
    

    // ----- Proposed PV from calculation engine -----
    const proposedPV = Number(result.calculatedPV) || 0
    const pvTolerancePercent = thresholds.pvTolerancePercent
    // Pass when Proposed PV is GREATER THAN OR EQUAL to the allowed floor (Standard PV / tolerance if tolerance<100?).
    // Business rule here: Proposed PV must be at least Standard PV (within epsilon). Tolerance >=100 means relax upward only.
    const EPS = 1e-2 // 0.01 currency units to absorb float noise
    const pvPass = proposedPV + EPS >= (standardPV * (pvTolerancePercent / 100))
    const pvDifference = standardPV - proposedPV

    // ----- Conditions based on cumulative percentages -----
    // Use nominal base excluding non-PV extras; include handover in base as per ver6.2 intent
    const totalNominalForConditions = (Number(result.totalNominalPrice) || 0) + (Number(effInputs.additionalHandoverPayment) || 0)

    // Helper to compute cumulative at month cutoff
    // Include Garage amounts in acceptance totals, exclude Maintenance Deposit only (as per requirements)
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

    // Condition 1: Payment After 1 Year ≥ Target (fallback to threshold% of standard price if target not present)
    const stdTargetY1 = Number(effectiveStdPlan?.targetPaymentAfter1Year) || ((Number(effectiveStdPlan.totalPrice) || 0) * (thresholds.firstYearPercentMin / 100))
    const cond1Pass = paidY1 >= stdTargetY1 - 1e-9

    const withinRange = (value, min, max) => {
      if (min != null && Number(value) < Number(min)) return false
      if (max != null && Number(value) > Number(max)) return false
      return true
    }

    const cond2Pass = withinRange(percentHandover, thresholds.handoverPercentMin, thresholds.handoverPercentMax)
    const cond3Pass = withinRange(percentY1, thresholds.firstYearPercentMin, thresholds.firstYearPercentMax)
    const cond4Pass = withinRange(percentY2, thresholds.secondYearPercentMin, thresholds.secondYearPercentMax)
    const cond5Pass = withinRange(percentY3, thresholds.thirdYearPercentMin, thresholds.thirdYearPercentMax)

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
          required: { min: thresholds.handoverPercentMin, max: thresholds.handoverPercentMax },
          actual: { percent: percentHandover, amount: paidByHandover }, handoverYear: Number(effInputs.handoverYear) || 0
        },
        { key: 'cumulative_y1', label: 'Cumulative by End of Year 1', status: cond3Pass ? 'PASS' : 'FAIL',
          required: { min: thresholds.firstYearPercentMin, max: thresholds.firstYearPercentMax },
          actual: { percent: percentY1, amount: paidY1 }
        },
        { key: 'cumulative_y2', label: 'Cumulative by End of Year 2', status: cond4Pass ? 'PASS' : 'FAIL',
          required: { min: thresholds.secondYearPercentMin, max: thresholds.secondYearPercentMax },
          actual: { percent: percentY2, amount: paidY2 }
        },
        { key: 'cumulative_y3', label: 'Cumulative by End of Year 3', status: cond5Pass ? 'PASS' : 'FAIL',
          required: { min: thresholds.thirdYearPercentMin, max: thresholds.thirdYearPercentMax },
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
 * - Service will also add "*_words" fields for numeric values in data using the requested language
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
        // Client's offer — Property Consultant only
        allowedRoles: ['property_consultant'],
        // No default template currently present; require templateName explicitly or add client_offer.docx later
        defaultTemplate: 'client_offer.docx'
      },
      reservation_form: {
        // Reservation form — Financial Admin only
        allowedRoles: ['financial_admin'],
        // Mapped to provided template in /api/templates
        defaultTemplate: 'Pricing Form G.docx'
      },
      contract: {
        // Contract form — Contracts Admin (person) only
        allowedRoles: ['contract_person'],
        // Map to actual file available in /api/templates
        defaultTemplate: 'Uptown Residence Contract.docx'
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

// Server-rendered Client Offer PDF
app.post('/api/documents/client-offer', authLimiter, authMiddleware, requireRole(['property_consultant']), async (req, res) => {
  try {
    // Accept either direct payload or derive from deal_id
    let {
      language,
      currency,
      buyers,
      schedule,
      totals,
      offer_date,
      first_payment_date,
      unit
    } = req.body || {}

    // Determine consultant (creator)
    // Initialize from authenticated request context first
    let consultant = {
      name: (req.user?.name && String(req.user.name).trim()) ? req.user.name : null,
      email: req.user?.email || null
    }

    const dealId = Number(req.body?.deal_id)
    // If a deal_id is provided, prefer the deal's creator from DB (uses users.name and email only)
    if (Number.isFinite(dealId) && dealId > 0) {
      try {
        const q = await pool.query(`
          SELECT u.email,
                 COALESCE(NULLIF(TRIM(u.name),''), u.email) AS full_name
          FROM deals d
          JOIN users u ON u.id = d.created_by
          WHERE d.id=$1
          LIMIT 1
        `, [dealId])
        if (q.rows.length) {
          consultant = { name: q.rows[0].full_name || null, email: q.rows[0].email || null }
        }
      } catch { /* ignore */ }
    }

    // If still missing, read current user from DB using name/email columns only
    if (!consultant.email || !consultant.name) {
      try {
        const u = await pool.query(`
          SELECT email,
                 COALESCE(NULLIF(TRIM(name),''), email) AS full_name
          FROM users WHERE id=$1 LIMIT 1
        `, [req.user.id])
        if (u.rows.length) {
          consultant = {
            name: u.rows[0].full_name || consultant.name || null,
            email: u.rows[0].email || consultant.email || null
          }
        }
      } catch { /* ignore */ }
    }

    // If deal_id provided, try to derive from DB
    if (!buyers || !schedule) {
      if (Number.isFinite(dealId) && dealId > 0) {
        const dr = await pool.query('SELECT * FROM deals WHERE id=$1', [dealId])
        if (dr.rows.length) {
          const d = dr.rows[0]
          try {
            const calc = d.details?.calculator || {}
            // buyers[]
            const num = Math.min(Math.max(Number(calc?.clientInfo?.number_of_buyers) || 1, 1), 4)
            const bb = []
            for (let i = 1; i <= num; i++) {
              const sfx = i === 1 ? '' : `_${i}`
              bb.push({
                buyer_name: calc?.clientInfo?.[`buyer_name${sfx}`] || '',
                phone_primary: calc?.clientInfo?.[`phone_primary${sfx}`] || '',
                phone_secondary: calc?.clientInfo?.[`phone_secondary${sfx}`] || '',
                email: calc?.clientInfo?.[`email${sfx}`] || ''
              })
            }
            buyers = buyers || bb
            // schedule
            if (!schedule && calc?.generatedPlan?.schedule) {
              schedule = calc.generatedPlan.schedule
              totals = calc.generatedPlan.totals || { totalNominal: 0 }
            }
            // dates and unit
            offer_date = offer_date || calc?.inputs?.offerDate || new Date().toISOString().slice(0, 10)
            first_payment_date = first_payment_date || calc?.inputs?.firstPaymentDate || offer_date
            unit = unit || {
              unit_code: calc?.unitInfo?.unit_code || '',
              unit_type: calc?.unitInfo?.unit_type || ''
            }
            language = language || (req.body?.language || 'en')
            currency = currency || (req.body?.currency || '')
          } catch {
            // fallback to request body only
          }
        }
      }
    }

    // Minimal required fields
    buyers = Array.isArray(buyers) && buyers.length ? buyers : []
    schedule = Array.isArray(schedule) ? schedule : []
    totals = totals || { totalNominal: schedule.reduce((s, e) => s + (Number(e.amount) || 0), 0) }
    language = (String(language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en')
    const rtl = language === 'ar'
    const dir = rtl ? 'rtl' : 'ltr'

    // Localize schedule labels when Arabic
    function arLabel(label) {
      if (!label) return ''
      const L = String(label).toLowerCase()
      if (L.includes('down payment')) return 'دفعة التعاقد'
      if (L.includes('equal installment')) return 'قسط متساوي'
      if (L.includes('handover')) return 'التسليم'
      if (L.includes('maintenance')) return 'وديعة الصيانة'
      if (L.includes('garage fee')) return 'مصروفات الجراج'
      if (L.startsWith('year')) {
        // examples: "Year 2 (monthly)" — simplify to Arabic phrase
        const parts = /year\s+(\d+)\s*\(([^)]+)\)?/i.exec(label)
        if (parts) {
          const y = parts[1]
          const f = parts[2].toLowerCase()
          let fAr = 'سنوي'
          if (f.includes('monthly')) fAr = 'شهري'
          else if (f.includes('quarter')) fAr = 'ربع سنوي'
          else if (f.includes('bi')) fAr = 'نصف سنوي'
          return `سنة ${y} (${fAr})`
        }
      }
      return label // fallback
    }

    // Build HTML
    const css = `
      <style>
        @page { size: A4; margin: 16mm 14mm; }
        html { direction: ${dir}; }
        body { font-family: "Noto Naskh Arabic", "Amiri", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        h1,h2,h3 { margin: 0 0 8px; }
        .header { display:flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .brand { font-size: 16px; color: #A97E34; font-weight: 700; }
        .meta { color: #6b7280; font-size: 12px; ${rtl ? 'text-align:right;' : ''}}
        .section { margin: 14px 0; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
        th { text-align: ${rtl ? 'right' : 'left'}; background: #f6efe3; color: #5b4630; font-size: 12px; border-bottom: 1px solid #ead9bd; padding: 8px; }
        td { font-size: 12px; border-bottom: 1px solid #f2e8d6; padding: 8px; page-break-inside: avoid; }
        .totals { margin-top: 8px; padding: 8px; border: 1px solid #ead9bd; border-radius: 8px; background: #fbfaf7; }
        .buyers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .buyer { border: 1px solid #ead9bd; border-radius: 8px; padding: 8px; background: #fff; }
        .foot { margin-top: 12px; color:#6b7280; font-size: 11px; }
      </style>
    `

    const f = (s) => Number(s || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const todayTs = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const title = rtl ? 'عرض السعر للعميل' : 'Client Offer'
    const tBuyers = rtl ? 'العملاء' : 'Clients'
    const tSchedule = rtl ? 'خطة السداد' : 'Payment Plan'
    const tTotals = rtl ? 'الإجمالي' : 'Totals'
    const tOfferDate = rtl ? 'تاريخ العرض' : 'Offer Date'
    const tFirstPayment = rtl ? 'تاريخ أول دفعة' : 'First Payment'
    const tUnit = rtl ? 'الوحدة' : 'Unit'
    const tMonth = rtl ? 'الشهر' : 'Month'
    const tLabel = rtl ? 'الوصف' : 'Label'
    const tAmount = rtl ? 'القيمة' : 'Amount'
    const tDate = rtl ? 'التاريخ' : 'Date'
    const tAmountWords = rtl ? 'المبلغ بالحروف' : 'Amount in Words'
    const tConsultant = rtl ? 'المستشار العقاري' : 'Property Consultant'
    const tEmail = rtl ? 'البريد الإلكتروني' : 'Email'

    const buyersHtml = buyers.map((b, idx) => `
      <div class="buyer">
        <div><strong>${rtl ? 'العميل' : 'Buyer'} ${idx + 1}:</strong> ${b.buyer_name || '-'}</div>
        <div><strong>${rtl ? 'الهاتف' : 'Phone'}:</strong> ${[b.phone_primary, b.phone_secondary].filter(Boolean).join(' / ') || '-'}</div>
        <div><strong>${tEmail}:</strong> ${b.email || '-'}</div>
      </div>
    `).join('')

    // Ensure writtenAmount present; if not, compute
    const langForWords = language
    const scheduleRows = schedule.map((r) => {
        const labelText = rtl ? arLabel(r.label || '') : (r.label || '')
        const amount = Number(r.amount) || 0
        // Always render words according to the requested language, ignoring any client-provided wording.
        const words = convertToWords(amount, langForWords, { currency })
        return `
          <tr>
            <td>${Number(r.month) || 0}</td>
            <td>${labelText}</td>
            <td style="text-align:${rtl ? 'left' : 'right'}">${f(amount)} ${currency || ''}</td>
            <td>${r.date || ''}</td>
            <td>${words || ''}</td>
          </tr>
        `
      }).join('')

    const unitLine = unit ? `${unit.unit_code || ''} ${unit.unit_type ? '— ' + unit.unit_type : ''}`.trim() : ''
    const consultantLine = (consultant.name || consultant.email)
      ? `<div class="meta"><strong>${tConsultant}:</strong> ${[consultant.name, consultant.email].filter(Boolean).join(' — ')}</div>`
      : ''

    // Unit pricing breakdown (auto-resolve from DB when unit_id is provided)
    let upb = req.body?.unit_pricing_breakdown || req.body?.unitPricingBreakdown || null
    try {
      const unitId = Number(unit?.unit_id)
      if (Number.isFinite(unitId) && unitId > 0) {
        const r = await pool.query(`
          SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
          FROM units u
          JOIN unit_model_pricing p ON p.model_id = u.model_id
          WHERE u.id=$1 AND p.status='approved'
          ORDER BY p.id DESC
          LIMIT 1
        `, [unitId])
        if (r.rows.length) {
          const row = r.rows[0]
          // Build effective breakdown from DB, prefer client-provided values when present
          upb = {
            base: Number((upb && upb.base) ?? row.price) || 0,
            garden: Number((upb && upb.garden) ?? row.garden_price) || 0,
            roof: Number((upb && upb.roof) ?? row.roof_price) || 0,
            storage: Number((upb && upb.storage) ?? row.storage_price) || 0,
            garage: Number((upb && upb.garage) ?? row.garage_price) || 0,
            maintenance: Number((upb && upb.maintenance) ?? row.maintenance_price) || 0
          }
        }
      }
    } catch { /* ignore and continue with provided breakdown */ }

    let unitTotalsBox = ''
    if (upb && typeof upb === 'object') {
      const rows = []
      const L = (en, ar) => rtl ? ar : en
      const addRow = (label, val) => {
        const n = Number(val) || 0
        if (!(n > 0) && label !== 'unit_type') return
        rows.push(`
          <tr>
            <td style="padding:6px 8px; background:#ead9bd; font-weight:700;">${label}</td>
            <td style="padding:6px 8px; text-align:${rtl ? 'left' : 'right'}; white-space:nowrap; min-width:120px;">${label === 'unit_type' ? (unit?.unit_type || '') : f(n)} ${label === 'unit_type' ? '' : (currency || '')}</td>
          </tr>
        `)
      }
      addRow(L('Unit Type', 'نوع الوحدة'), 1) // placeholder to render unit type on the right cell
      addRow(L('Price', 'السعر'), upb.base)
      if (Number(upb.garden || 0) > 0) addRow(L('Garden', 'الحديقة'), upb.garden)
      if (Number(upb.roof || 0) > 0) addRow(L('Roof', 'السطح'), upb.roof)
      if (Number(upb.storage || 0) > 0) addRow(L('Storage', 'غرفة التخزين'), upb.storage)
      if (Number(upb.garage || 0) > 0) addRow(L('Garage', 'الجراج'), upb.garage)
      // Maintenance Deposit from breakdown (auto-fetched above if unit_id present)
      const maint = Number(upb.maintenance || 0)
      if (maint > 0) addRow(L('Maintenance Deposit', 'وديعة الصيانة'), maint)
      const totalExcl = (Number(upb.base||0)+Number(upb.garden||0)+Number(upb.roof||0)+Number(upb.storage||0)+Number(upb.garage||0))
      const totalIncl = totalExcl + maint
      rows.push(`
        <tr>
          <td style="padding:6px 8px; background:#cba86c; font-weight:900;">${L('Total (excluding Maintenance Deposit)', 'الإجمالي (بدون وديعة الصيانة)')}</td>
          <td style="padding:6px 8px; text-align:${rtl ? 'left' : 'right'}; font-weight:900; white-space:nowrap; min-width:120px;">${f(totalExcl)} ${currency || ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 8px; background:#cba86c; font-weight:900;">${L('Total (including Maintenance Deposit)', 'الإجمالي (شامل وديعة الصيانة)')}</td>
          <td style="padding:6px 8px; text-align:${rtl ? 'left' : 'right'}; font-weight:900; white-space:nowrap; min-width:120px;">${f(totalIncl)} ${currency || ''}</td>
        </tr>
      `)
      unitTotalsBox = `
        <div style="margin:${rtl ? '0 16px 0 0' : '0 0 0 16px'}; width: 42%;">
          <table style="width:100%; border-collapse:collapse; border:1px solid #ead9bd">
            ${rows.join('')}
          </table>
        </div>
      `
    }

    const html = `
      <html lang="${language}" dir="${dir}">
        <head>
          <meta charset="UTF-8" />
          ${css}
        </head>
        <body>
          <div class="header">
            <div class="brand">${rtl ? 'نظام الشؤون المالية' : 'Uptown Financial System'}</div>
            <div class="meta">${rtl ? 'تم الإنشاء' : 'Generated'}: ${todayTs}</div>
          </div>

          <h2 style="${rtl ? 'text-align:right;' : ''}">${title}</h2>
          <div class="section">
            <div class="meta"><strong>${tOfferDate}:</strong> ${offer_date || ''}   <strong>${tFirstPayment}:</strong> ${first_payment_date || ''}</div>
            ${unitLine ? `<div class="meta"><strong>${tUnit}:</strong> ${unitLine}</div>` : ''}
            ${consultantLine}
            <div style="display:flex; ${rtl ? 'flex-direction:row-reverse;' : ''} gap:12px; align-items:stretch;">
              <div style="flex:1;">
                <div class="buyers">
                  ${buyersHtml || (rtl ? '<div>لا يوجد بيانات عملاء</div>' : '<div>No client data</div>')}
                </div>
              </div>
              ${unitTotalsBox}
            </div>
          </div>

          
          <div class="section">
            <h3 style="${rtl ? 'text-align:right;' : ''}">${tSchedule}</h3>
            <table>
              <thead>
                <tr>
                  <th>${tMonth}</th>
                  <th>${tLabel}</th>
                  <th style="text-align:${rtl ? 'left' : 'right'}">${tAmount}</th>
                  <th>${tDate}</th>
                  <th>${tAmountWords}</th>
                </tr>
              </thead>
              <tbody>
                ${scheduleRows || `<tr><td colspan="5">${rtl ? 'لا توجد بيانات' : 'No data'}</td></tr>`}
              </tbody>
            </table>
            <div class="totals">
              <div><strong>${rtl ? 'الإجمالي (بدون وديعة الصيانة)' : 'Total (excluding Maintenance Deposit)'}:</strong> ${f(Number(((totals?.totalNominalExcludingMaintenance ?? totals?.totalNominal) || 0)))} ${currency || ''}</div>
              <div><strong>${rtl ? 'الإجمالي (شامل وديعة الصيانة)' : 'Total (including Maintenance Deposit)'}:</strong> ${f(Number(((totals?.totalNominalIncludingMaintenance ?? totals?.totalNominal) || 0)))} ${currency || ''}</div>
            </div>
          </div>

          <div class="foot">
            ${rtl
              ? 'هذا العرض تم إنشاؤه آليًا لأغراض المناقشة ولا يُعد مُستندًا تعاقديًا.'
              : 'This offer is generated automatically for discussion purposes and is not a contractual document.'}
          </div>
        </body>
      </html>
    `

    // Render with Puppeteer (reuse a singleton browser to improve performance)
    const browser = await getBrowser()
    const page = await browser.newPage()
    // Use 'load' to avoid hanging on networkidle behind sandbox; our HTML is static
    await page.setContent(html, { waitUntil: 'load' })
    // Localized footer: Page X of Y (EN) / صفحة س من ص (AR)
    const footerTemplate = `
      <div style="width:100%; font-size:10px; color:#6b7280; padding:6px 10px; ${rtl ? 'direction:rtl; text-align:left;' : 'direction:ltr; text-align:right;'}">
        ${rtl ? 'صفحة' : 'Page'} <span class="pageNumber"></span> ${rtl ? 'من' : 'of'} <span class="totalPages"></span>
      </div>`
    const headerTemplate = '<div></div>'

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '14mm', right: '12mm', bottom: '18mm', left: '12mm' }
    })
    await page.close()

    const filename = `client_offer_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(pdfBuffer)
  } catch (err) {
    console.error('POST /api/documents/client-offer error:', err)
    return bad(res, 500, 'Failed to generate Client Offer PDF')
  }
})

// Server-rendered Reservation Form PDF (Financial Admin, gated by FM approval)
app.post('/api/documents/reservation-form', authLimiter, authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const dealId = Number(req.body?.deal_id)
    if (!Number.isFinite(dealId) || dealId <= 0) {
      return bad(res, 400, 'deal_id must be a positive number')
    }
    // Enforce FM approval prior to reservation form generation
    const dr = await pool.query('SELECT * FROM deals WHERE id=$1', [dealId])
    if (dr.rows.length === 0) return bad(res, 404, 'Deal not found')
    const deal = dr.rows[0]
    if (!deal.fm_review_at) {
      return bad(res, 403, 'Financial Manager approval required before generating Reservation Form')
    }

    // Inputs from FA
    const reservationDate = String(req.body?.reservation_form_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const preliminaryPayment = Number(req.body?.preliminary_payment_amount) || 0
    const UIcurrency = (req.body?.currency_override || '').trim()
    const language = String(req.body?.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'
    const rtl = language === 'ar'

    // Day of week (localize)
    let dayOfWeek = ''
    try {
      const d = new Date(reservationDate)
      const namesEn = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      const namesAr = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']
      dayOfWeek = (rtl ? namesAr : namesEn)[d.getDay()] || ''
    } catch {}

    // Extract calculator snapshot stored on the deal
    const calc = deal.details?.calculator || {}

    // Down Payment amount (prefer engine field; fallback to schedule entry)
    let downPayment = Number(calc?.generatedPlan?.downPaymentAmount) || 0
    if (!(downPayment > 0)) {
      try {
        const dpRow = (calc?.generatedPlan?.schedule || []).find(r => String(r.label || '').toLowerCase().includes('down payment'))
        if (dpRow) downPayment = Number(dpRow.amount) || 0
      } catch {}
    }

    // Unit totals: build breakdown and compute total including maintenance
    let upb = calc?.unitPricingBreakdown || null
    let totalIncl = 0
    let currency = UIcurrency || calc?.currency || ''
    let unit = {
      unit_code: calc?.unitInfo?.unit_code || '',
      unit_type: calc?.unitInfo?.unit_type || '',
      unit_id: calc?.unitInfo?.unit_id || null
    }
    try {
      const unitId = Number(unit?.unit_id)
      if (Number.isFinite(unitId) && unitId > 0) {
        const r = await pool.query(`
          SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
          FROM units u
          JOIN unit_model_pricing p ON p.model_id = u.model_id
          WHERE u.id=$1 AND p.status='approved'
          ORDER BY p.id DESC
          LIMIT 1
        `, [unitId])
        if (r.rows.length) {
          const row = r.rows[0]
          upb = {
            base: Number((upb && upb.base) ?? row.price) || 0,
            garden: Number((upb && upb.garden) ?? row.garden_price) || 0,
            roof: Number((upb && upb.roof) ?? row.roof_price) || 0,
            storage: Number((upb && upb.storage) ?? row.storage_price) || 0,
            garage: Number((upb && upb.garage) ?? row.garage_price) || 0,
            maintenance: Number((upb && upb.maintenance) ?? row.maintenance_price) || 0
          }
        }
      }
    } catch {}

    const totalExcl = (Number(upb?.base||0)+Number(upb?.garden||0)+Number(upb?.roof||0)+Number(upb?.storage||0)+Number(upb?.garage||0))
    totalIncl = totalExcl + (Number(upb?.maintenance||0))

    // Remaining amount to be paid
    const remainingAmount = Math.max(0, Number(totalIncl) - Number(preliminaryPayment) - Number(downPayment))

    // Buyers (minimal)
    const numBuyers = Math.min(Math.max(Number(calc?.clientInfo?.number_of_buyers) || 1, 1), 4)
    const buyers = []
    for (let i = 1; i <= numBuyers; i++) {
      const sfx = i === 1 ? '' : `_${i}`
      buyers.push({
        buyer_name: calc?.clientInfo?.[`buyer_name${sfx}`] || '',
        phone_primary: calc?.clientInfo?.[`phone_primary${sfx}`] || '',
        phone_secondary: calc?.clientInfo?.[`phone_secondary${sfx}`] || '',
        email: calc?.clientInfo?.[`email${sfx}`] || ''
      })
    }

    // i18n helper
    const L = (en, ar) => rtl ? ar : en
    const dir = rtl ? 'rtl' : 'ltr'
    const textAlignLeft = rtl ? 'text-right' : 'text-left'
    const textAlignRight = rtl ? 'text-left' : 'text-right'

    // Build Tailwind-based HTML (matching attached form style) with RTL support
    const html = `
      <!DOCTYPE html>
      <html lang="${language}" dir="${dir}">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>${L('Reservation Form', 'نموذج الحجز')}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="${rtl ? 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600;700&display=swap' : 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'}" rel="stylesheet">
        <style>
          html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { font-family: ${rtl ? "'Noto Naskh Arabic', serif" : "'Inter', sans-serif"}; }
        </style>
      </head>
      <body class="bg-gray-100 p-4 sm:p-8">
        <div class="container mx-auto max-w-4xl bg-white shadow-lg rounded-2xl overflow-hidden">
          <div class="p-6 sm:p-8 border-b border-gray-200 ${textAlignLeft}">
            <h1 class="text-2xl sm:text-3xl font-bold text-gray-800">${L('Reservation Form', 'نموذج الحجز')}</h1>
            <p class="mt-2 text-gray-600">${L('This document summarizes the reservation details for the selected unit.', 'يُلخص هذا المستند تفاصيل حجز الوحدة المختارة.')}</p>
          </div>

          <!-- Reservation Summary -->
          <div class="px-6 sm:px-8 py-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-gray-50 rounded-xl p-4 border border-gray-200 ${textAlignLeft}">
              <h2 class="text-lg font-semibold text-gray-700 mb-2">${L('Reservation Details', 'تفاصيل الحجز')}</h2>
              <div class="space-y-1 text-gray-800">
                <div><span class="font-medium">${L('Date', 'التاريخ')}:</span> ${reservationDate} <span class="text-gray-500">(${dayOfWeek})</span></div>
                <div><span class="font-medium">${L('Preliminary Payment', 'دفعة الحجز الأولية')}:</span> ${Number(preliminaryPayment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</div>
                <div><span class="font-medium">${L('Down Payment', 'دفعة التعاقد')}:</span> ${Number(downPayment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</div>
                <div><span class="font-medium">${L('Total Unit Value (incl. maintenance)', 'قيمة الوحدة الإجمالية (شاملة وديعة الصيانة)')}:</span> ${Number(totalIncl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</div>
                <div><span class="font-medium">${L('Remaining Amount', 'المبلغ المتبقي')}:</span> ${Number(remainingAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</div>
              </div>
            </div>
            <div class="bg-gray-50 rounded-xl p-4 border border-gray-200 ${textAlignLeft}">
              <h2 class="text-lg font-semibold text-gray-700 mb-2">${L('Unit', 'الوحدة')}</h2>
              <div class="space-y-1 text-gray-800">
                <div><span class="font-medium">${L('Code', 'الكود')}:</span> ${unit.unit_code || '-'}</div>
                <div><span class="font-medium">${L('Type', 'النوع')}:</span> ${unit.unit_type || '-'}</div>
              </div>
            </div>
          </div>

          <!-- Buyers -->
          <div class="px-6 sm:px-8 pb-6 ${textAlignLeft}">
            <h2 class="text-lg font-semibold text-gray-700 mb-3">${L('Buyers', 'العملاء')}</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              ${
                buyers.length
                  ? buyers.map((b, i) => `
                    <div class="rounded-xl border border-gray-200 p-4">
                      <div class="text-sm text-gray-500 mb-1">${L('Buyer', 'العميل')} ${i + 1}</div>
                      <div class="text-gray-800"><span class="font-medium">${L('Name', 'الاسم')}:</span> ${b.buyer_name || '-'}</div>
                      <div class="text-gray-800"><span class="font-medium">${L('Phone', 'الهاتف')}:</span> ${[b.phone_primary, b.phone_secondary].filter(Boolean).join(' / ') || '-'}</div>
                      <div class="text-gray-800"><span class="font-medium">${L('Email', 'البريد الإلكتروني')}:</span> ${b.email || '-'}</div>
                    </div>
                  `).join('')
                  : `<div class="text-gray-500">${L('No client data', 'لا توجد بيانات عملاء')}</div>`
              }
            </div>
          </div>

          <!-- Pricing Breakdown -->
          <div class="px-6 sm:px-8 pb-8 ${textAlignLeft}">
            <h2 class="text-lg font-semibold text-gray-700 mb-3">${L('Pricing Breakdown', 'تفاصيل التسعير')}</h2>
            <div class="rounded-xl border border-gray-200 overflow-hidden">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="text-xs font-medium text-gray-500 uppercase tracking-wider p-3 ${textAlignLeft}">${L('Label', 'البند')}</th>
                    <th class="text-xs font-medium text-gray-500 uppercase tracking-wider p-3 ${textAlignRight}">${L('Amount', 'القيمة')}</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-100">
                  <tr><td class="p-3">${L('Base', 'السعر الأساسي')}</td><td class="p-3 ${textAlignRight}">${Number(upb?.base||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>
                  ${Number(upb?.garden||0)>0 ? `<tr><td class="p-3">${L('Garden', 'الحديقة')}</td><td class="p-3 ${textAlignRight}">${Number(upb?.garden||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>` : ''}
                  ${Number(upb?.roof||0)>0 ? `<tr><td class="p-3">${L('Roof', 'السطح')}</td><td class="p-3 ${textAlignRight}">${Number(upb?.roof||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>` : ''}
                  ${Number(upb?.storage||0)>0 ? `<tr><td class="p-3">${L('Storage', 'غرفة التخزين')}</td><td class="p-3 ${textAlignRight}">${Number(upb?.storage||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>` : ''}
                  ${Number(upb?.garage||0)>0 ? `<tr><td class="p-3">${L('Garage', 'الجراج')}</td><td class="p-3 ${textAlignRight}">${Number(upb?.garage||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>` : ''}
                  ${Number(upb?.maintenance||0)>0 ? `<tr><td class="p-3">${L('Maintenance Deposit', 'وديعة الصيانة')}</td><td class="p-3 ${textAlignRight}">${Number(upb?.maintenance||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>` : ''}
                  <tr class="bg-gray-50"><td class="p-3 font-semibold">${L('Total (excl. maintenance)', 'الإجمالي (بدون وديعة الصيانة)')}</td><td class="p-3 ${textAlignRight} font-semibold">${Number(totalExcl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>
                  <tr class="bg-gray-50"><td class="p-3 font-semibold">${L('Total (incl. maintenance)', 'الإجمالي (شامل وديعة الصيانة)')}</td><td class="p-3 ${textAlignRight} font-semibold">${Number(totalIncl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="px-6 sm:px-8 pb-8 text-gray-500 text-sm border-t border-gray-100 ${textAlignLeft}">
            ${L('This reservation form is generated automatically based on the consultant\'s saved plan and pricing. Values are indicative and subject to contract.', 'تم إنشاء نموذج الحجز تلقائيًا اعتمادًا على الخطة والأسعار المحفوظة بواسطة المستشار. القيم إرشادية وقابلة للتغيير عند التعاقد.')}
          </div>
        </div>
      </body>
      </html>
    `

    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const footerTemplate = `
      <div style="width:100%; font-size:10px; color:#6b7280; padding:6px 10px; ${rtl ? 'direction:rtl; text-align:left;' : 'direction:ltr; text-align:right;'}">
        ${L('Page', 'صفحة')} <span class="pageNumber"></span> ${L('of', 'من')} <span class="totalPages"></span>
      </div>`
    const headerTemplate = '<div></div>'
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '14mm', right: '12mm', bottom: '18mm', left: '12mm' }
    })
    await page.close()

    const filename = `reservation_form_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(pdfBuffer)
  } catch (err) {
    console.error('POST /api/documents/reservation-form error:', err)
    return bad(res, 500, 'Failed to generate Reservation Form PDF')
  }
})

// Global error handler
app.use(errorHandler)

export default app