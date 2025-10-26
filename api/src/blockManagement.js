import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'
import { validate, blockRequestSchema, blockApproveSchema, blockExtendSchema } from './validation.js'

const router = express.Router()

// Defensive: ensure blocks table exists (some envs may have skipped migrations)
async function ensureBlocksSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        duration_days INTEGER NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        blocked_until TIMESTAMPTZ NOT NULL,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_at TIMESTAMPTZ,
        approval_reason TEXT,
        rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rejected_at TIMESTAMPTZ,
        rejection_reason TEXT,
        extension_count INTEGER DEFAULT 0,
        expiry_notified BOOLEAN DEFAULT FALSE,
        last_extension_reason TEXT,
        last_extended_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_extended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_unit ON blocks(unit_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);
      CREATE INDEX IF NOT EXISTS idx_blocks_blocked_until ON blocks(blocked_until);
    `)
  } catch (e) {
    // If this fails, let the request path report 500 with a clear message
    throw e
  }
}

async function createNotification(type, userId, refTable, refId, message) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, refTable, refId, message]
    )
  } catch (e) {
    // notifications table may not exist in all deployments; swallow errors
  }
}

// Request unit block
// NOTE: Router is mounted at /api/blocks, so route paths here must NOT be prefixed with /blocks
router.post('/request', authMiddleware, requireRole(['property_consultant','sales_manager']), validate(blockRequestSchema), async (req, res) => {
  const { unitId, durationDays, reason } = req.body || {}
  try {
    // Ensure schema exists (in case migrations were skipped)
    await ensureBlocksSchema()

    // Validate unit availability
    const unit = await pool.query(
      'SELECT id, code, available FROM units WHERE id = $1',
      [unitId]
    )
    if (unit.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Unit not found' } })
    }
    if (unit.rows[0].available === false) {
      return res.status(400).json({ error: { message: 'Unit is not available for blocking' } })
    }

    // Check existing blocks
    const existingBlock = await pool.query(
      `SELECT id FROM blocks 
       WHERE unit_id = $1 AND status = 'approved' AND blocked_until > NOW()`,
      [unitId]
    )
    if (existingBlock.rows.length > 0) {
      return res.status(400).json({ error: { message: 'Unit is already blocked' } })
    }

    // Enforce business rule: an approved payment plan must exist for this unit before blocking
    const approvedPlan = await pool.query(
      `SELECT id
       FROM payment_plans
       WHERE status='approved'
         AND (details->'calculator'->'unitInfo'->>'unit_id')::int = $1
       ORDER BY id DESC
       LIMIT 1`,
      [unitId]
    )
    if (approvedPlan.rows.length === 0) {
      return res.status(400).json({ error: { message: 'An approved payment plan is required to request a block for this unit.' } })
    }

    // Create block request
    const d = Number(durationDays)
    const result = await pool.query(
      `INSERT INTO blocks (unit_id, requested_by, duration_days, reason, status, blocked_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW() + ($3::int) * INTERVAL '1 day', NOW(), NOW())
       RETURNING *`,
      [unitId, req.user.id, d, reason || null]
    )

    // Notify finance manager(s)
    await createNotification('block_request', req.user.id, 'blocks', result.rows[0].id, 'New block request requires approval')

    return res.json({ ok: true, block: result.rows[0] })
  } catch (error) {
    console.error('Block request error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Approve/reject block request
router.patch('/:id/approve', authMiddleware, requireRole(['financial_manager']), validate(blockApproveSchema), async (req, res) => {
  const { action, reason } = req.body || {} // action: 'approve' or 'reject'
  const blockId = Number(req.params.id)
  if (!Number.isFinite(blockId)) return res.status(400).json({ error: { message: 'Invalid block id' } })

  try {
    const block = await pool.query('SELECT * FROM blocks WHERE id = $1', [blockId])
    if (block.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Block not found' } })
    }
    const row = block.rows[0]
    if (row.status !== 'pending') {
      return res.status(400).json({ error: { message: 'Block request already processed' } })
    }

    if (action === 'approve') {
      // Update block status and unit availability
      await pool.query(
        `UPDATE blocks 
         SET status = 'approved', 
             approved_by = $1, 
             approved_at = NOW(),
             approval_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [req.user.id, reason || null, blockId]
      )
      // Update unit availability and status to BLOCKED
      await pool.query(
        `UPDATE units 
         SET available = FALSE,
             unit_status = 'BLOCKED',
             updated_at = NOW()
         WHERE id = $1`,
        [row.unit_id]
      )
    } else if (action === 'reject') {
      await pool.query(
        `UPDATE blocks 
         SET status = 'rejected', 
             rejected_by = $1, 
             rejected_at = NOW(),
             rejection_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [req.user.id, reason || null, blockId]
      )
    } else {
      return res.status(400).json({ error: { message: 'Invalid action' } })
    }

    // Notify requester
    await createNotification('block_decision', row.requested_by, 'blocks', blockId, `Block request ${action}ed`)

    return res.json({ ok: true, action })
  } catch (error) {
    console.error('Block approval error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get current blocks
router.get('/current', authMiddleware, async (req, res) => {
  try {
    let query = `
      SELECT 
        b.id,
        b.unit_id,
        b.blocked_until,
        b.status,
        b.reason,
        u.code as unit_code,
        u.unit_status,
        u.unit_type,
        usr.email as requested_by_name,
        b.created_at
      FROM blocks b
      JOIN units u ON b.unit_id = u.id
      JOIN users usr ON b.requested_by = usr.id
      WHERE b.status = 'approved' AND b.blocked_until > NOW()
    `
    const params = []

    // Filter by role
    if (req.user.role === 'property_consultant') {
      query += ' AND b.requested_by = $1'
      params.push(req.user.id)
    }

    query += ' ORDER BY b.blocked_until ASC'

    const blocks = await pool.query(query, params)
    return res.json({ ok: true, blocks: blocks.rows })
  } catch (error) {
    console.error('Current blocks error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Extend block duration
router.patch('/:id/extend', authMiddleware, requireRole(['financial_manager']), validate(blockExtendSchema), async (req, res) => {
  const { additionalDays, reason } = req.body || {}
  const blockId = Number(req.params.id)
  if (!Number.isFinite(blockId)) return res.status(400).json({ error: { message: 'Invalid block id' } })
  const add = Number(additionalDays)

  try {
    const block = await pool.query('SELECT * FROM blocks WHERE id = $1 AND status = $2', [blockId, 'approved'])
    if (block.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Active block not found' } })
    }

    // Check extension limits (max 3 extensions, 28 days total)
    const currentBlock = block.rows[0]
    const totalExtensions = Number(currentBlock.extension_count || 0)
    const currentDuration = Number(currentBlock.duration_days || 0) + (totalExtensions * 7)
    const newTotalDuration = currentDuration + (Number.isFinite(add) ? add : 0)

    if (newTotalDuration > 28) {
      return res.status(400).json({ error: { message: 'Maximum block duration (28 days) exceeded' } })
    }
    if (totalExtensions >= 3) {
      return res.status(400).json({ error: { message: 'Maximum extensions (3) reached' } })
    }

    // Update block
    await pool.query(
      `UPDATE blocks 
       SET blocked_until = blocked_until + ($1::text || ' days')::interval,
           extension_count = COALESCE(extension_count, 0) + 1,
           last_extension_reason = $2,
           last_extended_by = $3,
           last_extended_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [add, reason || null, req.user.id, blockId]
    )

    return res.json({ ok: true, message: 'Block extended successfully' })
  } catch (error) {
    console.error('Block extension error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Automatic block expiry job (runs daily)
async function processBlockExpiry() {
  try {
    // Expire blocks that have reached their end date
    const expiredBlocks = await pool.query(
      `UPDATE blocks 
       SET status = 'expired', updated_at=NOW()
       WHERE status = 'approved' AND blocked_until < NOW()
       RETURNING id, unit_id`
    )

    // Make units available again
    for (const block of expiredBlocks.rows) {
      await pool.query(
        `UPDATE units 
         SET available = TRUE,
             unit_status = 'AVAILABLE',
             updated_at = NOW()
         WHERE id = $1`,
        [block.unit_id]
      )
      // Notify finance managers (user_id nullable)
      await createNotification('block_expired', null, 'blocks', block.id, 'Block expired automatically')
    }
    if (expiredBlocks.rows.length > 0) {
      console.log(`[blocks] Processed ${expiredBlocks.rows.length} expired blocks`)
    }
  } catch (error) {
    console.error('Block expiry job error:', error)
  }
}

// Schedule the expiry job to run daily (approx cadence)
setInterval(processBlockExpiry, 24 * 60 * 60 * 1000) // 24 hours

// List pending block requests
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    // Disallow admin/superadmin from block workflows per policy
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }

    // Pending means status='pending' in blocks table
    // Return requester email and unit summary
    const base = `
      SELECT 
        b.id, b.unit_id, b.duration_days, b.reason, b.status, b.blocked_until, b.created_at,
        u.code AS unit_code, u.unit_type, u.model_id, u.available,
        ru.id AS requested_by, ru.email AS requested_by_email, ru.role AS requested_by_role
      FROM blocks b
      JOIN units u ON u.id = b.unit_id
      JOIN users ru ON ru.id = b.requested_by
      WHERE b.status = 'pending'
    `
    const params = []
    let where = ''
    let joinTeam = ''
    // Consultants: only see own
    if (req.user.role === 'property_consultant') {
      where = ' AND b.requested_by = $1'
      params.push(req.user.id)
    } else if (req.user.role === 'sales_manager') {
      // Sales Manager: only see requests from consultants in their team
      joinTeam = ' JOIN sales_team_members stm ON stm.consultant_user_id = b.requested_by AND stm.active = TRUE '
      where = params.length ? ' AND stm.manager_user_id = $2' : ' AND stm.manager_user_id = $1'
      params.push(req.user.id)
    }
    // Financial Managers see all pending
    const q = base.replace('FROM blocks b', `FROM blocks b${joinTeam}`) + where + ' ORDER BY b.created_at DESC'
    const r = await pool.query(q, params)
    return res.json({ ok: true, requests: r.rows })
  } catch (e) {
    console.error('List pending blocks error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Cancel a pending block request
router.patch('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: { message: 'Invalid id' } })

    const r = await pool.query('SELECT id, requested_by, status FROM blocks WHERE id=$1', [id])
    if (r.rows.length === 0) return res.status(404).json({ error: { message: 'Block request not found' } })
    const row = r.rows[0]
    if (row.status !== 'pending') return res.status(400).json({ error: { message: 'Only pending requests can be cancelled' } })

    // Permission:
    // - property_consultant: can cancel only their own
    // - sales_manager: can cancel any pending
    // - others: forbidden
    const role = req.user.role
    const isOwner = row.requested_by === req.user.id
    const canCancel = (role === 'sales_manager') || (role === 'property_consultant' && isOwner)
    if (!canCancel) return res.status(403).json({ error: { message: 'Forbidden' } })

    await pool.query(
      `UPDATE blocks 
       SET status='rejected', rejected_by=$1, rejected_at=NOW(), rejection_reason=COALESCE($2, 'Cancelled by requester'), updated_at=NOW()
       WHERE id=$3`,
      [req.user.id, req.body?.reason || null, id]
    )

    await createNotification('block_cancelled', row.requested_by, 'blocks', id, 'Block request was cancelled')
    return res.json({ ok: true })
  } catch (e) {
    console.error('Cancel block request error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router