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

    // Unit totals (optional) — prefer explicit breakdown from request for consistency with calculator
    const upb = (unit_pricing_breakdown && typeof unit_pricing_breakdown === 'object')
      ? {
          base: Number(unit_pricing_breakdown.base || 0),
          garden: Number(unit_pricing_breakdown.garden || 0),
          roof: Number(unit_pricing_breakdown.roof || 0),
          storage: Number(unit_pricing_breakdown.storage || 0),
          garage: Number(unit_pricing_breakdown.garage || 0),
          maintenance: Number(unit_pricing_breakdown.maintenance || 0),
        }
      : null
    const totalExcl = upb
      ? (Number(upb.base||0)+Number(upb.garden||0)+Number(upb.roof||0)+Number(upb.storage||0)+Number(upb.garage||0))
      : null
    const totalIncl = upb ? (Number(totalExcl||0) + Number(upb.maintenance||0)) : null

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

    const totalsHtml = upb ? `
      <div class="section">
        <h3 style="${rtl ? 'text-align:right;' : ''}">${tTotals}</h3>
        <table>
          <thead>
            <tr>
              <th>${tLabel}</th>
              <th style="text-align:${rtl ? 'left' : 'right'}">${tAmount}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>${tBase}</td><td style="text-align:${rtl ? 'left' : 'right'}">${f(upb.base)} ${currency || ''}</td></tr>
            ${Number(upb.garden||0)>0 ? `<tr><td>${tGarden}</td><td style="text-align:${rtl ? 'left' : 'right'}">${f(upb.garden)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.roof||0)>0 ? `<tr><td>${tRoof}</td><td style="text-align:${rtl ? 'left' : 'right'}">${f(upb.roof)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.storage||0)>0 ? `<tr><td>${tStorage}</td><td style="text-align:${rtl ? 'left' : 'right'}">${f(upb.storage)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.garage||0)>0 ? `<tr><td>${tGarage}</td><td style="text-align:${rtl ? 'left' : 'right'}">${f(upb.garage)} ${currency || ''}</td></tr>` : ''}
            ${Number(upb.maintenance||0)>0 ? `<tr><td>${tMaintenance}</td><td style="text-align:${rtl ? 'left' : 'right'}">${f(upb.maintenance)} ${currency || ''}</td></tr>` : ''}
            ${totalExcl != null ? `<tr><td><strong>${tTotalExcl}</strong></td><td style="text-align:${rtl ? 'left' : 'right'}"><strong>${f(totalExcl)} ${currency || ''}</strong></td></tr>` : ''}
            ${totalIncl != null ? `<tr><td><strong>${tTotalIncl}</strong></td><td style="text-align:${rtl ? 'left' : 'right'}"><strong>${f(totalIncl)} ${currency || ''}</strong></td></tr>` : ''}
          </tbody>
        </table>
      </div>
    ` : ''

    const langForWords = language
    const scheduleRows = schedule.map((r) => {
      const labelText = rtl ? arLabel(r.label || '') : (r.label || '')
      const amount = Number(r.amount) || 0
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
            </div>
          </div>
          ${totalsHtml}
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
          </div>
        </body>
      </html>
    `

    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
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

// Server-rendered Reservation Form PDF
router.post('/reservation-form', authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const dealId = Number(req.body?.deal_id)
    if (!Number.isFinite(dealId) || dealId <= 0) {
      return bad(res, 400, 'deal_id must be a positive number')
    }
    const dr = await pool.query('SELECT * FROM deals WHERE id=$1', [dealId])
    if (dr.rows.length === 0) return bad(res, 404, 'Deal not found')
    const deal = dr.rows[0]
    if (!deal.fm_review_at) {
      return bad(res, 403, 'Financial Manager approval required before generating Reservation Form')
    }

    const reservationDate = String(req.body?.reservation_form_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const preliminaryPayment = Number(req.body?.preliminary_payment_amount) || 0
    const UIcurrency = (req.body?.currency_override || '').trim()
    const language = String(req.body?.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'
    const rtl = language === 'ar'

    let dayOfWeek = ''
    try {
      const d = new Date(reservationDate)
      const namesEn = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      const namesAr = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']
      dayOfWeek = (rtl ? namesAr : namesEn)[d.getDay()] || ''
    } catch {}

    const calc = deal.details?.calculator || {}

    let downPayment = Number(calc?.generatedPlan?.downPaymentAmount) || 0
    if (!(downPayment > 0)) {
      try {
        const dpRow = (calc?.generatedPlan?.schedule || []).find(r => String(r.label || '').toLowerCase().includes('down payment'))
        if (dpRow) downPayment = Number(dpRow.amount) || 0
      } catch {}
    }

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
    const remainingAmount = Math.max(0, Number(totalIncl) - Number(preliminaryPayment) - Number(downPayment))

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

    const L = (en, ar) => rtl ? ar : en
    const dir = rtl ? 'rtl' : 'ltr'
    const textAlignLeft = rtl ? 'text-right' : 'text-left'
    const textAlignRight = rtl ? 'text-left' : 'text-right'

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

export default router