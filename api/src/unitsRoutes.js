import express from 'express'
import { pool } from './db.js'
import { authMiddleware } from './authRoutes.js'

const router = express.Router()

// List units (with optional search, pagination)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim().toLowerCase()
    const page = Math.max(1, parseInt(req.query.page || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '50', 10)))
    const offset = (page - 1) * pageSize

    const where = []
    const params = []
    let placeholderCount = 1

    if (search) {
      const searchPlaceholder = `${placeholderCount++}`
      where.push(`(LOWER(u.code) LIKE ${searchPlaceholder} OR LOWER(u.description) LIKE ${searchPlaceholder})`)
      params.push(`%${search}%`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM units u ${whereSql}`, params)
    const total = countRes.rows[0]?.c || 0

    const limitPlaceholder = `${placeholderCount++}`
    const offsetPlaceholder = `${placeholderCount++}`
    params.push(pageSize)
    params.push(offset)

    const listSql = `
      SELECT
        u.id, u.code, u.description, u.unit_type, u.unit_type_id, ut.name AS unit_type_name,
        u.base_price, u.currency, u.model_id, u.area, u.orientation,
        u.has_garden, u.garden_area, u.has_roof, u.roof_area,
        u.maintenance_price, u.garage_price, u.garden_price, u.roof_price, u.storage_price,
        u.available, u.unit_status,
        u.unit_number, u.floor, u.building_number, u.block_sector, u.zone, u.garden_details,
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
      ${whereSql}
      ORDER BY u.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `
    const { rows } = await pool.query(listSql, params)
    return res.json({ ok: true, units: rows, pagination: { page, pageSize, total } })
  } catch (e) {
    console.error('GET /api/units error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get a unit with full details including pricing breakdown and standard pricing
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const r = await pool.query(`
      SELECT
        u.id, u.code, u.description, u.unit_type, u.unit_type_id, ut.name AS unit_type_name,
        u.base_price, u.currency, u.model_id, u.area, u.orientation,
        u.has_garden, u.garden_area, u.has_roof, u.roof_area, u.garage_area,
        u.maintenance_price, u.garage_price, u.garden_price, u.roof_price, u.storage_price,
        u.available, u.unit_status, u.created_by, u.approved_by, u.created_at, u.updated_at,
        u.unit_number, u.floor, u.building_number, u.block_sector, u.zone, u.garden_details,
        m.model_name AS model_name, m.model_code AS model_code,
        p.price AS standard_base_price,
        p.maintenance_price AS standard_maintenance_price,
        p.garage_price AS standard_garage_price,
        p.garden_price AS standard_garden_price,
        p.roof_price AS standard_roof_price,
        p.storage_price AS standard_storage_price,
        (COALESCE(u.has_garden, FALSE) AND COALESCE(u.garden_area, 0) > 0) AS garden_available,
        (COALESCE(u.has_roof, FALSE) AND COALESCE(u.roof_area, 0) > 0) AS roof_available,
        (COALESCE(u.garage_area, 0) > 0) AS garage_available,
        (COALESCE(u.base_price,0)
          + COALESCE(u.garage_price,0)
          + COALESCE(u.garden_price,0)
          + COALESCE(u.roof_price,0)
          + COALESCE(u.storage_price,0)) AS total_price
      FROM units u
      LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
      LEFT JOIN unit_models m ON m.id = u.model_id
      LEFT JOIN LATERAL (
        SELECT price, maintenance_price, garage_price, garden_price, roof_price, storage_price
        FROM unit_model_pricing
        WHERE model_id = u.model_id AND status = 'approved'
        ORDER BY id DESC
        LIMIT 1
      ) p ON TRUE
      WHERE u.id=$1
    `, [id])
    if (r.rows.length === 0) return res.status(404).json({ error: { message: 'Unit not found' } })
    return res.json({ ok: true, unit: r.rows[0] })
  } catch (e) {
    console.error('GET /api/units/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Admin guard helper (inventory drafts for day-to-day go via /api/inventory; this path is reserved for core admins)
function requireAdminLike(req, res, next) {
  const role = req.user?.role
  if (!['admin', 'superadmin'].includes(role)) {
    return res.status(403).json({ error: { message: 'Forbidden' } })
  }
  next()
}

// Create unit
router.post('/', authMiddleware, requireAdminLike, async (req, res) => {
  try {
    const role = req.user?.role
    const { code, description, unit_type, base_price, currency, model_id, unit_type_id } = req.body || {}
    if (!code || typeof code !== 'string') return res.status(400).json({ error: { message: 'code is required' } })

    // Financial Admin: can only create draft unit with code; must request link to model separately
    if (role === 'financial_admin') {
      try {
        const r = await pool.query(
          `INSERT INTO units (code, description, unit_type, unit_type_id, base_price, currency, model_id, unit_status, created_by, available)
           VALUES ($1, NULL, NULL, NULL, 0, 'EGP', NULL, 'INVENTORY_DRAFT', $2, TRUE)
           RETURNING *`,
          [code.trim(), req.user.id]
        )
        return res.json({ ok: true, unit: r.rows[0] })
      } catch (err) {
        // Unique violation on code
        if (err && err.code === '23505') {
          return res.status(400).json({ error: { message: 'Unit code already exists. Duplicate codes are not allowed.' } })
        }
        console.error('POST /api/units (FA) error', err)
        return res.status(500).json({ error: { message: 'Internal error' } })
      }
    }

    // Admin/Superadmin: full control (optional direct link to model)
    const price = Number(base_price || 0)
    const cur = (currency || 'EGP').toString().toUpperCase()

    // Optional unit_type_id
    let utid = null
    if (unit_type_id != null) {
      const t = await pool.query('SELECT id FROM unit_types WHERE id=$1', [Number(unit_type_id)])
      if (t.rows.length === 0) return res.status(400).json({ error: { message: 'Invalid unit_type_id' } })
      utid = Number(unit_type_id)
    }

    let mid = null
    if (model_id != null) {
      const m = await pool.query('SELECT id FROM unit_models WHERE id=$1', [Number(model_id)])
      if (m.rows.length === 0) return res.status(400).json({ error: { message: 'Invalid model_id' } })
      mid = Number(model_id)
    }

    try {
      const r = await pool.query(
        `INSERT INTO units (code, description, unit_type, unit_type_id, base_price, currency, model_id, unit_status, created_by, available)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'AVAILABLE', $8, TRUE)
         RETURNING *`,
        [code.trim(), description || null, unit_type || null, utid, isFinite(price) ? price : 0, cur, mid, req.user.id]
      )
      return res.json({ ok: true, unit: r.rows[0] })
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(400).json({ error: { message: 'Unit code already exists. Duplicate codes are not allowed.' } })
      }
      console.error('POST /api/units error', err)
      return res.status(500).json({ error: { message: 'Internal error' } })
    }
  } catch (e) {
    console.error('POST /api/units outer error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Update unit
router.patch('/:id', authMiddleware, requireAdminLike, async (req, res) => {
  try {
    const role = req.user?.role
    const id = Number(req.params.id)
    const { code, description, unit_type, base_price, currency, model_id, unit_type_id } = req.body || {}
    const r0 = await pool.query('SELECT * FROM units WHERE id=$1', [id])
    if (r0.rows.length === 0) return res.status(404).json({ error: { message: 'Unit not found' } })
    const u = r0.rows[0]

    // Restrict Financial Admin to editing only drafts
    if (role === 'financial_admin' && u.unit_status !== 'INVENTORY_DRAFT') {
      return res.status(403).json({ error: { message: 'Financial Admin can only edit units in draft status.' } })
    }

    const newCode = typeof code === 'string' && code.trim() ? code.trim() : u.code
    const newDesc = typeof description === 'string' ? description : u.description
    const newType = typeof unit_type === 'string' ? unit_type : u.unit_type
    const price = base_price != null ? Number(base_price) : u.base_price
    const cur = typeof currency === 'string' ? currency.toUpperCase() : u.currency

    if (role === 'financial_admin' && model_id !== undefined) {
      return res.status(400).json({ error: { message: 'Financial Admin cannot set model_id directly. Use link-request workflow.' } })
    }

    let mid = u.model_id
    if (model_id !== undefined) {
      if (model_id === null || model_id === '') mid = null
      else {
        const m = await pool.query('SELECT id FROM unit_models WHERE id=$1', [Number(model_id)])
        if (m.rows.length === 0) return res.status(400).json({ error: { message: 'Invalid model_id' } })
        mid = Number(model_id)
      }
    }

    let utid = u.unit_type_id
    if (unit_type_id !== undefined) {
      if (unit_type_id === null || unit_type_id === '') utid = null
      else {
        const t = await pool.query('SELECT id FROM unit_types WHERE id=$1', [Number(unit_type_id)])
        if (t.rows.length === 0) return res.status(400).json({ error: { message: 'Invalid unit_type_id' } })
        utid = Number(unit_type_id)
      }
    }

    const r = await pool.query(
      'UPDATE units SET code=$1, description=$2, unit_type=$3, unit_type_id=$4, base_price=$5, currency=$6, model_id=$7 WHERE id=$8 RETURNING *',
      [newCode, newDesc, newType, utid, isFinite(price) ? price : u.base_price, cur, mid, id]
    )
    return res.json({ ok: true, unit: r.rows[0] })
  } catch (e) {
    console.error('PATCH /api/units/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Delete unit
router.delete('/:id', authMiddleware, requireAdminLike, async (req, res) => {
  try {
    const role = req.user?.role
    const id = Number(req.params.id)
    const r0 = await pool.query('SELECT unit_status FROM units WHERE id=$1', [id])
    if (r0.rows.length === 0) return res.status(404).json({ error: { message: 'Unit not found' } })

    if (role === 'financial_admin' && r0.rows[0].unit_status !== 'INVENTORY_DRAFT') {
      return res.status(403).json({ error: { message: 'Financial Admin can only delete units in draft status.' } })
    }

    const r = await pool.query('DELETE FROM units WHERE id=$1 RETURNING id', [id])
    if (r.rows.length === 0) return res.status(404).json({ error: { message: 'Unit not found' } })
    return res.json({ ok: true, id })
  } catch (e) {
    console.error('DELETE /api/units/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router