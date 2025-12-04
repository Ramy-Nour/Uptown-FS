// Integration tests using supertest without external runner
import request from 'supertest'
import app from './app.js'
import { pool } from './db.js'

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

async function testHealth() {
  const res = await request(app).get('/api/health').expect(200)
  assert(res.body.status === 'ok', 'health ok')
  console.log('✓ /api/health')
}

async function testCalculateTargetPV() {
  const payload = {
    mode: 'calculateForTargetPV',
    stdPlan: { totalPrice: 1000000, financialDiscountRate: 12, calculatedPV: 850000 },
    inputs: {
      dpType: 'amount',
      downPaymentValue: 100000,
      planDurationYears: 5,
      installmentFrequency: 'monthly',
      additionalHandoverPayment: 0,
      handoverYear: 2,
      splitFirstYearPayments: false,
      firstYearPayments: [],
      subsequentYears: []
    }
  }
  const res = await request(app).post('/api/calculate').send(payload).expect(200)
  assert(res.body.ok === true, 'ok true')
  assert(Math.abs(res.body.data.calculatedPV - 850000) < 1e-3, 'PV matched')
  console.log('✓ /api/calculate (calculateForTargetPV)')
}

async function testValidation() {
  const bad = {
    mode: 'calculateForTargetPV',
    stdPlan: { totalPrice: -1, financialDiscountRate: 'abc', calculatedPV: -5 }, // invalid
    inputs: {}
  }
  const res = await request(app).post('/api/calculate').send(bad).expect(400)
  assert(res.body?.error?.message, 'has error message')
  console.log('✓ /api/calculate validation')
}

// Minimal smoke tests for documents routes to ensure documentsRoutes.js parses
// and the routes are wired through the app. We don't try to generate real PDFs
// here, only assert the auth layer responds as expected without 500s.
async function testDocumentsClientOfferAuth() {
  const res = await request(app)
    .post('/api/documents/client-offer')
    .send({})
    .expect(401) // authMiddleware should reject unauthenticated requests
  assert(res.body?.error, 'client-offer returns structured error on 401')
  console.log('✓ /api/documents/client-offer (unauthenticated 401)')
}

async function testDocumentsReservationFormAuth() {
  const res = await request(app)
    .post('/api/documents/reservation-form')
    .send({})
    .expect(401) // authMiddleware should reject unauthenticated requests
  assert(res.body?.error, 'reservation-form returns structured error on 401')
  console.log('✓ /api/documents/reservation-form (unauthenticated 401)')
}

// DB-backed smoke test for Reservation Form PDF generation.
// Flow:
// 1) Register a user via /api/auth/register
// 2) Promote to financial_admin directly in DB
// 3) Login to obtain JWT
// 4) Insert a deal with fm_review_at and a calculator snapshot
// 5) Call /api/documents/reservation-form and expect a PDF (200 + application/pdf)
async function testDocumentsReservationFormPdfFlow() {
  const email = `fa_int_${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'TestPassword123!'

  // 1) Register user
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email, password })
    .expect(200)

  assert(reg.body.ok === true, 'register ok for financial admin')
  const userId = reg.body.user?.id
  assert(userId, 'registered user has id')

  // 2) Promote to financial_admin
  await pool.query('UPDATE users SET role=$1 WHERE id=$2', ['financial_admin', userId])

  // 3) Login to obtain JWT
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200)

  assert(login.body.ok === true, 'login ok for financial admin')
  const token = login.body.accessToken
  assert(token, 'accessToken issued for financial admin')

  // 4) Insert a deal with fm_review_at and calculator snapshot
  const calcSnapshot = {
    currency: 'EGP',
    unitInfo: {
      unit_code: 'U-INT-101',
      unit_type: 'Apartment',
      unit_id: 9999
    },
    unitPricingBreakdown: {
      base: 1000000,
      garden: 0,
      roof: 0,
      storage: 0,
      garage: 0,
      maintenance: 100000
    },
    clientInfo: {
      number_of_buyers: 1,
      buyer_name: 'Integration Test Buyer'
    },
    generatedPlan: {
      downPaymentAmount: 100000,
      schedule: [
        { label: 'Down Payment', amount: 100000, month: 1, date: '2025-01-15' }
      ]
    }
  }

  const dealInsert = await pool.query(
    `INSERT INTO deals (title, amount, details, unit_type, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      'Integration RF Deal',
      1100000,
      { calculator: calcSnapshot },
      'Apartment',
      'approved',
      userId
    ]
  )
  const dealId = dealInsert.rows[0]?.id
  assert(dealId, 'deal inserted')

  // Mark fm_review_at so the RF endpoint passes FM approval rule without needing reservation_forms/units state
  try {
    await pool.query('UPDATE deals SET fm_review_at = now() WHERE id=$1', [dealId])
  } catch {
    // If the column doesn't exist in a particular environment, we skip;
    // in that case the test may fail due to FM rule, which is acceptable for surfacing schema drift.
  }

  // 5) Call reservation-form PDF endpoint
  const rfRes = await request(app)
    .post('/api/documents/reservation-form')
    .set('Authorization', `Bearer ${token}`)
    .send({
      deal_id: dealId,
      reservation_form_date: '01/01/2025',
      preliminary_payment_amount: 50000,
      language: 'en',
      currency_override: 'EGP'
    })
    .expect(200)

  const contentType = rfRes.headers['content-type'] || ''
  assert(contentType.includes('application/pdf'), 'reservation-form returns application/pdf')
  // supertest exposes raw buffer on res.body when not JSON; ensure non-trivial size
  assert(
    Buffer.isBuffer(rfRes.body) && rfRes.body.length > 1000,
    'reservation-form PDF response has non-trivial length'
  )

  console.log('✓ /api/documents/reservation-form (FM-approved deal, PDF 200)')
}

async function run() {
  await testHealth()
  await testCalculateTargetPV()
  await testValidation()
  await testDocumentsClientOfferAuth()
  await testDocumentsReservationFormAuth()
  await testDocumentsReservationFormPdfFlow()
  console.log('All integration tests passed.')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})