import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'
import { bad, ok, ensureNumber } from './workflowUtils.js'

const router = express.Router()

/**
 * SECTION: Reservation Forms (FA + FM)
 * Mounted under /api/workflow
 */

// Helper: parse reservation date from dd/MM/YYYY or ISO-like formats to ISO string
function parseReservationDateToIso(input) {
  if (!input) return null
  let value = input
  if (typeof value !== 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  if (m) {
    const [, dd, mm, yyyy] = m
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Create reservation form (Financial Admin) for an approved plan and blocked unit
 */
router.post(
  '/reservation-forms',
  authMiddleware,
  requireRole(['financial_admin']),
  async (req, res) => {
    try {
      const { payment_plan_id, reservation_date, preliminary_payment, language } =
        req.body || {}
      const planId = ensureNumber(payment_plan_id)
      if (!planId) return bad(res, 400, 'payment_plan_id is required and must be numeric')

      const planRes = await pool.query(
        `SELECT pp.*, d.details AS deal_details
         FROM payment_plans pp
         LEFT JOIN deals d ON d.id = pp.deal_id
         WHERE pp.id=$1`,
        [planId]
      )
      if (planRes.rows.length === 0) {
        return bad(res, 404, 'Payment plan not found')
      }
      const plan = planRes.rows[0]
      if (plan.status !== 'approved') {
        return bad(res, 400, 'Reservation requires an approved payment plan')
      }

      const calc = plan.details?.calculator || plan.deal_details?.calculator || {}
      const unitIdRaw = calc?.unitInfo?.unit_id
      const unitId = ensureNumber(unitIdRaw)
      if (!unitId) {
        return bad(res, 400, 'Unit information missing from plan snapshot')
      }

      const unitRes = await pool.query(
        `SELECT id, unit_status, available FROM units WHERE id=$1`,
        [unitId]
      )
      if (unitRes.rows.length === 0) return bad(res, 404, 'Unit not found')

      const unit = unitRes.rows[0]
      if (!(unit.unit_status === 'BLOCKED' && unit.available === false)) {
        return bad(
          res,
          400,
          'Reservation forms can only be created for units that are currently BLOCKED'
        )
      }

      const blockRes = await pool.query(
        `SELECT id
         FROM blocks
         WHERE unit_id=$1
           AND status='approved'
           AND blocked_until > now()
         ORDER BY id DESC
         LIMIT 1`,
        [unitId]
      )
      if (blockRes.rows.length === 0) {
        return bad(
          res,
          400,
          'An active approved block is required before creating a reservation form'
        )
      }

      // Prevent duplicate reservation forms for the same payment plan while one is pending or approved.
      const existingRes = await pool.query(
        `SELECT id, status
         FROM reservation_forms
         WHERE payment_plan_id = $1
           AND status IN ('pending_approval', 'approved')
         ORDER BY id DESC
         LIMIT 1`,
        [planId]
      )
      if (existingRes.rows.length > 0) {
        return bad(
          res,
          400,
          'A reservation form for this payment plan has already been created and is pending Financial Manager decision or already approved.'
        )
      }

      let reservationDateIso = parseReservationDateToIso(reservation_date)
      if (!reservationDateIso) {
        reservationDateIso = new Date().toISOString()
      }

      const prelimValue =
        preliminary_payment != null && preliminary_payment !== ''
          ? Number(preliminary_payment)
          : 0
      const details = {
        payment_plan_id: planId,
        unit_id: unitId,
        reservation_date: reservationDateIso,
        preliminary_payment: prelimValue,
        language: language || 'ar',
        deal_id: plan.deal_id ?? null,
        calculator: calc || null
      }

      const ins = await pool.query(
        `INSERT INTO reservation_forms
           (payment_plan_id, unit_id, reservation_date, preliminary_payment, language, status, created_by, details)
         VALUES
           ($1, $2, $3, $4, $5, 'pending_approval', $6, $7)
         RETURNING *`,
        [
          planId,
          unitId,
          reservationDateIso,
          prelimValue,
          language || 'ar',
          req.user.id,
          details
        ]
      )

      return ok(res, { reservation_form: ins.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/reservation-forms error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * List reservation forms (FA/FM)
 */
router.get(
  '/reservation-forms',
  authMiddleware,
  requireRole(['financial_admin', 'financial_manager']),
  async (req, res) => {
    try {
      const { status } = req.query || {}
      const clauses = []
      const params = []
      if (status) {
        params.push(String(status))
        clauses.push(`rf.status = ${params.length}`)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const q = `
        SELECT
          rf.*,
          pp.deal_id,
          u.code AS unit_code,
          u.unit_type
        FROM reservation_forms rf
        LEFT JOIN payment_plans pp ON pp.id = rf.payment_plan_id
        LEFT JOIN units u ON u.id = rf.unit_id
        ${where}
        ORDER BY rf.id DESC`
      const result = await pool.query(q, params)
      return ok(res, { reservation_forms: result.rows })
    } catch (e) {
      console.error('GET /api/workflow/reservation-forms error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FA cancel a pending reservation form
 * - Only allowed while status='pending_approval'
 * - Marks status='cancelled' and records cancellation metadata in details
 */
router.patch(
  '/reservation-forms/:id/cancel',
  authMiddleware,
  requireRole(['financial_admin']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const cur = await pool.query('SELECT * FROM reservation_forms WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Reservation form not found')

      const row = cur.rows[0]
      if (row.status !== 'pending_approval') {
        return bad(res, 400, 'Only pending reservation forms can be cancelled by Financial Admin')
      }

      const details = row.details || {}
      const updatedDetails = {
        ...details,
        cancellation: {
          cancelled_by: req.user.id,
          cancelled_at: new Date().toISOString()
        }
      }

      const upd = await pool.query(
        `UPDATE reservation_forms
         SET status='cancelled',
             details=$1
         WHERE id=$2
         RETURNING *`,
        [updatedDetails, id]
      )

      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/reservation-forms/:id/cancel error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FM approve reservation form: unit becomes RESERVED
 */
router.patch(
  '/reservation-forms/:id/approve',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }
      await client.query('BEGIN')
      const cur = await client.query(
        `SELECT rf.*, u.unit_status, u.available
         FROM reservation_forms rf
         LEFT JOIN units u ON u.id = rf.unit_id
         WHERE rf.id=$1`,
        [id]
      )
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 404, 'Reservation form not found')
      }
      const row = cur.rows[0]
      if (row.status !== 'pending_approval') {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 400, 'Reservation form is not pending approval')
      }

      await client.query(
        `UPDATE reservation_forms
         SET status='approved',
             approved_by=$1,
             approved_at=now()
         WHERE id=$2`,
        [req.user.id, id]
      )

      await client.query(
        `UPDATE units
         SET unit_status='RESERVED',
             available=FALSE,
             updated_at=now()
         WHERE id=$1`,
        [row.unit_id]
      )

      const result = await client.query('SELECT * FROM reservation_forms WHERE id=$1', [id])

      await client.query('COMMIT')
      client.release()
      return ok(res, { reservation_form: result.rows[0] })
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      client.release()
      console.error('PATCH /api/workflow/reservation-forms/:id/approve error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FM reject reservation form
 */
router.patch(
  '/reservation-forms/:id/reject',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const cur = await pool.query('SELECT * FROM reservation_forms WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Reservation form not found')
      if (cur.rows[0].status !== 'pending_approval') {
        return bad(res, 400, 'Reservation form is not pending approval')
      }
      const upd = await pool.query(
        `UPDATE reservation_forms
         SET status='rejected',
             rejected_by=$1,
             rejected_at=now()
         WHERE id=$2
         RETURNING *`,
        [req.user.id, id]
      )
      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/reservation-forms/:id/reject error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FA request amendment for an approved reservation form
 * - Stores requested new date / preliminary payment + reason in details.amendment_request
 */
router.post(
  '/reservation-forms/:id/request-amendment',
  authMiddleware,
  requireRole(['financial_admin']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const cur = await pool.query('SELECT * FROM reservation_forms WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Reservation form not found')

      const row = cur.rows[0]
      if (row.status !== 'approved') {
        return bad(res, 400, 'Only approved reservation forms can be amended')
      }

      const existingDetails = row.details || {}
      const existingAmendment = existingDetails.amendment_request
      if (existingAmendment && existingAmendment.state === 'pending') {
        return bad(res, 400, 'An amendment request is already pending for this reservation form')
      }

      const { reservation_date, preliminary_payment, reason } = req.body || {}

      let reservationDateIso = parseReservationDateToIso(reservation_date)
      if (!reservationDateIso) {
        reservationDateIso = row.reservation_date || existingDetails.reservation_date || new Date().toISOString()
      }

      let prelim
      if (preliminary_payment != null && preliminary_payment !== '') {
        const num = Number(preliminary_payment)
        if (!Number.isFinite(num) || num < 0) {
          return bad(res, 400, 'preliminary_payment must be a non-negative number when provided')
        }
        prelim = num
      } else {
        const fromColumn = row.preliminary_payment
        const fromDetails = existingDetails.preliminary_payment
        const v = fromColumn != null ? fromColumn : fromDetails
        prelim = v != null ? Number(v) : 0
      }

      const nowIso = new Date().toISOString()
      const details = {
        ...existingDetails,
        amendment_request: {
          state: 'pending',
          requested_by: req.user.id,
          requested_at: nowIso,
          reservation_date_iso: reservationDateIso,
          preliminary_payment: prelim,
          reason: typeof reason === 'string' ? reason : ''
        }
      }

      const upd = await pool.query(
        `UPDATE reservation_forms
         SET details=$1
         WHERE id=$2
         RETURNING *`,
        [details, id]
      )

      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/reservation-forms/:id/request-amendment error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FM list of approved reservations that have pending amendment requests
 */
router.get(
  '/reservation-forms/amendments',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const q = `
        SELECT
          rf.*,
          pp.deal_id,
          u.code AS unit_code,
          u.unit_type
        FROM reservation_forms rf
        LEFT JOIN payment_plans pp ON pp.id = rf.payment_plan_id
        LEFT JOIN units u ON u.id = rf.unit_id
        WHERE rf.status = 'approved'
        ORDER BY rf.id DESC`
      const result = await pool.query(q)
      const rows = result.rows || []
      const filtered = rows.filter(r => {
        const d = r.details || {}
        const ar = d.amendment_request
        return ar && ar.state === 'pending'
      })
      return ok(res, { reservation_forms: filtered })
    } catch (e) {
      console.error('GET /api/workflow/reservation-forms/amendments error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FM approve an amendment request: updates reservation_date/preliminary_payment and records history
 */
router.patch(
  '/reservation-forms/:id/approve-amendment',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }

      await client.query('BEGIN')
      const cur = await client.query('SELECT * FROM reservation_forms WHERE id=$1 FOR UPDATE', [id])
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 404, 'Reservation form not found')
      }

      const row = cur.rows[0]
      if (row.status !== 'approved') {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 400, 'Only approved reservation forms can be amended')
      }

      const details = row.details || {}
      const amendment = details.amendment_request
      if (!amendment || amendment.state !== 'pending') {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 400, 'No pending amendment request to approve')
      }

      const nowIso = new Date().toISOString()
      const existingReservationDate = row.reservation_date || details.reservation_date || null
      const existingPrelim =
        row.preliminary_payment != null ? row.preliminary_payment : details.preliminary_payment ?? null

      const newReservationDateIso =
        amendment.reservation_date_iso || existingReservationDate || nowIso
      const newPrelim =
        amendment.preliminary_payment != null
          ? Number(amendment.preliminary_payment)
          : existingPrelim != null
          ? Number(existingPrelim)
          : 0

      const historyEntry = {
        previous_reservation_date: existingReservationDate,
        previous_preliminary_payment: existingPrelim,
        new_reservation_date: newReservationDateIso,
        new_preliminary_payment: newPrelim,
        approved_by: req.user.id,
        approved_at: nowIso,
        reason: amendment.reason || ''
      }

      const nextHistory = Array.isArray(details.amendment_history)
        ? [...details.amendment_history, historyEntry]
        : [historyEntry]

      const updatedDetails = {
        ...details,
        reservation_date: newReservationDateIso,
        preliminary_payment: newPrelim,
        amendment_history: nextHistory
      }
      delete updatedDetails.amendment_request

      const upd = await client.query(
        `UPDATE reservation_forms
         SET reservation_date=$1,
             preliminary_payment=$2,
             details=$3
         WHERE id=$4
         RETURNING *`,
        [newReservationDateIso, newPrelim, updatedDetails, id]
      )

      await client.query('COMMIT')
      client.release()
      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      client.release()
      console.error('PATCH /api/workflow/reservation-forms/:id/approve-amendment error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * FM reject an amendment request: keeps existing values, archives request into amendment_history
 */
router.patch(
  '/reservation-forms/:id/reject-amendment',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const cur = await pool.query('SELECT * FROM reservation_forms WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Reservation form not found')

      const row = cur.rows[0]
      if (row.status !== 'approved') {
        return bad(res, 400, 'Only approved reservation forms can have amendments rejected')
      }

      const details = row.details || {}
      const amendment = details.amendment_request
      if (!amendment || amendment.state !== 'pending') {
        return bad(res, 400, 'No pending amendment request to reject')
      }

      const nowIso = new Date().toISOString()
      const existingReservationDate = row.reservation_date || details.reservation_date || null
      const existingPrelim =
        row.preliminary_payment != null ? row.preliminary_payment : details.preliminary_payment ?? null

      const historyEntry = {
        previous_reservation_date: existingReservationDate,
        previous_preliminary_payment: existingPrelim,
        new_reservation_date: amendment.reservation_date_iso || null,
        new_preliminary_payment:
          amendment.preliminary_payment != null ? Number(amendment.preliminary_payment) : null,
        rejected_by: req.user.id,
        rejected_at: nowIso,
        reason: amendment.reason || ''
      }

      const nextHistory = Array.isArray(details.amendment_history)
        ? [...details.amendment_history, historyEntry]
        : [historyEntry]

      const updatedDetails = {
        ...details,
        amendment_history: nextHistory
      }
      delete updatedDetails.amendment_request

      const upd = await pool.query(
        `UPDATE reservation_forms
         SET details=$1
         WHERE id=$2
         RETURNING *`,
        [updatedDetails, id]
      )

      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/reservation-forms/:id/reject-amendment error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

export default router