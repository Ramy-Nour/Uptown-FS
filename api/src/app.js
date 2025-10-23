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
})>
// Mount documents routes (Client Offer + Reservation Form)
app.use('/api/documentsiter, authMiddleware, requireRole(['property_consultant']), async (req, res) => {
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

// moved: Client Offer PDF endpoint is now in documentsRoutes.js (mounted at /api/documents/client-offer)

// Global error handler
app.use(errorHandler)

export default app