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

// Server-rendered Client Offer PDF
router.post('/client-offer', authMiddleware, requireRole(['property_consultant']), async (req, res) => {
  try {
    let {
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

    // Consultant identity
    let consultant = {
      name: (req.user?.name && String(req.user.name).trim()) ? req.user.name : null,
      email: req.user?.email || null
    }

    const dealId = Number(req.body?.deal_id)
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
      } catch {}
    }

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
      } catch {}
    }

    if (!buyers || !schedule) {
      if (Number.isFinite(dealId) && dealId > 0) {
        const dr = await pool.query('SELECT * FROM deals WHERE id=$1', [dealId])
        if (dr.rows.length) {
          const d = dr.rows[0]
          try {
            const calc = d.details?.calculator || {}
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
            if (!schedule && calc?.generatedPlan?.schedule) {
              schedule = calc.generatedPlan.schedule
              totals = calc.generatedPlan.totals || { totalNominal: 0 }
            }
            offer_date = offer_date || calc?.inputs?.offerDate || new Date().toISOString().slice(0, 10)
            first_payment_date = first_payment_date || calc?.inputs?.firstPaymentDate || offer_date
            unit = unit || {
              unit_code: calc?.unitInfo?.unit_code || '',
              unit_type: calc?.unitInfo?.unit_type || ''
            }
            language = language || (req.body?.language || 'en')
            currency = currency || (req.body?.currency || '')
          } catch {}
        }
      }
    }

    buyers = Array.isArray(buyers) && buyers.length ? buyers : []
    schedule = Array.isArray(schedule) ? schedule : []
    totals = totals || { totalNominal: schedule.reduce((s, e) => s + (Number(e.amount) || 0), 0) }
    language = (String(language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en')
    const rtl = language === 'ar'
    const dir = rtl ? 'rtl' : 'ltr'

    // Unit totals (optional) — prefer explicit breakdown from request for consistency with calculator.
    // If missing (or clearly all zeros), fall back to latest approved unit-model pricing for the unit so
    // the box is still populated for older deals that did not persist unit_pricing_breakdown correctly.
    let upb = null
    if (unit_pricing_breakdown && typeof unit_pricing_breakdown === 'object') {
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

      // Treat an all-zero breakdown as "not provided" so that we can fall back to pricing
      // instead of rendering 0.00 everywhere in the unit totals box.
      if (!allZero) {
        upb = candidate
      }
    }

    if (!upb && unit && Number.isFinite(Number(unit.unit_id)) && Number(unit.unit_id) > 0) {
      try {
        const r = await pool.query(`
          SELECT p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price
          FROM units u
          JOIN unit_model_pricing p ON p.model_id = u.model_id
          WHERE u.id=$1 AND p.status='approved'
          ORDER BY p.id DESC
          LIMIT 1
        `, [Number(unit.unit_id)])
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
      } catch (_) {
        // If lookup fails, keep upb as null and omit the box; PDF generation should still succeed.
      }
    }
    const totalExcl = upb
      ? (Number(upb.base || 0) +
         Number(upb.garden || 0) +
         Number(upb.roof || 0) +
         Number(upb.storage || 0) +
         Number(upb.garage || 0))
      : null
    const totalIncl = upb ? (Number(totalExcl || 0) + Number(upb.maintenance || 0)) : null

    function arLabel(label) {
      if (!label) return ''
      const L = String(label).toLowerCase()
      if (L.includes('down payment')) return 'دفعة التعاقد'
      if (L.includes('equal installment')) return 'قسط متساوي'
      if (L.includes('handover')) return 'التسليم'
      if (L.includes('maintenance')) return 'وديعة الصيانة'
      if (L.includes('garage fee')) return 'مصروفات الجراج'
      if (L.startsWith('year')) {
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
      return label
    }

    const css = `
      <style>
        /* Let Puppeteer page.pdf() control margins; avoid conflicting @page margins */
        @page { size: A4; }
        html { direction: ${dir}; }
        body { font-family: "Noto Naskh Arabic", "Amiri", "DejaVu Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        h1,h2,h3 { margin: 0 0 8px; }
        .header { display:flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .brand { font-size: 16px; color: #A97E34; font-weight: 700; }
        .meta { color: #6b7280; font-size: 12px; ${rtl ? 'text-align:right;' : ''}}
        .section { margin: 14px 0; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
        /* Corporate identity for plan table */
        .plan-table { table-layout: fixed; border: 2px solid #1f2937; }
        .plan-table th { text-align: ${rtl ? 'right' : 'left'}; background: #A97E34; color: #000; font-size: 12px; padding: 8px; border: 2px solid #1f2937; }
        .plan-table td { font-size: 12px; padding: 8px; border: 2px solid #1f2937; page-break-inside: avoid; background: #fffdf5; }
        .col-month { width: 8%; }
        .col-label { width: 30%; }
        .col-amount { width: 20%; }
        .col-date { width: 20%; white-space: nowrap; }
        .col-words { width: 22%; }
        .buyers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .buyer { border: 1px solid #ead9bd; border-radius: 8px; padding: 8px; background: #fff; }
        .foot { margin-top: 12px; color:#6b7280; font-size: 11px; }

        /* Compact unit summary box (corporate colors) */
        .unit-summary { width: 280px; border: 2px solid #1f2937; }
        .unit-summary table { width: 100%; border-collapse: collapse; }
        .unit-summary th { background: #A97E34; color: #000; text-align: center; font-weight: 700; padding: 6px; border: 2px solid #1f2937; }
        .unit-summary td { background: #d9b45b; color: #000; padding: 6px; border: 2px solid #1f2937; font-size: 12px; }
        .unit-summary .label { width: 60%; }
        .unit-summary .value { width: 40%; text-align: ${rtl ? 'left' : 'right'}; }
        .unit-summary .total td { background: #f0d18a; font-weight: 700; }
      </style>
    `
    const f = (s) => Number(s || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtDate = (s) => {
      if (!s) return ''
      // Input may be YYYY-MM-DD; output DD-MM-YYYY in local time
      const d = new Date(s)
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2,'0')
        const mm = String(d.getMonth()+1).padStart(2,'0')
        const yyyy = d.getFullYear()
        const out = `${dd}-${mm}-${yyyy}`
        return out
      }
      // Fallback: simple split
      const parts = String(s).split('-')
      return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : s
    }
    const localTimestamp = () => {
      // Always render timestamp in Cairo time
      const timeZone = process.env.TIMEZONE || process.env.TZ || 'Africa/Cairo'
      const d = new Date()
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
      const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]))
      const dd = parts.day || '01'
      const mm = parts.month || '01'
      const yyyy = parts.year || '1970'
      const hh = parts.hour || '00'
      const mi = parts.minute || '00'
      const ss = parts.second || '00'
      return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
    }
    const todayTs = localTimestamp()
    const title = rtl ? 'عرض السعر للعميل' : 'Client Offer'
    const tSchedule = rtl ? 'خطة السداد' : 'Payment Plan'
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
    const tTotals = rtl ? 'ملخص قيمة الوحدة' : 'Unit Totals'
    const tBase = rtl ? 'السعر الأساسي' : 'Base'
    const tGarden = rtl ? 'الحديقة' : 'Garden'
    const tRoof = rtl ? 'السطح' : 'Roof'
    const tStorage = rtl ? 'غرفة التخزين' : 'Storage'
    const tGarage = rtl ? 'الجراج' : 'Garage'
    const tMaintenance = rtl ? 'وديعة الصيانة' : 'Maintenance Deposit'
    const tTotalExcl = rtl ? 'الإجمالي (بدون وديعة الصيانة)' : 'Total (excl. maintenance)'
    const tTotalIncl = rtl ? 'الإجمالي (شامل وديعة الصيانة)' : 'Total (incl. maintenance)'

    const buyersHtml = buyers.map((b, idx) => `
      <div class="buyer">
        <div><strong>${rtl ? 'العميل' : 'Buyer'} ${idx + 1}:</strong> ${b.buyer_name || '-'}</div>
        <div><strong>${rtl ? 'الهاتف' : 'Phone'}:</strong> ${[b.phone_primary, b.phone_secondary].filter(Boolean).join(' / ') || '-'}</div>
        <div><strong>${tEmail}:</strong> ${b.email || '-'}</div>
      </div>
    `).join('')

    const summaryBoxHtml = upb ? `
      <div class="unit-summary">
        <table>
          <thead>
            <tr><th colspan="2">${unit?.unit_type ? unit.unit_type : (rtl ? 'الوحدة' : 'Unit')}</th></tr>
          </thead>
          <tbody>
            <tr><td class="label">${tBase}</td><td class="value">${f(upb.base)} ${currency || ''}</td></tr>
            ${Number(upb.garden||0)>0 ? `<tr><td class="label">${tGarden}</td><td class="value">${f(upb.garden)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.roof||0)>0 ? `<tr><td class="label">${tRoof}</td><td class="value">${f(upb.roof)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.storage||0)>0 ? `<tr><td class="label">${tStorage}</td><td class="value">${f(upb.storage)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.garage||0)>0 ? `<tr><td class="label">${tGarage}</td><td class="value">${f(upb.garage)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.maintenance||0)>0 ? `<tr><td class="label">${tMaintenance}</td><td class="value">${f(upb.maintenance)} ${currency || ''}</td></tr>` : ''}
            ${totalIncl != null ? `<tr class="total"><td class="label">${tTotalIncl}</td><td class="value">${f(totalIncl)} ${currency || ''}</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    ` : ''

    const langForWords = language
    const scheduleRows = schedule.map((r) => {
      const labelText = rtl ? arLabel(r.label || '') : (r.label || '')
      const amount = Number(r.amount) || 0
      const words = convertToWords(amount, langForWords, { currency })
      const dateStr = fmtDate(r.date || '')
      return `
        <tr>
          <td class="col-month">${Number(r.month) || 0}</td>
          <td class="col-label">${labelText}</td>
          <td class="col-amount" style="text-align:${rtl ? 'left' : 'right'}">${f(amount)} ${currency || ''}</td>
          <td class="col-date">${dateStr}</td>
          <td class="col-words">${words || ''}</td>
        </tr>
      `
    }).join('')

    const unitLine = unit ? `${unit.unit_code || ''} ${unit.unit_type ? '— ' + unit.unit_type : ''}`.trim() : ''
    const consultantLine = (consultant.name || consultant.email)
      ? `<div class="meta"><strong>${tConsultant}:</strong> ${[consultant.name, consultant.email].filter(Boolean).join(' — ')}</div>`
      : ''

    const html = `
      <html lang="${language}" dir="${dir}">
        <head>
          <meta charset="UTF-8" />
          ${css}
        </head>
        <body>
          <!-- Body header removed; repeating headerTemplate will render on each page -->
          <div class="section" style="margin-top: 20mm;">
            <div style="display:flex; gap:12px; align-items:stretch;">
              ${rtl ? `
                ${summaryBoxHtml}
                <div style="flex:1;">
                  <div class="buyers">
                    ${buyersHtml || '<div>لا يوجد بيانات عملاء</div>'}
                  </div>
                </div>
              ` : `
                <div style="flex:1;">
                  <div class="buyers">
                    ${buyersHtml || '<div>No client data</div>'}
                  </div>
                </div>
                ${summaryBoxHtml}
              `}
            </div>
          </div>
          <div class="section">
            <h3 style="${rtl ? 'text-align:right;' : ''}">${tSchedule}</h3>
            <table class="plan-table">
              <thead>
                <tr>
                  <th class="col-month">${tMonth}</th>
                  <th class="col-label">${tLabel}</th>
                  <th class="col-amount" style="text-align:${rtl ? 'left' : 'right'}">${tAmount}</th>
                  <th class="col-date">${tDate}</th>
                  <th class="col-words">${tAmountWords}</th>
                </tr>
              </thead>
              <tbody>
                ${scheduleRows || `<tr><td colspan="5">${rtl ? 'لا توجد بيانات' : 'No data'}</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="foot" style="${rtl ? 'text-align:right;' : 'text-align:left;'}">
            ${rtl
              ? 'هذا المستند ليس عقدًا وهو مُعد لعرض الأسعار للعميل فقط. قد تختلف القيم عند التعاقد النهائي.'
              : 'This document is not a contract and is generated for client viewing only. Values are indicative and subject to final contract.'}
          </div>
        </body>
      </html>
    `

    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const footerTemplate = `
      <div style="width:100%; font-size:10px; color:#6b7280; padding:6px 10px; font-family:'Noto Naskh Arabic','Amiri','DejaVu Sans',Arial, sans-serif; ${rtl ? 'direction:rtl; unicode-bidi:bidi-override; text-align:left;' : 'direction:ltr; text-align:right;'}">
        ${rtl ? 'صفحة' : 'Page'} <span class="pageNumber"></span> ${rtl ? 'من' : 'of'} <span class="totalPages"></span>
      </div>`
    const headerTemplate = `
      <div style="width:100%; padding:12px 14px 8px; font-family:'Noto Naskh Arabic','Amiri','DejaVu Sans',Arial,sans-serif; ${rtl ? 'direction:rtl; unicode-bidi:bidi-override;' : 'direction:ltr;'}">
        <div style="display:flex; justify-content:space-between; align-items:flex-end;">
          <div style="${rtl ? 'text-align:left;' : 'text-align:left'}; color:#A97E34; font-weight:700; font-size:13px;">
            ${rtl ? 'نظام شركة أبتاون 6 أكتوبر المالي' : 'Uptown 6 October Financial System'}
          </div>
          <div style="${rtl ? 'text-align:right;' : 'text-align:right'}; font-size:10px; color:#6b7280;">
            ${rtl ? 'تم الإنشاء' : 'Generated'}: ${todayTs}
          </div>
        </div>
        <div style="text-align:center; font-weight:800; font-size:20px; color:#111827; margin-top:6px;">
          ${title}
        </div>
        <div style="font-size:11px; color:#374151; margin-top:4px; ${rtl ? 'text-align:right;' : 'text-align:left;'}">
          <span style="font-weight:700;">${tOfferDate}:</span> ${fmtDate(offer_date || '')}
          &nbsp;&nbsp;<span style="font-weight:700;">${tFirstPayment}:</span> ${fmtDate(first_payment_date || '')}<br/>
          <span style="font-weight:700;">${tUnit}:</span> ${unit?.unit_code || ''} — ${unit?.unit_type || ''}<br/>
          <span style="font-weight:700;">${tConsultant}:</span> ${consultant?.email || ''}
        </div>
      </div>`
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '35mm', right: '12mm', bottom: '18mm', left: '12mm' }
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

// Server-rendered Reservation Form PDF
// Allow read-only generation for contract workflow and management roles so
// Contract Admin / CM / TM can inspect the same RF document used for the deal.
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
    if (dr.rows.length === 0) return bad(res, 404, 'Deal not found')
    const deal = dr.rows[0]

    // Fetch consultant (deal creator) for the header
    let consultant = { name: null, email: null }
    try {
      const u = await pool.query(`
        SELECT
          u.email,
          COALESCE(NULLIF(TRIM(u.meta->>'name'), ''), u.email) AS full_name
        FROM deals d
        JOIN users u ON u.id = d.created_by
        WHERE d.id=$1
        LIMIT 1
      `, [dealId])
      if (u.rows.length) {
        consultant = {
          name: u.rows[0].full_name || null,
          email: u.rows[0].email || null
        }
      }
    } catch (e) {
      console.error('Failed to fetch consultant for RF:', e)
    }

    // Look up any approved reservation form linked to this deal. This serves two purposes:
    // - When fm_review_at is null, the presence of an approved reservation form is the FM approval signal.
    // - Once a reservation form is approved, its preliminary_payment should be treated as locked and reused
    //   for all Reservation Form PDFs, regardless of what the client sends in the request body.
    let approvedReservation = null
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
        LIMIT 1
        `,
        [dealId]
      )
      if (rf.rows.length > 0) {
        approvedReservation = rf.rows[0]
      }
    } catch (e) {
      console.error('Failed to look up approved reservation:', e)
    }

    // Cairo-local timestamp helper
    const localTimestamp = () => {
      const timeZone = process.env.TIMEZONE || process.env.TZ || 'Africa/Cairo'
      const d = new Date()
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
      const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]))
      const dd = parts.day || '01'
      const mm = parts.month || '01'
      const yyyy = parts.year || '1970'
      const hh = parts.hour || '00'
      const mi = parts.minute || '00'
      const ss = parts.second || '00'
      return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
    }
    const todayTs = localTimestamp()

    // Date formatter DD-MM-YYYY
    const fmtDate = (s) => {
      if (!s) return ''
      const d = new Date(s)
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const yyyy = d.getFullYear()
        return `${dd}-${mm}-${yyyy}`
      }
      const parts = String(s).split('-')
      return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : s
    }

    // Determine language and reservation date for the Reservation Form layout.
    const calcForLanguage = deal.details?.calculator || {}

    // Language: prefer explicit request, then calculator snapshot, then default to Arabic.
    let language = req.body?.language || calcForLanguage?.language || calcForLanguage?.inputs?.language || 'ar'
    language = String(language).toLowerCase()
    language = language.startsWith('ar') ? 'ar' : 'en'
    const rtl = language === 'ar'

    // Reservation date:
    // - Once an approved reservation form exists, always use its stored reservation_date.
    // - Otherwise prefer reservation_form_date from the request (dd/MM/YYYY or ISO-like),
    //   then fall back to today.
    let reservationDateDisplay = null
    let reservationDateIso = null

    const dbReservationDateRaw =
      approvedReservation?.reservation_date || approvedReservation?.details?.reservation_date

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
      const rawReservationFormDate = req.body?.reservation_form_date
      if (typeof rawReservationFormDate === 'string' && rawReservationFormDate.trim()) {
        const trimmed = rawReservationFormDate.trim()
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
        if (m) {
          const [, dd, mm, yyyy] = m
          reservationDateDisplay = `${dd}/${mm}/${yyyy}`
          const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
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
      reservationDateDisplay = reservationDateDisplay || `${dd}/${mm}/${yyyy}`
      reservationDateIso = `${yyyy}-${mm}-${dd}`
    }

    const reservationDate = reservationDateDisplay

    let dayOfWeek = ''
    try {
      const d = new Date(reservationDateIso || reservationDate)
      const namesEn = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      const namesAr = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']
      dayOfWeek = (rtl ? namesAr : namesEn)[d.getDay()] || ''
    } catch {}

    const calc = deal.details?.calculator || {}

    // Total down payment should come from the calculator snapshot and be stored
    // on the reservation form; we still compute it here as a fallback so older
    // reservations (without dp.total) render correctly.
    let downPayment = Number(calc?.generatedPlan?.downPaymentAmount) || 0
    if (!(downPayment > 0)) {
      try {
        const dpRow = (calc?.generatedPlan?.schedule || []).find(r =>
          String(r.label || '').toLowerCase().includes('down payment')
        )
        if (dpRow) downPayment = Number(dpRow.amount) || 0
      } catch {}
    }

    // Pricing for the reservation form must come strictly from the deal snapshot
    // (calc.unitPricingBreakdown) so it reflects the agreed offer, not any later
    // changes in unit_model_pricing. We still read structural unit fields such as
    // area, building number, block/sector, and zone from the live units table for
    // informational purposes only; we do NOT override prices from there.
    let upb = calc?.unitPricingBreakdown || null
    let totalIncl = 0

    // Ensure preliminaryPayment is defined (default to 0 if missing from request/approval)
    let preliminaryPayment = 0
    if (approvedReservation) {
      const fromColumn = approvedReservation.preliminary_payment
      const fromDetails = approvedReservation.details?.preliminary_payment
      preliminaryPayment = Number(fromColumn != null ? fromColumn : fromDetails) || 0
    } else {
      const fromBody = req.body?.preliminary_payment_amount ?? req.body?.preliminary_payment
      preliminaryPayment = Number(fromBody) || 0
    }

    // Down payment breakdown (total / preliminary / additional paid / remaining) —
    // prefer the stored dp object from reservation_forms.details when present.
    let dpTotal = downPayment
    let paidDpAmount = 0
    let prelimDateForText = reservationDate // default: reservation date if we don't have a separate preliminary date
    let paidDpDateForText = '' // date string for the additional paid DP line

    if (approvedReservation && approvedReservation.details && approvedReservation.details.dp) {
      const dp = approvedReservation.details.dp
      if (dp.total != null) {
        const v = Number(dp.total)
        if (Number.isFinite(v) && v >= 0) dpTotal = v
      }
      if (dp.preliminary_amount != null) {
        const v = Number(dp.preliminary_amount)
        if (Number.isFinite(v) && v >= 0) {
          preliminaryPayment = v
        }
      }
      if (dp.preliminary_date) {
        try {
          const d = new Date(dp.preliminary_date)
          if (!Number.isNaN(d.getTime())) {
            const dd = String(d.getUTCDate()).padStart(2, '0')
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
            const yyyy = d.getUTCFullYear()
            prelimDateForText = `${dd}/${mm}/${yyyy}`
          }
        } catch {}
      }
      if (dp.paid_amount != null) {
        const v = Number(dp.paid_amount)
        if (Number.isFinite(v) && v >= 0) {
          paidDpAmount = v
        }
      }
      if (dp.paid_date) {
        try {
          const d = new Date(dp.paid_date)
          if (!Number.isNaN(d.getTime())) {
            const dd = String(d.getUTCDate()).padStart(2, '0')
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
            const yyyy = d.getUTCFullYear()
            paidDpDateForText = `${dd}/${mm}/${yyyy}`
          }
        } catch {}
      }
      // If dp.remaining is stored, prefer it; otherwise recompute as dpTotal - prelim - paid.
      if (dp.remaining != null) {
        const v = Number(dp.remaining)
        if (Number.isFinite(v) && v >= 0) {
          // we will recompute remainingAmount later using totals, but keep this
          // value for down payment lines where needed.
        }
      }
    }

    const dpRemaining = Math.max(0, Number(dpTotal) - Number(preliminaryPayment) - Number(paidDpAmount))

    // Currency for RF comes from the calculator snapshot / deal details; there is
    // no separate UIcurrency variable in this route, so avoid referencing it.
    let currency = calc?.currency || deal.details?.currency || ''
    let unit = {
      unit_code: calc?.unitInfo?.unit_code || '',
      unit_type: calc?.unitInfo?.unit_type || '',
      unit_id: calc?.unitInfo?.unit_id || null,
      unit_area: null,
      building_number: null,
      block_sector: null,
      zone: null
    }
    try {
      const unitId = Number(unit?.unit_id)
      if (Number.isFinite(unitId) && unitId > 0) {
        const r = await pool.query(`
          SELECT
            u.area AS unit_area,
            u.building_number,
            u.block_sector,
            u.zone
          FROM units u
          WHERE u.id=$1
          LIMIT 1
        `, [unitId])
        if (r.rows.length) {
          const row = r.rows[0]
          unit.unit_area = row.unit_area != null ? Number(row.unit_area) || null : null
          unit.building_number = row.building_number != null ? String(row.building_number) : null
          unit.block_sector = row.block_sector != null ? String(row.block_sector) : null
          unit.zone = row.zone != null ? String(row.zone) : null
        }
      }
    } catch {}

    const totalExcl = (Number(upb?.base||0)+Number(upb?.garden||0)+Number(upb?.roof||0)+Number(upb?.storage||0)+Number(upb?.garage||0))
    totalIncl = totalExcl + (Number(upb?.maintenance||0))

    // Remaining Amount (باقي المبلغ) should reflect the total price after
    // deducting the full agreed Down Payment (regardless of how it is split
    // between preliminary / paid / remaining portions).
    const remainingAmount = Math.max(
      0,
      Number(totalIncl) - Number(dpTotal)
    )

    // Amount-in-words helpers (respect RF language and currency)
    const langForWords = language
    const priceWords = convertToWords(totalExcl, langForWords, { currency })
    const maintenanceWords = convertToWords(Number(upb?.maintenance||0), langForWords, { currency })
    const totalWords = convertToWords(totalIncl, langForWords, { currency })
    const prelimWords = convertToWords(preliminaryPayment, langForWords, { currency })
    const paidDpWords = convertToWords(paidDpAmount, langForWords, { currency })
    const remainingDpWords = convertToWords(dpRemaining, langForWords, { currency })
    const remainingWords = convertToWords(remainingAmount, langForWords, { currency })

    const numBuyers = Math.min(Math.max(Number(calc?.clientInfo?.number_of_buyers) || 1, 1), 4)
    const buyers = []
    for (let i = 1; i <= numBuyers; i++) {
      const sfx = i === 1 ? '' : `_${i}`
      buyers.push({
        buyer_name: calc?.clientInfo?.[`buyer_name${sfx}`] || '',
        nationality: calc?.clientInfo?.[`nationality${sfx}`] || '',
        id_or_passport: calc?.clientInfo?.[`id_or_passport${sfx}`] || '',
        id_issue_date: calc?.clientInfo?.[`id_issue_date${sfx}`] || '',
        birth_date: calc?.clientInfo?.[`birth_date${sfx}`] || '',
        address: calc?.clientInfo?.[`address${sfx}`] || '',
        phone_primary: calc?.clientInfo?.[`phone_primary${sfx}`] || '',
        phone_secondary: calc?.clientInfo?.[`phone_secondary${sfx}`] || '',
        email: calc?.clientInfo?.[`email${sfx}`] || ''
      })
    }

    const L = (en, ar) => rtl ? ar : en
    const dir = rtl ? 'rtl' : 'ltr'
    const textAlignLeft = rtl ? 'text-right' : 'text-left'
    const textAlignRight = rtl ? 'text-left' : 'text-right'

    // Title and header labels specific to the Reservation Form PDF
    // Note: 'title' is used in both the HTML body and the PDF header
    const title = L('Reservation Form – Residential Unit', 'إستمارة حجز – وحدة سكنية')

    // Header specific labels (fixing ReferenceError)
    // If business wants the label to remain "Offer Date", change the first string only.
    const tOfferDate = L('Reservation Date', 'تاريخ الحجز')
    const tFirstPayment = L('First Payment', 'أول دفعة')
    const tUnit = L('Unit', 'الوحدة')
    const tConsultant = L('Property Consultant', 'المستشار العقاري')

    // Header data mapping
    const offer_date = reservationDateIso || reservationDate
    const first_payment_date = calc?.inputs?.firstPaymentDate || (reservationDateIso || reservationDate)
    const headerReservationDateLabel = L('Reservation Date', 'تاريخ الحجز')
    const headerUnitLabel = L('Unit', 'الوحدة')

    // Build buyers HTML (up to 4 owners) using compact blocks
    const buyersHtml = buyers.length
      ? buyers.map((b, idx) => `
        <div class="flex items-center mb-2 text-base leading-relaxed">
          <span class="font-bold w-28 ml-2">${L('Buyer', 'العميل')} ${idx + 1}:</span>
          <span class="flex-1 border-b border-dotted border-gray-500 pb-0.5">
            ${b.buyer_name || '-'}
          </span>
        </div>
      `).join('')
      : `<div class="text-gray-500 text-sm">${L('No client data', 'لا توجد بيانات عملاء')}</div>`

    const html = `
      <!DOCTYPE html>
      <html lang="${language}" dir="${dir}">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>${L('Reservation Form – Residential Unit', 'إستمارة حجز – وحدة سكنية')}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="${rtl
          ? 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap'
          : 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'}" rel="stylesheet">
        <style>
          html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body {
            font-family: ${rtl ? "'Cairo', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" : "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"};
            background-color: #f3f4f6;
          }
          .page {
            background: white;
            box-shadow: 0 0 15px rgba(0,0,0,0.1);
            max-width: 210mm;
            min-height: 297mm;
            margin: 20px auto;
            padding: 20mm;
            position: relative;
          }
          .form-input-like {
            border-bottom: 1px dotted #000;
            display: inline-block;
            min-width: 80px;
          }
          @media print {
            body { background: none; margin: 0; }
            .page {
              box-shadow: none;
              margin: 0;
              width: 100%;
              max-width: none;
              padding: 10mm;
            }
          }
          /* Corporate identity table styling for RF breakdown */
          .rf-table { border: 2px solid #1f2937; border-collapse: collapse; width: 100%; }
          .rf-table th {
            background: #A97E34;
            color: #000;
            border: 2px solid #1f2937;
            font-size: 12px;
            padding: 6px;
          }
          .rf-table td {
            border: 2px solid #1f2937;
            background: #fffdf5;
            font-size: 12px;
            padding: 6px;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <!-- Header -->
          <header class="text-center mb-8 border-b-4 border-double border-gray-800 pb-4">
            <h1 class="text-3xl font-bold text-gray-900 mb-1">
              ${L('Reservation Form – Residential Unit', 'إستمارة حجز – وحدة سكنية')}
            </h1>
            <p class="text-xl font-bold text-gray-700">
              ${L('Uptown Residence Project', 'مشروع ابتاون ريزيدنس')}
            </p>
          </header>

          <!-- Intro / Date -->
          <section class="mb-6 text-lg leading-relaxed ${textAlignLeft}">
            <p>
              ${rtl
                ? `إنه فى يوم <span class="form-input-like px-2">${dayOfWeek || '-'}</span>
                    الموافق <span class="form-input-like px-2">${reservationDate || '-'}</span>
                    تحررت استمارة الحجز الآتي بياناتها:`
                : `On the day of <span class="form-input-like px-2">${dayOfWeek || '-'}</span>,
                    dated <span class="form-input-like px-2">${reservationDate || '-'}</span>,
                    this reservation form has been issued with the following details:`}
            </p>
          </section>

          <!-- Buyers Section -->
          <section class="mb-6">
            <h2 class="text-xl font-bold text-white bg-gray-800 px-4 py-2 mb-4 inline-block rounded-sm print:text-black print:bg-transparent print:border print:border-black">
              ${L('Client Information', 'بيانات العميل')}
            </h2>
            <div class="text-lg">
              ${buyersHtml}
            </div>
          </section>

          <!-- Unit and Financial Data -->
          <section class="mb-8">
            <h2 class="text-xl font-bold text-white bg-gray-800 px-4 py-2 mb-4 inline-block rounded-sm print:text-black print:bg-transparent print:border print:border-black">
              ${L('Unit Information and Financial Details', 'بيانات الوحدة وطريقة السداد')}
            </h2>

            <div class="space-y-3 text-lg leading-relaxed ${textAlignLeft}">
              <div>
                <span class="font-bold">${L('Unit Type', 'نوع الوحدة')}:</span>
                <span class="form-input-like px-2">
                  ${L('Residential Apartment', 'شقة سكنية')} (${unit.unit_type || '-'})
                </span>
                <span class="ml-4">
                  ${L('(Unit Area /', '(Unit Area /')} 
                  <span class="form-input-like px-2">
                    ${unit.unit_area != null ? Number(unit.unit_area).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' م²' : '-'}
                  </span>
                  )
                </span>
              </div>
              <div>
                <span class="font-bold">${L('Unit Code', 'كود الوحدة')}:</span>
                <span class="form-input-like px-2">${unit.unit_code || '-'}</span>
              </div>
              <div>
                <span class="font-bold">${L('Building Number', 'مبنى رقم')}:</span>
                <span class="form-input-like px-2">${unit.building_number || '-'}</span>
                <span class="ml-4 font-bold">${L('Block/Sector', 'قطاع')}:</span>
                <span class="form-input-like px-2">${unit.block_sector || '-'}</span>
                <span class="ml-4 font-bold">${L('Zone', 'مجاورة')}:</span>
                <span class="form-input-like px-2">${unit.zone || '-'}</span>
              </div>
              <div class="text-sm text-gray-700 mt-1">
                ${rtl
                  ? 'بمشروع ابتاون ريزيدنس – حى ابتاون ٦ أكتوبر'
                  : 'Uptown Residence Project – Uptown 6th of October District'}
              </div>
            </div>

            <div class="mt-4">
              ${rtl ? `
                <div class="space-y-2 text-base leading-relaxed ${textAlignLeft}">
                  <p>
                    ثمن الوحدة شامل المساحة الإضافية والجراج وغرفة التخزين /
                    ${Number(totalExcl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${priceWords} لاغير)
                  </p>
                  <p>
                    وديعة الصيانة /
                    ${Number(upb?.maintenance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${maintenanceWords} لاغير)
                  </p>
                  <p>
                    إجمالي المطلوب سداده /
                    ${Number(totalIncl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${totalWords} لاغير)
                  </p>
                  <p>
                    دفعة حجز مبدئي :
                    ${Number(preliminaryPayment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${prelimWords} لاغير)
                    تم سدادها بتاريخ
                    ${prelimDateForText}
                  </p>
                  <p>
                    دفعة من دفعة التعاقد:
                    ${Number(paidDpAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${paidDpWords} لاغير)
                    ${paidDpAmount > 0 && paidDpDateForText ? `تم سدادها بتاريخ ${paidDpDateForText}` : ''}
                  </p>
                  <p>
                    باقي دفعة التعاقد:
                    ${Number(dpRemaining).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${remainingDpWords} لاغير)
                  </p>
                  <p>
                    باقي المبلغ:
                    ${Number(remainingAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جم
                    (${remainingWords} لاغير)
                  </p>
                  <p class="mt-2 text-sm italic text-gray-700">
                    * يتم سداد باقي المبلغ طبقا لملحق السداد المرفق.
                  </p>
                </div>
              ` : `
                <table class="rf-table">
                  <thead>
                    <tr>
                      <th class="${textAlignLeft}">${L('Item', 'البند')}</th>
                      <th class="${textAlignRight}">${L('Amount', 'القيمة')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Base Price (excl. maintenance)</td>
                      <td class="${textAlignRight}">
                        ${Number(totalExcl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}
                        <div class="text-xs text-gray-600 mt-1">${priceWords}</div>
                      </td>
                    </tr>
                    <tr>
                      <td>Maintenance Deposit</td>
                      <td class="${textAlignRight}">
                        ${Number(upb?.maintenance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}
                        <div class="text-xs text-gray-600 mt-1">${maintenanceWords}</div>
                      </td>
                    </tr>
                    <tr>
                      <td class="font-semibold">Total (incl. maintenance)</td>
                      <td class="${textAlignRight} font-semibold">
                        ${Number(totalIncl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}
                        <div class="text-xs text-gray-600 mt-1">${totalWords}</div>
                      </td>
                    </tr>
                    <tr>
                      <td>Preliminary Reservation Payment</td>
                      <td class="${textAlignRight}">
                        ${Number(preliminaryPayment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}
                        <div class="text-xs text-gray-600 mt-1">${prelimWords}</div>
                      </td>
                    </tr>
                    <tr>
                      <td>Contract Down Payment (net of reservation)</td>
                      <td class="${textAlignRight}">
                        ${dpNetOfPrelim.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}
                        <div class="text-xs text-gray-600 mt-1">${dpNetWords}</div>
                      </td>
                    </tr>
                    <tr>
                      <td class="font-semibold">Remaining Amount</td>
                      <td class="${textAlignRight} font-semibold">
                        ${Number(remainingAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}
                        <div class="text-xs text-gray-600 mt-1">${remainingWords}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p class="mt-2 text-sm italic text-gray-500 ${textAlignLeft}">
                  * The remaining amount will be paid according to the attached payment plan.
                </p>
              `}
            </div>
          </section>

          <!-- Conditions (shortened, based on your Arabic sample) -->
          <section class="mb-8 text-justify">
            <h2 class="text-xl font-bold text-white bg-gray-800 px-4 py-2 mb-4 inline-block rounded-sm print:text-black print:bg-transparent print:border print:border-black">
              ${L('General Terms and Conditions', 'شروط عامة متفق عليها')}
            </h2>
            <ol class="list-decimal list-inside space-y-1 text-sm md:text-base leading-relaxed text-gray-800 ${rtl ? 'text-right' : ''}">
              <li>${L(
                'The client may not assign this reservation form to a third party without the company’s written approval.',
                'لا يجوز للعميل التنازل عن استمارة الحجز للغير إلا بموافقة كتابية من الشركة.'
              )}</li>
              <li>${L(
                'The client shall deliver the cheques to the company within 15 days from the date of issuing this reservation form unless extended by the company.',
                'يلتزم العميل بتسليم الشيكات للشركة في مدة أقصاها (15) خمسة عشر يوم من تاريخ تحرير استمارة الحجز، ويجوز مد المدة بموافقة الشركة.'
              )}</li>
              <li>${L(
                'This reservation form ceases to be valid once the purchase contract is signed and the contract terms apply instead.',
                'ينتهي العمل بهذه الاستمارة فور توقيع العميل على عقد الشراء وتطبق بنود العقد ويحل محل هذه الاستمارة.'
              )}</li>
              <li>${L(
                'If the client wishes to withdraw before signing the contract, the company may deduct a percentage from the paid amounts according to policy.',
                'في حالة رغبة العميل في العدول عن إتمام البيع قبل استلامه للعقد، يحق للشركة خصم نسبة من المبالغ المدفوعة طبقا للسياسة المعتمدة.'
              )}</li>
            </ol>
          </section>

          <!-- Footer / Signatures -->
          <footer class="mt-10 pt-6 border-t-2 border-gray-800">
            <div class="text-center mb-6 text-base">
              <span class="font-medium">
                ${L('Issued on:', 'حررت في تاريخ:')}
              </span>
              <span class="form-input-like px-2">${reservationDate || '-'}</span>
            </div>
            <div class="grid grid-cols-3 gap-8 text-center text-sm md:text-base">
              <div class="flex flex-col items-center">
                <p class="font-bold mb-8">${L('Prepared By', 'إعداد')}</p>
                <div class="w-3/4 border-b border-gray-400 h-8"></div>
              </div>
              <div class="flex flex-col items-center">
                <p class="font-bold mb-8">${L('Client', 'العميل')}</p>
                <div class="w-3/4 border-b border-gray-400 h-8"></div>
              </div>
              <div class="flex flex-col items-center">
                <p class="font-bold mb-8">${L('Reservation Officer', 'مسئول الحجز')}</p>
                <div class="w-3/4 border-b border-gray-400 h-8"></div>
              </div>
            </div>
          </footer>
        </div>
      </body>
      </html>
    `

    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const footerTemplate = `
      <div style="width:100%; font-size:10px; color:#6b7280; padding:6px 10px; font-family:'Noto Naskh Arabic','Amiri','DejaVu Sans',Arial, sans-serif; ${rtl ? 'direction:rtl; unicode-bidi:bidi-override; text-align:left;' : 'direction:ltr; text-align:right;'}">
        ${rtl ? 'صفحة' : 'Page'} <span class="pageNumber"></span> ${rtl ? 'من' : 'of'} <span class="totalPages"></span>
      </div>`
    const headerTemplate = `
      <div style="width:100%; padding:12px 14px 8px; font-family:'Noto Naskh Arabic','Amiri','DejaVu Sans',Arial,sans-serif; ${rtl ? 'direction:rtl; unicode-bidi:bidi-override;' : 'direction:ltr;'}">
        <div style="display:flex; justify-content:space-between; align-items:flex-end;">
          <div style="${rtl ? 'text-align:left;' : 'text-align:left'}; color:#A97E34; font-weight:700; font-size:13px;">
            ${rtl ? 'نظام شركة أبتاون 6 أكتوبر المالي' : 'Uptown 6 October Financial System'}
          </div>
          <div style="${rtl ? 'text-align:right;' : 'text-align:right'}; font-size:10px; color:#6b7280;">
            ${rtl ? 'تم الإنشاء' : 'Generated'}: ${todayTs}
          </div>
        </div>
        <div style="text-align:center; font-weight:800; font-size:20px; color:#111827; margin-top:6px;">
          ${title}
        </div>
        <div style="font-size:11px; color:#374151; margin-top:4px; ${rtl ? 'text-align:right;' : 'text-align:left;'}">
          <span style="font-weight:700;">${tOfferDate}:</span> ${fmtDate(offer_date || '')}
          &nbsp;&nbsp;<span style="font-weight:700;">${tFirstPayment}:</span> ${fmtDate(first_payment_date || '')}<br/>
          <span style="font-weight:700;">${tUnit}:</span> ${unit?.unit_code || ''} — ${unit?.unit_type || ''}<br/>
          <span style="font-weight:700;">${tConsultant}:</span> ${consultant?.email || ''}
        </div>
      </div>`
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '35mm', right: '12mm', bottom: '18mm', left: '12mm' }
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

export default router
