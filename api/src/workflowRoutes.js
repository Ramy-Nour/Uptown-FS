import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

// Utilities
function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) {
  return res.json({ ok: true, ...payload })
}
function ensureNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Resolve discount policy precedence: Project > Unit Type > Global
async function getPolicyLimitForPlan(details) {
  try {
    const projectId = details?.project_id ? Number(details.project_id) : null
    const unitTypeId = details?.unit_type_id ? Number(details.unit_type_id) : null

    if (Number.isFinite(projectId)) {
      const r = await pool.query(
        `SELECT policy_limit_percent
         FROM approval_policies
         WHERE active=TRUE AND scope_type='project' AND scope_id=$1
         ORDER BY id DESC
         LIMIT 1`,
        [projectId]
      )
      if (r.rows.length) return Number(r.rows[0].policy_limit_percent) || 5
    }

    if (Number.isFinite(unitTypeId)) {
      const r = await pool.query(
        `SELECT policy_limit_percent
         FROM approval_policies
         WHERE active=TRUE AND scope_type='unit_type' AND scope_id=$1
         ORDER BY id DESC
         LIMIT 1`,
        [unitTypeId]
      )
      if (r.rows.length) return Number(r.rows[0].policy_limit_percent) || 5
    }

    const r = await pool.query(
      `SELECT policy_limit_percent
       FROM approval_policies
       WHERE active=TRUE AND scope_type='global'
       ORDER BY id DESC
       LIMIT 1`
    )
    if (r.rows.length) return Number(r.rows[0].policy_limit_percent) || 5
  } catch (e) {
    console.error('getPolicyLimitForPlan error:', e)
  }
  return 5
}

// Policy resolution with precedence: project > unit_type > global
// Current DB lacks projects table; we implement unit_type > global for now.
// If deal.unit_type matches unit_types.name (case-insensitive), we resolve by unit_type policy.
async function resolvePolicyLimitForDeal(dealId) {
  try {
    const d = await pool.query('SELECT unit_type FROM deals WHERE id=$1', [dealId])
    const utName = (d.rows[0]?.unit_type || '').trim()
    if (utName) {
      const type = await pool.query('SELECT id FROM unit_types WHERE name ILIKE $1 LIMIT 1', [utName])
      if (type.rows.length > 0) {
        const r = await pool.query(
          `SELECT policy_limit_percent
           FROM approval_policies
           WHERE active=TRUE AND scope_type='unit_type' AND scope_id=$1
           ORDER BY id DESC LIMIT 1`,
          [type.rows[0].id]
        )
        if (r.rows.length > 0) {
          const v = Number(r.rows[0].policy_limit_percent)
          if (Number.isFinite(v) && v > 0) return v
        }
      }
    }
    // Fallback to global
    const g = await pool.query(
      `SELECT policy_limit_percent
       FROM approval_policies
       WHERE active=TRUE AND scope_type='global'
       ORDER BY id DESC LIMIT 1`
    )
    if (g.rows.length > 0) {
      const v = Number(g.rows[0].policy_limit_percent)
      if (Number.isFinite(v) && v > 0) return v
    }
  } catch (e) {
    // ignore and fall back
  }
  return 5
}

/**
 * SECTION 1: Standard Pricing (Financial Manager -> CEO approval)
 * - create/update by: financial_manager
 * - approve/reject by: ceo
 */
router.post(
  '/standard-pricing',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const {
        unit_id,
        unit_type,
        price,
        area,
        std_financial_rate_percent,
        plan_duration_years,
        installment_frequency
      } = req.body || {}

      const unitId = ensureNumber(unit_id)
      const pr = ensureNumber(price)
      const ar = ensureNumber(area)
      const rate = Number(std_financial_rate_percent)
      const years = Number(plan_duration_years)
      const freq = String(installment_frequency || '').toLowerCase()

      if (!unitId) return bad(res, 400, 'unit_id is required and must be a number')
      if (!unit_type || typeof unit_type !== 'string') return bad(res, 400, 'unit_type is required')
      if (pr == null || pr < 0) return bad(res, 400, 'price must be a non-negative number')
      if (ar == null || ar <= 0) return bad(res, 400, 'area must be a positive number')
      if (!isFinite(rate)) return bad(res, 400, 'std_financial_rate_percent must be a number')
      if (!Number.isInteger(years) || years <= 0) return bad(res, 400, 'plan_duration_years must be integer >= 1')
      const allowedFreq = new Set(['monthly', 'quarterly', 'bi-annually', 'annually'])
      if (!allowedFreq.has(freq)) return bad(res, 400, 'installment_frequency must be one of monthly|quarterly|bi-annually|annually')

      const result = await pool.query(
        `INSERT INTO standard_pricing
          (unit_id, unit_type, price, area, std_financial_rate_percent, plan_duration_years, installment_frequency, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_approval')
         RETURNING *`,
        [unitId, unit_type, pr, ar, rate, years, freq, req.user.id]
      )
      return ok(res, { standard_pricing: result.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/standard-pricing error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.get(
  '/standard-pricing',
  authMiddleware,
  requireRole(['financial_manager', 'ceo', 'admin', 'superadmin', 'property_consultant', 'financial_admin', 'contract_person', 'contract_manager']),
  async (req, res) => {
    try {
      const { unit_id, status } = req.query || {}
      const unitId = unit_id ? ensureNumber(unit_id) : null
      const clauses = []
      const params = []
      if (unitId) {
        params.push(unitId)
        clauses.push(`unit_id = $${params.length}`)
      }
      if (status) {
        params.push(String(status))
        clauses.push(`status = $${params.length}`)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const q = `SELECT * FROM standard_pricing ${where} ORDER BY id DESC`
      const result = await pool.query(q, params)
      return ok(res, { standard_pricing: result.rows })
    } catch (e) {
      console.error('GET /api/workflow/standard-pricing error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * Sales team membership listing
 * Allows viewing existing manager assignments.
 * Optional query params:
 *  - consultant_user_id (number)
 *  - manager_user_id (number)
 *  - active (boolean, default true)
 */
router.get(
  '/sales-teams/memberships',
  authMiddleware,
  requireRole(['sales_manager', 'admin', 'superadmin', 'contract_manager', 'financial_manager']),
  async (req, res) => {
    try {
      const { consultant_user_id, manager_user_id } = req.query || {}
      const active = req.query.active === undefined ? true : String(req.query.active).toLowerCase() === 'true'
      const clauses = []
      const params = []

      if (consultant_user_id) {
        params.push(ensureNumber(consultant_user_id))
        clauses.push(`stm.consultant_user_id = $${params.length}`)
      }
      if (manager_user_id) {
        params.push(ensureNumber(manager_user_id))
        clauses.push(`stm.manager_user_id = $${params.length}`)
      }
      if (typeof active === 'boolean') {
        params.push(active)
        clauses.push(`stm.active = $${params.length}`)
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const sql = `
        SELECT stm.manager_user_id,
               stm.consultant_user_id AS member_user_id,
               stm.active,
               m.email AS manager_email,
               c.email AS member_email
        FROM sales_team_members stm
        JOIN users m ON m.id = stm.manager_user_id
        JOIN users c ON c.id = stm.consultant_user_id
        ${where}
        ORDER BY stm.manager_user_id ASC, stm.consultant_user_id ASC
      `
      const r = await pool.query(sql, params)
      return ok(res, { memberships: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/sales-teams/memberships error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * Contracts team membership listing
 */
router.get(
  '/contracts-teams/memberships',
  authMiddleware,
  requireRole(['contract_manager', 'admin', 'superadmin']),
  async (req, res) => {
    try {
      const { member_user_id, manager_user_id } = req.query || {}
      const active = req.query.active === undefined ? true : String(req.query.active).toLowerCase() === 'true'
      const clauses = []
      const params = []

      if (member_user_id) {
        params.push(ensureNumber(member_user_id))
        clauses.push(`tm.member_user_id = $${params.length}`)
      }
      if (manager_user_id) {
        params.push(ensureNumber(manager_user_id))
        clauses.push(`tm.manager_user_id = $${params.length}`)
      }
      if (typeof active === 'boolean') {
        params.push(active)
        clauses.push(`tm.active = $${params.length}`)
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const sql = `
        SELECT tm.manager_user_id,
               tm.member_user_id,
               tm.active,
               m.email AS manager_email,
               c.email AS member_email
        FROM contracts_team_members tm
        JOIN users m ON m.id = tm.manager_user_id
        JOIN users c ON c.id = tm.member_user_id
        ${where}
        ORDER BY tm.manager_user_id ASC, tm.member_user_id ASC
      `
      const r = await pool.query(sql, params)
      return ok(res, { memberships: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/contracts-teams/memberships error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * Finance team membership listing
 */
router.get(
  '/finance-teams/memberships',
  authMiddleware,
  requireRole(['financial_manager', 'admin', 'superadmin']),
  async (req, res) => {
    try {
      const { member_user_id, manager_user_id } = req.query || {}
      const active = req.query.active === undefined ? true : String(req.query.active).toLowerCase() === 'true'
      const clauses = []
      const params = []

      if (member_user_id) {
        params.push(ensureNumber(member_user_id))
        clauses.push(`tm.member_user_id = $${params.length}`)
      }
      if (manager_user_id) {
        params.push(ensureNumber(manager_user_id))
        clauses.push(`tm.manager_user_id = $${params.length}`)
      }
      if (typeof active === 'boolean') {
        params.push(active)
        clauses.push(`tm.active = $${params.length}`)
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const sql = `
        SELECT tm.manager_user_id,
               tm.member_user_id,
               tm.active,
               m.email AS manager_email,
               c.email AS member_email
        FROM finance_team_members tm
        JOIN users m ON m.id = tm.manager_user_id
        JOIN users c ON c.id = tm.member_user_id
        ${where}
        ORDER by tm.manager_user_id ASC, tm.member_user_id ASC
      `
      const r = await pool.query(sql, params)
      return ok(res, { memberships: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/finance-teams/memberships error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Financial manager updates standard data (even if approved) -> moves to pending_approval and logs history
router.patch(
  '/standard-pricing/:id',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      // Load old row
      const oldRes = await client.query('SELECT * FROM standard_pricing WHERE id=$1', [id])
      if (oldRes.rows.length === 0) {
        client.release()
        return bad(res, 404, 'Standard record not found')
      }
      const oldRow = oldRes.rows[0]

      const allowedFields = [
        'unit_type', 'price', 'area', 'std_financial_rate_percent',
        'plan_duration_years', 'installment_frequency'
      ]
      const updates = []
      const params = []
      for (const f of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
          params.push(req.body[f])
          updates.push(`${f} = ${params.length}`)
        }
      }
      if (updates.length === 0) {
        client.release()
        return bad(res, 400, 'No updatable fields provided')
      }

      // Enforce valid frequency if provided
      if (Object.prototype.hasOwnProperty.call(req.body, 'installment_frequency')) {
        const freq = String(req.body.installment_frequency || '').toLowerCase()
        const allowed = new Set(['monthly', 'quarterly', 'bi-annually', 'annually'])
        if (!allowed.has(freq)) {
          client.release()
          return bad(res, 400, 'installment_frequency must be one of monthly|quarterly|bi-annually|annually')
        }
      }

      await client.query('BEGIN')
      // Build update SQL using $ placeholders
      const updateSql = `
        UPDATE standard_pricing
        SET ${updates.join(', ')},
            status='pending_approval',
            approved_by=NULL,
            updated_at=now()
        WHERE id=${params.length + 1}
        RETURNING *`
      const updateParams = params.concat([id])
      const updRes = await client.query(updateSql, updateParams)
      const newRow = updRes.rows[0]

      // History log
      await client.query(
        `INSERT INTO standard_pricing_history
         (standard_pricing_id, change_type, changed_by, old_values, new_values)
         VALUES ($1, 'update', $2, $3::jsonb, $4::jsonb)`,
        [id, req.user.id, JSON.stringify(oldRow), JSON.stringify(newRow)]
      )

      await client.query('COMMIT')
      client.release()
      return ok(res, { standard_pricing: newRow })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('PATCH /api/workflow/standard-pricing/:id error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// CEO approves/rejects
router.patch(
  '/standard-pricing/:id/approve',
  authMiddleware,
  requireRole(['ceo', 'chairman', 'vice_chairman']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }
      await client.query('BEGIN')
      const prev = await client.query('SELECT * FROM standard_pricing WHERE id=$1', [id])
      const result = await client.query(
        `UPDATE standard_pricing
         SET status='approved', approved_by=$1, updated_at=now()
         WHERE id=$2 AND status='pending_approval'
         RETURNING *`,
        [req.user.id, id]
      )
      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 404, 'Not found or not pending')
      }
      const row = result.rows[0]
      await client.query(
        `INSERT INTO standard_pricing_history
         (standard_pricing_id, change_type, changed_by, old_values, new_values)
         VALUES ($1, 'approve', $2, $3::jsonb, $4::jsonb)`,
        [id, req.user.id, JSON.stringify(prev.rows[0] || null), JSON.stringify(row)]
      )
      // Propagate approved standard pricing to the related unit (if present)
      const unitId = Number(row.unit_id) || null
      const newPrice = Number(row.price) || 0
      const newArea = row.area != null ? Number(row.area) : null
      const newUnitTypeName = typeof row.unit_type === 'string' ? row.unit_type.trim() : null
      let resolvedUnitTypeId = null
      if (unitId) {
        // Try to resolve unit_type_id from name when provided
        if (newUnitTypeName) {
          const utRes = await client.query('SELECT id FROM unit_types WHERE name ILIKE $1 LIMIT 1', [newUnitTypeName])
          if (utRes.rows.length > 0) {
            resolvedUnitTypeId = Number(utRes.rows[0].id)
          }
        }

        // Build dynamic UPDATE for units
        const sets = []
        const params = []
        if (Number.isFinite(newPrice)) { params.push(newPrice); sets.push(`base_price=${params.length}`) }
        if (newArea != null && Number.isFinite(newArea) && newArea > 0) { params.push(newArea); sets.push(`area=${params.length}`) }
        if (newUnitTypeName) { params.push(newUnitTypeName); sets.push(`unit_type=${params.length}`) }
        if (resolvedUnitTypeId != null) { params.push(resolvedUnitTypeId); sets.push(`unit_type_id=${params.length}`) }

        params.push(unitId)
        const sql = `UPDATE units SET ${sets.join(', ')}, updated_at=now() WHERE id=${params.length}`
        const upd = await client.query(sql, params)

        // Log propagate in standard_pricing_history
        await client.query(
          `INSERT INTO standard_pricing_history
           (standard_pricing_id, change_type, changed_by, old_values, new_values)
           VALUES ($1, 'propagate', $2, $3::jsonb, $4::jsonb)`,
          [
            id,
            req.user.id,
            JSON.stringify(prev.rows[0] || null),
            JSON.stringify({
              propagated_to_units: upd.rowCount || 0,
              unit_id: unitId,
              new_base_price: newPrice,
              new_area: newArea,
              new_unit_type: newUnitTypeName || null,
              new_unit_type_id: resolvedUnitTypeId,
            }),
          ]
        )

        // Additional units audit entry: record change source in unit_inventory_changes
        const payload = {
          source: 'standard_pricing_approval',
          standard_pricing_id: id,
          updates: {
            base_price: Number.isFinite(newPrice) ? newPrice : undefined,
            area: (newArea != null && Number.isFinite(newArea) && newArea > 0) ? newArea : undefined,
            unit_type: newUnitTypeName || undefined,
            unit_type_id: resolvedUnitTypeId != null ? resolvedUnitTypeId : undefined
          }
        }
        await client.query(
          `INSERT INTO unit_inventory_changes (unit_id, action, payload, status, requested_by, approved_by, reason)
           VALUES ($1, 'update', $2::jsonb, 'approved', $3, $3, 'propagate_from_standard_pricing_approval')`,
          [unitId, JSON.stringify(payload), req.user.id]
        )
      }
      await client.query('COMMIT')
      client.release()
      return ok(res, { standard_pricing: row })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('PATCH /api/workflow/standard-pricing/:id/approve error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/standard-pricing/:id/reject',
  authMiddleware,
  requireRole(['ceo', 'chairman', 'vice_chairman']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }
      await client.query('BEGIN')
      const prev = await client.query('SELECT * FROM standard_pricing WHERE id=$1', [id])
      const result = await client.query(
        `UPDATE standard_pricing
         SET status='rejected', approved_by=$1, updated_at=now()
         WHERE id=$2 AND status='pending_approval'
         RETURNING *`,
        [req.user.id, id]
      )
      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        client.release()
        return bad(res, 404, 'Not found or not pending')
      }
      const row = result.rows[0]
      await client.query(
        `INSERT INTO standard_pricing_history
         (standard_pricing_id, change_type, changed_by, old_values, new_values)
         VALUES ($1, 'reject', $2, $3::jsonb, $4::jsonb)`,
        [id, req.user.id, JSON.stringify(prev.rows[0] || null), JSON.stringify(row)]
      )
      await client.query('COMMIT')
      client.release()
      return ok(res, { standard_pricing: row })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('PATCH /api/workflow/standard-pricing/:id/reject error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * SECTION 2: Payment Plans (Sales Consultant -> Financial Manager approval)
 * - create by: property_consultant
 * - approve/reject by: financial_manager
 */
router.post(
  '/payment-plans',
  authMiddleware,
  requireRole(['property_consultant', 'financial_manager', 'financial_admin', 'sales_manager']),
  async (req, res) => {
    try {
      const { deal_id, details } = req.body || {}
      const dealId = ensureNumber(deal_id)
      if (!dealId) return bad(res, 400, 'deal_id is required and must be a number')
      const det = details && typeof details === 'object' ? details : {}

      // Extract discount percent from typical shapes
      const disc = Number(det?.inputs?.salesDiscountPercent ?? det?.salesDiscountPercent ?? 0) || 0
      let status = 'pending_sm' // default: Sales-Manager review

      if (req.user?.role === 'property_consultant') {
        if (disc > 2) {
          // Still allow creation; SM will escalate to FM
          status = 'pending_sm'
        } else {
          status = 'pending_sm'
        }
      } else if (req.user?.role === 'sales_manager') {
        // SM can directly approve if ≤2, otherwise send to FM
        if (disc <= 2) {
          status = 'approved'
        } else {
          status = 'pending_fm'
        }
      } else if (req.user?.role === 'financial_manager') {
        // FM can approve within policy limit; else escalate to TM
        const policyLimit = await getPolicyLimitForPlan(det)
        if (disc <= policyLimit) {
          status = 'approved'
        } else {
          status = 'pending_tm'
        }
      }

      const result = await pool.query(
        `INSERT INTO payment_plans (deal_id, details, created_by, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [dealId, det, req.user.id, status]
      )
      return ok(res, { payment_plan: result.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/payment-plans error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.get(
  '/payment-plans',
  authMiddleware,
  requireRole(['property_consultant', 'financial_manager', 'sales_manager', 'admin', 'superadmin']),
  async (req, res) => {
    try {
      const { deal_id, status } = req.query || {}
      const clauses = []
      const params = []
      if (deal_id) {
        params.push(ensureNumber(deal_id))
        clauses.push(`deal_id = ${params.length}`)
      }
      if (status) {
        params.push(String(status))
        clauses.push(`status = ${params.length}`)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const result = await pool.query(`SELECT * FROM payment_plans ${where} ORDER BY id DESC`, params)
      return ok(res, { payment_plans: result.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Get a payment plan by id
router.get(
  '/payment-plans/:id',
  authMiddleware,
  requireRole(['property_consultant', 'financial_manager', 'financial_admin', 'sales_manager', 'admin', 'superadmin']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const r = await pool.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (r.rows.length === 0) return bad(res, 404, 'Payment plan not found')
      return ok(res, { payment_plan: r.rows[0] })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/:id error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Queues
router.get('/payment-plans/queue/sm', authMiddleware, requireRole(['sales_manager']), async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM payment_plans WHERE status='pending_sm' ORDER BY id DESC`)
    return ok(res, { payment_plans: r.rows })
  } catch (e) {
    console.error('GET /api/workflow/payment-plans/queue/sm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.get('/payment-plans/queue/fm', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM payment_plans WHERE status='pending_fm' ORDER BY id DESC`)
    return ok(res, { payment_plans: r.rows })
  } catch (e) {
    console.error('GET /api/workflow/payment-plans/queue/fm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.get('/payment-plans/queue/tm', authMiddleware, requireRole(['ceo', 'vice_chairman', 'chairman', 'top_management']), async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM payment_plans WHERE status='pending_tm' ORDER BY id DESC`)
    return ok(res, { payment_plans: r.rows })
  } catch (e) {
    console.error('GET /api/workflow/payment-plans/queue/tm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Approvals by financial_manager
router.patch(
  '/payment-plans/:id/approve',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      // Load plan to check discount and current status
      const cur = await pool.query('SELECT id, details, status FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Not found')
      if (!['pending_fm', 'pending_sm', 'pending_approval'].includes(cur.rows[0].status)) {
        return bad(res, 400, 'Plan not in a state FM can act upon')
      }

      const det = cur.rows[0].details || {}
      const disc = Number(det?.inputs?.salesDiscountPercent ?? det?.salesDiscountPercent ?? 0) || 0
      const policyLimit = await getPolicyLimitForPlan(det)

      if (disc <= policyLimit) {
        const result = await pool.query(
          `UPDATE payment_plans
           SET status='approved', approved_by=$1, updated_at=now()
           WHERE id=$2
           RETURNING *`,
          [req.user.id, id]
        )
        return ok(res, { payment_plan: result.rows[0] })
      } else {
        // Over policy -> escalate to Top-Management queue
        const result = await pool.query(
          `UPDATE payment_plans
           SET status='pending_tm', approved_by=$1, updated_at=now()
           WHERE id=$2
           RETURNING *`,
          [req.user.id, id]
        )
        return ok(res, { payment_plan: result.rows[0] })
      }
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/approve error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Sales-Manager approvals (≤2% approve directly, otherwise route to FM)
router.patch(
  '/payment-plans/:id/approve-sm',
  authMiddleware,
  requireRole(['sales_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const cur = await pool.query('SELECT id, details, status FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Not found')
      if (!['pending_sm', 'pending_approval'].includes(cur.rows[0].status)) {
        return bad(res, 400, 'Plan not in Sales-Manager queue')
      }

      const det = cur.rows[0].details || {}
      const disc = Number(det?.inputs?.salesDiscountPercent ?? det?.salesDiscountPercent ?? 0) || 0
      if (disc <= 2) {
        const r = await pool.query(
          `UPDATE payment_plans SET status='approved', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
          [req.user.id, id]
        )
        return ok(res, { payment_plan: r.rows[0] })
      } else {
        const r = await pool.query(
          `UPDATE payment_plans SET status='pending_fm', updated_at=now() WHERE id=$1 RETURNING *`,
          [id]
        )
        return ok(res, { payment_plan: r.rows[0] })
      }
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
      const cur = await pool.query('SELECT id, status FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Not found')
      if (!['pending_sm', 'pending_approval'].includes(cur.rows[0].status)) {
        return bad(res, 400, 'Plan not in Sales-Manager queue')
      }
      const r = await pool.query(
        `UPDATE payment_plans SET status='rejected', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [req.user.id, id]
      )
      return ok(res, { payment_plan: r.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/reject-sm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Top-Management dual approvals
router.patch(
  '/payment-plans/:id/approve-tm',
  authMiddleware,
  requireRole(['ceo']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
      await client.query('BEGIN')
      const cur = await client.query('SELECT id, status FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Not found') }
      if (cur.rows[0].status !== 'pending_tm') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Plan is not pending Top-Management') }
      // record approval (unique per approver)
      await client.query(
        `INSERT INTO payment_plan_tm_approvals (payment_plan_id, approver_user_id, decision)
         VALUES ($1, $2, 'approve')
         ON CONFLICT (payment_plan_id, approver_user_id) DO UPDATE SET decision='approve', created_at=now()`,
        [id, req.user.id]
      )
      const approvals = await client.query(
        `SELECT COUNT(*)::int AS c FROM payment_plan_tm_approvals WHERE payment_plan_id=$1 AND decision='approve'`,
        [id]
      )
      if ((approvals.rows[0]?.c || 0) >= 2) {
        const upd = await client.query(
          `UPDATE payment_plans SET status='approved', updated_at=now() WHERE id=$1 RETURNING *`,
          [id]
        )
        await client.query('COMMIT'); client.release()
        return ok(res, { payment_plan: upd.rows[0], approvals_required: 2, approvals_count: approvals.rows[0].c })
      } else {
        await client.query('COMMIT'); client.release()
        return ok(res, { payment_plan: cur.rows[0], approvals_required: 2, approvals_count: approvals.rows[0].c })
      }
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('PATCH /api/workflow/payment-plans/:id/approve-tm error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/payment-plans/:id/reject-tm',
  authMiddleware,
  requireRole(['ceo', 'vice_chairman', 'chairman', 'top_management']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
      await client.query('BEGIN')
      const cur = await client.query('SELECT id, status FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Not found') }
      if (cur.rows[0].status !== 'pending_tm') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Plan is not pending Top-Management') }
      await client.query(
        `INSERT INTO payment_plan_tm_approvals (payment_plan_id, approver_user_id, decision)
         VALUES ($1, $2, 'reject')
         ON CONFLICT (payment_plan_id, approver_user_id) DO UPDATE SET decision='reject', created_at=now()`,
        [id, req.user.id]
      )
      const upd = await client.query(
        `UPDATE payment_plans SET status='rejected', updated_at=now() WHERE id=$1 RETURNING *`,
        [id]
      )
      await client.query('COMMIT'); client.release()
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('PATCH /api/workflow/payment-plans/:id/reject-tm error:', e)
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
      const result = await pool.query(
        `UPDATE payment_plans
         SET status='rejected', approved_by=$1, updated_at=now()
         WHERE id=$2 AND status IN ('pending_approval','pending_sm','pending_fm','pending_tm')
         RETURNING *`,
        [req.user.id, id]
      )
      if (result.rows.length === 0) return bad(res, 404, 'Not found or not pending')
      return ok(res, { payment_plan: result.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/payment-plans/:id/reject error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// CEO approval for plans that exceeded 2% discount
router.patch(
  '/payment-plans/:id/approve-ceo',
  authMiddleware,
  requireRole(['ceo']),
  async (req, res) => {
    // Deprecated: use /approve-tm by Top-Management (CEO/VC/Chairman)
    return res.status(410).json({ error: { message: 'Deprecated endpoint. Use /api/workflow/payment-plans/:id/approve-tm' } })
  }
)

// Sales team assignments
router.post(
  '/sales-teams/assign',
  authMiddleware,
  requireRole(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { manager_user_id, consultant_user_id } = req.body || {}
      const mid = ensureNumber(manager_user_id)
      const cid = ensureNumber(consultant_user_id)
      if (!mid || !cid) return bad(res, 400, 'manager_user_id and consultant_user_id are required numbers')
      const r = await pool.query(
        `INSERT INTO sales_team_members (manager_user_id, consultant_user_id, active)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (manager_user_id, consultant_user_id)
         DO UPDATE SET active=TRUE, updated_at=now()
         RETURNING *`,
        [mid, cid]
      )
      return ok(res, { membership: r.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/sales-teams/assign error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/sales-teams/assign',
  authMiddleware,
  requireRole(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { manager_user_id, consultant_user_id, active } = req.body || {}
      const mid = ensureNumber(manager_user_id)
      const cid = ensureNumber(consultant_user_id)
      if (!mid || !cid || typeof active !== 'boolean') return bad(res, 400, 'manager_user_id, consultant_user_id and active:boolean are required')
      const r = await pool.query(
        `UPDATE sales_team_members SET active=$1, updated_at=now()
         WHERE manager_user_id=$2 AND consultant_user_id=$3
         RETURNING *`,
        [active, mid, cid]
      )
      if (r.rows.length === 0) return bad(res, 404, 'Assignment not found')
      return ok(res, { membership: r.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/sales-teams/assign error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Contracts team assignments
router.post(
  '/contracts-teams/assign',
  authMiddleware,
  requireRole(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { manager_user_id, member_user_id } = req.body || {}
      const mid = ensureNumber(manager_user_id)
      const cid = ensureNumber(member_user_id)
      if (!mid || !cid) return bad(res, 400, 'manager_user_id and member_user_id are required numbers')
      const r = await pool.query(
        `INSERT INTO contracts_team_members (manager_user_id, member_user_id, active)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (manager_user_id, member_user_id)
         DO UPDATE SET active=TRUE, updated_at=now()
         RETURNING *`,
        [mid, cid]
      )
      return ok(res, { membership: r.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/contracts-teams/assign error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/contracts-teams/assign',
  authMiddleware,
  requireRole(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { manager_user_id, member_user_id, active } = req.body || {}
      const mid = ensureNumber(manager_user_id)
      const cid = ensureNumber(member_user_id)
      if (!mid || !cid || typeof active !== 'boolean') return bad(res, 400, 'manager_user_id, member_user_id and active:boolean are required')
      const r = await pool.query(
        `UPDATE contracts_team_members SET active=$1, updated_at=now()
         WHERE manager_user_id=$2 AND member_user_id=$3
         RETURNING *`,
        [active, mid, cid]
      )
      if (r.rows.length === 0) return bad(res, 404, 'Assignment not found')
      return ok(res, { membership: r.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/contracts-teams/assign error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.post(
  '/finance-teams/assign',
  authMiddleware,
  requireRole(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { manager_user_id, member_user_id } = req.body || {}
      const mid = ensureNumber(manager_user_id)
      const cid = ensureNumber(member_user_id)
      if (!mid || !cid) return bad(res, 400, 'manager_user_id and member_user_id are required numbers')
      const r = await pool.query(
        `INSERT INTO finance_team_members (manager_user_id, member_user_id, active)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (manager_user_id, member_user_id)
         DO UPDATE SET active=TRUE, updated_at=now()
         RETURNING *`,
        [mid, cid]
      )
      return ok(res, { membership: r.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/finance-teams/assign error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.patch(
  '/finance-teams/assign',
  authMiddleware,
  requireRole(['admin', 'superadmin']),
  async (req, res) => {
    try {
      const { manager_user_id, member_user_id, active } = req.body || {}
      const mid = ensureNumber(manager_user_id)
      const cid = ensureNumber(member_user_id)
      if (!mid || !cid || typeof active !== 'boolean') return bad(res, 400, 'manager_user_id, member_user_id and active:boolean are required')
      const r = await pool.query(
        `UPDATE finance_team_members SET active=$1, updated_at=now()
         WHERE manager_user_id=$2 AND member_user_id=$3
         RETURNING *`,
        [active, mid, cid]
      )
      if (r.rows.length === 0) return bad(res, 404, 'Assignment not found')
      return ok(res, { membership: r.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/finance-teams/assign error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Proposal listing helpers
router.get(
  '/payment-plans/my',
  authMiddleware,
  requireRole(['property_consultant']),
  async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM payment_plans WHERE created_by=$1 ORDER BY id DESC`,
        [req.user.id]
      )
      return ok(res, { payment_plans: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/my error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

router.get(
  '/payment-plans/team',
  authMiddleware,
  requireRole(['sales_manager']),
  async (req, res) => {
    try {
      // consultants assigned to this manager
      const team = await pool.query(
        `SELECT consultant_user_id AS uid
         FROM sales_team_members
         WHERE manager_user_id=$1 AND active=TRUE`,
        [req.user.id]
      )
      const uids = team.rows.map(r => r.uid)
      if (uids.length === 0) return ok(res, { payment_plans: [] })
      const placeholders = uids.map((_, i) => `$${i + 1}`).join(',')
      const r = await pool.query(
        `SELECT * FROM payment_plans WHERE created_by IN (${placeholders}) ORDER BY id DESC`,
        uids
      )
      return ok(res, { payment_plans: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/team error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Create a new version of a payment plan
router.post(
  '/payment-plans/:id/new-version',
  authMiddleware,
  requireRole(['property_consultant']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }
      await client.query('BEGIN')
      const cur = await client.query('SELECT * FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK'); client.release()
        return bad(res, 404, 'Payment plan not found')
      }
      const prev = cur.rows[0]
      // Only the original creator (consultant) can create new versions
      if (prev.created_by !== req.user.id) {
        await client.query('ROLLBACK'); client.release()
        return bad(res, 403, 'Only the consultant who created this plan can create a new version')
      }
      // Next version number for same deal
      const vres = await client.query('SELECT COALESCE(MAX(version),0)+1 AS v FROM payment_plans WHERE deal_id=$1', [prev.deal_id])
      const nextV = vres.rows[0].v || 1
      const ins = await client.query(
        `INSERT INTO payment_plans (deal_id, details, created_by, status, version, supersedes_id)
         VALUES ($1, $2, $3, 'pending_approval', $4, $5)
         RETURNING *`,
        [prev.deal_id, prev.details, req.user.id, nextV, id]
      )
      await client.query('COMMIT'); client.release()
      return ok(res, { payment_plan: ins.rows[0] })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('POST /api/workflow/payment-plans/:id/new-version error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// FM/FA request edits on a payment plan (does not modify the plan)
router.post(
  '/payment-plans/:id/request-edits',
  authMiddleware,
  requireRole(['financial_manager','financial_admin']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const { reason, fields } = req.body || {}
      const cur = await pool.query('SELECT id, details, created_by FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Payment plan not found')
      const det = cur.rows[0].details || {}
      const meta = det.meta || {}
      const editReq = {
        by_user_id: req.user.id,
        by_role: req.user.role,
        reason: typeof reason === 'string' ? reason : null,
        fields: Array.isArray(fields) ? fields : [],
        at: new Date().toISOString()
      }
      const nextMeta = {
        ...meta,
        pending_edit_request: true,
        edit_requests: [...(meta.edit_requests || []), editReq]
      }
      const nextDetails = { ...det, meta: nextMeta }
      const upd = await pool.query(
        `UPDATE payment_plans SET details=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [nextDetails, id]
      )
      // Notify the consultant (creator)
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           VALUES ($1, 'payment_plan_request_edits', 'payment_plans', $2, $3)`,
          [cur.rows[0].created_by, id, String(reason || 'Edits requested for your payment plan.')]
        )
      } catch {}
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/payment-plans/:id/request-edits error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Consultant marks edits addressed (does not change approval status)
router.post(
  '/payment-plans/:id/edits-addressed',
  authMiddleware,
  requireRole(['property_consultant']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      const { notes } = req.body || {}
      if (!id) return bad(res, 400, 'Invalid id')
      const cur = await pool.query('SELECT id, details FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) return bad(res, 404, 'Payment plan not found')
      const det = cur.rows[0].details || {}
      const meta = det.meta || {}
      const resp = {
        by_user_id: req.user.id,
        notes: typeof notes === 'string' ? notes : null,
        at: new Date().toISOString()
      }
      const nextMeta = {
        ...meta,
        pending_edit_request: false,
        edit_responses: [...(meta.edit_responses || []), resp]
      }
      const nextDetails = { ...det, meta: nextMeta }
      const upd = await pool.query(
        `UPDATE payment_plans SET details=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [nextDetails, id]
      )
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      console.error('POST /api/workflow/payment-plans/:id/edits-addressed error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Mark an approved plan as accepted (unique per deal)
router.patch(
  '/payment-plans/:id/mark-accepted',
  authMiddleware,
  requireRole(['financial_manager', 'ceo']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) {
        client.release()
        return bad(res, 400, 'Invalid id')
      }
      await client.query('BEGIN')
      const cur = await client.query('SELECT id, deal_id, status FROM payment_plans WHERE id=$1', [id])
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK'); client.release()
        return bad(res, 404, 'Not found')
      }
      if (cur.rows[0].status !== 'approved') {
        await client.query('ROLLBACK'); client.release()
        return bad(res, 400, 'Only approved plans can be accepted')
      }
      // Set accepted on this plan; unique index ensures only one per deal
      const upd = await client.query(
        `UPDATE payment_plans SET accepted=TRUE, accepted_at=now() WHERE id=$1 RETURNING *`,
        [id]
      )
      await client.query('COMMIT'); client.release()
      return ok(res, { payment_plan: upd.rows[0] })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      if (String(e.message || '').includes('uniq_payment_plans_one_accepted_per_deal')) {
        return bad(res, 400, 'This deal already has an accepted plan')
      }
      console.error('PATCH /api/workflow/payment-plans/:id/mark-accepted error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

/**
 * SECTION 3: Reservation Forms (Financial Admin -> Financial Manager review)
 * - create/edit by: financial_admin
 * - approve/reject by: financial_manager
 */
router.post(
  '/reservation-forms',
  authMiddleware,
  requireRole(['financial_admin']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const { payment_plan_id, details } = req.body || {}
      const pid = ensureNumber(payment_plan_id)
      if (!pid) {
        client.release()
        return bad(res, 400, 'payment_plan_id is required and must be a number')
      }

      // Ensure payment plan exists and is approved by financial manager
      const planRes = await client.query('SELECT id, status FROM payment_plans WHERE id=$1', [pid])
      if (planRes.rows.length === 0) { client.release(); return bad(res, 404, 'Payment plan not found') }
      if (planRes.rows[0].status !== 'approved') { client.release(); return bad(res, 400, 'Payment plan must be approved before creating reservation') }

      const det = details && typeof details === 'object' ? details : {}
      await client.query('BEGIN')
      const result = await client.query(
        `INSERT INTO reservation_forms (payment_plan_id, details, created_by, status)
         VALUES ($1, $2, $3, 'pending_approval')
         RETURNING *`,
        [pid, det, req.user.id]
      )
      const row = result.rows[0]
      await client.query(
        `INSERT INTO reservation_forms_history (reservation_form_id, change_type, changed_by, old_values, new_values)
         VALUES ($1, 'create', $2, $3::jsonb, $4::jsonb)`,
        [row.id, req.user.id, JSON.stringify(null), JSON.stringify(row)]
      )
      await client.query('COMMIT'); client.release()
      return ok(res, { reservation_form: row })
    } catch (e) {
      try { await client.query('ROLLBACK') } catch {}
      client.release()
      console.error('POST /api/workflow/reservation-forms error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// List reservation forms (FA/FM)
router.get(
  '/reservation-forms',
  authMiddleware,
  requireRole(['financial_admin','financial_manager']),
  async (req, res) => {
    try {
      const { status = 'pending_approval' } = req.query || {}
      const r = await pool.query(
        `SELECT rf.*, pp.deal_id, pp.status AS payment_plan_status
         FROM reservation_forms rf
         LEFT JOIN payment_plans pp ON pp.id = rf.payment_plan_id
         WHERE ($1 = 'all' OR rf.status = $1)
         ORDER BY rf.id DESC`,
        [String(status)]
      )
      return ok(res, { reservation_forms: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/reservation-forms error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// FM approve reservation form
router.patch(
  '/reservation-forms/:id/approve',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')
      const r0 = await pool.query('SELECT * FROM reservation_forms WHERE id=$1', [id])
      if (r0.rows.length === 0) return bad(res, 404, 'Reservation form not found')
      if (r0.rows[0].status !== 'pending_approval') return bad(res, 400, 'Reservation form is not pending approval')
      const upd = await pool.query(
        `UPDATE reservation_forms
         SET status='approved', approved_by=$1, updated_at=now()
         WHERE id=$2
         RETURNING *`,
        [req.user.id, id]
      )
      await pool.query(
        `INSERT INTO reservation_forms_history (reservation_form_id, change_type, changed_by, old_values, new_values)
         VALUES ($1, 'approve', $2, $3::jsonb, $4::jsonb)`,
        [id, req.user.id, JSON.stringify(r0.rows[0]), JSON.stringify(upd.rows[0])]
      )
      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
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
      const { reason } = req.body || {}
      if (!id) return bad(res, 400, 'Invalid id')
      const r0 = await pool.query('SELECT * FROM reservation_forms WHERE id=$1', [id])
      if (r0.rows.length === 0) return bad(res, 404, 'Reservation form not found')
      if (r0.rows[0].status !== 'pending_approval') return bad(res, 400, 'Reservation form is not pending approval')
      const upd = await pool.query(
        `UPDATE reservation_forms
         SET status='rejected', approved_by=$1, updated_at=now()
         WHERE id=$2
         RETURNING *`,
        [req.user.id, id]
      )
      await pool.query(
        `INSERT INTO reservation_forms_history (reservation_form_id, change_type, changed_by, old_values, new_values)
         VALUES ($1, 'reject', $2, $3::jsonb, $4::jsonb)`,
        [id, req.user.id, JSON.stringify({ ...r0.rows[0], reason: reason || null }), JSON.stringify(upd.rows[0])]
      )
      return ok(res, { reservation_form: upd.rows[0] })
    } catch (e) {
      console.error('PATCH /api/workflow/reservation-forms/:id/reject error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// List approved payment plans for a unit (by unit_id inside plan details.calculator.unitInfo.unit_id)
router.get(
  '/payment-plans/approved-for-unit',
  authMiddleware,
  requireRole(['financial_admin','financial_manager','sales_manager','property_consultant']),
  async (req, res) => {
    try {
      const unitId = ensureNumber(req.query.unit_id)
      if (!unitId) return bad(res, 400, 'unit_id is required')
      const r = await pool.query(
        `SELECT id, deal_id, COALESCE(version, 1) AS version, status, created_at
         FROM payment_plans
         WHERE status='approved'
           AND (details->'calculator'->'unitInfo'->>'unit_id')::int = $1
         ORDER BY id DESC`,
        [unitId]
      )
      return ok(res, { payment_plans: r.rows })
    } catch (e) {
      console.error('GET /api/workflow/payment-plans/approved-for-unit error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

export default router