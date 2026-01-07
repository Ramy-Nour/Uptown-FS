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
import contractsRoutes from './contractsRoutes.js'
import blockOverridesRoutes from './blockOverrides.js'
import { authMiddleware } from './authRoutes.js'

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
// Behind Docker/network proxies, enable trust proxy so express-rate-limit can read X-Forwarded-For safely
app.set('trust proxy', 1)

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
app.use('/api/sales', salesPeopleRoutes)
app.use('/api/commission-policies', commissionPoliciesRoutes)
app.use('/api/standard-plan', standardPlanRoutes)
app.use('/api/pricing', pricingRoutes) // Unit model pricing (FM/TM)
app.use('/api/workflow', workflowRoutes) // Queues, approvals, teams
app.use('/api/config', configRoutes) // System configs (acceptance thresholds)
app.use('/api/reports', reportsRoutes) // Workflow/throughput reports (offers/reservations/contracts)
app.use('/api', planningRoutes) // /calculate, /generate-plan
app.use('/api/notifications', notificationsRoutes)
app.use('/api/blocks', blockManagementRoutes) // Unit block workflow
app.use('/api/contracts', contractsRoutes) // Contracts workflow
app.use('/api/blocks', blockOverridesRoutes) // Block override chain endpoints

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
app.post('/api/generate-document', authMiddleware, validate(generateDocumentSchema), async (req, res) => {
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
      // Note: Pricing Form (client offer) is allowed for draft deals so consultants can print offers.
      if (deal_id != null && type !== 'pricing_form') {
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

    // For contract documents, if a deal_id is provided, try to enrich the data with
    // down payment breakdown from the approved reservation form so templates can
    // reuse the same DP totals as the Reservation Form without re-calculating.
    if (type === 'contract' &amp;&amp; deal_id != null) {
      const id = Number(deal_id)
      if (Number.isFinite(id) &amp;&amp; id > 0) {
        try {
          const rf = await pool.query(
            `
            SELECT rf.*
            FROM reservation_forms rf
            LEFT JOIN payment_plans pp ON pp.id = rf.payment_plan_id
            WHERE rf.status = 'approved'
              AND (
                pp.deal_id = $1
                OR (
                  rf.details->>'deal_id' ~ '^[0-9]+

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
                  AND (rf.details->>'deal_id')::numeric = $1
                )
              )
            ORDER BY rf.id DESC
            LIMIT 1
            `,
            [id]
          )
          if (rf.rows.length) {
            const row = rf.rows[0]
            const details = row.details || {}
            const dp = details.dp || {}

            let dpTotal = null
            let dpRemaining = null
            let dpPrelim = null
            let dpPaid = null

            if (dp.total != null) {
              const v = Number(dp.total)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpTotal = v
                docData.dp_total = v
              }
            }
            if (dp.remaining != null) {
              const v = Number(dp.remaining)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpRemaining = v
                docData.dp_remaining = v
              }
            }
            if (dp.preliminary_amount != null) {
              const v = Number(dp.preliminary_amount)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpPrelim = v
              }
            }
            if (dp.paid_amount != null) {
              const v = Number(dp.paid_amount)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpPaid = v
              }
            }

            // Map to Arabic contract placeholders while keeping template names:
            // - «الدفعة التعاقد بالأرقام» should show the Total Down Payment (from the offer).
            // - «الدفعة التعاقد كتابتا» should show the same total amount in words.
            // - «بيان الباقي من دفعة التعاقد» should be a full Arabic sentence
            //   describing what remains from the Down Payment (and, when 0, that it
            //   has been fully paid with the relevant date).
            const total = dpTotal != null ? dpTotal : 0
            const remaining = dpRemaining != null ? dpRemaining : Math.max(0, total - (dpPrelim || 0) - (dpPaid || 0))
            const paidSoFar = (dpPrelim || 0) + (dpPaid || 0)

            // Numeric placeholders (Total Down Payment)
            docData['الدفعة التعاقد بالأرقام'] = total

            // Words for Total Down Payment (explicit, in addition to auto *_words fields)
            const totalDpWordsForContract = convertToWords(total, lang, { currency })
            docData['الدفعة التعاقد كتابتا'] = totalDpWordsForContract

            // Statement about what remains from the Down Payment
            if (lang === 'ar') {
              if (remaining > 0) {
                docData['بيان الباقي من دفعة التعاقد'] =
                  `دفعة التعاقد المتفق عليها هي مبلغ ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم، ` +
                  `تم سداد مبلغ ${paidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم من قيمة دفعة التعاقد حتى تاريخه، ` +
                  `ويتبيقى مبلغ ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم يسدد عند توقيع العقد.`
              } else {
                // When remaining DP == 0, it has been fully paid. Use the last
                // DP-related date from the reservation process (paid_date, then
                // preliminary_date, then reservation_date) as the completion date.
                let completionDateText = ''
                try {
                  const srcDate =
                    dp.paid_date ||
                    dp.preliminary_date ||
                    row.reservation_date ||
                    null
                  if (srcDate) {
                    const d = new Date(srcDate)
                    if (!Number.isNaN(d.getTime())) {
                      const dd = String(d.getDate()).padStart(2, '0')
                      const mm = String(d.getMonth() + 1).padStart(2, '0')
                      const yyyy = d.getFullYear()
                      completionDateText = `${dd}/${mm}/${yyyy}`
                    }
                  }
                } catch {}
                docData['بيان الباقي من دفعة التعاقد'] =
                  `دفعة التعاقد المتفق عليها هي مبلغ ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم، تم سداده بالكامل` +
                  (completionDateText ? ` بتاريخ ${completionDateText}.` : '.')
              }
            } else {
              // Simple English fallback if the contract is ever generated in English
              if (remaining > 0) {
                docData['بيان الباقي من دفعة التعاقد'] =
                  `The agreed down payment is ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP, ` +
                  `of which ${paidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP has been paid so far, ` +
                  `leaving ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP to be paid upon signing the contract.`
              } else {
                let completionDateText = ''
                try {
                  const srcDate =
                    dp.paid_date ||
                    dp.preliminary_date ||
                    row.reservation_date ||
                    null
                  if (srcDate) {
                    const d = new Date(srcDate)
                    if (!Number.isNaN(d.getTime())) {
                      const dd = String(d.getDate()).padStart(2, '0')
                      const mm = String(d.getMonth() + 1).padStart(2, '0')
                      const yyyy = d.getFullYear()
                      completionDateText = `${dd}/${mm}/${yyyy}`
                    }
                  }
                } catch {}
                docData['بيان الباقي من دفعة التعاقد'] =
                  `The agreed down payment is ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP and it has been fully paid` +
                  (completionDateText ? ` on ${completionDateText}.` : '.')
              }
            }
          }
        } catch (e) {
          console.error('generate-document: failed to enrich contract with DP data from reservation_forms:', e)
        }
      }
    }

    // Build rendering data:
    // - Original keys
    // - For numeric fields, add \"<key>_words\" using the convertToWords helper
    const renderData = { ...docData }
    for (const [k, v] of Object.entries(docData)) {
      const num = Number(v)
      if (typeof v === 'number' || (typeof v === 'string' &amp;&amp; v.trim() !== '' &amp;&amp; isFinite(num))) {
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
                  AND (rf.details->>'deal_id')::numeric = $1
                )
              )
            ORDER BY rf.id DESC
            LIMIT 1
            `,
            [id]
          )
          if (rf.rows.length) {
            const row = rf.rows[0]
            const details = row.details || {}
            const dp = details.dp || {}

            let dpTotal = null
            let dpRemaining = null
            let dpPrelim = null
            let dpPaid = null

            if (dp.total != null) {
              const v = Number(dp.total)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpTotal = v
                docData.dp_total = v
              }
            }
            if (dp.remaining != null) {
              const v = Number(dp.remaining)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpRemaining = v
                docData.dp_remaining = v
              }
            }
            if (dp.preliminary_amount != null) {
              const v = Number(dp.preliminary_amount)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpPrelim = v
              }
            }
            if (dp.paid_amount != null) {
              const v = Number(dp.paid_amount)
              if (Number.isFinite(v) &amp;&amp; v >= 0) {
                dpPaid = v
              }
            }

            // Map to Arabic contract placeholders while keeping template names:
            // - «الدفعة التعاقد بالأرقام» should show the Total Down Payment (from the offer).
            // - «الدفعة التعاقد كتابتا» should show the same total amount in words.
            // - «بيان الباقي من دفعة التعاقد» should be a full Arabic sentence
            //   describing what remains from the Down Payment (and, when 0, that it
            //   has been fully paid with the relevant date).
            const total = dpTotal != null ? dpTotal : 0
            const remaining = dpRemaining != null ? dpRemaining : Math.max(0, total - (dpPrelim || 0) - (dpPaid || 0))
            const paidSoFar = (dpPrelim || 0) + (dpPaid || 0)

            // Numeric placeholders (Total Down Payment)
            docData['الدفعة التعاقد بالأرقام'] = total

            // Words for Total Down Payment (explicit, in addition to auto *_words fields)
            const totalDpWordsForContract = convertToWords(total, lang, { currency })
            docData['الدفعة التعاقد كتابتا'] = totalDpWordsForContract

            // Statement about what remains from the Down Payment
            if (lang === 'ar') {
              if (remaining > 0) {
                docData['بيان الباقي من دفعة التعاقد'] =
                  `دفعة التعاقد المتفق عليها هي مبلغ ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم، ` +
                  `تم سداد مبلغ ${paidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم من قيمة دفعة التعاقد حتى تاريخه، ` +
                  `ويتبيقى مبلغ ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم يسدد عند توقيع العقد.`
              } else {
                // When remaining DP == 0, it has been fully paid. Use the last
                // DP-related date from the reservation process (paid_date, then
                // preliminary_date, then reservation_date) as the completion date.
                let completionDateText = ''
                try {
                  const srcDate =
                    dp.paid_date ||
                    dp.preliminary_date ||
                    row.reservation_date ||
                    null
                  if (srcDate) {
                    const d = new Date(srcDate)
                    if (!Number.isNaN(d.getTime())) {
                      const dd = String(d.getDate()).padStart(2, '0')
                      const mm = String(d.getMonth() + 1).padStart(2, '0')
                      const yyyy = d.getFullYear()
                      completionDateText = `${dd}/${mm}/${yyyy}`
                    }
                  }
                } catch {}
                docData['بيان الباقي من دفعة التعاقد'] =
                  `دفعة التعاقد المتفق عليها هي مبلغ ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم، تم سداده بالكامل` +
                  (completionDateText ? ` بتاريخ ${completionDateText}.` : '.')
              }
            } else {
              // Simple English fallback if the contract is ever generated in English
              if (remaining > 0) {
                docData['بيان الباقي من دفعة التعاقد'] =
                  `The agreed down payment is ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP, ` +
                  `of which ${paidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP has been paid so far, ` +
                  `leaving ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP to be paid upon signing the contract.`
              } else {
                let completionDateText = ''
                try {
                  const srcDate =
                    dp.paid_date ||
                    dp.preliminary_date ||
                    row.reservation_date ||
                    null
                  if (srcDate) {
                    const d = new Date(srcDate)
                    if (!Number.isNaN(d.getTime())) {
                      const dd = String(d.getDate()).padStart(2, '0')
                      const mm = String(d.getMonth() + 1).padStart(2, '0')
                      const yyyy = d.getFullYear()
                      completionDateText = `${dd}/${mm}/${yyyy}`
                    }
                  }
                } catch {}
                docData['بيان الباقي من دفعة التعاقد'] =
                  `The agreed down payment is ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP and it has been fully paid` +
                  (completionDateText ? ` on ${completionDateText}.` : '.')
              }
            }
          }
        } catch (e) {
          console.error('generate-document: failed to enrich contract with DP data from reservation_forms:', e)
        }
      }
    }

    // Build rendering data:
    // - Original keys
    // - For numeric fields, add \"<key>_words\" using the convertToWords helper
    const renderData = { ...docData }
    for (const [k, v] of Object.entries(docData)) {
      const num = Number(v)
      if (typeof v === 'number' || (typeof v === 'string' &amp;&amp; v.trim() !== '' &amp;&amp; isFinite(num))) {
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