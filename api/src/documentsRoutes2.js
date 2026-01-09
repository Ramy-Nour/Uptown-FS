import express from 'express'
import puppeteer from 'puppeteer'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'
import convertToWords from '../utils/converter.js'

const router = express.Router()

// Puppeteer singleton (per-process)
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

function bad(res, code, message, details) {
  return res.status(code).json({
    error: { message, details },
    timestamp: new Date().toISOString()
  })
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

// ------------------------------
// Client Offer PDF
// ------------------------------
router.post(
  '/client-offer',
  authMiddleware,
  requireRole(['property_consultant']),
  async (req, res) => {
    try {
      let {
        deal_id,
        language,
        currency,
        buyers,
        schedule,
        totals,
        offer_date,
        first_payment_date,
        unit,
        unit_pricing_breakdown
      } = req.body || {}

      const dealId = Number(deal_id)
      let consultant = {
        name:
          req.user?.name && String(req.user.name).trim()
            ? String(req.user.name).trim()
            : null,
        email: req.user?.email || null
      }

      // If deal_id is provided, hydrate missing fields from the deal snapshot
      let calc = null
      if (Number.isFinite(dealId) && dealId > 0) {
        const dr = await pool.query('SELECT * FROM deals WHERE id=$1', [dealId])
        if (dr.rows.length > 0) {
          const deal = dr.rows[0]
          calc = deal.details?.calculator || null

          // Consultant = deal creator
          try {
            const u = await pool.query(
              `SELECT u.email,
                      COALESCE(NULLIF(TRIM(u.meta->>'name'), ''), u.email) AS full_name
               FROM deals d
               JOIN users u ON u.id = d.created_by
               WHERE d.id=$1
               LIMIT 1`,
              [dealId]
            )
            if (u.rows.length) {
              consultant = {
                name: u.rows[0].full_name || consultant.name || null,
                email: u.rows[0].email || consultant.email || null
              }
            }
          } catch {
            // ignore lookup failures
          }

          if (!buyers && calc?.clientInfo) {
            const num = Math.min(
              Math.max(Number(calc.clientInfo.number_of_buyers) || 1, 1),
              4
            )
            const bb = []
            for (let i = 1; i <= num; i++) {
              const sfx = i === 1 ? '' : `_${i}`
              bb.push({
                buyer_name: calc.clientInfo[`buyer_name${sfx}`] || '',
                phone_primary: calc.clientInfo[`phone_primary${sfx}`] || '',
                phone_secondary:
                  calc.clientInfo[`phone_secondary${sfx}`] || '',
                email: calc.clientInfo[`email${sfx}`] || ''
              })
            }
            buyers = bb
          }

          if (!schedule && calc?.generatedPlan?.schedule) {
            schedule = calc.generatedPlan.schedule
            totals = calc.generatedPlan.totals || totals
          }

          if (!offer_date) {
            offer_date =
              calc?.inputs?.offerDate ||
              new Date().toISOString().slice(0, 10)
          }
          if (!first_payment_date) {
            first_payment_date =
              calc?.inputs?.firstPaymentDate || offer_date
          }

          if (!unit && calc?.unitInfo) {
            unit = {
              unit_code: calc.unitInfo.unit_code || '',
              unit_type: calc.unitInfo.unit_type || '',
              unit_id: calc.unitInfo.unit_id || null
            }
          }

          if (!unit_pricing_breakdown && calc?.unitPricingBreakdown) {
            unit_pricing_breakdown = calc.unitPricingBreakdown
          }

          language =
            language ||
            calc?.language ||
            calc?.inputs?.language ||
            language
          currency =
            currency || calc?.currency || deal.details?.currency || currency
        }
      }

      // Fallback consultant data from users table if missing
      if (!consultant.email || !consultant.name) {
        try {
          const u = await pool.query(
            `SELECT email,
                    COALESCE(NULLIF(TRIM(name), ''), email) AS full_name
             FROM users WHERE id=$1 LIMIT 1`,
            [req.user.id]
          )
          if (u.rows.length) {
            consultant = {
              name: u.rows[0].full_name || consultant.name || null,
              email: u.rows[0].email || consultant.email || null
            }
          }
        } catch {
          // ignore
        }
      }

      buyers = Array.isArray(buyers) ? buyers : []
      schedule = Array.isArray(schedule) ? schedule : []
      totals = totals || {
        totalNominal: schedule.reduce(
          (sum, r) => sum + (Number(r.amount) || 0),
          0
        )
      }

      const lang =
        String(language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'
      const rtl = lang === 'ar'
      const dir = rtl ? 'rtl' : 'ltr'

      // Unit pricing breakdown (box on the right)
      let upb = null
      if (isObject(unit_pricing_breakdown)) {
        const candidate = {
          base: Number(unit_pricing_breakdown.base || 0),
          garden: Number(unit_pricing_breakdown.garden || 0),
          roof: Number(unit_pricing_breakdown.roof || 0),
          storage: Number(unit_pricing_breakdown.storage || 0),
          garage: Number(unit_pricing_breakdown.garage || 0),
          maintenance: Number(unit_pricing_breakdown.maintenance || 0)
        }
        const allZero =
          !candidate.base &&
          !candidate.garden &&
          !candidate.roof &&
          !candidate.storage &&
          !candidate.garage &&
          !candidate.maintenance
        if (!allZero) upb = candidate
      }

      // If not provided, try to pull from unit_model_pricing
      if (!upb && unit && Number.isFinite(Number(unit.unit_id))) {
        try {
          const r = await pool.query(
            `
            SELECT price,
                   maintenance_price,
                   garage_price,
                   garden_price,
                   roof_price,
                   storage_price
            FROM units u
            JOIN unit_model_pricing p ON p.model_id = u.model_id
            WHERE u.id=$1 AND p.status='approved'
            ORDER BY p.id DESC
            LIMIT 1
            `,
            [Number(unit.unit_id)]
          )
          if (r.rows.length) {
            const row = r.rows[0]
            upb = {
              base: Number(row.price || 0),
              garden: Number(row.garden_price || 0),
              roof: Number(row.roof_price || 0),
              storage: Number(row.storage_price || 0),
              garage: Number(row.garage_price || 0),
              maintenance: Number(row.maintenance_price || 0)
            }
          }
        } catch {
          // ignore, box will be omitted
        }
      }

      const totalExcl = upb
        ? Number(upb.base || 0) +
          Number(upb.garden || 0) +
          Number(upb.roof || 0) +
          Number(upb.storage || 0) +
          Number(upb.garage || 0)
        : null
      const totalIncl = upb
        ? Number(totalExcl || 0) + Number(upb.maintenance || 0)
        : null

      const fmtNum = (n) =>
        Number(n || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })

      const fmtDate = (s) => {
        if (!s) return ''
        const d = new Date(s)
        if (!Number.isNaN(d.getTime())) {
          const dd = String(d.getDate()).padStart(2, '0')
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const yyyy = d.getFullYear()
          return `${dd}-${mm}-${yyyy}`
        }
        return String(s)
      }

      const buyersHtml = buyers
        .map(
          (b, idx) => `
        <div class="buyer">
          <div><strong>${rtl ? 'العميل' : 'Buyer'} ${
            idx + 1
          }:</strong> ${b.buyer_name || '-'}</div>
          <div><strong>${rtl ? 'الهاتف' : 'Phone'}:</strong> ${[
            b.phone_primary,
            b.phone_secondary
          ]
            .filter(Boolean)
            .join(' / ') || '-'}</div>
          <div><strong>Email:</strong> ${b.email || '-'}</div>
        </div>
      `
        )
        .join('')

      const scheduleRows = schedule
        .map((r, idx) => {
          const amount = Number(r.amount) || 0
          const dateStr = fmtDate(r.date || '')
          const words = convertToWords(amount, lang, { currency })
          return `
          <tr>
            <td>${idx + 1}</td>
            <td>${r.label || ''}</td>
            <td style="text-align:${rtl ? 'left' : 'right'}">${fmtNum(
              amount
            )} ${currency || ''}</td>
            <td>${dateStr}</td>
            <td>${words || ''}</td>
          </tr>
        `
        })
        .join('')

      const unitSummaryBox = upb
        ? `
        <div class="unit-summary">
          <table>
            <thead>
              <tr><th colspan="2">${
                unit?.unit_type || (rtl ? 'الوحدة' : 'Unit')
              }</th></tr>
            </thead>
            <tbody>
              <tr><td class="label">${
                rtl ? 'السعر الأساسي' : 'Base'
              }</td><td class="value">${fmtNum(upb.base)} ${currency || ''}</td></tr>
              ${
                Number(upb.garden || 0) > 0
                  ? `<tr><td class="label">${
                      rtl ? 'الحديقة' : 'Garden'
                    }</td><td class="value">${fmtNum(
                      upb.garden
                    )} ${currency || ''}</td></tr>`
                  : ''
              }
              ${
                Number(upb.roof || 0) > 0
                  ? `<tr><td class="label">${
                      rtl ? 'السطح' : 'Roof'
                    }</td><td class="value">${fmtNum(
                      upb.roof
                    )} ${currency || ''}</td></tr>`
                  : ''
              }
              ${
                Number(upb.storage || 0) > 0
                  ? `<tr><td class="label">${
                      rtl ? 'غرفة التخزين' : 'Storage'
                    }</td><td class="value">${fmtNum(
                      upb.storage
                    )} ${currency || ''}</td></tr>`
                  : ''
              }
              ${
                Number(upb.garage || 0) > 0
                  ? `<tr><td class="label">${
                      rtl ? 'الجراج' : 'Garage'
                    }</td><td class="value">${fmtNum(
                      upb.garage
                    )} ${currency || ''}</td></tr>`
                  : ''
              }
              ${
                Number(upb.maintenance || 0) > 0
                  ? `<tr><td class="label">${
                      rtl ? 'وديعة الصيانة' : 'Maintenance'
                    }</td><td class="value">${fmtNum(
                      upb.maintenance
                    )} ${currency || ''}</td></tr>`
                  : ''
              }
              ${
                totalIncl != null
                  ? `<tr class="total"><td class="label">${
                      rtl
                        ? 'الإجمالي (شامل الصيانة)'
                        : 'Total (incl. maintenance)'
                    }</td><td class="value">${fmtNum(
                      totalIncl
                    )} ${currency || ''}</td></tr>`
                  : ''
              }
            </tbody>
          </table>
        </div>
      `
        : ''

      const today = new Date()
      const ts = today.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })

      const css = `
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: "Noto Naskh Arabic","Amiri","DejaVu Sans",Arial,sans-serif; direction:${dir}; }
        h1,h2,h3 { margin: 0 0 8px; }
        .header { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px; }
        .brand { font-size:16px; color:#A97E34; font-weight:700; }
        .meta { color:#6b7280; font-size:12px; }
        .section { margin:14px 0; }
        table { width:100%; border-collapse:collapse; }
        .plan-table th { background:#A97E34; color:#000; padding:6px; border:1px solid #1f2937; font-size:12px; }
        .plan-table td { border:1px solid #1f2937; padding:6px; font-size:12px; background:#fffdf5; }
        .buyers { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .buyer { border:1px solid #ead9bd; border-radius:8px; padding:8px; background:#fff; font-size:12px; }
        .unit-summary { width:280px; border:2px solid #1f2937; }
        .unit-summary table { width:100%; border-collapse:collapse; }
        .unit-summary th { background:#A97E34; color:#000; padding:6px; border:2px solid #1f2937; font-size:12px; }
        .unit-summary td { background:#d9b45b; color:#000; padding:6px; border:2px solid #1f2937; font-size:12px; }
        .unit-summary .label { width:60%; }
        .unit-summary .value { width:40%; text-align:${rtl ? 'left' : 'right'}; }
        .unit-summary .total td { background:#f0d18a; font-weight:700; }
        .foot { margin-top:12px; color:#6b7280; font-size:10px; }
      </style>
      `

      const html = `
      <html lang="${lang}" dir="${dir}">
        <head>
          <meta charset="UTF-8" />
          ${css}
        </head>
        <body>
          <div class="header">
            <div class="brand">${
              rtl
                ? 'نظام شركة أبتاون 6 أكتوبر المالي'
                : 'Uptown 6 October Financial System'
            }</div>
            <div class="meta">
              ${(rtl ? 'تم الإنشاء' : 'Generated') + ': ' + ts}<br/>
              ${rtl ? 'استشاري' : 'Consultant'}: ${
                [consultant.name, consultant.email].filter(Boolean).join(' — ') ||
                '-'
              }
            </div>
          </div>
          <h2 style="${rtl ? 'text-align:right;' : ''}">${
        rtl ? 'عرض السعر للعميل' : 'Client Offer'
      }</h2>
          <div class="section">
            <strong>${rtl ? 'الوحدة' : 'Unit'}:</strong>
            ${unit?.unit_code || ''} ${unit?.unit_type ? '— ' + unit.unit_type : ''}
            <br/>
            <strong>${rtl ? 'تاريخ العرض' : 'Offer Date'}:</strong> ${fmtDate(
              offer_date
            )}
            &nbsp;&nbsp;
            <strong>${
              rtl ? 'تاريخ أول دفعة' : 'First Payment'
            }:</strong> ${fmtDate(first_payment_date)}
          </div>
          <div class="section" style="display:flex; gap:12px; align-items:flex-start;">
            <div style="flex:1;">
              <div class="buyers">
                ${
                  buyersHtml ||
                  (rtl ? '<div>لا يوجد بيانات عملاء</div>' : '<div>No client data</div>')
                }
              </div>
            </div>
            ${unitSummaryBox}
          </div>
          <div class="section">
            <h3 style="${rtl ? 'text-align:right;' : ''}">${
        rtl ? 'خطة السداد' : 'Payment Schedule'
      }</h3>
            <table class="plan-table">
              <thead>
                <tr>
                  <th style="width:8%;">#</th>
                  <th style="width:32%;">${rtl ? 'الوصف' : 'Label'}</th>
                  <th style="width:22%;">${rtl ? 'القيمة' : 'Amount'}</th>
                  <th style="width:18%;">${rtl ? 'التاريخ' : 'Date'}</th>
                  <th style="width:20%;">${
                    rtl ? 'المبلغ بالحروف' : 'Amount in Words'
                  }</th>
                </tr>
              </thead>
              <tbody>
                ${
                  scheduleRows ||
                  `<tr><td colspan="5">${
                    rtl ? 'لا توجد بيانات' : 'No schedule data'
                  }</td></tr>`
                }
              </tbody>
            </table>
          </div>
          <div class="foot">
            ${
              rtl
                ? 'هذا المستند ليس عقدًا وهو مُعد لعرض الأسعار للعميل فقط. قد تختلف القيم عند التعاقد النهائي.'
                : 'This document is not a contract and is generated for client viewing only. Values are indicative and subject to the final contract.'
            }
          </div>
        </body>
      </html>
      `

      const browser = await getBrowser()
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true
      })
      await page.close()

      const filename = `client_offer_${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.pdf`
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      )
      return res.send(pdfBuffer)
    } catch (err) {
      console.error('POST /api/documents2/client-offer error:', err)
      return bad(res, 500, 'Failed to generate Client Offer PDF')
    }
  }
)

// ------------------------------
// Reservation Form PDF
// ------------------------------
router.post(
  '/reservation-form',
  authMiddleware,
  requireRole([
    'financial_admin',
    'financial_manager',
    'contract_person',
    'contract_manager',
    'ceo',
    'chairman',
    'vice_chairman',
    'top_management',
    'admin',
    'superadmin'
  ]),
  async (req, res) => {
    try {
      const dealId = Number(req.body?.deal_id)
      if (!Number.isFinite(dealId) || dealId <= 0) {
        return bad(res, 400, 'deal_id must be a positive number')
      }

      const dr = await pool.query('SELECT * FROM deals WHERE id=$1', [dealId])
      if (dr.rows.length === 0) {
        return bad(res, 404, 'Deal not found')
      }
      const deal = dr.rows[0]
      const calc = deal.details?.calculator || {}

      // Optional explicit reservation_form_id (from Contracts console)
      let approvedReservation = null
      const reservationFormId = Number(req.body?.reservation_form_id)
      if (Number.isFinite(reservationFormId) && reservationFormId > 0) {
        try {
          const rfById = await pool.query(
            `SELECT * FROM reservation_forms WHERE id=$1 AND status='approved'`,
            [reservationFormId]
          )
          if (rfById.rows.length > 0) {
            approvedReservation = rfById.rows[0]
          }
        } catch (e) {
          console.error('RF by id lookup failed in documentsRoutes2:', e)
        }
      }

      // Fallback: latest approved RF by deal_id or legacy details.deal_id
      if (!approvedReservation) {
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
            [dealId]
          )
          if (rf.rows.length > 0) {
            approvedReservation = rf.rows[0]
          }
        } catch (e) {
          console.error('RF by deal_id lookup failed in documentsRoutes2:', e)
        }
      }

      // Determine language (prefer request, then calculator snapshot)
      let language =
        req.body?.language ||
        calc?.language ||
        calc?.inputs?.language ||
        'ar'
      language = String(language).toLowerCase()
      const lang = language.startsWith('ar') ? 'ar' : 'en'
      const rtl = lang === 'ar'
      const dir = rtl ? 'rtl' : 'ltr'

      // Currency for wording
      const currency =
        req.body?.currency_override ||
        calc?.currency ||
        deal.details?.currency ||
        'EGP'

      // Reservation date
      let reservationDateDisplay = null
      let reservationDateIso = null

      const dbReservationDateRaw =
        approvedReservation?.reservation_date ||
        approvedReservation?.details?.reservation_date

      if (dbReservationDateRaw) {
        const d = new Date(dbReservationDateRaw)
        if (!Number.isNaN(d.getTime())) {
          const dd = String(d.getUTCDate()).padStart(2, '0')
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
          const yyyy = d.getUTCFullYear()
          reservationDateDisplay = `${dd}/${mm}/${yyyy}`
          reservationDateIso = `${yyyy}-${mm}-${dd}`
        }
      }

      if (!reservationDateIso) {
        const raw = req.body?.reservation_form_date
        if (typeof raw === 'string' && raw.trim()) {
          const trimmed = raw.trim()
          const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
          if (m) {
            const [, dd, mm, yyyy] = m
            reservationDateDisplay = `${dd}/${mm}/${yyyy}`
            reservationDateIso = `${yyyy}-${mm}-${dd}`
          } else {
            const d = new Date(trimmed)
            if (!Number.isNaN(d.getTime())) {
              const dd = String(d.getUTCDate()).padStart(2, '0')
              const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
              const yyyy = d.getUTCFullYear()
              reservationDateDisplay = `${dd}/${mm}/${yyyy}`
              reservationDateIso = `${yyyy}-${mm}-${dd}`
            } else {
              reservationDateDisplay = trimmed
            }
          }
        }
      }

      if (!reservationDateIso) {
        const d = new Date()
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const yyyy = d.getFullYear()
        reservationDateDisplay =
          reservationDateDisplay || `${dd}/${mm}/${yyyy}`
        reservationDateIso = `${yyyy}-${mm}-${dd}`
      }

      const reservationDate = reservationDateDisplay

      // Down payment information
      let dpTotal =
        Number(calc?.generatedPlan?.downPaymentAmount) ||
        Number(
          approvedReservation?.details?.dp?.total ??
            approvedReservation?.preliminary_payment
        ) ||
        0

      // request body preliminary payment
      let preliminaryPayment =
        Number(
          req.body?.preliminary_payment_amount ??
            req.body?.preliminary_payment
        ) || 0

      // If RF has a stored dp.preliminary_amount, prefer it
      if (approvedReservation?.details?.dp?.preliminary_amount != null) {
        const v = Number(approvedReservation.details.dp.preliminary_amount)
        if (Number.isFinite(v) && v >= 0) {
          preliminaryPayment = v
        }
      }

      let paidDpAmount = 0
      if (approvedReservation?.details?.dp?.paid_amount != null) {
        const v = Number(approvedReservation.details.dp.paid_amount)
        if (Number.isFinite(v) && v >= 0) paidDpAmount = v
      }

      const dpRemaining = Math.max(
        0,
        Number(dpTotal) - Number(preliminaryPayment) - Number(paidDpAmount)
      )

      // Unit pricing (from calc snapshot)
      const upb = calc?.unitPricingBreakdown || {}
      const totalExcl =
        Number(upb.totalExclMaintenance || upb.total_excl) ||
        (Number(upb.base || 0) +
          Number(upb.garden || 0) +
          Number(upb.roof || 0) +
          Number(upb.storage || 0) +
          Number(upb.garage || 0))
      const maintenance =
        Number(upb.maintenance || upb.maintenance_fee) || 0
      const totalIncl =
        Number(upb.totalInclMaintenance || upb.total_incl) ||
        totalExcl + maintenance

      const remainingPriceAfterDp = Math.max(
        0,
        Number(totalIncl) - Number(dpTotal)
      )

      // Buyer information
      const numBuyers = Math.min(
        Math.max(Number(calc?.clientInfo?.number_of_buyers) || 1, 1),
        4
      )
      const buyers = []
      for (let i = 1; i <= numBuyers; i++) {
        const sfx = i === 1 ? '' : `_${i}`
        buyers.push({
          buyer_name: calc?.clientInfo?.[`buyer_name${sfx}`] || '',
          id_or_passport:
            calc?.clientInfo?.[`id_or_passport${sfx}`] || '',
          nationality: calc?.clientInfo?.[`nationality${sfx}`] || '',
          address: calc?.clientInfo?.[`address${sfx}`] || '',
          phone_primary:
            calc?.clientInfo?.[`phone_primary${sfx}`] || '',
          phone_secondary:
            calc?.clientInfo?.[`phone_secondary${sfx}`] || ''
        })
      }

      const unit = {
        unit_code: calc?.unitInfo?.unit_code || '',
        unit_type: calc?.unitInfo?.unit_type || '',
        unit_id: calc?.unitInfo?.unit_id || null,
        unit_area: calc?.unitInfo?.unit_area || calc?.unitInfo?.area || '',
        garden_area: calc?.unitInfo?.garden_area || calc?.unitInfo?.garden || '',
        building_number: calc?.unitInfo?.building_number || calc?.unitInfo?.building || '',
        block_sector: calc?.unitInfo?.block_sector || calc?.unitInfo?.block || '',
        zone: calc?.unitInfo?.zone || ''
      }

      // Extract payment dates if available
      const prelimDateRaw = approvedReservation?.details?.dp?.preliminary_date || null
      const paidDateRaw = approvedReservation?.details?.dp?.paid_date || null
      
      const formatPaymentDate = (rawDate) => {
        if (!rawDate) return ''
        const d = new Date(rawDate)
        if (Number.isNaN(d.getTime())) return ''
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const yyyy = d.getFullYear()
        return `${dd}/${mm}/${yyyy}`
      }

      const prelimDateStr = formatPaymentDate(prelimDateRaw)
      const paidDateStr = formatPaymentDate(paidDateRaw)

      // Helpers
      const fmtNum = (n) =>
        Number(n || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })

      const priceWords = convertToWords(totalExcl, lang, { currency })
      const maintenanceWords = convertToWords(maintenance, lang, {
        currency
      })
      const totalWords = convertToWords(totalIncl, lang, { currency })
      const prelimWords = convertToWords(preliminaryPayment, lang, {
        currency
      })
      const paidDpWords = convertToWords(paidDpAmount, lang, {
        currency
      })
      const remainingDpWords = convertToWords(dpRemaining, lang, {
        currency
      })
      const remainingWords = convertToWords(
        remainingPriceAfterDp,
        lang,
        { currency }
      )

      const buyersHtml = buyers
        .map(
          (b, idx) => `
        <div class="buyer">
          <div><strong>${rtl ? 'العميل' : 'Buyer'} ${
            idx + 1
          }:</strong> ${b.buyer_name || '-'}</div>
          <div><strong>${
            rtl ? 'الرقم القومي / جواز السفر' : 'ID/Passport'
          }:</strong> ${b.id_or_passport || '-'}</div>
          <div><strong>${rtl ? 'الجنسية' : 'Nationality'}:</strong> ${
            b.nationality || '-'
          }</div>
          <div><strong>${rtl ? 'العنوان' : 'Address'}:</strong> ${
            b.address || '-'
          }</div>
          <div><strong>${rtl ? 'الهاتف' : 'Phone'}:</strong> ${[
            b.phone_primary,
            b.phone_secondary
          ]
            .filter(Boolean)
            .join(' / ') || '-'}</div>
        </div>
      `
        )
        .join('')

      const today = new Date()
      const ts = today.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })

      const css = `
      <style>
        @page { size: A4; margin: 10mm; }
        body { font-family: "Noto Naskh Arabic","Amiri","DejaVu Sans",Arial,sans-serif; direction:${dir}; font-size:12px; }
        h1,h2 { margin:0 0 6px; font-size:20px; }
        h3 { margin:0 0 5px; font-size:14px; }
        .header { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px; }
        .brand { font-size:16px; color:#A97E34; font-weight:700; }
        .meta { font-size:11px; color:#6b7280; }
        .section { margin:8px 0; }
        table { width:100%; border-collapse:collapse; }
        th, td { border:1px solid #1f2937; padding:5px; font-size:12px; background:#fffdf5; }
        th { background:#A97E34; color:#000; }
        .buyers { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .buyer { border:1px solid #ead9bd; border-radius:6px; padding:6px; background:#fff; font-size:12px; }
        .foot { margin-top:10px; font-size:11px; color:#6b7280; }
      </style>
      `

      const html = `
      <html lang="${lang}" dir="${dir}">
        <head>
          <meta charset="UTF-8" />
          ${css}
        </head>
        <body>
          <div class="header">
            <div class="brand">${
              rtl
                ? 'نموذج حجز وحدة — شركة أبتاون 6 أكتوبر'
                : 'Unit Reservation Form — Uptown 6 October'
            }</div>
            <div class="meta">
              ${(rtl ? 'تاريخ الطباعة' : 'Generated') + ': ' + ts}<br/>
              ${
                rtl
                  ? 'تاريخ الحجز'
                  : 'Reservation Date'
              }: ${reservationDate}
            </div>
          </div>
          <div class="section">
            <strong>${rtl ? 'الوحدة' : 'Unit'}:</strong>
            <br/>
            ${rtl 
              ? `نوع الوحدة / ${unit.unit_type} (مساحة الوحدة / ${unit.unit_area} م2) ${unit.garden_area ? `(مساحة الحديقة / ${unit.garden_area} م2)` : ''}`
              : `Unit Type / ${unit.unit_type} (Unit Area / ${unit.unit_area} m2) ${unit.garden_area ? `(Garden Area / ${unit.garden_area} m2)` : ''}`
            }
            <br/>
            ${rtl
              ? `كود الوحدة ${unit.unit_code} ( رقم المبنى ${unit.building_number} ) رقم البلوك ( ${unit.block_sector} ) رقم المجاورة ( ${unit.zone} ) بمشروع ابتاون ريزيدنس - حي ابتاون 6 أكتوبر`
              : `Unit Code ${unit.unit_code} ( Bldg ${unit.building_number} ) Block ( ${unit.block_sector} ) Zone ( ${unit.zone} ) - Uptown Residence Project`
            }
          </div>
          <div class="section">
            <h3>${rtl ? 'بيانات العملاء' : 'Buyer Information'}</h3>
            <div class="buyers">
              ${
                buyersHtml ||
                (rtl ? '<div>لا يوجد بيانات عملاء</div>' : '<div>No buyer data</div>')
              }
            </div>
          </div>
          <div class="section">
            <h3>${rtl ? 'قيمة الوحدة ووديعة الصيانة' : 'Unit Price & Maintenance'}</h3>
            <table>
              <tbody>
                <tr>
                  <th>${rtl ? 'إجمالي السعر بدون صيانة' : 'Total price excl. maintenance'}</th>
                  <td>${fmtNum(totalExcl)} ${currency}</td>
                  <td>${priceWords}</td>
                </tr>
                <tr>
                  <th>${rtl ? 'وديعة الصيانة' : 'Maintenance deposit'}</th>
                  <td>${fmtNum(maintenance)} ${currency}</td>
                  <td>${maintenanceWords}</td>
                </tr>
                <tr>
                  <th>${rtl ? 'إجمالي السعر شامل الصيانة' : 'Total price incl. maintenance'}</th>
                  <td>${fmtNum(totalIncl)} ${currency}</td>
                  <td>${totalWords}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="section">
            <h3>${rtl ? 'دفعة المقدم' : 'Down Payment'}</h3>
            <table>
              <tbody>
                <tr>
                  <th>${rtl ? 'إجمالي الدفعة' : 'Total Down Payment'}</th>
                  <td>${fmtNum(dpTotal)} ${currency}</td>
                  <td>${convertToWords(dpTotal, lang, { currency })}</td>
                </tr>
                <tr>
                  <th>
                    ${rtl ? 'الدفعة المبدئية عند الحجز' : 'Preliminary payment at reservation'}
                    ${prelimDateStr ? (rtl ? ` (تم سدادها بتاريخ ${prelimDateStr})` : ` (Paid on ${prelimDateStr})`) : ''}
                  </th>
                  <td>${fmtNum(preliminaryPayment)} ${currency}</td>
                  <td>${prelimWords}</td>
                </tr>
                <tr>
                  <th>
                    ${
                      dpRemaining === 0 
                        ? (rtl ? 'باقي دفعة المقدم' : 'Rest of Down Payment')
                        : (rtl ? 'مبالغ مدفوعة من قيمة دفعة المقدم' : 'Amounts paid from Down Payment value')
                    }
                    ${paidDateStr ? (rtl ? ` (تم سدادها بتاريخ ${paidDateStr})` : ` (Paid on ${paidDateStr})`) : ''}
                  </th>
                  <td>${fmtNum(paidDpAmount)} ${currency}</td>
                  <td>${paidDpWords}</td>
                </tr>
                ${
                  dpRemaining > 0
                    ? `<tr>
                        <th>${rtl ? 'المتبقي من قيمة دفعة المقدم' : 'Remaining from Down Payment value'}</th>
                        <td>${fmtNum(dpRemaining)} ${currency}</td>
                        <td>${remainingDpWords}</td>
                      </tr>`
                    : ''
                }
              </tbody>
            </table>
          </div>
          <div class="section">
            <h3>${rtl ? 'المتبقي من قيمة الوحدة' : 'Remaining Unit Price'}</h3>
            <table>
              <tbody>
                <tr>
                  <th>${rtl ? 'يتم سداد باقي المبلغ طبقا لملحق السداد المرفق' : 'Remaining amount to be paid per attached schedule'}</th>
                  <td>${fmtNum(remainingPriceAfterDp)} ${currency}</td>
                  <td>${remainingWords}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="section" style="margin-top:20px; border:2px solid #000; padding:10px;">
            <h3 style="text-align:center; margin:0; padding-bottom:10px; border-bottom:1px solid #ccc;">
              ${rtl ? 'شروط عامة متفق عليها' : 'General Agreed Conditions'}
            </h3>
            <ol style="font-size:10px; line-height:1.4; padding-${rtl ? 'right' : 'left'}:20px; margin:10px 0;">
              <li>${rtl 
                ? 'لا يجوز للعميل التنازل عن استمارة الحجز للغير إلا بموافقة كتابية من الشركة.' 
                : 'The Client may not assign this Reservation Form to third parties without written approval from the Company.'}</li>
              <li>${rtl 
                ? 'يلتزم العميل بتسليم الشيكات للشركة في مدة أقصاها (15) خمسة عشر يوم من تاريخ تحرير استمارة الحجز، يجوز مد المدة بموافقة الشركة اذا كان سبب التأخير راجع لإجراءات بنك العميل.' 
                : 'The Client commits to delivering checks to the Company within a maximum of (15) fifteen days from the date of this Reservation Form. This period may be extended with Company approval if the delay is due to Client bank procedures.'}</li>
              <li>${rtl 
                ? 'ينتهي العمل بهذه الاستمارة فور توقيع العميل على عقد الشراء وتطبق بنود العقد ويحل محل هذه الاستمارة.' 
                : 'This Form ceases to be effective immediately upon the Client signing the Purchase Contract, at which point the Contract terms apply and replace this Form.'}</li>
              <li>${rtl 
                ? 'في حالة رغبة العميل، في العدول عن إتمام البيع قبل استلامه للعقد، يقوم بإخطار الشركة برغبته في ذلك كتابة وفي هذه الحالة يخصم من العميل (20%) من الدفعة المقدمة.' 
                : 'In the event the Client wishes to withdraw from the sale before receiving the Contract, they must notify the Company in writing. In this case, (20%) of the Down Payment will be deducted.'}</li>
              <li>${rtl 
                ? 'يقر العميل بصحة جميع بياناته المذكورة أعلاه وأن عنوان المراسلات المذكور أعلاه بهذه الاستمارة محلا مختارا له وأن أي إعلانات أو إنذارات أو إخطارات أو مراسلات مرسلة إلى هذا العنوان تعتبر صحيحة وينتج عنها آثارها القانونية، وفي حالة تغيير العنوان المذكور أعلاه لا تعتبر أي إعلانات أو إنذارات أو إخطارات أو مراسلات مرسلة إلى على العنوان الجديد صحيحة ومنتجة لآثارها القانونية إلا بعد أن يرسل العميل إقرار جديد إلى الشركة يقر فيه بعنوانه الجديد.' 
                : 'The Client declares the accuracy of all data above and that the correspondence address listed is their chosen domicile. Any notices, warnings, or correspondence sent to this address are considered valid and legally binding. In case of address change, no notices sent to the new address are valid unless the Client sends a new written declaration to the Company with the new address.'}</li>
              <li>${rtl 
                ? 'يقر العميل انه إطلع على نسخة العقد على تطبيق و/أو موقع إلكتروني و/أو من خلال حضوره لمقر الشركة ويوافق عليه وليس عليه أي اعتراض على أي من بنوده.' 
                : 'The Client acknowledges having viewed a copy of the Contract via the app/website and/or by visiting Company premises, agrees to it, and has no objections to any of its clauses.'}</li>
              <li>${rtl 
                ? 'لا تعتبر هذه الاستمارة منتجة لآثارها مالم تكن موقعة من العميل ومسئول الحجز بالشركة ومختومة بختم الشركة دون كشط أو تعديل أو تحشير.' 
                : 'This Form is not legally binding unless signed by the Client and the Company Reservation Officer, and stamped with the Company seal without scratching, alteration, or insertion.'}</li>
              <li>${rtl 
                ? 'حررت استمارة الحجز من عدد 2 نسخة للعمل بموجبها عند اللزوم.' 
                : 'This Reservation Form is executed in two copies to be acted upon when necessary.'}</li>
            </ol>
          </div>

          <div class="section" style="margin-top:20px;">
            <div style="text-align:${rtl ? 'left' : 'right'}; font-weight:bold; margin-bottom:20px;">
              ${rtl ? 'حررت في تاريخ' : 'Edited on Date'} &nbsp;&nbsp;&nbsp;&nbsp; / &nbsp;&nbsp;&nbsp;&nbsp; / 20
            </div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:12px;">
              <div style="text-align:center;">
                ${rtl ? 'مسئول الحجز /' : 'Reservation Officer /'}<br/><br/>
                .........................
              </div>
              <div style="text-align:center;">
                ${rtl ? 'مدير الحسابات/' : 'Accounts Manager /'}<br/><br/>
                .........................
              </div>
              <div style="text-align:center;">
                ${rtl ? 'العميل /' : 'Client /'}<br/><br/>
                .........................
              </div>
            </div>
          </div>

          <div class="foot">
          </div>
        </body>
      </html>
      `

      const browser = await getBrowser()
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true
      })
      await page.close()

      const filename = `reservation_form_${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.pdf`
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      )
      return res.send(pdfBuffer)
    } catch (err) {
      console.error('POST /api/documents2/reservation-form error:', err)
      return bad(res, 500, 'Failed to generate Reservation Form PDF')
    }
  }
)

export default router