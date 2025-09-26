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
    if (search) {
      const idx = params.push(`%${search}%`)
      // Use positional parameter placeholders ($1, $2, ...) correctly
      where.push(`(LOWER(code) LIKE ${idx} OR LOWER(description) LIKE ${idx})`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM units ${whereSql}`, params)
    const total = countRes.rows[0]?.c || 0

    // Add LIMIT/OFFSET as bound parameters and reference them with placeholders
    const limitIdx = params.push(pageSize)
    const offsetIdx = params.push(offset)
    const listSql = `
      SELECT
        u.id,
        u.code,
        u.description,
        u.unit_type,
        u.unit_type_id,
        ut.name AS unit_type_name,
        u.base_price,
        u.currency,
        u.model_id,
        u.area,
        u.orientation,
        u.has_garden,
        u.garden_area,
        u.has_roof,
        u.roof_area,
        u.maintenance_price,
        u.garage_price,
        u.garden_price,
        u.roof_price,
        u.storage_price,
        u.available,
        u.unit_status,
        -- availability flags for components
        (COALESCE(u.has_garden, FALSE) AND COALESCE(u.garden_area, 0) > 0) AS garden_available,
        (COALESCE(u.roof_area, 0) > 0 AND COALESCE(u.has_roof, FALSE)) AS roof_available,
        (COALESCE(u.garage_area, 0) > 0) AS garage_available,
        -- totals
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
      LIMIT ${limitIdx} OFFSET ${offsetIdx}
    `
    const rows = await pool.query(listSql, params)
    return res.json({ ok: true, units: rows.rows, pagination: { page, pageSize, total } })
  } catch (e) {
    console.error('GET /api/units error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get a unit
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const r = await pool.query('SELECT * FROM units WHERE id=$1', [id])
    if (r.rows.length === 0) return res.status(404).json({ error: { message: 'Unit not found' } })
    return res.json({ ok: true, unit: r.rows[0] })
  } catch (e) {
    console.error('GET /api/units/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Admin/Finance Admin guard helper
function requireAdminLike(req, res, next) {
  const role = req.user?.role
  if (!['admin', 'superadmin', 'financial_admin'].includes(role)) {
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
    const id = Number(req.params.id)
    const r = await pool.query('DELETE FROM units WHERE id=$1 RETURNING id', [id])
    if (r.rows.length === 0) return res.status(404).json({ error: { message: 'Unit not found' } })
    return res.json({ ok: true, id })
  } catch (e) {
    console.error('DELETE /api/units/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router