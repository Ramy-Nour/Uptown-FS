// Integration tests using supertest without external runner
import request from 'supertest'
import app from './app2.js'
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

// Role-aware smoke test for GET /api/deals/by-unit/:unitId.
// Ensures that:
// - Non-elevated users (property_consultant) only see their own deals for that unit.
// - Elevated users (sales_manager) see all deals for the unit.
// - The underlying SQL uses proper placeholders for both unit_id and created_by
//   so Postgres does not throw \"bind message supplies 2 parameters\".
async function testDealsByUnitVisibilityAndBinding() {
  const password = 'TestPassword123!'
  const unitId = Math.floor(1e6 + Math.random() * 1e6)

  // Register Property Consultant
  const pcEmail = `pc_byunit_${Math.random().toString(36).slice(2, 8)}@example.com`
  const regPc = await request(app)
    .post('/api/auth/register')
    .send({ email: pcEmail, password })
    .expect(200)
  assert(regPc.body.ok === true, 'pc register ok')
  const pcId = regPc.body.user?.id
  assert(pcId, 'pc user id')
  await pool.query('UPDATE users SET role=$1 WHERE id=$2', ['property_consultant', pcId])

  const loginPc = await request(app)
    .post('/api/auth/login')
    .send({ email: pcEmail, password })
    .expect(200)
  assert(loginPc.body.ok === true, 'pc login ok')
  const pcToken = loginPc.body.accessToken
  assert(pcToken, 'pc access token issued')

  // Register Sales Manager (elevated)
  const smEmail = `sm_byunit_${Math.random().toString(36).slice(2, 8)}@example.com`
  const regSm = await request(app)
    .post('/api/auth/register')
    .send({ email: smEmail, password })
    .expect(200)
  assert(regSm.body.ok === true, 'sm register ok')
  const smId = regSm.body.user?.id
  assert(smId, 'sm user id')
  await pool.query('UPDATE users SET role=$1 WHERE id=$2', ['sales_manager', smId])

  const loginSm = await request(app)
    .post('/api/auth/login')
    .send({ email: smEmail, password })
    .expect(200)
  assert(loginSm.body.ok === true, 'sm login ok')
  const smToken = loginSm.body.accessToken
  assert(smToken, 'sm access token issued')

  // Insert two deals for the same unit_id: one by PC, one by Sales Manager
  const detailsPc = { calculator: { unitInfo: { unit_id: unitId } } }
  await pool.query(
    `INSERT INTO deals (title, amount, details, unit_type, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['PC Deal by unit', 100000, detailsPc, 'Apartment', 'draft', pcId]
  )

  const detailsSm = { calculator: { unitInfo: { unit_id: unitId } } }
  await pool.query(
    `INSERT INTO deals (title, amount, details, unit_type, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['SM Deal by unit', 200000, detailsSm, 'Apartment', 'draft', smId]
  )

  // Non-elevated consultant should only see their own deals for this unit
  const pcRes = await request(app)
    .get(`/api/deals/by-unit/${unitId}`)
    .set('Authorization', `Bearer ${pcToken}`)
    .expect(200)

  assert(pcRes.body.ok === true, 'pc /by-unit ok true')
  assert(Array.isArray(pcRes.body.deals), 'pc /by-unit deals is array')
  assert(pcRes.body.deals.length >= 1, 'pc /by-unit returns at least one deal')
  assert(
    pcRes.body.deals.every(d => d.created_by === pcId),
    'pc /by-unit only returns deals created_by the consultant'
  )

  // Elevated sales manager should see all deals for this unit (both creators)
  const smRes = await request(app)
    .get(`/api/deals/by-unit/${unitId}`)
    .set('Authorization', `Bearer ${smToken}`)
    .expect(200)

  assert(smRes.body.ok === true, 'sm /by-unit ok true')
  assert(Array.isArray(smRes.body.deals), 'sm /by-unit deals is array')
  const creators = new Set(smRes.body.deals.map(d => d.created_by))
  assert(creators.has(pcId), 'sm /by-unit includes consultant deal')
  assert(creators.has(smId), 'sm /by-unit includes manager deal')

  console.log('✓ /api/deals/by-unit/:unitId (role visibility + SQL binding)')
}

async function run() {
  await testHealth()
  await testCalculateTargetPV()
  await testValidation()
  await testDocumentsClientOfferAuth()
  await testDocumentsReservationFormAuth()
  await testDocumentsReservationFormPdfFlow()
  await testDealsByUnitVisibilityAndBinding()
  console.log('All integration tests passed.')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})