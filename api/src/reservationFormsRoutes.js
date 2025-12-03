import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'
import { bad, ok, ensureNumber } from './workflowUtils.js'

const router = express.Router()

/**
 * SECTION: Reservation Forms (FA + FM)
 * Mounted under /api/workflow
 */

// Create reservation form (Financial Admin) for an approved plan and blocked unit
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

      const details = {
        payment_plan_id: planId,
        unit_id: unitId,
        reservation_date: reservation_date || null,
        preliminary_payment: preliminary_payment != null ? Number(preliminary_payment) : 0,
        language: language || 'en',
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
          reservation_date || new Date().toISOString(),
          preliminary_payment != null ? Number(preliminary_payment) : 0,
          language || 'en',
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

// List reservation forms (FA/FM)
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
        clauses.push(`rf.status = $${params.length}`)
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

// FM approve reservation form: unit becomes RESERVED
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

// FM reject reservation form
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

export default router