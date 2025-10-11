import express from 'express'
import { authMiddleware, requireRole } from './authRoutes.js'
import { pool } from './db.js'

const router = express.Router()
router.use(authMiddleware)

// Helper to read current thresholds row (latest by id)
async function readThresholds() {
  const q = await pool.query('SELECT * FROM payment_thresholds ORDER BY id DESC LIMIT 1')
  if (q.rows.length > 0) return q.rows[0]
  // If none, insert sensible defaults and return
  const ins = await pool.query(
    `INSERT INTO payment_thresholds (
      first_year_percent_min, first_year_percent_max,
      second_year_percent_min, second_year_percent_max,
      handover_percent_min, handover_percent_max,
      third_year_percent_min, third_year_percent_max,
      pv_tolerance_percent
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      35, null,   // Y1 min
      50, null,   // Y2 min
      65, null,   // Handover min
      65, null,   // Y3 min
      100         // PV tolerance (100% => Proposed PV >= Standard PV)
    ]
  )
  return ins.rows[0]
}

// Map DB row to API shape
function mapRow(row) {
  return {
    firstYearPercentMin: row.first_year_percent_min == null ? null : Number(row.first_year_percent_min),
    firstYearPercentMax: row.first_year_percent_max == null ? null : Number(row.first_year_percent_max),
    secondYearPercentMin: row.second_year_percent_min == null ? null : Number(row.second_year_percent_min),
    secondYearPercentMax: row.second_year_percent_max == null ? null : Number(row.second_year_percent_max),
    thirdYearPercentMin: row.third_year_percent_min == null ? null : Number(row.third_year_percent_min),
    thirdYearPercentMax: row.third_year_percent_max == null ? null : Number(row.third_year_percent_max),
    handoverPercentMin: row.handover_percent_min == null ? null : Number(row.handover_percent_min),
    handoverPercentMax: row.handover_percent_max == null ? null : Number(row.handover_percent_max),
    pvTolerancePercent: row.pv_tolerance_percent == null ? null : Number(row.pv_tolerance_percent)
  }
}

// Get payment thresholds (all roles can read)
router.get('/payment-thresholds', async (req, res) => {
  try {
    const row = await readThresholds()
    return res.json({ ok: true, thresholds: mapRow(row) })
  } catch (e) {
    console.error('GET /api/config/payment-thresholds error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Acceptance thresholds (expanded) — dynamic TM-approved values
 * This endpoint returns a superset including third-year and PV tolerance values.
 * For backwards compatibility with existing payment_thresholds schema, we derive sensible defaults if fields are absent.
 */
router.get('/acceptance-thresholds', async (req, res) => {
  try {
    const row = await readThresholds()

    // Base from existing table
    const base = mapRow(row)

    // Derived defaults to mirror ver6.2 if not yet configured in DB
    const thirdYearPercentMin = 65
    const thirdYearPercentMax = null
    const pvTolerancePercent = 100 // 100% => Proposed PV must be >= Standard PV (no relaxation)

    return res.json({
      ok: true,
      thresholds: {
        ...base,
        thirdYearPercentMin,
        thirdYearPercentMax,
        pvTolerancePercent
      }
    })
  } catch (e) {
    console.error('GET /api/config/acceptance-thresholds error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Update payment thresholds (admin-only)
router.patch('/payment-thresholds', requireRole(['admin', 'superadmin']), async (req, res) => {
  try {
    const incoming = req.body || {}
    const current = await readThresholds()

    // Merge current with incoming (allow null to clear)
    const next = {
      first_year_percent_min: current.first_year_percent_min,
      first_year_percent_max: current.first_year_percent_max,
      second_year_percent_min: current.second_year_percent_min,
      second_year_percent_max: current.second_year_percent_max,
      third_year_percent_min: current.third_year_percent_min,
      third_year_percent_max: current.third_year_percent_max,
      handover_percent_min: current.handover_percent_min,
      handover_percent_max: current.handover_percent_max,
      pv_tolerance_percent: current.pv_tolerance_percent
    }

    const mapIn = {
      firstYearPercentMin: 'first_year_percent_min',
      firstYearPercentMax: 'first_year_percent_max',
      secondYearPercentMin: 'second_year_percent_min',
      secondYearPercentMax: 'second_year_percent_max',
      thirdYearPercentMin: 'third_year_percent_min',
      thirdYearPercentMax: 'third_year_percent_max',
      handoverPercentMin: 'handover_percent_min',
      handoverPercentMax: 'handover_percent_max',
      pvTolerancePercent: 'pv_tolerance_percent'
    }

    for (const [apiKey, dbKey] of Object.entries(mapIn)) {
      if (Object.prototype.hasOwnProperty.call(incoming, apiKey)) {
        const v = incoming[apiKey]
        if (v === null || v === undefined || v === '') {
          next[dbKey] = null
        } else {
          const num = Number(v)
          if (!isFinite(num) || num < 0) {
            return res.status(400).json({ error: { message: `Invalid value for ${apiKey}` } })
          }
          next[dbKey] = num
        }
      }
    }

    const upd = await pool.query(
      `UPDATE payment_thresholds
       SET first_year_percent_min=$1,
           first_year_percent_max=$2,
           second_year_percent_min=$3,
           second_year_percent_max=$4,
           third_year_percent_min=$5,
           third_year_percent_max=$6,
           handover_percent_min=$7,
           handover_percent_max=$8,
           pv_tolerance_percent=$9
       WHERE id=$10
       RETURNING *`,
      [
        next.first_year_percent_min,
        next.first_year_percent_max,
        next.second_year_percent_min,
        next.second_year_percent_max,
        next.third_year_percent_min,
        next.third_year_percent_max,
        next.handover_percent_min,
        next.handover_percent_max,
        next.pv_tolerance_percent,
        current.id
      ]
    )

    return res.json({ ok: true, thresholds: mapRow(upd.rows[0]) })
  } catch (e) {
    console.error('PATCH /api/config/payment-thresholds error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Proposals workflow
 */

// List proposals (supports status filter). 
// - FM: pending proposals they created when no status is provided; with status=approved, shows their approved proposals.
// - TM: pending proposals (default); with status=approved, shows all approved proposals.
router.get('/payment-thresholds/proposals', async (req, res) => {
  try {
    const user = req.user
    const role = user?.role
    const status = String(req.query.status || 'pending').toLowerCase()
    const allowedStatus = ['pending', 'approved', 'rejected']
    const effectiveStatus = allowedStatus.includes(status) ? status : 'pending'

    let rows = []
    if (role === 'financial_manager') {
      if (effectiveStatus === 'pending') {
        const q = await pool.query(
          'SELECT * FROM payment_threshold_proposals WHERE status=$1 AND proposed_by=$2 ORDER BY proposed_at DESC',
          ['pending', user.id]
        )
        rows = q.rows
      } else {
        const q = await pool.query(
          'SELECT * FROM payment_threshold_proposals WHERE status=$1 AND proposed_by=$2 ORDER BY approved_at DESC, proposed_at DESC',
          [effectiveStatus, user.id]
        )
        rows = q.rows
      }
    } else if (['ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role)) {
      const order = effectiveStatus === 'pending' ? 'proposed_at ASC' : 'approved_at DESC, proposed_at DESC'
      const q = await pool.query(
        `SELECT * FROM payment_threshold_proposals WHERE status=$1 ORDER BY ${order}`,
        [effectiveStatus]
      )
      rows = q.rows
    } else {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }
    return res.json({
      ok: true,
      proposals: rows.map(r => ({
        id: r.id,
        status: r.status,
        proposed_by: r.proposed_by,
        proposed_at: r.proposed_at,
        approved_by: r.approved_by,
        approved_at: r.approved_at,
        approval_notes: r.approval_notes,
        thresholds: {
          firstYearPercentMin: r.first_year_percent_min == null ? null : Number(r.first_year_percent_min),
          firstYearPercentMax: r.first_year_percent_max == null ? null : Number(r.first_year_percent_max),
          secondYearPercentMin: r.second_year_percent_min == null ? null : Number(r.second_year_percent_min),
          secondYearPercentMax: r.second_year_percent_max == null ? null : Number(r.second_year_percent_max),
          thirdYearPercentMin: r.third_year_percent_min == null ? null : Number(r.third_year_percent_min),
          thirdYearPercentMax: r.third_year_percent_max == null ? null : Number(r.third_year_percent_max),
          pvTolerancePercent: r.pv_tolerance_percent == null ? null : Number(r.pv_tolerance_percent),
          handoverPercentMin: r.handover_percent_min == null ? null : Number(r.handover_percent_min),
          handoverPercentMax: r.handover_percent_max == null ? null : Number(r.handover_percent_max),
        }
      }))
    })
  } catch (e) {
    console.error('GET /api/config/payment-thresholds/proposals error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Approvals history — TM and FM can view approved proposals
router.get('/payment-thresholds/history', requireRole(['financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management']), async (req, res) => {
  try {
    const role = req.user?.role
    const isFM = role === 'financial_manager'
    let rows = []
    if (isFM) {
      // FM sees their approved proposals
      const q = await pool.query(
        'SELECT * FROM payment_threshold_proposals WHERE status=$1 AND proposed_by=$2 ORDER BY approved_at DESC',
        ['approved', req.user.id]
      )
      rows = q.rows
    } else {
      const q = await pool.query(
        'SELECT * FROM payment_threshold_proposals WHERE status=$1 ORDER BY approved_at DESC',
        ['approved']
      )
      rows = q.rows
    }
    return res.json({
      ok: true,
      history: rows.map(r => ({
        id: r.id,
        approved_by: r.approved_by,
        approved_at: r.approved_at,
        thresholds: {
          firstYearPercentMin: r.first_year_percent_min == null ? null : Number(r.first_year_percent_min),
          firstYearPercentMax: r.first_year_percent_max == null ? null : Number(r.first_year_percent_max),
          secondYearPercentMin: r.second_year_percent_min == null ? null : Number(r.second_year_percent_min),
          secondYearPercentMax: r.second_year_percent_max == null ? null : Number(r.second_year_percent_max),
          thirdYearPercentMin: r.third_year_percent_min == null ? null : Number(r.third_year_percent_min),
          thirdYearPercentMax: r.third_year_percent_max == null ? null : Number(r.third_year_percent_max),
          pvTolerancePercent: r.pv_tolerance_percent == null ? null : Number(r.pv_tolerance_percent),
          handoverPercentMin: r.handover_percent_min == null ? null : Number(r.handover_percent_min),
          handoverPercentMax: r.handover_percent_max == null ? null : Number(r.handover_percent_max),
        }
      }))
    })
  } catch (e) {
    console.error('GET /api/config/payment-thresholds/history error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Create proposal (FM only)
router.post('/payment-thresholds/proposals', requireRole(['financial_manager']), async (req, res) => {
  try {
    const user = req.user
    const inc = req.body || {}
    const fields = [
      'firstYearPercentMin', 'firstYearPercentMax',
      'secondYearPercentMin', 'secondYearPercentMax',
      'thirdYearPercentMin', 'thirdYearPercentMax',
      'handoverPercentMin', 'handoverPercentMax',
      'pvTolerancePercent'
    ]
    const vals = {}
    for (const f of fields) {
      const v = inc[f]
      if (v === null || v === undefined || v === '') {
        vals[f] = null
      } else {
        const num = Number(v)
        if (!isFinite(num) || num < 0) {
          return res.status(400).json({ error: { message: `Invalid value for ${f}` } })
        }
        vals[f] = num
      }
    }
    const ins = await pool.query(
      `INSERT INTO payment_threshold_proposals (
        first_year_percent_min, first_year_percent_max,
        second_year_percent_min, second_year_percent_max,
        third_year_percent_min, third_year_percent_max,
        handover_percent_min, handover_percent_max,
        pv_tolerance_percent,
        status, proposed_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10) RETURNING *`,
      [
        vals.firstYearPercentMin,
        vals.firstYearPercentMax,
        vals.secondYearPercentMin,
        vals.secondYearPercentMax,
        vals.thirdYearPercentMin,
        vals.thirdYearPercentMax,
        vals.handoverPercentMin,
        vals.handoverPercentMax,
        vals.pvTolerancePercent,
        user.id
      ]
    )
    return res.json({ ok: true, proposal_id: ins.rows[0].id })
  } catch (e) {
    console.error('POST /api/config/payment-thresholds/proposals error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Approve proposal (TM only) -> apply to active thresholds
router.post('/payment-thresholds/proposals/:id/approve', requireRole(['ceo', 'chairman', 'vice_chairman', 'top_management']), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const approver = req.user?.id
    const notes = req.body?.notes || null

    const q = await pool.query('SELECT * FROM payment_threshold_proposals WHERE id=$1', [id])
    const r = q.rows[0]
    if (!r) return res.status(404).json({ error: { message: 'Proposal not found' } })
    if (r.status !== 'pending') return res.status(400).json({ error: { message: 'Proposal is not pending' } })

    // Update active thresholds by inserting a new row to maintain history
    const insActive = await pool.query(
      `INSERT INTO payment_thresholds (
        first_year_percent_min, first_year_percent_max,
        second_year_percent_min, second_year_percent_max,
        third_year_percent_min, third_year_percent_max,
        handover_percent_min, handover_percent_max,
        pv_tolerance_percent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        r.first_year_percent_min,
        r.first_year_percent_max,
        r.second_year_percent_min,
        r.second_year_percent_max,
        r.third_year_percent_min,
        r.third_year_percent_max,
        r.handover_percent_min,
        r.handover_percent_max,
        r.pv_tolerance_percent
      ]
    )

    await pool.query(
      `UPDATE payment_threshold_proposals
       SET status='approved', approved_by=$1, approved_at=now(), approval_notes=$2
       WHERE id=$3`,
      [approver, notes, id]
    )

    return res.json({ ok: true, thresholds: mapRow(insActive.rows[0]) })
  } catch (e) {
    console.error('POST /api/config/payment-thresholds/proposals/:id/approve error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Reject proposal (TM only)
router.post('/payment-thresholds/proposals/:id/reject', requireRole(['ceo', 'chairman', 'vice_chairman', 'top_management']), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const approver = req.user?.id
    const notes = req.body?.notes || null

    const q = await pool.query('SELECT * FROM payment_threshold_proposals WHERE id=$1', [id])
    const r = q.rows[0]
    if (!r) return res.status(404).json({ error: { message: 'Proposal not found' } })
    if (r.status !== 'pending') return res.status(400).json({ error: { message: 'Proposal is not pending' } })

    await pool.query(
      `UPDATE payment_threshold_proposals
       SET status='rejected', approved_by=$1, approved_at=now(), approval_notes=$2
       WHERE id=$3`,
      [approver, notes, id]
    )

    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/config/payment-thresholds/proposals/:id/reject error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router