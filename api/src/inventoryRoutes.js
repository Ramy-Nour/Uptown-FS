import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) { return res.json({ ok: true, ...payload }) }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

// Simple helper to compute changed fields diff (original -> updated)
function computeDiff(orig, updated) {
  const diff = {}
  for (const k of Object.keys(updated)) {
    const a = orig?.[k]
    const b = updated[k]
    // Normalize numeric strings
    const an = (a != null && a !== '') ? (isNaN(Number(a)) ? a : Number(a)) : a
    const bn = (b != null && b !== '') ? (isNaN(Number(b)) ? b : Number(b)) : b
    if (JSON.stringify(an) !== JSON.stringify(bn)) {
      diff[k] = { from: a, to: b }
    }
  }
  return diff
}

// Create a pending change row
async function createUnitModelChange(client, { action, model_id = null, payload = {}, requested_by }) {
  const r = await client.query(
    `INSERT INTO unit_model_changes (action, model_id, payload, requested_by)
     VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
    [String(action), model_id, JSON.stringify(payload), requested_by]
  )
  return r.rows[0]
}

// --------------------
// Unit Models (read list)
// --------------------
router.get('/unit-models', authMiddleware, requireRole(['financial_manager', 'financial_admin', 'ceo', 'chairman', 'vice_chairman']), async (req, res) => {
  try {
    const { search, page = 1, pageSize = 20 } = req.query || {}
    const p = Math.max(1, Number(page) || 1)
    const ps = Math.max(1, Math.min(100, Number(pageSize) || 20))
    const off = (p - 1) * ps

    const clauses = []
    const params = []
    let placeholderCount = 1

    if (search) {
      const searchPlaceholder = `$${placeholderCount++}`
      clauses.push(`(LOWER(model_name) LIKE ${searchPlaceholder} OR LOWER(COALESCE(model_code, '')) LIKE ${searchPlaceholder})`)
      params.push(`%${String(search).toLowerCase()}%`)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const countParams = [...params]
    const tot = await pool.query(`SELECT COUNT(1) AS c FROM unit_models ${where}`, countParams)

    const limitPlaceholder = `$${placeholderCount++}`
    const offsetPlaceholder = `$${placeholderCount++}`
    params.push(ps)
    params.push(off)

    const list = await pool.query(
      `SELECT * FROM unit_models ${where} ORDER BY id DESC LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    )
    
    return ok(res, { items: list.rows, pagination: { page: p, pageSize: ps, total: Number(tot.rows[0].c) } })
  } catch (e) {
    console.error('GET /api/inventory/unit-models error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Existing create/update/delete routes for unit models remain restricted to financial_manager
router.post('/unit-models', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const {
      model_name, model_code, area, orientation,
      has_garden, garden_area,
      has_roof, roof_area,
      garage_area, garage_standard_code
    } = req.body || {}

    if (!model_name || !Number.isFinite(Number(area))) {
      client.release()
      return bad(res, 400, 'model_name and numeric area are required')
    }

    const payload = {
      model_name: String(model_name).trim(),
      model_code: model_code ? String(model_code).trim() : null,
      area: Number(area) || 0,
      orientation: String(orientation || 'left'),
      has_garden: !!has_garden,
      garden_area: has_garden ? (Number(garden_area) || 0) : null,
      has_roof: !!has_roof,
      roof_area: has_roof ? (Number(roof_area) || 0) : null,
      garage_area: garage_area == null ? null : (Number(garage_area) || 0),
      garage_standard_code: garage_standard_code || null
    }

    const change = await createUnitModelChange(client, { action: 'create', payload, requested_by: req.user.id })
    client.release()
    return ok(res, { change, message: 'Change request created and pending approval.' })
  } catch (e) {
    client.release()
    console.error('POST /api/inventory/unit-models error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/unit-models/:id', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }

    const cur = await client.query('SELECT * FROM unit_models WHERE id=$1', [id])
    if (cur.rows.length === 0) { client.release(); return bad(res, 404, 'Not found') }

    const allow = ['model_name','model_code','area','orientation','has_garden','garden_area','has_roof','roof_area','garage_area','garage_standard_code']
    const payload = {}
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        let v = req.body[k]
        if (['area','garden_area','roof_area','garage_area'].includes(k)) {
          v = (v == null || v === '') ? null : Number(v) || 0
        }
        if (['has_garden','has_roof'].includes(k)) {
          v = !!v
        }
        payload[k] = v
      }
    }
    if (Object.keys(payload).length === 0) { client.release(); return bad(res, 400, 'No fields to update') }

    const change = await createUnitModelChange(client, { action: 'update', model_id: id, payload, requested_by: req.user.id })
    client.release()
    return ok(res, { change, message: 'Change request created and pending approval.' })
  } catch (e) {
    client.release()
    console.error('PATCH /api/inventory/unit-models/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.delete('/unit-models/:id', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    const cur = await client.query('SELECT id FROM unit_models WHERE id=$1', [id])
    if (cur.rows.length === 0) { client.release(); return bad(res, 404, 'Not found') }
    const change = await createUnitModelChange(client, { action: 'delete', model_id: id, payload: {}, requested_by: req.user.id })
    client.release()
    return ok(res, { change, message: 'Delete request created and pending approval.' })
  } catch (e) {
    client.release()
    console.error('DELETE /api/inventory/units/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.get('/unit-models/:id/audit', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const r = await pool.query(
      `SELECT a.*, u.email AS changed_by_email
       FROM unit_model_audit a
       LEFT JOIN users u ON u.id = a.changed_by
       WHERE a.model_id=$1
       ORDER BY a.id DESC`,
      [id]
    )
    return ok(res, { audit: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/unit-models/:id/audit error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Pending changes: list (FM + Top Management)
router.get('/unit-models/changes', authMiddleware, requireRole(['financial_manager','ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const { status = 'pending_approval' } = req.query || {}
    const r = await pool.query(
      `SELECT c.*, u.email AS requested_by_email, a.email AS approved_by_email
       FROM unit_model_changes c
       LEFT JOIN users u ON u.id = c.requested_by
       LEFT JOIN users a ON a.id = c.approved_by
       WHERE c.status=$1
       ORDER BY c.id DESC`,
      [String(status)]
    )
    return ok(res, { changes: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/unit-models/changes error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: cancel a pending unit model change request they created (replaces approve/deny on FM page)
router.delete('/unit-models/changes/:id', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query('SELECT id, status, requested_by FROM unit_model_changes WHERE id=$1', [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Change not found')
    const ch = cur.rows[0]
    if (!['pending_approval', 'rejected'].includes(ch.status)) return bad(res, 400, 'Only pending or rejected requests can be deleted')
    if (ch.requested_by !== req.user.id) return bad(res, 403, 'You can only delete your own requests')
    await pool.query('DELETE FROM unit_model_changes WHERE id=$1', [id])
    return ok(res, { deleted_id: id })
  } catch (e) {
    console.error('DELETE /api/inventory/unit-models/changes/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Approve change (Top Management only)
router.patch('/unit-models/changes/:id/approve', authMiddleware, requireRole(['ceo','chairman','vice_chairman']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM unit_model_changes WHERE id=$1 FOR UPDATE', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Change not found') }
    const ch = cur.rows[0]
    if (ch.status !== 'pending_approval') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Not pending approval') }
    const payload = ch.payload || {}
    let applied = null

    if (ch.action === 'create') {
      const r = await client.query(
        `INSERT INTO unit_models
         (model_name, model_code, area, orientation, has_garden, garden_area, has_roof, roof_area, garage_area, garage_standard_code, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
         RETURNING *`,
        [
          String(payload.model_name||'').trim(),
          payload.model_code ? String(payload.model_code).trim() : null,
          Number(payload.area)||0,
          String(payload.orientation||'left'),
          !!payload.has_garden,
          payload.has_garden ? (Number(payload.garden_area)||0) : null,
          !!payload.has_roof,
          payload.has_roof ? (Number(payload.roof_area)||0) : null,
          payload.garage_area == null ? null : (Number(payload.garage_area)||0),
          payload.garage_standard_code || null,
          req.user.id
        ]
      )
      applied = r.rows[0]
      await client.query(
        `INSERT INTO unit_model_audit (model_id, action, changed_by, details)
         VALUES ($1, 'create', $2, $3::jsonb)`,
        [applied.id, req.user.id, JSON.stringify({ after: applied, approved_change_id: ch.id })]
      )
    } else if (ch.action === 'update') {
      const curModel = await client.query('SELECT * FROM unit_models WHERE id=$1', [ch.model_id])
      if (curModel.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Model not found') }
      const prev = curModel.rows[0]
      const allow = ['model_name','model_code','area','orientation','has_garden','garden_area','has_roof','roof_area','garage_area','garage_standard_code']
      const fields = []
      const params = []
      const updatedPreview = {}
      let placeholderCount = 1
      for (const k of allow) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) {
          let v = payload[k]
          if (['area','garden_area','roof_area','garage_area'].includes(k)) {
            v = (v == null || v === '') ? null : Number(v) || 0
          }
          if (['has_garden','has_roof'].includes(k)) v = !!v
          updatedPreview[k] = v
          fields.push(`${k}=$${placeholderCount++}`)
          params.push(v)
        }
      }
      if (fields.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'No fields to update') }

      fields.push(`updated_by=$${placeholderCount++}`)
      params.push(req.user.id)
      
      const idPlaceholder = `$${placeholderCount++}`
      params.push(ch.model_id)
      
      const r = await client.query(`UPDATE unit_models SET ${fields.join(', ')}, updated_at=now() WHERE id=${idPlaceholder} RETURNING *`, params)
      applied = r.rows[0]
      const diff = computeDiff(prev, updatedPreview)
      await client.query(
        `INSERT INTO unit_model_audit (model_id, action, changed_by, details)
         VALUES ($1, 'update', $2, $3::jsonb)`,
        [ch.model_id, req.user.id, JSON.stringify({ diff, approved_change_id: ch.id })]
      )
    } else if (ch.action === 'delete') {
      const curModel = await client.query('SELECT * FROM unit_models WHERE id=$1', [ch.model_id])
      if (curModel.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Model not found') }
      const prev = curModel.rows[0]
      await client.query('DELETE FROM unit_models WHERE id=$1', [ch.model_id])
      await client.query(
        `INSERT INTO unit_model_audit (model_id, action, changed_by, details)
         VALUES ($1, 'delete', $2, $3::jsonb)`,
        [ch.model_id, req.user.id, JSON.stringify({ before: prev, approved_change_id: ch.id })]
      )
      applied = { id: ch.model_id }
    } else {
      await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Unknown action')
    }

    const upd = await client.query(
      `UPDATE unit_model_changes SET status='approved', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )

    await client.query('COMMIT'); client.release()
    return ok(res, { change: upd.rows[0], applied })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/unit-models/changes/:id/approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: modify a rejected change request and resubmit for approval
router.patch('/unit-models/changes/:id/modify', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    const { payload } = req.body || {}
    if (!id) return bad(res, 400, 'Invalid id')

    const cur = await pool.query('SELECT id, status, requested_by, action FROM unit_model_changes WHERE id=$1', [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Change not found')
    const ch = cur.rows[0]
    if (ch.status !== 'rejected') return bad(res, 400, 'Only rejected requests can be modified')
    if (ch.requested_by !== req.user.id) return bad(res, 403, 'You can only modify your own requests')

    // For delete actions there is nothing to modify; allow resubmission without payload
    const newPayload = (ch.action === 'delete') ? {} : (payload && typeof payload === 'object' ? payload : null)
    if (ch.action !== 'delete' && !newPayload) {
      return bad(res, 400, 'payload object is required for modifying this request')
    }

    const r = await pool.query(
      `UPDATE unit_model_changes
       SET payload = COALESCE($1::jsonb, payload),
           status='pending_approval',
           approved_by=NULL,
           reason=NULL,
           updated_at=now()
       WHERE id=$2
       RETURNING *`,
      [newPayload ? JSON.stringify(newPayload) : null, id]
    )

    return ok(res, { change: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/unit-models/changes/:id/modify error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Reject change (Top Management only)
router.patch('/unit-models/changes/:id/reject', authMiddleware, requireRole(['ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const id = num(req.params.id)
    const { reason } = req.body || {}
    if (!id) return bad(res, 400, 'Invalid id')
    const r = await pool.query(
      `UPDATE unit_model_changes SET status='rejected', approved_by=$1, reason=$2, updated_at=now() WHERE id=$3 AND status='pending_approval' RETURNING *`,
      [req.user.id, reason || null, id]
    )
    if (r.rows.length === 0) return bad(res, 404, 'Not found or not pending')

    // Notify the requesting Financial Manager about the rejection with the reason
    const requestedBy = r.rows[0].requested_by
    if (requestedBy) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
         VALUES ($1, 'unit_model_change_rejected', 'unit_model_changes', $2, $3)`,
        [requestedBy, r.rows[0].id, String(reason || 'Your unit model request was rejected.')]
      )
    }

    return ok(res, { change: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/unit-models/changes/:id/reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// --------------------
// Inventory: unit types & units
// --------------------

// List unit types (broad read access for calculators)
router.get('/types', authMiddleware, requireRole(['admin','superadmin','sales_manager','property_consultant','financial_manager','financial_admin','ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, description, active FROM unit_types WHERE active=TRUE ORDER BY name ASC`)
    return ok(res, { unit_types: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/types error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// List available units (with optional search/pagination/model filter).
// - For sales/consultants, only show available units with an approved model link.
// - For admin/financial roles, show all units including drafts.
router.get('/units', authMiddleware, requireRole(['admin','superadmin','sales_manager','property_consultant','financial_manager','financial_admin','ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const { search } = req.query || {}
    const typeId = num(req.query.unit_type_id)
    const modelId = num(req.query.model_id)
    const userRole = req.user?.role

    // Pagination defaults:
    // - If consumer didn't pass page/pageSize and requested by unit_type_id (calculator use), default to 200.
    // - Otherwise default to 20 for admin listing.
    const pagePassed = Object.prototype.hasOwnProperty.call(req.query || {}, 'page')
    const pageSizePassed = Object.prototype.hasOwnProperty.call(req.query || {}, 'pageSize')
    const p = Math.max(1, Number(req.query.page) || 1)
    const defaultPs = (!pagePassed && !pageSizePassed && typeId) ? 200 : 20
    const ps = Math.max(1, Math.min(200, Number(req.query.pageSize) || defaultPs))
    const off = (p - 1) * ps

    const clauses = []
    const params = []
    let placeholderCount = 1

    // Role-based filtering:
    // - Sales roles only see available units ready for deals.
    // - Admin roles see all units.
    const salesRoles = ['property_consultant', 'sales_manager']
    if (salesRoles.includes(req.user.role)) {
      clauses.push('u.available = TRUE', "u.unit_status='AVAILABLE'", 'u.model_id IS NOT NULL')
    }

    if (typeId) {
      clauses.push(`u.unit_type_id = $${placeholderCount++}`)
      params.push(typeId)
    }
    if (modelId) {
      clauses.push(`u.model_id = $${placeholderCount++}`)
      params.push(modelId)
    }

    if (search) {
      const s = `%${String(search).toLowerCase()}%`
      const ph = `$${placeholderCount++}`
      clauses.push(`(
         LOWER(u.code) LIKE ${ph}
         OR LOWER(COALESCE(u.unit_type, '')) LIKE ${ph}
         OR LOWER(COALESCE(ut.name, '')) LIKE ${ph}
       )`)
      // push same placeholder value for each use
      params.push(s)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const countParams = [...params]

    // Count total
    const tot = await pool.query(
      `SELECT COUNT(1) AS c
       FROM units u
       LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
       LEFT JOIN unit_models m ON m.id = u.model_id
       ${where}`,
      countParams
    )

    // Paged rows
    const limitPlaceholder = `$${placeholderCount++}`
    const offsetPlaceholder = `$${placeholderCount++}`
    params.push(ps, off)

    const r = await pool.query(
      `SELECT
         u.id, u.code, u.unit_type, u.unit_type_id, ut.name AS unit_type_name,
         u.unit_number, u.floor, u.building_number, u.block_sector, u.zone, u.garden_details,
         u.base_price, u.currency, u.model_id, u.area, u.orientation,
         u.has_garden, u.garden_area, u.has_roof, u.roof_area,
         u.maintenance_price, u.garage_price, u.garden_price, u.roof_price, u.storage_price,
         u.available, u.unit_status,
         -- Embed complete model object
         row_to_json(m) AS model,
         -- Convenience fields from model (kept for backward compatibility)
         m.model_name AS model_name, m.model_code AS model_code,
         -- Latest approved standard pricing for the linked model
         row_to_json(sp) AS approved_standard_pricing,
         sp.price AS approved_standard_price,
         sp.maintenance_price AS approved_maintenance_price,
         sp.garage_price AS approved_garage_price,
         sp.garden_price AS approved_garden_price,
         sp.roof_price AS approved_roof_price,
         sp.storage_price AS approved_storage_price,
         -- Availability helpers and computed totals
         (COALESCE(u.has_garden, FALSE) AND COALESCE(u.garden_area, 0) > 0) AS garden_available,
         (COALESCE(u.has_roof, FALSE) AND COALESCE(u.roof_area, 0) > 0) AS roof_available,
         (COALESCE(u.garage_area, 0) > 0) AS garage_available,
         (COALESCE(u.base_price,0)
           + COALESCE(u.maintenance_price,0)
           + COALESCE(u.garage_price,0)
           + COALESCE(u.garden_price,0)
           + COALESCE(u.roof_price,0)
           + COALESCE(u.storage_price,0)) AS total_price
       FROM units u
       LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
       LEFT JOIN unit_models m ON m.id = u.model_id
       LEFT JOIN LATERAL (
         SELECT
           p.id,
           p.model_id,
           p.price,
           p.maintenance_price,
           p.garage_price,
           p.garden_price,
           p.roof_price,
           p.storage_price,
           p.status,
           p.updated_at
         FROM unit_model_pricing p
         WHERE p.model_id = u.model_id AND p.status = 'approved'
         ORDER BY p.id DESC
         LIMIT 1
       ) sp ON true
       ${where}
       ORDER BY u.id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    )

    return ok(res, {
      units: r.rows,
      pagination: { page: p, pageSize: ps, total: Number(tot.rows[0].c) }
    })
  } catch (e) {
    console.error('GET /api/inventory/units error:', e)
    return bad(res, 500, 'Internal error')
  }
})

/**
 * Financial Manager: list inventory drafts awaiting approval
 * NOTE: must be defined BEFORE '/units/:id' to avoid route capture ('drafts' being treated as :id).
*/
router.get('/units/drafts', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.*, ru.email AS created_by_email, m.model_name, m.model_code
       FROM units u
       LEFT JOIN users ru ON ru.id = u.created_by
       LEFT JOIN unit_models m ON m.id = u.model_id
       WHERE u.unit_status='INVENTORY_DRAFT'
       ORDER BY u.updated_at DESC, u.id DESC`
    )
    return ok(res, { units: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/units/drafts error:', e)
    return bad(res, 500, 'Internal error')
  }
})

/**
 * Fetch a single AVAILABLE unit by id with embedded model and approved standard pricing.
 * Access: consultants and above.
 */
router.get('/units/:id', authMiddleware, requireRole(['admin','superadmin','sales_manager','property_consultant','financial_manager','financial_admin','ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')

    const params = [id]
    const r = await pool.query(
      `SELECT
         u.id, u.code, u.unit_type, u.unit_type_id, ut.name AS unit_type_name,
         u.unit_number, u.floor, u.building_number, u.block_sector, u.zone, u.garden_details,
         u.base_price, u.currency, u.model_id, u.area, u.orientation,
         u.has_garden, u.garden_area, u.has_roof, u.roof_area,
         u.maintenance_price, u.garage_price, u.garden_price, u.roof_price, u.storage_price,
         u.available, u.unit_status,
         -- Embed complete model object
         row_to_json(m) AS model,
         -- Convenience fields from model (kept for backward compatibility)
         m.model_name AS model_name, m.model_code AS model_code,
         -- Latest approved standard pricing for the linked model
         row_to_json(sp) AS approved_standard_pricing,
         sp.price AS approved_standard_price,
         sp.maintenance_price AS approved_maintenance_price,
         sp.garage_price AS approved_garage_price,
         sp.garden_price AS approved_garden_price,
         sp.roof_price AS approved_roof_price,
         sp.storage_price AS approved_storage_price,
         -- Availability helpers and computed totals
         (COALESCE(u.has_garden, FALSE) AND COALESCE(u.garden_area, 0) > 0) AS garden_available,
         (COALESCE(u.has_roof, FALSE) AND COALESCE(u.roof_area, 0) > 0) AS roof_available,
         (COALESCE(u.garage_area, 0) > 0) AS garage_available,
         (COALESCE(u.base_price,0)
           + COALESCE(u.maintenance_price,0)
           + COALESCE(u.garage_price,0)
           + COALESCE(u.garden_price,0)
           + COALESCE(u.roof_price,0)
           + COALESCE(u.storage_price,0)) AS total_price
       FROM units u
       LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
       LEFT JOIN unit_models m ON m.id = u.model_id
       LEFT JOIN LATERAL (
         SELECT
           p.id,
           p.model_id,
           p.price,
           p.maintenance_price,
           p.garage_price,
           p.garden_price,
           p.roof_price,
           p.storage_price,
           p.status,
           p.updated_at
         FROM unit_model_pricing p
         WHERE p.model_id = u.model_id AND p.status = 'approved'
         ORDER BY p.id DESC
         LIMIT 1
       ) sp ON true
       WHERE u.id = $1 AND u.unit_status='AVAILABLE'`,
      params
    )

    if (r.rows.length === 0) return bad(res, 404, 'Unit not found or not available')

    // Build Approved Standard (benchmark) from unit + active global standard plan
    const unit = r.rows[0]
    const sp = unit.approved_standard_pricing || {}
    const toNum = (v) => Number(v || 0)
    const totalExclMaintenance =
      toNum(sp.price || unit.base_price) +
      toNum(sp.garden_price || unit.garden_price) +
      toNum(sp.roof_price || unit.roof_price) +
      toNum(sp.storage_price || unit.storage_price) +
      toNum(sp.garage_price || unit.garage_price)

    // Load latest active global standard plan settings
    let stdPlanCfg = null
    try {
      const pr = await pool.query(
        `SELECT std_financial_rate_percent, plan_duration_years, installment_frequency
         FROM standard_plan
         WHERE active=TRUE
         ORDER BY id DESC
         LIMIT 1`
      )
      stdPlanCfg = pr.rows[0] || null
    } catch { /* ignore */ }

    // Compute Standard PV baseline using equal installments if we have a config
    let calculatedPV = null
    if (stdPlanCfg) {
      const annualRate = Number(stdPlanCfg.std_financial_rate_percent) || 0
      const years = Number(stdPlanCfg.plan_duration_years) || 1
      const freq = String(stdPlanCfg.installment_frequency || 'monthly').toLowerCase()
      let perYear = 12
      if (freq === 'quarterly') perYear = 4
      else if (freq === 'biannually' || freq === 'bi-annually') perYear = 2
      else if (freq === 'annually') perYear = 1
      const n = Math.max(1, years * perYear)
      const per = totalExclMaintenance / n
      const monthlyRate = annualRate > 0 ? Math.pow(1 + annualRate / 100, 1 / 12) - 1 : 0

      // Payment months for equal installments starting immediately
      const months = []
      for (let i = 1; i <= n; i++) {
        const step = Math.round((i - 1) * (12 / perYear))
        months.push(step)
      }
      calculatedPV = months.reduce((pv, m) => pv + (per > 0 ? per / Math.pow(1 + monthlyRate, m) : 0), 0)
    }

    const standardPlan = {
      totalPrice: totalExclMaintenance,
      financialDiscountRate: stdPlanCfg ? (Number(stdPlanCfg.std_financial_rate_percent) || 0) : 0,
      calculatedPV: calculatedPV != null ? calculatedPV : totalExclMaintenance
    }

    // Attach standardPlan to unit for client consumption
    unit.standardPlan = standardPlan

    return ok(res, { unit })
  } catch (e) {
    console.error('GET /api/inventory/units/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})


// Create inventory unit (Financial Admin) -> goes into FM approval queue as INVENTORY_DRAFT
router.post('/units', authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const { code, model_id } = req.body || {}
    if (!code || typeof code !== 'string') return bad(res, 400, 'code is required')
    const modelId = num(model_id)
    if (!modelId) return bad(res, 400, 'model_id is required and must be numeric')

    // Ensure model exists
    const mRes = await pool.query('SELECT * FROM unit_models WHERE id=$1', [modelId])
    if (mRes.rows.length === 0) return bad(res, 404, 'Model not found')
    const m = mRes.rows[0]

    // Ensure model has approved standard pricing
    const priceRes = await pool.query(
      `SELECT price, maintenance_price, garage_price, garden_price, roof_price, storage_price
       FROM unit_model_pricing
       WHERE model_id=$1 AND status='approved'
       ORDER BY id DESC LIMIT 1`,
      [modelId]
    )
    if (priceRes.rows.length === 0) {
      return bad(res, 400, 'Model has no approved pricing. Ask Financial Manager to approve pricing first.')
    }
    const basePrice = Number(priceRes.rows[0].price) || 0
    const maintPrice = Number(priceRes.rows[0].maintenance_price ?? 0) || 0
    const garPrice = Number(priceRes.rows[0].garage_price ?? 0) || 0
    const gardenPrice = Number(priceRes.rows[0].garden_price ?? 0) || 0
    const roofPrice = Number(priceRes.rows[0].roof_price ?? 0) || 0
    const storagePrice = Number(priceRes.rows[0].storage_price ?? 0) || 0

    // Optional inventory metadata populated by Financial Admin
    const {
      unit_number,
      floor,
      building_number,
      block_sector,
      zone,
      garden_details
    } = req.body || {}

    // Create draft unit already linked to the model, with features and prices propagated
    let unit
    try {
      const r = await pool.query(
        `INSERT INTO units (
           code, unit_type, unit_type_id, base_price, currency, model_id, available, unit_status, created_by,
           area, orientation, has_garden, garden_area, has_roof, roof_area,
           maintenance_price, garage_price, garden_price, roof_price, storage_price,
           unit_number, floor, building_number, block_sector, zone, garden_details
         )
         VALUES ($1, NULL, NULL, $2, 'EGP', $3, TRUE, 'INVENTORY_DRAFT', $4,
                 $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21)
         RETURNING *`,
        [
          code.trim(),
          basePrice,
          modelId,
          req.user.id,
          m.area, m.orientation, m.has_garden, m.garden_area, m.has_roof, m.roof_area,
          maintPrice, garPrice, gardenPrice, roofPrice, storagePrice,
          unit_number || null,
          floor || null,
          building_number || null,
          block_sector || null,
          zone || null,
          garden_details || null
        ]
      )
      unit = r.rows[0]
    } catch (err) {
      if (err && err.code === '23505') {
        return bad(res, 400, 'Unit code already exists. Duplicate codes are not allowed.')
      }
      throw err
    }

    // Notify all Financial Managers of a new draft unit awaiting approval
    await pool.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       SELECT u.id, 'inventory_unit_draft', 'units', $1, 'New inventory unit draft added. Please review and approve.'
       FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
      [unit.id]
    )

    return ok(res, { unit, message: 'Unit created as draft and linked to model. Awaiting Financial Manager approval.' })
  } catch (e) {
    console.error('POST /api/inventory/units error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: list inventory drafts awaiting approval
router.get('/units/drafts', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.*, ru.email AS created_by_email, m.model_name, m.model_code
       FROM units u
       LEFT JOIN users ru ON ru.id = u.created_by
       LEFT JOIN unit_models m ON m.id = u.model_id
       WHERE u.unit_status='INVENTORY_DRAFT'
       ORDER BY u.updated_at DESC, u.id DESC`
    )
    return ok(res, { units: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/units/drafts error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: approve inventory draft
router.patch('/units/:id/approve', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const r0 = await pool.query(`SELECT id, unit_status FROM units WHERE id=$1`, [id])
    if (r0.rows.length === 0) return bad(res, 404, 'Unit not found')
    if (r0.rows[0].unit_status !== 'INVENTORY_DRAFT') return bad(res, 400, 'Unit is not in draft status')

    const r = await pool.query(
      `UPDATE units
       SET unit_status='AVAILABLE', approved_by=$1, updated_at=now()
       WHERE id=$2
       RETURNING *`,
      [req.user.id, id]
    )
    return ok(res, { unit: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/units/:id/approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: reject inventory draft (stores optional reason in meta)
router.patch('/units/:id/reject', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    const { reason } = req.body || {}
    if (!id) return bad(res, 400, 'Invalid id')
    const r0 = await pool.query(`SELECT id, unit_status, meta FROM units WHERE id=$1`, [id])
    if (r0.rows.length === 0) return bad(res, 404, 'Unit not found')
    if (r0.rows[0].unit_status !== 'INVENTORY_DRAFT') return bad(res, 400, 'Unit is not in draft status')

    const currentMeta = r0.rows[0].meta || {}
    const newMeta = { ...currentMeta, inventory_reject_reason: reason || null }

    const r = await pool.query(
      `UPDATE units
       SET unit_status='INVENTORY_REJECTED', approved_by=$1, meta=$2::jsonb, updated_at=now()
       WHERE id=$3
       RETURNING *`,
      [req.user.id, JSON.stringify(newMeta), id]
    )
    return ok(res, { unit: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/units/:id/reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// --------------------
// Holds: requests/approve/unblock/extend/override flow
// --------------------

// Hold requests
router.post('/holds', authMiddleware, requireRole(['property_consultant']), async (req, res) => {
  try {
    const { unit_id, payment_plan_id, duration_days } = req.body || {}
    const uid = num(unit_id)
    if (!uid) return bad(res, 400, 'unit_id is required')
    const pid = payment_plan_id ? num(payment_plan_id) : null

    // Check unit exists, available, and properly linked to a model with approved pricing
    const u = await pool.query('SELECT id, available, model_id FROM units WHERE id=$1', [uid])
    if (u.rows.length === 0) return bad(res, 404, 'Unit not found')
    const unit = u.rows[0]
    if (unit.available === false) return bad(res, 400, 'Unit is not available')
    if (!unit.model_id) return bad(res, 400, 'Unit is not linked to a model. Linking with an approved standard price is required before requesting a hold.')
    const p = await pool.query(
      `SELECT 1 FROM unit_model_pricing WHERE model_id=$1 AND status='approved' LIMIT 1`,
      [unit.model_id]
    )
    if (p.rows.length === 0) return bad(res, 400, 'Linked model has no approved pricing. Please wait for Financial Manager approval.')

    // Duration validation 1-7
    let days = Number(duration_days) || 7
    if (days < 1) days = 1
    if (days > 7) days = 7

    const r = await pool.query(
      `INSERT INTO holds (unit_id, payment_plan_id, requested_by, status, expires_at)
       VALUES ($1, $2, $3, 'pending_approval', now() + ($4 || ' days')::interval)
       RETURNING *`,
      [uid, pid, req.user.id, String(days)]
    )
    return ok(res, { hold: r.rows[0] })
  } catch (e) {
    console.error('POST /api/inventory/holds error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.get('/holds', authMiddleware, requireRole(['financial_manager', 'sales_manager', 'admin', 'superadmin']), async (req, res) => {
  try {
    const { status } = req.query || {}
    const clauses = []
    const params = []
    let placeholderCount = 1

    if (status) {
      clauses.push(`status=$${placeholderCount++}`)
      params.push(String(status))
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const r = await pool.query(`SELECT * FROM holds ${where} ORDER BY id DESC`, params)
    return ok(res, { holds: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/holds error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/holds/:id/approve', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM holds WHERE id=$1', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Hold not found') }
    if (cur.rows[0].status !== 'pending_approval') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Hold not pending') }
    const expiresAt = cur.rows[0].expires_at ? new Date(cur.rows[0].expires_at) : new Date(Date.now() + 7 * 24 * 3600 * 1000)
    const nextNotify = new Date(expiresAt.getTime())
    const upd = await client.query(
      `UPDATE holds
       SET status='approved', approved_by=$1, expires_at=$2, next_notify_at=$3, updated_at=now()
       WHERE id=$4 RETURNING *`,
      [req.user.id, expiresAt.toISOString(), nextNotify.toISOString(), id]
    )
    // Block unit
    await client.query('UPDATE units SET available=FALSE, updated_at=now() WHERE id=$1', [cur.rows[0].unit_id])
    await client.query('COMMIT'); client.release()
    return ok(res, { hold: upd.rows[0] })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/holds/:id/approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/holds/:id/unblock', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM holds WHERE id=$1', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Hold not found') }
    const upd = await client.query(
      `UPDATE holds SET status='unblocked', updated_at=now() WHERE id=$1 RETURNING *`,
      [id]
    )
    await client.query('UPDATE units SET available=TRUE, updated_at=now() WHERE id=$1', [cur.rows[0].unit_id])
    await client.query('COMMIT'); client.release()
    return ok(res, { hold: upd.rows[0] })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/holds/:id/unblock error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/holds/:id/extend', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const r = await pool.query(
      `UPDATE holds SET expires_at = COALESCE(expires_at, now()) + INTERVAL '7 days', next_notify_at = COALESCE(expires_at, now()) + INTERVAL '7 days', updated_at=now()
       WHERE id=$1 AND status='approved'
       RETURNING *`,
      [id]
    )
    if (r.rows.length === 0) return bad(res, 404, 'Hold not found or not approved')
    return ok(res, { hold: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/holds/:id/extend error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Override unblock (FM can override after CEO approvals elsewhere) if unit not reserved
/**
 * Override-unblock flow:
 * 1) FM requests override -> status 'pending_override_ceo' and notify CEOs
 * 2) CEO approves -> status 'override_ceo_approved' and notify FMs + consultant
 * 3) FM executes override-unblock -> set available=true, status 'unblocked' and notify consultant + CEOs
 */
router.post('/holds/:id/override-request', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM holds WHERE id=$1', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Hold not found') }
    const hold = cur.rows[0]
    // cannot request override if already reserved
    if (hold.payment_plan_id) {
      const rf = await client.query(
        `SELECT 1 FROM reservation_forms WHERE payment_plan_id=$1 AND status='approved' LIMIT 1`,
        [hold.payment_plan_id]
      )
      if (rf.rows.length > 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Cannot override: unit is reserved') }
    }
    const upd = await client.query(
      `UPDATE holds SET status='pending_override_ceo', updated_at=now() WHERE id=$1 RETURNING *`,
      [id]
    )
    // notify all CEOs
    await client.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       SELECT u.id, 'hold_override_request', 'holds', $1, 'Hold override requested and awaits CEO approval.'
       FROM users u WHERE u.role='ceo' AND u.active=TRUE`,
      [id]
    )
    await client.query('COMMIT'); client.release()
    return ok(res, { hold: upd.rows[0] })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('POST /api/inventory/holds/:id/override-request error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/holds/:id/override-approve', authMiddleware, requireRole(['ceo']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM holds WHERE id=$1', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Hold not found') }
    if (cur.rows[0].status !== 'pending_override_ceo') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Not pending CEO override approval') }
    const upd = await client.query(
      `UPDATE holds SET status='override_ceo_approved', updated_at=now() WHERE id=$1 RETURNING *`,
      [id]
    )
    // Notify all Financial Managers and the requesting consultant
    await client.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       SELECT u.id, 'hold_override_ceo_approved', 'holds', $1, 'CEO approved hold override. You may unblock the unit.'
       FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
      [id]
    )
    const requestedBy = cur.rows[0].requested_by
    if (requestedBy) {
      await client.query(
        `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
         VALUES ($1, 'hold_override_ceo_approved', 'holds', $2, 'CEO approved hold override for your request.')`,
        [requestedBy, id]
      )
    }
    await client.query('COMMIT'); client.release()
    return ok(res, { hold: upd.rows[0] })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/holds/:id/override-approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Override-unblock after CEO approval
router.patch('/holds/:id/override-unblock', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM holds WHERE id=$1', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Hold not found') }
    const hold = cur.rows[0]
    if (hold.status !== 'override_ceo_approved') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'CEO approval required before override-unblock') }
    if (hold.payment_plan_id) {
      const rf = await client.query(
        `SELECT 1 FROM reservation_forms WHERE payment_plan_id=$1 AND status='approved' LIMIT 1`,
        [hold.payment_plan_id]
      )
      if (rf.rows.length > 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Cannot override: unit is reserved') }
    }
    const upd = await client.query(
      `UPDATE holds SET status='unblocked', updated_at=now() WHERE id=$1 RETURNING *`,
      [id]
    )
    await client.query('UPDATE units SET available=TRUE, updated_at=now() WHERE id=$1', [hold.unit_id])
    // Notify consultant and CEOs
    if (hold.requested_by) {
      await client.query(
        `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
         VALUES ($1, 'hold_override_unblocked', 'holds', $2, 'Your hold has been overridden and unblocked by Financial Manager.')`,
        [hold.requested_by, id]
      )
    }
    await client.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       SELECT u.id, 'hold_override_unblocked', 'holds', $1, 'Hold was unblocked after CEO approval.'
       FROM users u WHERE u.role='ceo' AND u.active=TRUE`,
      [id]
    )
    await client.query('COMMIT'); client.release()
    return ok(res, { hold: upd.rows[0] })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/holds/:id/override-unblock error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Notifications list (for financial manager)
router.get('/notifications', authMiddleware, requireRole(['financial_manager', 'admin', 'superadmin']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM notifications WHERE user_id=$1 AND is_read=FALSE ORDER BY id DESC`,
      [req.user.id]
    )
    return ok(res, { notifications: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/notifications error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// --------------------
// Link unit to model workflow (FA -> FM approval)
// --------------------

// FA: request a link of a unit to a model (requires approved model pricing present)
router.post('/units/:id/link-request', authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const unitId = num(req.params.id)
    const { model_id } = req.body || {}
    const modelId = num(model_id)
    if (!unitId || !modelId) return bad(res, 400, 'unitId and model_id are required')

    // Ensure unit exists and is available
    const u = await pool.query('SELECT id FROM units WHERE id=$1', [unitId])
    if (u.rows.length === 0) return bad(res, 404, 'Unit not found')

    // Ensure model exists
    const m = await pool.query('SELECT id FROM unit_models WHERE id=$1', [modelId])
    if (m.rows.length === 0) return bad(res, 404, 'Model not found')

    // Ensure approved pricing exists for model
    const p = await pool.query(`SELECT price FROM unit_model_pricing WHERE model_id=$1 AND status='approved' ORDER BY id DESC LIMIT 1`, [modelId])
    if (p.rows.length === 0) return bad(res, 400, 'Model has no approved pricing. Ask Financial Manager to approve pricing first.')

    // Create or upsert link request (enforce unique per unit)
    const cur = await pool.query('SELECT id, status FROM unit_model_inventory_links WHERE unit_id=$1', [unitId])
    let link
    if (cur.rows.length === 0) {
      const ins = await pool.query(
        `INSERT INTO unit_model_inventory_links (unit_id, model_id, status, requested_by)
         VALUES ($1, $2, 'pending_approval', $3)
         RETURNING *`,
        [unitId, modelId, req.user.id]
      )
      link = ins.rows[0]
    } else {
      const upd = await pool.query(
        `UPDATE unit_model_inventory_links
         SET model_id=$1, status='pending_approval', approved_by=NULL, updated_at=now()
         WHERE unit_id=$2
         RETURNING *`,
        [modelId, unitId]
      )
      link = upd.rows[0]
    }

    await pool.query(
      `INSERT INTO unit_model_inventory_link_audit (link_id, action, changed_by, details)
       VALUES ($1, 'request', $2, $3)`,
      [link.id, req.user.id, JSON.stringify({ model_id: modelId })]
    )

    return ok(res, { link })
  } catch (e) {
    console.error('POST /api/inventory/units/:id/link-request error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// --------------------
// Financial Admin: update a draft unit's metadata (code and inventory metadata only)
// --------------------
router.patch('/units/:id', authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return bad(res, 400, 'Invalid id')

    // Only allow updates while in draft
    const cur = await pool.query(
      `SELECT id, unit_status FROM units WHERE id=$1`,
      [id]
    )
    if (cur.rows.length === 0) return bad(res, 404, 'Unit not found')
    if (cur.rows[0].unit_status !== 'INVENTORY_DRAFT') {
      return bad(res, 403, 'Only draft units can be edited by Financial Admin')
    }

    const { code, unit_number, floor, building_number, block_sector, zone } = req.body || {}
    const fields = []
    const params = []
    let c = 1

    if (typeof code === 'string') { fields.push(`code=$${c++}`); params.push(code.trim()) }
    if (unit_number !== undefined) { fields.push(`unit_number=$${c++}`); params.push(unit_number || null) }
    if (floor !== undefined) { fields.push(`floor=$${c++}`); params.push(floor || null) }
    if (building_number !== undefined) { fields.push(`building_number=$${c++}`); params.push(building_number || null) }
    if (block_sector !== undefined) { fields.push(`block_sector=$${c++}`); params.push(block_sector || null) }
    if (zone !== undefined) { fields.push(`zone=$${c++}`); params.push(zone || null) }

    if (fields.length === 0) return bad(res, 400, 'No fields to update')

    const idPh = `$${c++}`
    params.push(id)

    const r = await pool.query(
      `UPDATE units SET ${fields.join(', ')}, updated_at=now() WHERE id=${idPh} RETURNING *`,
      params
    )

    return ok(res, { unit: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/units/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// --------------------
// Financial Admin: request change (edit/delete) for APPROVED units
// --------------------
router.post('/units/:id/change-request', authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return bad(res, 400, 'Invalid id')

    const u0 = await pool.query('SELECT id, unit_status FROM units WHERE id=$1', [id])
    if (u0.rows.length === 0) return bad(res, 404, 'Unit not found')

    if (u0.rows[0].unit_status === 'INVENTORY_DRAFT') {
      return bad(res, 400, 'Use the normal Edit on drafts. Change-requests are for approved units.')
    }

    const { action, payload } = req.body || {}
    const act = String(action || '').toLowerCase()
    if (!['update', 'delete'].includes(act)) return bad(res, 400, 'action must be update or delete')

    // Only allow safe fields from FA
    let safePayload = {}
    if (act === 'update') {
      const p = payload && typeof payload === 'object' ? payload : {}
      const allow = ['code','unit_number','floor','building_number','block_sector','zone']
      for (const k of allow) {
        if (Object.prototype.hasOwnProperty.call(p, k)) {
          safePayload[k] = p[k]
        }
      }
      if (Object.keys(safePayload).length === 0) return bad(res, 400, 'No updatable fields in payload')
    }

    const ins = await pool.query(
      `INSERT INTO unit_inventory_changes (unit_id, action, payload, requested_by)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING *`,
      [id, act, JSON.stringify(safePayload || {}), req.user.id]
    )

    // Notify Financial Managers
    await pool.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       SELECT u.id, 'unit_inventory_change_request', 'unit_inventory_changes', $1, 'New unit inventory change request awaiting approval.'
       FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
      [ins.rows[0].id]
    )

    return ok(res, { change: ins.rows[0] })
  } catch (e) {
    console.error('POST /api/inventory/units/:id/change-request error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// --------------------
// Financial Manager: list/approve/reject change requests
// --------------------
router.get('/units/changes', authMiddleware, requireRole(['financial_manager','financial_admin']), async (req, res) => {
  try {
    const { status = 'pending_approval', mine, unit_id } = req.query || {}
    const role = req.user?.role
    const isFA = role === 'financial_admin'

    const params = []
    let where = '1=1'

    // status filter
    if (String(status) !== 'all') {
      where += ` AND c.status=$${params.length + 1}`
      params.push(String(status))
    }

    const unitIdNum = unit_id ? Number(unit_id) : null
    if (unitIdNum && Number.isFinite(unitIdNum) && unitIdNum > 0) {
      // Filter by a specific unit
      where += ` AND c.unit_id=$${params.length + 1}`
      params.push(unitIdNum)
      // For FA: allow viewing all requests for this unit (audit purpose)
      // no requester filter applied when unit_id filter is used
    } else if (isFA) {
      // Without unit filter: FA can only view their own when mine=1
      if (String(mine) !== '1') {
        return bad(res, 403, 'Financial Admin can only view their own change history (use mine=1) or provide unit_id')
      }
      where += ` AND c.requested_by=$${params.length + 1}`
      params.push(req.user.id)
    }

    const r = await pool.query(
      `SELECT c.*, u.code AS unit_code, u.unit_status, ru.email AS requested_by_email, au.email AS approved_by_email
       FROM unit_inventory_changes c
       LEFT JOIN units u ON u.id = c.unit_id
       LEFT JOIN users ru ON ru.id = c.requested_by
       LEFT JOIN users au ON au.id = c.approved_by
       WHERE ${where}
       ORDER BY c.id DESC`,
      params
    )
    return ok(res, { changes: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/units/changes error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/units/changes/:id/approve', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) { client.release(); return bad(res, 400, 'Invalid id') }

    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM unit_inventory_changes WHERE id=$1 FOR UPDATE', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Change not found') }
    const ch = cur.rows[0]
    if (ch.status !== 'pending_approval') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Not pending approval') }

    if (ch.action === 'delete') {
      await client.query('DELETE FROM units WHERE id=$1', [ch.unit_id])
    } else if (ch.action === 'update') {
      const p = ch.payload || {}
      const allow = ['code','unit_number','floor','building_number','block_sector','zone']
      const fields = []
      const params = []
      let c = 1
      for (const k of allow) {
        if (Object.prototype.hasOwnProperty.call(p, k)) {
          fields.push(`${k}=$${c++}`)
          params.push(p[k] == null ? null : p[k])
        }
      }
      if (fields.length > 0) {
        const idPh = `$${c++}`
        params.push(ch.unit_id)
        await client.query(`UPDATE units SET ${fields.join(', ')}, updated_at=now() WHERE id=${idPh}`, params)
      }
    } else {
      await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Unknown action')
    }

    const upd = await client.query(
      `UPDATE unit_inventory_changes SET status='approved', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )
    await client.query('COMMIT'); client.release()
    return ok(res, { change: upd.rows[0] })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/units/changes/:id/approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

router.patch('/units/changes/:id/reject', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { reason } = req.body || {}
    if (!Number.isFinite(id) || id <= 0) return bad(res, 400, 'Invalid id')
    const r = await pool.query(
      `UPDATE unit_inventory_changes SET status='rejected', approved_by=$1, reason=$2, updated_at=now() WHERE id=$3 AND status='pending_approval' RETURNING *`,
      [req.user.id, reason || null, id]
    )
    if (r.rows.length === 0) return bad(res, 404, 'Not found or not pending')
    return ok(res, { change: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/units/changes/:id/reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

export default router