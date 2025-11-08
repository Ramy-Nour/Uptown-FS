import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) { return res.json({ ok: true, ...payload }) }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

async function notifyByRole(role, type, refId, message) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       SELECT u.id, $1, 'blocks', $2, $3
       FROM users u
       WHERE u.role=$4 AND u.active=TRUE`,
      [type, refId, message, role]
    )
  } catch (_) {}
}

// Sales Manager approval: pending_sm -> pending_fm
router.patch('/:id/override-sm', authMiddleware, requireRole(['sales_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query('SELECT id, status, override_status FROM blocks WHERE id=$1', [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Block not found')
    const row = cur.rows[0]
    if (row.status !== 'pending') return bad(res, 400, 'Only pending blocks can be overridden')
    if (row.override_status !== 'pending_sm') return bad(res, 400, 'Override stage is not pending Sales Manager')

    await pool.query('UPDATE blocks SET override_status=$1, updated_at=now() WHERE id=$2', ['pending_fm', id])
    await pool.query(
      `INSERT INTO block_overrides (block_id, decision, decided_by, notes) VALUES ($1, 'approve_sm', $2, $3)`,
      [id, req.user.id, req.body?.notes || null]
    )
    await notifyByRole('financial_manager', 'block_override_pending_fm', id, 'Block override approved by SM. Awaiting FM decision.')
    return ok(res, { override_status: 'pending_fm' })
  } catch (e) {
    console.error('PATCH /api/blocks/:id/override-sm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Financial Manager approval: pending_fm -> pending_tm
router.patch('/:id/override-fm', authMiddleware, requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query('SELECT id, status, override_status FROM blocks WHERE id=$1', [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Block not found')
    const row = cur.rows[0]
    if (row.status !== 'pending') return bad(res, 400, 'Only pending blocks can be overridden')
    if (row.override_status !== 'pending_fm') return bad(res, 400, 'Override stage is not pending Financial Manager')

    await pool.query('UPDATE blocks SET override_status=$1, updated_at=now() WHERE id=$2', ['pending_tm', id])
    await pool.query(
      `INSERT INTO block_overrides (block_id, decision, decided_by, notes) VALUES ($1, 'approve_fm', $2, $3)`,
      [id, req.user.id, req.body?.notes || null]
    )
    // Notify Top-Management (CEO/Chairman/VC/Top Management)
    await notifyByRole('ceo', 'block_override_pending_tm', id, 'Block override approved by FM. Awaiting TM decision.')
    await notifyByRole('chairman', 'block_override_pending_tm', id, 'Block override approved by FM. Awaiting TM decision.')
    await notifyByRole('vice_chairman', 'block_override_pending_tm', id, 'Block override approved by FM. Awaiting TM decision.')
    await notifyByRole('top_management', 'block_override_pending_tm', id, 'Block override approved by FM. Awaiting TM decision.')
    return ok(res, { override_status: 'pending_tm' })
  } catch (e) {
    console.error('PATCH /api/blocks/:id/override-fm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Top-Management approval: can approve regardless of previous stages (bypass allowed)
router.patch('/:id/override-tm', authMiddleware, requireRole(['ceo','chairman','vice_chairman','top_management']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query('SELECT id, status, override_status, requested_by FROM blocks WHERE id=$1', [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Block not found')
    const row = cur.rows[0]
    if (row.status !== 'pending') return bad(res, 400, 'Only pending blocks can be overridden')

    const bypass = row.override_status !== 'pending_tm'
    await pool.query('UPDATE blocks SET override_status=$1, updated_at=now() WHERE id=$2', ['approved', id])
    await pool.query(
      `INSERT INTO block_overrides (block_id, decision, decided_by, notes) VALUES ($1, $2, $3, $4)`,
      [id, bypass ? 'approve_tm_bypass' : 'approve_tm', req.user.id, bypass ? 'TM override approved without prior SM/FM approvals' : (req.body?.notes || null)]
    )
    // Notify FM, SM, and requester
    await notifyByRole('financial_manager', 'block_override_tm_approved', id, 'TM approved block override.')
    await notifyByRole('sales_manager', 'block_override_tm_approved', id, 'TM approved block override.')
    if (row.requested_by) {
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           VALUES ($1, 'block_override_tm_approved', 'blocks', $2, 'TM approved block override for your request.')`,
          [row.requested_by, id]
        )
      } catch (_) {}
    }
    return ok(res, { override_status: 'approved', bypass })
  } catch (e) {
    console.error('PATCH /api/blocks/:id/override-tm error:', e)
    return bad(res, 500, 'Internal error')
  }
})

// Reject override at any stage (SM/FM/TM)
router.patch('/:id/override-reject', authMiddleware, requireRole(['sales_manager','financial_manager','ceo','chairman','vice_chairman','top_management']), async (req, res) => {
  try {
    const id = num(req.params.id)
    if (!id) return bad(res, 400, 'Invalid id')
    const cur = await pool.query('SELECT id, status, requested_by FROM blocks WHERE id=$1', [id])
    if (cur.rows.length === 0) return bad(res, 404, 'Block not found')
    if (cur.rows[0].status !== 'pending') return bad(res, 400, 'Only pending blocks can be overridden')

    await pool.query('UPDATE blocks SET override_status=$1, updated_at=now() WHERE id=$2', ['rejected', id])
    await pool.query(
      `INSERT INTO block_overrides (block_id, decision, decided_by, notes) VALUES ($1, 'reject', $2, $3)`,
      [id, req.user.id, req.body?.notes || null]
    )
    // Notify requester of rejection
    const requester = cur.rows[0].requested_by
    if (requester) {
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           VALUES ($1, 'block_override_rejected', 'blocks', $2, 'Block override has been rejected.')`,
          [requester, id]
        )
      } catch (_) {}
    }
    return ok(res, { override_status: 'rejected' })
  } catch (e) {
    console.error('PATCH /api/blocks/:id/override-reject error:', e)
    return bad(res, 500, 'Internal error')
  }
})

export default router