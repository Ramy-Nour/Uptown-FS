import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'
import {
  bad,
  ok,
  ensureNumber,
  getPolicyLimitForPlan,
  resolvePolicyLimitForDeal
} from './workflowUtils.js'

const router = express.Router()

/**
 * SECTION: Payment Plans workflow
 * Mounted under /api/workflow
 */

// Create payment plan for a deal
router.post(
  '/payment-plans',
  authMiddleware,
  requireRole([
    'property_consultant',
    'sales_manager',
    'financial_manager',
    'financial_admin',
    'admin',
    'superadmin'
  ]),
  async (req, res) => {
    try {
      const { deal_id, details } = req.body || {}
      const dealId = ensureNumber(deal_id)
      if (!dealId) return bad(res, 400, 'deal_id is required and must be numeric')
      if (!details || typeof details !== 'object') {
        return bad(res, 400, 'details (calculator snapshot) is required')
      }

      const decision =
        details?.calculator?.generatedPlan?.evaluation?.decision || null

      const baseStatus =
        req.user.role === 'property_consultant' ? 'pending_sm' : 'pending_fm'

      const ins = await pool.query(
        `INSERT INTO payment_plans (deal_id, details, created_by, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [dealId, details, req.user.id, baseStatus]
      )

      const row = ins.rows[0]

      return ok(res, { payment_plan: row })
    } catch (e) {
      console.error('POST /api/workflow/payment-plans error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// List payment plans (basic filter)
router.get(
  '/payment-plans',
  authMiddleware,
  requireRole([
    'admin',
    'superadmin',
    'financial_manager',
    'financial_admin',
    'sales_manager',
    'property_consultant'
  ]),
  async (req, res) => {
    try {
      const { deal_id, status } = req.query || {}
      const clauses = []
      const params = []
      if (deal_id) {
        params.push(ensureNumber(deal_id))
        clauses.push(`deal_id = $${params.length}`)
      }
      if (status) {
        params.push(String(status))
        clauses.push(`status = $${params.length}`)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const q = `SELECT * FROM payment_plans ${where} ORDER BY id DESC`
      const result = await pool.query(q, params)
      return ok(res, { payment_plans: result.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// My payment plans (creator = current user)
router.get(
  '/payment-plans/my',
  authMiddleware,
  requireRole([
    'property_consultant',
    'sales_manager',
    'financial_manager',
    'financial_admin',
    'admin',
    'superadmin'
  ]),
  async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT pp.*, d.title AS deal_title
         FROM payment_plans pp
         LEFT JOIN deals d ON d.id = pp.deal_id
         WHERE pp.created_by = $1
         ORDER BY pp.id DESC`,
        [req.user.id]
      )
      return ok(res, { payment_plans: rows.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/my error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Team payment plans (Sales Manager teams)
router.get(
  '/payment-plans/team',
  authMiddleware,
  requireRole(['sales_manager']),
  async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT pp.*, d.title AS deal_title, u.email AS consultant_email
         FROM payment_plans pp
         JOIN deals d ON d.id = pp.deal_id
         JOIN users u ON u.id = pp.created_by
         JOIN sales_team_members stm
           ON stm.consultant_user_id = pp.created_by
          AND stm.manager_user_id = $1
          AND stm.active = TRUE
         ORDER BY pp.id DESC`,
        [req.user.id]
      )
      return ok(res, { payment_plans: rows.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/team error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Approved plans for a unit (consultant-created only) — used in Current Blocks / Reservation
router.get(
  '/payment-plans/approved-for-unit',
  authMiddleware,
  requireRole([
    'property_consultant',
    'sales_manager',
    'financial_manager',
    'financial_admin',
    'admin',
    'superadmin'
  ]),
  async (req, res) => {
    try {
      const unitId = ensureNumber(req.query.unit_id)
      if (!unitId) return bad(res, 400, 'unit_id is required')

      const rows = await pool.query(
        `
        WITH target AS (
          SELECT $1::int AS unit_id, TRIM(u.code) AS unit_code
          FROM units u
          WHERE u.id = $1
        )
        SELECT
          pp.id,
          pp.deal_id,
          pp.status,
          pp.created_at,
          pp.details,
          u.email AS consultant_email
        FROM payment_plans pp
        JOIN users u ON u.id = pp.created_by,
             target t
        WHERE pp.status = 'approved'
          AND u.role = 'property_consultant'
          AND (
            (
              TRIM(COALESCE(pp.details->'calculator'->'unitInfo'->>'unit_id','')) ~ '^[0-9]+'
              AND TRIM(pp.details->'calculator'->'unitInfo'->>'unit_id')::int = t.unit_id
            )
            OR (
              TRIM(COALESCE(pp.details->'calculator'->'unitInfo'->>'unit_code','')) = t.unit_code
            )
          )
        ORDER BY pp.id DESC`,
        [unitId]
      )
      return ok(res, { payment_plans: rows.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/approved-for-unit error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Queues for SM/FM/TM
router.get(
  '/payment-plans/queue/sm',
  authMiddleware,
  requireRole(['sales_manager']),
  async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT
           pp.*,
           d.title AS deal_title,
           d.amount AS deal_amount,
           u.email AS consultant_email
         FROM payment_plans pp
         JOIN deals d ON d.id = pp.deal_id
         JOIN users u ON u.id = pp.created_by
         JOIN sales_team_members stm
           ON stm.consultant_user_id = pp.created_by
          AND stm.manager_user_id = $1
          AND stm.active = TRUE
         WHERE pp.status = 'pending_sm'
         ORDER BY pp.id DESC`,
        [req.user.id]
      )
      return ok(res, { payment_plans: rows.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/queue/sm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.get(
  '/payment-plans/queue/fm',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT
           pp.*,
           d.title AS deal_title,
           d.amount AS deal_amount,
           u.email AS consultant_email
         FROM payment_plans pp
         JOIN deals d ON d.id = pp.deal_id
         JOIN users u ON u.id = pp.created_by
         WHERE pp.status IN ('pending_fm', 'pending_tm')
         ORDER BY pp.id DESC`
      )
      return ok(res, { payment_plans: rows.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/queue/fm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.get(
  '/payment-plans/queue/tm',
  authMiddleware,
  requireRole(['ceo', 'chairman', 'vice_chairman', 'top_management']),
  async (req, res) => {
    try {
      const rows = await pool.query(
        `SELECT
           pp.*,
           d.title AS deal_title,
           d.amount AS deal_amount,
           u.email AS consultant_email
         FROM payment_plans pp
         JOIN deals d ON d.id = pp.deal_id
         JOIN users u ON u.id = pp.created_by
         WHERE pp.status = 'pending_tm'
         ORDER BY pp.id DESC`
      )
      return ok(res, { payment_plans: rows.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/queue/tm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Get single payment plan by id
router.get(
  '/payment-plans/:id',
  authMiddleware,
  requireRole([
    'property_consultant',
    'sales_manager',
    'financial_manager',
    'financial_admin',
    'admin',
    'superadmin',
    'ceo',
    'chairman',
    'vice_chairman',
    'top_management'
  ]),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const r = await pool.query(
        `SELECT pp.*, d.title AS deal_title, d.amount AS deal_amount
         FROM payment_plans pp
         LEFT JOIN deals d ON d.id = pp.deal_id
         WHERE pp.id = $1`,
        [id]
      )
      if (r.rows.length === 0) return bad(res, 404, 'Payment plan not found')
      return ok(res, { payment_plan: r.rows[0] })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/:id error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// SM approve / reject
router.patch(
  '/payment-plans/:id/approve-sm',
  authMiddleware,
  requireRole(['sales_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const q = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) return bad(res, 404, 'Not found')
      const row = q.rows[0]
      if (row.status !== 'pending_sm') {
        return bad(res, 400, 'Plan is not pending Sales Manager approval')
      }

      const upd = await pool.query(
        `UPDATE payment_plans
         SET status='pending_fm', updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/approve-sm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/payment-plans/:id/reject-sm',
  authMiddleware,
  requireRole(['sales_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const q = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) return bad(res, 404, 'Not found')
      const row = q.rows[0]
      if (row.status !== 'pending_sm') {
        return bad(res, 400, 'Plan is not pending Sales Manager approval')
      }

      const upd = await pool.query(
        `UPDATE payment_plans
         SET status='rejected', updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/reject-sm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// FM approve / reject (including policy limit evaluation)
router.patch(
  '/payment-plans/:id/approve',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const q = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) return bad(res, 404, 'Not found')
      const row = q.rows[0]

      if (!['pending_fm', 'pending_tm'].includes(row.status)) {
        return bad(res, 400, 'Plan is not pending FM/TM approval')
      }

      const details = row.details || {}
      const disc = Number(details?.calculator?.inputs?.salesDiscountPercent) || 0
      const plimit = await getPolicyLimitForPlan(details)
      const overPolicy = disc > plimit

      if (overPolicy) {
        const upd = await pool.query(
          `UPDATE payment_plans
           SET status='pending_tm', updated_at=now()
           WHERE id=$1
           RETURNING *`,
          [id]
        )
        return ok(res, {
          payment_plan: upd.rows[0],
          escalated: true,
          policyLimitPercent: plimit
        })
      }

      const upd = await pool.query(
        `UPDATE payment_plans
         SET status='approved', updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )
      return ok(res, { payment_plan: upd.rows[0], policyLimitPercent: plimit })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/approve error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/payment-plans/:id/reject',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const q = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) return bad(res, 404, 'Not found')
      const row = q.rows[0]
      if (!['pending_fm', 'pending_tm'].includes(row.status)) {
        return bad(res, 400, 'Plan is not pending FM/TM approval')
      }
      const upd = await pool.query(
        `UPDATE payment_plans
         SET status='rejected', updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/reject error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// TM approve / reject
router.patch(
  '/payment-plans/:id/approve-tm',
  authMiddleware,
  requireRole(['ceo', 'chairman', 'vice_chairman', 'top_management']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const q = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) return bad(res, 404, 'Not found')
      const row = q.rows[0]
      if (row.status !== 'pending_tm') {
        return bad(res, 400, 'Plan is not pending TM approval')
      }
      const upd = await pool.query(
        `UPDATE payment_plans
         SET status='approved', updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/approve-tm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/payment-plans/:id/reject-tm',
  authMiddleware,
  requireRole(['ceo', 'chairman', 'vice_chairman', 'top_management']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const q = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) return bad(res, 404, 'Not found')
      const row = q.rows[0]
      if (row.status !== 'pending_tm') {
        return bad(res, 400, 'Plan is not pending TM approval')
      }
      const upd = await pool.query(
        `UPDATE payment_plans
         SET status='rejected', updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/reject-tm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Mark a single plan as accepted for a deal
router.patch(
  '/payment-plans/:id/mark-accepted',
  authMiddleware,
  requireRole(['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }
      await client.query('BEGIN')
      const q = await client.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (q.rows.length === 0) {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 404, 'Not found')
      }
      const plan = q.rows[0]
      if (plan.status !== 'approved') {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 400, 'Only approved plans can be marked as accepted')
      }

      await client.query(
        'UPDATE payment_plans SET accepted=FALSE, updated_at=now() WHERE deal_id=$1',
        [plan.deal_id]
      )
      const upd = await client.query(
        `UPDATE payment_plans
         SET accepted=TRUE, updated_at=now()
         WHERE id=$1
         RETURNING *`,
        [id]
      )

      await client.query('COMMIT')
      client.release()
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      client.release()
      console.error('PATCH /api/workflow/payment-plans/:id/mark-accepted error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Role-aware policy limit for a deal (helper)
router.get(
  '/payment-plans/policy-limit-for-deal/:id',
  authMiddleware,
  requireRole(['financial_manager', 'admin', 'superadmin']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const limit = await resolvePolicyLimitForDeal(id)
      return ok(res, { policyLimitPercent: limit })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/policy-limit-for-deal/:id error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

export default router