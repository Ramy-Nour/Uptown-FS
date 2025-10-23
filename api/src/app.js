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
import { runSchemaCheck } from './utils/schemaCheck.js'
import workflowRoutes from './workflowRoutes.js'
import inventoryRoutes from './inventoryRoutes.js'
import reportsRoutes from './reportsRoutes.js'
import pricingRoutes from './pricingRoutes.js' // THIS LINE IS NEW
import configRoutes from './configRoutes.js'
import standardPlanRoutes from './standardPlanRoutes.js' // NEW
import calculateRoutes from './calculateRoutes.js' // NEW
import documentsRoutes from './documentsRoutes.js'
import planningRoutes from './planningRoutes.js'
import notificationsRoutes from './notificationsRoutes.js'

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

// Core middleware (must be early)
app.use(helmet())
app.use(cors()) // Defaults allow Codespaces *.app.github.dev unless overridden via CORS_ORIGINS upstream/proxy
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// Basic health/message endpoints for reachability checks
app.get('/api/health', (req, res) => res.json({ status: 'ok' }))
app.get('/api/message', (req, res) => res.json({ message: 'Hello from API' }))

// Mount primary route modules
app.use('/api/auth', authRoutes)
app.use('/api/deals', dealsRoutes)
app.use('/api/units', unitsRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/standard-plan', standardPlanRoutes)
app.use('/api/pricing', pricingRoutes) // Unit model pricing (FM/TM)
app.use('/api/workflow', workflowRoutes) // Queues, approvals, teams
app.use('/api/config', configRoutes) // System configs (acceptance thresholds)
app.use('/api', planningRoutes) // /calculate, /generate-plan
app.use('/api/notifications', notificationsRoutes)
app.use('/api/blocks', blockManagementRoutes) // Unit block workflow

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

// moved: Reservation Form PDF endpoint is now in documentsRoutes.js (mounted at /api/documents/reservation-form)

/* moved: POST /api/calculate is now in planningRoutes.js (mounted at /api/calculate) */

/* moved: POST /api/generate-plan is now in planningRoutes.js (mounted at /api/generate-plan) */

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
    const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
    const bad = (res, code, message, details) => res.status(code).json({ error: { message, details } })

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
        defaultTemplate: 'client_offer.docx'
      },
      reservation_form: {
        // Reservation form — Financial Admin only
        allowedRoles: ['financial_admin'],
        defaultTemplate: 'Pricing Form G.docx'
      },
      contract: {
        // Contract form — Contracts Admin (person) only
        allowedRoles: ['contract_person'],
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
        const dq = await pool.query('SELECT status, needs_override, override_approved_at FROM deals WHERE id=$1', [id])
        if (dq.rows.length === 0) {
          return bad(res, 404, 'Deal not found')
        }
        if (dq.rows[0].status !== 'approved') {
          return bad(res, 400, 'Deal must be approved before generating this document')
        }
        if (dq.rows[0].needs_override === true && !dq.rows[0].override_approved_at) {
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
    const renderData = { ...docData }
    for (const [k, v] of Object.entries(docData)) {
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
// Mount documents routes (Client Offer + Reservation Form)
app.use('/api/documents', documentsRoutes)

// moved: Client Offer PDF endpoint is now in documentsRoutes.js (mounted at /api/documents/client-offer)

// Global error handler
app.use(errorHandler)

export default app