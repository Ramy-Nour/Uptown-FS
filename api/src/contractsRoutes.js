import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) { return res.json({ ok: true, ...payload }) }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

// List contracts (basic queue view)
router.get('/', authMiddleware, requireRole([
  'contract_person',
  'contract_manager',
  'ceo',
  'chairman',
  'vice_chairman',
  'top_management',
  'admin',
  'superadmin'
]), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.*,
         rf.deal_id,
         u.unit_code,
         (rf.details->'clientInfo'->>'buyer_name') AS buyer_name
       FROM contracts c
       LEFT JOIN reservation_forms rf ON rf.id = c.reservation_form_id
       LEFT JOIN deals d ON d.id = rf.deal_id
       LEFT JOIN units u ON u.id = d.unit_id
       ORDER BY c.created_at DESC, c.id DESC`
    )
    return ok(res, { contracts: result.rows })
  } catch (e) {
    console.error('GET /api/contracts error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Get single contract
router.get('/:id', authMiddleware, requireRole([
  'contract_person',
  'contract_manager',
  'ceo',
  'chairman',
  'vice_chairman',
  'top_management',
  'admin',
  'superadmin'
]), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const result = await pool.query(
      `SELECT
         c.*,
         rf.deal_id,
         u.unit_code,
         (rf.details->'clientInfo'->>'buyer_name') AS buyer_name
       FROM contracts c
       LEFT JOIN reservation_forms rf ON rf.id = c.reservation_form_id
       LEFT JOIN deals d ON d.id = rf.deal_id
       LEFT JOIN units u ON u.id = d.unit_id
       WHERE c.id = $1`,
      [id]
    )
    if (result.rows.length === 0) return bad(res, 404, 'Contract not found')
    return ok(res, { contract: result.rows[0] })
  } catch (e) {
    console.error('GET /api/contracts/:id error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Create a contract from an approved reservation form (Contract Admin)
router.post('/', authMiddleware, requireRole(['contract_person']), async (req, res) => {
  try {
    const { reservation_form_id, details } = req.body || {}
    const rfId = num(reservation_form_id)
    if (!rfId) return bad(res, 400, 'reservation_form_id is required and must be numeric')

    // Require reservation form approved
    const rf = await pool.query(`SELECT id, status FROM reservation_forms WHERE id=$1`, [rfId])
    if (rf.rows.length === 0) return bad(res, 404, 'Reservation form not found')
    if (rf.rows[0].status !== 'approved') return bad(res, 400, 'Reservation form must be approved to draft a contract')

    const det = details && typeof details === 'object' ? details : {}

    const ins = await pool.query(
      `INSERT INTO contracts (reservation_form_id, details, created_by, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING *`,
      [rfId, det, req.user.id]
    )
    return ok(res, { contract: ins.rows[0] })
  } catch (e) {
    console.error('POST /api/contracts error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Contract Manager approval: draft -> pending_tm
router.patch('/:id/approve-cm', authMiddleware, requireRole(['contract_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query(`SELECT * FROM contracts WHERE id=$1`, [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Contract not found')
    if (cur.rows[0].status !== 'draft') return bad(res, 400, 'Contract must be in draft to approve (CM)')
    const upd = await pool.query(
      `UPDATE contracts SET status='pending_tm', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )
    return ok(res, { contract: upd.rows[0] })
  } catch (e) {
    console.error('PATCH /api/contracts/:id/approve-cm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Top-Management approval: pending_tm -> approved
router.patch('/:id/approve-tm', authMiddleware, requireRole(['ceo','chairman','vice_chairman','top_management']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query(`SELECT * FROM contracts WHERE id=$1`, [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Contract not found')
    if (cur.rows[0].status !== 'pending_tm') return bad(res, 400, 'Contract must be pending TM to approve')
    const upd = await pool.query(
      `UPDATE contracts SET status='approved', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )
    return ok(res, { contract: upd.rows[0] })
  } catch (e) {
    console.error('PATCH /api/contracts/:id/approve-tm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Reject (CM/TM)
router.patch('/:id/reject', authMiddleware, requireRole(['contract_manager','ceo','chairman','vice_chairman','top_management']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query(`SELECT * FROM contracts WHERE id=$1`, [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Contract not found')
    const upd = await pool.query(
      `UPDATE contracts SET status='rejected', approved_by=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )
    return ok(res, { contract: upd.rows[0] })
  } catch (e) {
    console.error('PATCH /api/contracts/:id/reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Execute (print/finalize) — CA only; must be approved
router.patch('/:id/execute', authMiddleware, requireRole(['contract_person']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query(`SELECT * FROM contracts WHERE id=$1`, [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Contract not found')
    if (cur.rows[0].status !== 'approved') return bad(res, 400, 'Contract must be approved to execute')
    const upd = await pool.query(
      `UPDATE contracts SET status='executed', updated_at=now() WHERE id=$1 RETURNING *`,
      [id]
    )
    return ok(res, { contract: upd.rows[0] })
  } catch (e) {
    console.error('PATCH /api/contracts/:id/execute error:', e)
    return bad(res, 500, 'Internal error')
  }
})

export default router