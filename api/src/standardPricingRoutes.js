import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'
import { bad, ok, ensureNumber } from './workflowUtils.js'

const router = express.Router()

/**
 * SECTION: Standard Pricing (Financial Manager -> CEO/Top Management approval)
 * - create/update by: financial_manager
 * - approve/reject by: ceo/chairman/vice_chairman
 */

// Create standard pricing record
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
      if (!Number.isInteger(years) || years <= 0) {
        return bad(res, 400, 'plan_duration_years must be integer >= 1')
      }
      const allowedFreq = new Set(['monthly', 'quarterly', 'bi-annually', 'annually'])
      if (!allowedFreq.has(freq)) {
        return bad(
          res,
          400,
          'installment_frequency must be one of monthly|quarterly|bi-annually|annually'
        )
      }

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

// List standard pricing records
router.get(
  '/standard-pricing',
  authMiddleware,
  requireRole([
    'financial_manager',
    'ceo',
    'admin',
    'superadmin',
    'property_consultant',
    'financial_admin',
    'contract_person',
    'contract_manager'
  ]),
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

// Financial manager updates standard data (even if approved)
router.patch(
  '/standard-pricing/:id',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    const client = await pool.connect()
    try {
      const id = ensureNumber(req.params.id)
      if (!id) return bad(res, 400, 'Invalid id')

      const oldRes = await client.query('SELECT * FROM standard_pricing WHERE id=$1', [id])
      if (oldRes.rows.length === 0) {
        client.release()
        return bad(res, 404, 'Standard record not found')
      }
      const oldRow = oldRes.rows[0]

      const allowedFields = [
        'unit_type',
        'price',
        'area',
        'std_financial_rate_percent',
        'plan_duration_years',
        'installment_frequency'
      ]
      const updates = []
      const params = []
      for (const f of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
          params.push(req.body[f])
          updates.push(`${f} = $${params.length}`)
        }
      }
      if (updates.length === 0) {
        client.release()
        return bad(res, 400, 'No updatable fields provided')
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'installment_frequency')) {
        const freq = String(req.body.installment_frequency || '').toLowerCase()
        const allowed = new Set(['monthly', 'quarterly', 'bi-annually', 'annually'])
        if (!allowed.has(freq)) {
          client.release()
          return bad(
            res,
            400,
            'installment_frequency must be one of monthly|quarterly|bi-annually|annually'
          )
        }
      }

      await client.query('BEGIN')
      const updateSql = `
        UPDATE standard_pricing
        SET ${updates.join(', ')},
            status='pending_approval',
            approved_by=NULL,
            updated_at=now()
        WHERE id=$${params.length + 1}
        RETURNING *`
      const updateParams = params.concat([id])
      const updRes = await client.query(updateSql, updateParams)
      const newRow = updRes.rows[0]

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
      try {
        await client.query('ROLLBACK')
      } catch {}
      client.release()
      console.error('PATCH /api/workflow/standard-pricing/:id error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// CEO/Top Management approves a standard pricing record and propagates to unit
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

      const unitId = Number(row.unit_id) || null
      const newPrice = Number(row.price) || 0
      const newArea = row.area != null ? Number(row.area) : null
      const newUnitTypeName = typeof row.unit_type === 'string' ? row.unit_type.trim() : null
      let resolvedUnitTypeId = null

      if (unitId) {
        if (newUnitTypeName) {
          const utRes = await client.query(
            'SELECT id FROM unit_types WHERE name ILIKE $1 LIMIT 1',
            [newUnitTypeName]
          )
          if (utRes.rows.length > 0) {
            resolvedUnitTypeId = Number(utRes.rows[0].id)
          }
        }

        const sets = []
        const params = []
        if (Number.isFinite(newPrice)) {
          params.push(newPrice)
          sets.push(`base_price=$${params.length}`)
        }
        if (newArea != null && Number.isFinite(newArea) && newArea > 0) {
          params.push(newArea)
          sets.push(`area=$${params.length}`)
        }
        if (newUnitTypeName) {
          params.push(newUnitTypeName)
          sets.push(`unit_type=$${params.length}`)
        }
        if (resolvedUnitTypeId != null) {
          params.push(resolvedUnitTypeId)
          sets.push(`unit_type_id=$${params.length}`)
        }

        if (sets.length > 0) {
          params.push(unitId)
          const sql = `UPDATE units SET ${sets.join(', ')}, updated_at=now() WHERE id=$${
            params.length
          }`
          const upd = await client.query(sql, params)

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
                new_unit_type_id: resolvedUnitTypeId
              })
            ]
          )

          const payload = {
            source: 'standard_pricing_approval',
            standard_pricing_id: id,
            updates: {
              base_price: Number.isFinite(newPrice) ? newPrice : undefined,
              area:
                newArea != null && Number.isFinite(newArea) && newArea > 0
                  ? newArea
                  : undefined,
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
      }

      await client.query('COMMIT')
      client.release()
      return ok(res, { standard_pricing: row })
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      client.release()
      console.error('PATCH /api/workflow/standard-pricing/:id/approve error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

// Reject standard pricing
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
      try {
        await client.query('ROLLBACK')
      } catch {}
      client.release()
      console.error('PATCH /api/workflow/standard-pricing/:id/reject error:', e)
      return bad(res, 500, 'Internal error')
    }
  }
)

export default router