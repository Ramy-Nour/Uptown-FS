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
      where.push(`(LOWER(u.code) LIKE $${placeholderCount} OR LOWER(u.description) LIKE $${placeholderCount})`)
      params.push(`%${search}%`)
      placeholderCount++
    }

    // Filter by status (e.g., status=INVENTORY_DRAFT)
    const status = (req.query.status || '').toString().trim()
    if (status) {
      where.push(`u.unit_status = $${placeholderCount}`)
      params.push(status)
      placeholderCount++
    }

    // Filter for units without model (noModel=true for Coded Units)
    const noModel = req.query.noModel === 'true'
    if (noModel) {
      where.push(`u.model_id IS NULL`)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM units u ${whereSql}`, params)
    const total = countRes.rows[0]?.c || 0

    const limitPlaceholder = `$${placeholderCount++}`
    const offsetPlaceholder = `$${placeholderCount++}`
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
  if (!['admin', 'superadmin', 'crm_admin', 'financial_manager'].includes(role)) {
    return res.status(403).json({ error: { message: 'Forbidden' } })
  }
  next()
}

// Bulk create units (supports UR and CH coding modes)
router.post('/bulk-create', authMiddleware, requireAdminLike, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const {
      unitType = 'UR',       // 'UR' (Uptown Residence) or 'CH' (Custom Home)
      zone,
      block,
      building,              // For UR: building number; For CH: plot number (maps to building_number in DB)
      floors = [],           // UR only: array of floor numbers
      unitsPerFloor = 2,     // UR only: number of units per floor (for incremental numbering)
      plotStart,             // CH only: start of plot range
      plotEnd,               // CH only: end of plot range
      description_template
    } = req.body || {}

    // Common validations
    if (!zone || !block) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: { message: 'Zone and Block are required' } })
    }

    const createdUnits = []
    const duplicates = []

    // Pad Helper
    const pad = (num, size) => String(num).padStart(size, '0')

    const zonePad = pad(zone, 2)
    const blockPad = pad(block, 2)

    if (unitType === 'CH') {
      // Custom Home mode: CH-AAA-BB-CC (Plot-Block-Zone)
      // plotStart and plotEnd define range of plots to create
      const pStart = Number(plotStart) || 1
      const pEnd = Number(plotEnd) || pStart

      if (pStart > pEnd) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: { message: 'plotStart must be <= plotEnd' } })
      }

      for (let plot = pStart; plot <= pEnd; plot++) {
        const plotPad = pad(plot, 3)
        const code = `CH${plotPad}${blockPad}${zonePad}`

        const desc = description_template
          ? description_template.replace('{plot}', plot).replace('{block}', block).replace('{zone}', zone)
          : `Custom Home Plot ${plot}, Block ${block}, Zone ${zone}`

        // Check duplicate
        const check = await client.query('SELECT id FROM units WHERE code=$1', [code])
        if (check.rows.length > 0) {
          duplicates.push(code)
          continue
        }

        const insertRes = await client.query(
          `INSERT INTO units (
             code, description, unit_type, base_price, currency, model_id, unit_status, created_by, available,
             unit_number, floor, building_number, block_sector, zone
           ) VALUES (
             $1, $2, 'Custom Home', 0, 'EGP', NULL, 'INVENTORY_DRAFT', $3, FALSE,
             $4, NULL, $5, $6, $7
           ) RETURNING id, code`,
          [
            code, desc, req.user.id,
            String(plot), String(plot), String(block), String(zone)
          ]
        )
        createdUnits.push(insertRes.rows[0])
      }

    } else {
      // UR mode: UR-BB-CC-DDD-EE-FF (Apt-Floor-Bldg-Block-Zone)
      if (!building) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: { message: 'Building is required for UR mode' } })
      }
      if (!Array.isArray(floors) || floors.length === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: { message: 'Floors list is required for UR mode' } })
      }

      const bldgPad = pad(building, 3)
      const perFloor = Number(unitsPerFloor) || 2
      let aptCounter = 1 // Incremental apartment numbering

      for (const fl of floors) {
        const floorPad = pad(fl, 2)
        for (let u = 0; u < perFloor; u++) {
          const aptPad = pad(aptCounter, 2)
          const code = `UR${aptPad}${floorPad}${bldgPad}${blockPad}${zonePad}`

          const desc = description_template
            ? description_template.replace('{apt}', aptCounter).replace('{floor}', fl).replace('{bldg}', building)
            : `Apartment ${aptCounter}, Floor ${fl}, Building ${building}`

          // Check duplicate
          const check = await client.query('SELECT id FROM units WHERE code=$1', [code])
          if (check.rows.length > 0) {
            duplicates.push(code)
            aptCounter++
            continue
          }

          const insertRes = await client.query(
            `INSERT INTO units (
               code, description, unit_type, base_price, currency, model_id, unit_status, created_by, available,
               unit_number, floor, building_number, block_sector, zone
             ) VALUES (
               $1, $2, 'Apartment', 0, 'EGP', NULL, 'INVENTORY_DRAFT', $3, FALSE,
               $4, $5, $6, $7, $8
             ) RETURNING id, code`,
            [
              code, desc, req.user.id,
              String(aptCounter), String(fl), String(building), String(block), String(zone)
            ]
          )
          createdUnits.push(insertRes.rows[0])
          aptCounter++
        }
      }
    }

    await client.query('COMMIT')
    return res.json({ ok: true, created: createdUnits.length, duplicates: duplicates.length, duplicateCodes: duplicates, units: createdUnits })

  } catch (e) {
    await client.query('ROLLBACK')
    console.error('POST /api/units/bulk-create error', e)
    return res.status(500).json({ error: { message: 'Internal error during bulk creation' } })
  } finally {
    client.release()
  }
})

// Bulk link model to draft units (requires TM approval)
router.patch('/bulk-link-model', authMiddleware, requireAdminLike, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { unitIds, modelId } = req.body || {}

    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: { message: 'unitIds array is required' } })
    }
    if (!modelId) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: { message: 'modelId is required' } })
    }

    // Verify model exists and get model attributes
    const modelCheck = await client.query(
      `SELECT id, model_name, area, orientation, has_garden, garden_area, has_roof, roof_area, garage_area
       FROM unit_models WHERE id=$1`,
      [Number(modelId)]
    )
    if (modelCheck.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: { message: 'Invalid modelId' } })
    }
    const model = modelCheck.rows[0]

    // Fetch approved standard pricing for this model
    const pricingRes = await client.query(
      `SELECT price, maintenance_price, garage_price, garden_price, roof_price, storage_price
       FROM unit_model_pricing
       WHERE model_id = $1 AND status = 'approved'
       ORDER BY id DESC LIMIT 1`,
      [Number(modelId)]
    )
    const pricing = pricingRes.rows[0] || {}

    // Update units: link model, copy model attributes and pricing
    const updateRes = await client.query(
      `UPDATE units 
       SET model_id = $1,
           area = $2,
           orientation = $3,
           has_garden = $4,
           garden_area = $5,
           has_roof = $6,
           roof_area = $7,
           garage_area = $8,
           base_price = COALESCE($9, 0),
           maintenance_price = COALESCE($10, 0),
           garage_price = COALESCE($11, 0),
           garden_price = COALESCE($12, 0),
           roof_price = COALESCE($13, 0),
           storage_price = COALESCE($14, 0),
           updated_at = now()
       WHERE id = ANY($15) AND unit_status = 'INVENTORY_DRAFT'
       RETURNING id, code`,
      [
        Number(modelId),
        model.area || null,
        model.orientation || null,
        model.has_garden || false,
        model.garden_area || null,
        model.has_roof || false,
        model.roof_area || null,
        model.garage_area || null,
        pricing.price || 0,
        pricing.maintenance_price || 0,
        pricing.garage_price || 0,
        pricing.garden_price || 0,
        pricing.roof_price || 0,
        pricing.storage_price || 0,
        unitIds.map(Number)
      ]
    )

    if (updateRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: { message: 'No valid INVENTORY_DRAFT units found to update' } })
    }

    await client.query('COMMIT')
    return res.json({
      ok: true,
      updated: updateRes.rows.length,
      units: updateRes.rows,
      message: `${updateRes.rows.length} units linked to model with attributes and pricing. Awaiting TM approval.`
    })

  } catch (e) {
    await client.query('ROLLBACK')
    console.error('PATCH /api/units/bulk-link-model error', e)
    return res.status(500).json({ error: { message: 'Internal error during bulk model linking' } })
  } finally {
    client.release()
  }
})

// Approve model linking (TM only)
router.patch('/approve-model-link', authMiddleware, async (req, res) => {
  const role = req.user?.role
  const tmRoles = ['ceo', 'chairman', 'vice_chairman']
  if (!tmRoles.includes(role)) {
    return res.status(403).json({ error: { message: 'Only Top Management can approve model linking' } })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { unitIds } = req.body || {}

    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: { message: 'unitIds array is required' } })
    }

    const updateRes = await client.query(
      `UPDATE units 
       SET unit_status = 'AVAILABLE', available = TRUE, updated_at = now()
       WHERE id = ANY($1) AND unit_status = 'INVENTORY_DRAFT'
       RETURNING id, code`,
      [unitIds.map(Number)]
    )

    await client.query('COMMIT')
    return res.json({
      ok: true,
      approved: updateRes.rows.length,
      units: updateRes.rows
    })

  } catch (e) {
    await client.query('ROLLBACK')
    console.error('PATCH /api/units/approve-model-link error', e)
    return res.status(500).json({ error: { message: 'Internal error during approval' } })
  } finally {
    client.release()
  }
})

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