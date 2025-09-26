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
    if (ch.status !== 'pending_approval') return bad(res, 400, 'Only pending requests can be cancelled')
    if (ch.requested_by !== req.user.id) return bad(res, 403, 'You can only cancel your own requests')
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

// List available units (with optional search/pagination/model filter). Only units with an approved model link.
router.get('/units', authMiddleware, requireRole(['admin','superadmin','sales_manager','property_consultant','financial_manager','financial_admin','ceo','chairman','vice_chairman']), async (req, res) => {
  try {
    const { search } = req.query || {}
    const typeId = num(req.query.unit_type_id)
    const modelId = num(req.query.model_id)

    // Pagination defaults:
    // - If consumer didn't pass page/pageSize and requested by unit_type_id (calculator use), default to 200.
    // - Otherwise default to 20 for admin listing.
    const pagePassed = Object.prototype.hasOwnProperty.call(req.query || {}, 'page')
    const pageSizePassed = Object.prototype.hasOwnProperty.call(req.query || {}, 'pageSize')
    const p = Math.max(1, Number(req.query.page) || 1)
    const defaultPs = (!pagePassed && !pageSizePassed && typeId) ? 200 : 20
    const ps = Math.max(1, Math.min(200, Number(req.query.pageSize) || defaultPs))
    const off = (p - 1) * ps

    const clauses = ['u.available = TRUE', "u.unit_status='AVAILABLE'", 'u.model_id IS NOT NULL']
    const params = []
    let placeholderCount = 1

    if (typeId) {
      clauses.push(`u.unit_type_id = ${placeholderCount++}`)
      params.push(typeId)
    }
    if (modelId) {
      clauses.push(`u.model_id = ${placeholderCount++}`)
      params.push(modelId)
    }

    if (search) {
      const s = `%${String(search).toLowerCase()}%`
      const ph = `${placeholderCount++}`
      clauses.push(`(
        LOWER(u.code) LIKE ${ph}
        OR LOWER(COALESCE(u.description, '')) LIKE ${ph}
        OR LOWER(COALESCE(u.unit_type, '')) LIKE ${ph}
        OR LOWER(COALESCE(ut.name, '')) LIKE ${ph}
      )`)
      // push same placeholder value for each use
      params.push(s)
    }

    const where = `WHERE ${clauses.join(' AND ')}`
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
    params.push(ps, _codeofnewf</)

    const r = await pool.query(
      `SELECT
         u.id, u.code, u.description, u.unit_type, u.unit_type_id, ut.name AS unit_type_name,
         u.base_price, u.currency, u.model_id, u.area, u.orientation,
         u.has_garden, u.garden_area, u.has_roof, u.roof_area,
         u.maintenance_price, u.garage_price, u.garden_price, u.roof_price, u.storage_price,
         u.available, u.unit_status,
         m.model_name AS model_name, m.model_code AS model_code,
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

// Create inventory unit (Financial Admin) -> goes into FM approval queue as INVENTORY_DRAFT
router.post('/units', authMiddleware, requireRole(['financial_admin']), async (req, res) => {
  try {
    const { code } = req.body || {}
    if (!code || typeof code !== 'string') return bad(res, 400, 'code is required')

    // Create minimal draft unit; other attributes flow in later via model link approval
    let unit
    try {
      const r = await pool.query(
        `INSERT INTO units (code, description, unit_type, unit_type_id, base_price, currency, model_id, available, unit_status, created_by)
         VALUES ($1, NULL, NULL, NULL, 0, 'EGP', NULL, TRUE, 'INVENTORY_DRAFT', $2)
         RETURNING *`,
        [code.trim(), req.user.id]
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

    return ok(res, { unit, message: 'Unit created as draft. Awaiting Financial Manager approval.' })
  } catch (e) {
    console.error('POST /api/inventory/units error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: list inventory drafts awaiting approval
router.get('/units/drafts', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM units WHERE unit_status='INVENTORY_DRAFT' ORDER BY updated_at DESC, id DESC`
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
    // Check unit available
    const u = await pool.query('SELECT id, available FROM units WHERE id=$1', [uid])
    if (u.rows.length === 0) return bad(res, 404, 'Unit not found')
    if (u.rows[0].available === false) return bad(res, 400, 'Unit is not available')
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

// FM: list link requests
router.get('/unit-link-requests', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const { status = 'pending_approval' } = req.query || {}
    const r = await pool.query(
      `SELECT l.*, u.code AS unit_code, u.description AS unit_description, m.model_name, m.model_code
       FROM unit_model_inventory_links l
       JOIN units u ON u.id = l.unit_id
       JOIN unit_models m ON m.id = l.model_id
       WHERE l.status = $1
       ORDER BY l.updated_at DESC, l.id DESC`,
      [String(status)]
    )
    return ok(res, { links: r.rows })
  } catch (e) {
    console.error('GET /api/inventory/unit-link-requests error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: approve link request — copy features & price onto unit and set model_id; audit
router.patch('/unit-link-requests/:id/approve', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  const client = await pool.connect()
  try {
    const id = num(req.params.id)
    if (!id) { client.release(); return bad(res, 400, 'Invalid id') }
    await client.query('BEGIN')

    const cur = await client.query('SELECT * FROM unit_model_inventory_links WHERE id=$1 FOR UPDATE', [id])
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Link request not found') }
    const link = cur.rows[0]
    if (link.status !== 'pending_approval') { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Not pending approval') }

    const model = await client.query('SELECT * FROM unit_models WHERE id=$1', [link.model_id])
    if (model.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 404, 'Model not found') }
    const m = model.rows[0]

    const priceRes = await client.query(
      `SELECT price, maintenance_price, garage_price, garden_price, roof_price, storage_price
       FROM unit_model_pricing
       WHERE model_id=$1 AND status='approved'
       ORDER BY id DESC LIMIT 1`,
      [link.model_id]
    )
    if (priceRes.rows.length === 0) { await client.query('ROLLBACK'); client.release(); return bad(res, 400, 'Model has no approved pricing') }
    const basePrice = Number(priceRes.rows[0].price) || 0
    const maintPrice = Number(priceRes.rows[0].maintenance_price ?? 0) || 0
    const garPrice = Number(priceRes.rows[0].garage_price ?? 0) || 0
    const gardenPrice = Number(priceRes.rows[0].garden_price ?? 0) || 0
    const roofPrice = Number(priceRes.rows[0].roof_price ?? 0) || 0
    const storagePrice = Number(priceRes.rows[0].storage_price ?? 0) || 0

    // Copy features & set prices
    const upd = await client.query(
      `UPDATE units
       SET model_id=$1,
           base_price=$2,
           area=$3,
           orientation=$4,
           has_garden=$5,
           garden_area=$6,
           has_roof=$7,
           roof_area=$8,
           maintenance_price=$9,
           garage_price=$10,
           garden_price=$11,
           roof_price=$12,
           storage_price=$13,
           updated_at=now()
       WHERE id=$14
       RETURNING *`,
      [
        link.model_id,
        basePrice,
        m.area, m.orientation, m.has_garden, m.garden_area, m.has_roof, m.roof_area,
        maintPrice, garPrice, gardenPrice, roofPrice, storagePrice,
        link.unit_id
      ]
    )

    const updatedUnit = upd.rows[0]

    const updLink = await client.query(
      `UPDATE unit_model_inventory_links
       SET status='approved', approved_by=$1, updated_at=now()
       WHERE id=$2
       RETURNING *`,
      [req.user.id, id]
    )

    // Mark unit as AVAILABLE and set approved_by timestamp/user
    await client.query(
      `UPDATE units
       SET unit_status='AVAILABLE', approved_by=$1, updated_at=now()
       WHERE id=$2`,
      [req.user.id, link.unit_id]
    )

    await client.query(
      `INSERT INTO unit_model_inventory_link_audit (link_id, action, changed_by, details)
       VALUES ($1, 'approve', $2, $3)`,
      [updLink.rows[0].id, req.user.id, JSON.stringify({ propagated_base_price: basePrice })]
    )

    await client.query('COMMIT'); client.release()
    return ok(res, { link: updLink.rows[0], unit: updatedUnit })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    console.error('PATCH /api/inventory/unit-link-requests/:id/approve error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// FM: reject link request
router.patch('/unit-link-requests/:id/reject', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    const { reason } = req.body || {}
    if (!id) return bad(res, 400, 'Invalid id')

    const upd = await pool.query(
      `UPDATE unit_model_inventory_links
       SET status='rejected', approved_by=$1, reason=$2, updated_at=now()
       WHERE id=$3 AND status='pending_approval'
       RETURNING *`,
      [req.user.id, reason || null, id]
    )
    if (upd.rows.length === 0) return bad(res, 404, 'Not found or not pending')

    await pool.query(
      `INSERT INTO unit_model_inventory_link_audit (link_id, action, changed_by, details)
       VALUES ($1, 'reject', $2, $3)`,
      [upd.rows[0].id, req.user.id, JSON.stringify({ reason: reason || null })]
    )

    return ok(res, { link: upd.rows[0] })
  } catch (e) {
    console.error('PATCH /api/inventory/unit-link-requests/:id/reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

export default router