import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) { return res.json({ ok: true, ...payload }) }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

// Get latest active global standard plan (broad read access)
router.get('/latest', authMiddleware, requireRole(['admin','superadmin','sales_manager','property_consultant','financial_manager','financial_admin','ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, active, std_financial_rate_percent, plan_duration_years, installment_frequency, npv_tolerance_percent,
              created_at, updated_at, created_by, updated_by
       FROM standard_plan
       WHERE active=TRUE
       ORDER BY id DESC
       LIMIT 1`
    )
    if (r.rows.length === 0) {
      return ok(res, { standardPlan: null })
    }
    return ok(res, { standardPlan: r.rows[0] })
  } catch (e) {
    console.error('GET /api/standard-plan/latest error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Financial Manager: request a new global standard plan (created inactive; pending by process, no status column)
router.post('/request', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    let { std_financial_rate_percent, plan_duration_years, installment_frequency, npv_tolerance_percent } = req.body || {}
    const rate = Number(std_financial_rate_percent)
    const years = Number(plan_duration_years)
    const freq = String(installment_frequency || '').toLowerCase()
    const npvTol = npv_tolerance_percent != null ? Number(npv_tolerance_percent) : null

    if (!Number.isFinite(rate)) return bad(res, 400, 'std_financial_rate_percent must be a number')
    if (!Number.isInteger(years) || years <= 0) return bad(res, 400, 'plan_duration_years must be an integer >= 1')
    if (!['monthly','quarterly','biannually','annually'].includes(freq)) {
      return bad(res, 400, 'installment_frequency must be one of monthly|quarterly|biannually|annually')
    }
    if (npvTol != null && (!Number.isFinite(npvTol) || npvTol < 0 || npvTol > 100)) {
      return bad(res, 400, 'npv_tolerance_percent must be 0..100 when provided')
    }

    const ins = await pool.query(
      `INSERT INTO standard_plan (active, std_financial_rate_percent, plan_duration_years, installment_frequency, npv_tolerance_percent, created_by, updated_by)
       VALUES (FALSE, $1, $2, $3, $4, $5, $5)
       RETURNING *`,
      [rate, years, freq, npvTol, req.user.id]
    )

    return ok(res, { standardPlan: ins.rows[0] })
  } catch (e) {
    console.error('POST /api/standard-plan/request error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Top Management: create and activate a new global standard plan directly (deactivates previous active)
router.post('/', authMiddleware, requireRole(['ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    let { std_financial_rate_percent, plan_duration_years, installment_frequency, npv_tolerance_percent } = req.body || {}
    const rate = Number(std_financial_rate_percent)
    const years = Number(plan_duration_years)
    const freq = String(installment_frequency || '').toLowerCase()
    const npvTol = npv_tolerance_percent != null ? Number(npv_tolerance_percent) : null

    if (!Number.isFinite(rate)) return bad(res, 400, 'std_financial_rate_percent must be a number')
    if (!Number.isInteger(years) || years <= 0) return bad(res, 400, 'plan_duration_years must be an integer >= 1')
    if (!['monthly','quarterly','biannually','annually'].includes(freq)) {
      return bad(res, 400, 'installment_frequency must be one of monthly|quarterly|biannually|annually')
    }
    if (npvTol != null && (!Number.isFinite(npvTol) || npvTol < 0 || npvTol > 100)) {
      return bad(res, 400, 'npv_tolerance_percent must be 0..100 when provided')
    }

    await pool.query('UPDATE standard_plan SET active=FALSE, updated_at=now(), updated_by=$1 WHERE active=TRUE', [req.user.id])

    const ins = await pool.query(
      `INSERT INTO standard_plan (active, std_financial_rate_percent, plan_duration_years, installment_frequency, npv_tolerance_percent, created_by, updated_by)
       VALUES (TRUE, $1, $2, $3, $4, $5, $5)
       RETURNING *`,
      [rate, years, freq, npvTol, req.user.id]
    )

    return ok(res, { standardPlan: ins.rows[0] })
  } catch (e) {
    console.error('POST /api/standard-plan error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Top Management: approve a pending standard plan (activate it; no status column)
router.patch('/:id/approve', authMiddleware, requireRole(['ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')

    // Deactivate others, mark this one active
    await pool.query('UPDATE standard_plan SET active=FALSE, updated_at=now(), updated_by=$1 WHERE active=TRUE AND id<>$2', [req.user.id, id])
    const r = await pool.query(
      `UPDATE standard_plan
       SET active=TRUE, updated_by=$1, updated_at=now()
       WHERE id=$2
       RETURNING *`,
      [req.user.id, id]
    )
    if (r.rows.length === 0) return bad(res, 404, 'Not found')
    return ok(res, { standardPlan: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/standard-plan/:id/approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Top Management: reject a pending standard plan (no status column; keep inactive and mark updated_by)
router.patch('/:id/reject', authMiddleware, requireRole(['ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const r = await pool.query(
      `UPDATE standard_plan
       SET active=FALSE, updated_by=$1, updated_at=now()
       WHERE id=$2
       RETURNING *`,
      [req.user.id, id]
    )
    if (r.rows.length === 0) return bad(res, 404, 'Not found')
    return ok(res, { standardPlan: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/standard-plan/:id/reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Top Management: update an existing standard plan record (keep for minor edits)
router.patch('/:id', authMiddleware, requireRole(['ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')

    const allow = ['std_financial_rate_percent','plan_duration_years','installment_frequency','npv_tolerance_percent','active']
    const fields = []
    const params = []
    let pc = 1

    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
        let v = req.body[k]
        if (k === 'std_financial_rate_percent' || k === 'npv_tolerance_percent') {
          v = v == null ? null : Number(v)
          if (v != null && !Number.isFinite(v)) return bad(res, 400, `${k} must be numeric`)
        }
        if (k === 'plan_duration_years') {
          const yrs = Number(v)
          if (!Number.isInteger(yrs) || yrs <= 0) return bad(res, 400, 'plan_duration_years must be integer >= 1')
          v = yrs
        }
        if (k === 'installment_frequency') {
          v = String(v || '').toLowerCase()
          if (!['monthly','quarterly','biannually','annually'].includes(v)) {
            return bad(res, 400, 'installment_frequency must be one of monthly|quarterly|biannually|annually')
          }
        }
        if (k === 'active') {
          v = !!v
        }
        fields.push(`${k}=${pc++}`)
        params.push(v)
      }
    }

    if (fields.length === 0) return bad(res, 400, 'No fields to update')
    fields.push(`updated_by=${pc++}`)
    params.push(req.user.id)
    const idPh = `${pc++}`
    params.push(id)

    // If setting active=TRUE, deactivate other active records
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active') && !!req.body.active === true) {
      await pool.query('UPDATE standard_plan SET active=FALSE, updated_at=now(), updated_by=$1 WHERE active=TRUE AND id<>$2', [req.user.id, id])
    }

    const r = await pool.query(
      `UPDATE standard_plan SET ${fields.join(', ')}, updated_at=now() WHERE id=${idPh} RETURNING *`,
      params
    )

    if (r.rows.length === 0) return bad(res, 404, 'Standard plan not found')
    return ok(res, { standardPlan: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/standard-plan/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})

export default router