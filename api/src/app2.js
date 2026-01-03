import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import helmet from 'helmet'
import puppeteer from 'puppeteer'
import convertToWords from '../utils/converter.js'
import { createRequire } from 'module'
import authRoutes, { authMiddleware } from './authRoutes.js'
import { pool } from './db.js'
import dealsRoutes from './dealsRoutes.js'
import unitsRoutes from './unitsRoutes.js'
import salesPeopleRoutes from './salesPeopleRoutes.js'
import commissionPoliciesRoutes from './commissionPoliciesRoutes.js'
import commissionsRoutes from './commissionsRoutes.js'
import ocrRoutes from './ocrRoutes.js'
import workflowRoutes from './workflowRoutes.js'
import inventoryRoutes from './inventoryRoutes.js'
import reportsRoutes from './reportsRoutes.js'
import pricingRoutes from './pricingRoutes.js'
import configRoutes from './configRoutes.js'
import standardPlanRoutes from './standardPlanRoutes.js'
import calculateRoutes from './calculateRoutes.js'
import documentsRoutes from './documentsRoutes2.js'
import planningRoutes from './planningRoutes.js'
import notificationsRoutes from './notificationsRoutes.js'
import contractsRoutes from './contractsRoutes.js'
import blockOverridesRoutes from './blockOverrides.js'
import blockManagementRoutes from './blockManagement.js'
import { errorHandler } from './errorHandler.js'
import logger from './utils/logger.js'
import crypto from 'crypto'
import { validate, generateDocumentSchema } from './validation.js'

const require = createRequire(import.meta.url)
const libre = require('libreoffice-convert')

const app = express()

// Behind Docker/network proxies, enable trust proxy so express-rate-limit can read X-Forwarded-For safely
app.set('trust proxy', 1)

// Core middleware (must be early)
app.use(helmet())
app.use(cors())
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
app.use('/api/pricing', pricingRoutes)
app.use('/api/workflow', workflowRoutes)
app.use('/api/config', configRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api', planningRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/blocks', blockManagementRoutes)
app.use('/api/contracts', contractsRoutes)
app.use('/api/blocks', blockOverridesRoutes)
// Documents router (Client Offer + Reservation Form)
app.use('/api/documents', documentsRoutes)

// Puppeteer singleton (reuse browser instance to reduce latency) – kept for any HTML→PDF routes
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
  req.id = req.headers['x-request-id'] || crypto.randomUUID()
  const start = Date.now()

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

/**
 * POST /api/generate-document
 * Body: {
 *   templateName: string,              // must exist in /api/templates
 *   data: object,                      // flat key/value map for placeholders
 *   language?: 'en'|'ar',              // affects *_words auto-fields using convertToWords
 *   currency?: string                  // optional currency name/code for English words
 *   documentType?: 'pricing_form'|'reservation_form'|'contract'
 *   deal_id?: number                   // used for reservation/contract enrichment and guards
 * }
 *
 * Notes:
 * - Placeholders in the .docx should use Autocrat-style delimiters: <<placeholder_name>>
 * - Service will also add "<key>_words" fields for numeric values in data using the requested language
 */
app.post('/api/generate-document', authMiddleware, validate(generateDocumentSchema), async (req, res) => {
  try {
    let { templateName, documentType, deal_id, data, language, currency } = req.body || {}
    const role = req.user?.role

    const type = documentType && String(documentType).trim()
    const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
    const bad = (res, code, message, details) =>
      res.status(code).json({ error: { message, details } })

    let docData = isObject(data) ? data : (isObject(req.body) ? { ...req.body } : null)
    if (!docData) {
      return bad(res, 400, 'data must be an object with key/value pairs for placeholders')
    }
    delete docData.templateName
    delete docData.documentType
    delete docData.deal_id

    const TYPE_RULES = {
      pricing_form: {
        allowedRoles: ['property_consultant'],
        defaultTemplate: 'client_offer.docx'
      },
      reservation_form: {
        allowedRoles: ['financial_admin'],
        defaultTemplate: 'Pricing Form G.docx'
      },
      contract: {
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

      if (deal_id != null && type !== 'pricing_form') {
        const id = Number(deal_id)
        if (!Number.isFinite(id) || id <= 0) {
          return bad(res, 400, 'deal_id must be a positive number')
        }
        const dq = await pool.query(
          'SELECT status, needs_override, override_approved_at FROM deals WHERE id=$1',
          [id]
        )
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

      if (!templateName) {
        templateName = rules.defaultTemplate
      }
    } else {
      if (!templateName || typeof templateName !== 'string') {
        return bad(res, 400, 'Provide either documentType or templateName (string)')
      }
    }

    const lang = String(language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'

    const templatesDir = path.join(process.cwd(), 'api', 'templates')
    const requestedPath = path.join(templatesDir, templateName)
    if (!requestedPath.startsWith(templatesDir)) {
      return bad(res, 400, 'Invalid template path')
    }
    if (!fs.existsSync(requestedPath)) {
      return bad(res, 404, `Template not found: ${templateName}`)
    }

    // Contract: enrich data with DP breakdown from approved reservation form linked to the deal
    if (type === 'contract' && deal_id != null) {
      const id = Number(deal_id)
      if (Number.isFinite(id) && id > 0) {
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
                  rf.details->>'deal_id' ~ '^[0-9]+$'
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
              if (Number.isFinite(v) && v >= 0) {
                dpTotal = v
                docData.dp_total = v
              }
            }
            if (dp.remaining != null) {
              const v = Number(dp.remaining)
              if (Number.isFinite(v) && v >= 0) {
                dpRemaining = v
                docData.dp_remaining = v
              }
            }
            if (dp.preliminary_amount != null) {
              const v = Number(dp.preliminary_amount)
              if (Number.isFinite(v) && v >= 0) {
                dpPrelim = v
              }
            }
            if (dp.paid_amount != null) {
              const v = Number(dp.paid_amount)
              if (Number.isFinite(v) && v >= 0) {
                dpPaid = v
              }
            }

            const total = dpTotal != null ? dpTotal : 0
            const remaining = dpRemaining != null
              ? dpRemaining
              : Math.max(0, total - (dpPrelim || 0) - (dpPaid || 0))
            const paidSoFar = (dpPrelim || 0) + (dpPaid || 0)

            docData['الدفعة التعاقد بالأرقام'] = total

            const totalDpWordsForContract = convertToWords(total, lang, { currency })
            docData['الدفعة التعاقد كتابتا'] = totalDpWordsForContract

            if (lang === 'ar') {
              if (remaining > 0) {
                docData['بيان الباقي من دفعة التعاقد'] =
                  `دفعة التعاقد المتفق عليها هي مبلغ ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم، ` +
                  `تم سداد مبلغ ${paidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم من قيمة دفعة التعاقد حتى تاريخه، ` +
                  `ويتبقى مبلغ ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم يسدد عند توقيع العقد.`
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
                  `دفعة التعاقد المتفق عليها هي مبلغ ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم، تم سداده بالكامل` +
                  (completionDateText ? ` بتاريخ ${completionDateText}.` : '.')
              }
            } else {
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

    // Build rendering data with automatic *_words fields
    const renderData = { ...docData }
    for (const [k, v] of Object.entries(docData)) {
      const num = Number(v)
      if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(num))) {
        renderData[`${k}_words`] = convertToWords(num, lang, { currency })
      }
    }

    const content = fs.readFileSync(requestedPath, 'binary')
    const zip = new PizZip(content)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '<<', end: '>>' }
    })

    doc.setData(renderData)
    try {
      doc.render()
    } catch (e) {
      console.error('Docxtemplater render error:', e)
      return bad(res, 400, 'Failed to render document. Check placeholders and provided data.')
    }

    const docxBuffer = doc.getZip().generate({ type: 'nodebuffer' })
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

    const outName =
      path.basename(templateName, path.extname(templateName)) + '-filled.pdf'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`)
    return res.send(pdfBuffer)
  } catch (err) {
    console.error('POST /api/generate-document error:', err)
    return res.status(500).json({ error: { message: 'Internal error during document generation' } })
  }
})

// Global error handler
app.use(errorHandler)

export default app