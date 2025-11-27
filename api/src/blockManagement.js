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
        requested_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
        financial_decision TEXT,
        financial_checked_at TIMESTAMPTZ,
        override_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_unit ON blocks(unit_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);
      CREATE INDEX IF NOT EXISTS idx_blocks_blocked_until ON blocks(blocked_until);
      -- Unblock workflow columns (idempotent)
      ALTER TABLE blocks
        ADD COLUMN IF NOT EXISTS unblock_status TEXT,
        ADD COLUMN IF NOT EXISTS unblock_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS unblock_requested_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS unblock_reason TEXT,
        ADD COLUMN IF NOT EXISTS unblock_fm_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS unblock_fm_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS unblock_tm_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS unblock_tm_at TIMESTAMPTZ;
    `)
  } catch (e) {
    throw e
  }
}

async function createNotification(type, userId, refTable, refId, message) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, type, refTable, refId, message]
    )
  } catch (_) {}
}

// Request unit block
router.post(
  '/request',
  authMiddleware,
  requireRole(['property_consultant','sales_manager']),
  validate(blockRequestSchema),
  async (req, res) => {
    const { unitId, durationDays, reason } = req.body || {}
    try {
      await ensureBlocksSchema()

      // Validate unit
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

      // Already blocked?
      const existingBlock = await pool.query(
        `SELECT id FROM blocks 
         WHERE unit_id = $1 AND status = 'approved' AND blocked_until > NOW()`,
        [unitId]
      )
      if (existingBlock.rows.length > 0) {
        return res.status(400).json({ error: { message: 'Unit is already blocked' } })
      }

      // Require an approved payment plan for this unit (match by unit_id or unit_code, whitespace tolerant)
      const approvedPlan = await pool.query(
        `
        WITH target AS (
          SELECT $1::int AS unit_id, TRIM(u.code) AS unit_code
          FROM units u
          WHERE u.id = $1
        )
        SELECT pp.id, pp.details
        FROM payment_plans pp, target t
        WHERE pp.status='approved'
          AND (
            (
              TRIM(COALESCE(pp.details->'calculator'->'unitInfo'->>'unit_id','')) ~ '^[0-9]+$'
              AND (TRIM(pp.details->'calculator'->'unitInfo'->>'unit_id')::int = t.unit_id)
            )
            OR (
              TRIM(COALESCE(pp.details->'calculator'->'unitInfo'->>'unit_code','')) = t.unit_code
            )
          )
        ORDER BY pp.id DESC
        LIMIT 1
        `,
        [unitId]
      )

      let hasValidPlan = approvedPlan.rows.length > 0
      let planDetails = approvedPlan.rows[0]?.details || {}
      let planId = approvedPlan.rows[0]?.id || null

      // Fallback: Check for a valid Deal (Draft or Pending) with ACCEPT decision
      if (!hasValidPlan) {
        const validDeal = await pool.query(
          `
          SELECT d.id, d.details
          FROM deals d
          WHERE d.created_by = $1
            AND d.status NOT IN ('rejected', 'cancelled')
            AND (d.details->'calculator'->'unitInfo'->>'unit_id')::int = $2
            AND d.details->'calculator'->'generatedPlan'->'evaluation'->>'decision' = 'ACCEPT'
          ORDER BY d.id DESC
          LIMIT 1
          `,
          [req.user.id, unitId]
        )
        if (validDeal.rows.length > 0) {
          hasValidPlan = true
          planDetails = validDeal.rows[0].details || {}
          // planId remains null as there is no payment_plans row
        }
      }

      if (!hasValidPlan) {
        return res.status(400).json({ error: { message: 'An approved payment plan (or valid Deal) is required to request a block for this unit.' } })
      }

      const decision = planDetails?.calculator?.generatedPlan?.evaluation?.decision || null

      // Use default of 7 days if not provided
      const d = Number(durationDays) || 7
      const ins = await pool.query(
        `
        INSERT INTO blocks (
          unit_id, requested_by, duration_days, reason, status, blocked_until,
          created_at, updated_at, requested_plan_id, financial_decision, financial_checked_at, override_status
        )
        VALUES (
          $1, $2, $3, $4, 'pending', NOW() + ($3::int) * INTERVAL '1 day',
          NOW(), NOW(), $5, $6, NOW(), $7
        )
        RETURNING *
        `,
        [unitId, req.user.id, d, reason || null, planId, decision, (decision === 'ACCEPT') ? null : 'pending_sm']
      )

      // Notifications
      if (decision !== 'ACCEPT') {
        await createNotification('block_override_requested', req.user.id, 'blocks', ins.rows[0].id, 'Block override requested (pending Sales Manager).')
        try {
          await pool.query(
            `
            INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
            SELECT u.id, 'block_override_requested_tm', 'blocks', $1, 'Block override requested by consultant. You may approve directly (TM bypass).'
            FROM users u
            WHERE u.role IN ('ceo','chairman','vice_chairman','top_management') AND u.active=TRUE
            `,
            [ins.rows[0].id]
          )
        } catch (_) {}
      } else {
        await createNotification('block_request', req.user.id, 'blocks', ins.rows[0].id, 'New block request requires approval')
      }

      return res.json({ ok: true, block: ins.rows[0] })
    } catch (error) {
      console.error('Block request error:', error)
      return res.status(500).json({ error: { message: 'Internal error' } })
    }
  }
)

// Request unit unblock (Consultant/Sales Manager → FM)
router.post(
  '/request-unblock',
  authMiddleware,
  requireRole(['property_consultant','sales_manager']),
  async (req, res) => {
    const { unitId, reason } = req.body || {}
    try {
      await ensureBlocksSchema()

      const uRes = await pool.query(
        'SELECT id, code, available, unit_status FROM units WHERE id = $1',
        [unitId]
      )
      if (uRes.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Unit not found' } })
      }

      const unit = uRes.rows[0]

      // Find the active approved block for this unit
      const bRes = await pool.query(
        `SELECT * FROM blocks
         WHERE unit_id = $1
           AND status = 'approved'
           AND blocked_until > NOW()
         ORDER BY id DESC
         LIMIT 1`,
        [unitId]
      )
      if (bRes.rows.length === 0) {
        return res.status(400).json({ error: { message: 'No active approved block found for this unit.' } })
      }
      const block = bRes.rows[0]

      if (block.unblock_status && block.unblock_status !== 'rejected') {
        return res.status(400).json({ error: { message: 'An unblock request already exists for this block.' } })
      }

      await pool.query(
        `UPDATE blocks
         SET unblock_status = 'pending_fm',
             unblock_requested_by = $1,
             unblock_requested_at = NOW(),
             unblock_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [req.user.id, reason || null, block.id]
      )

      // Notify Financial Manager
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           SELECT u.id, 'unblock_request_pending_fm', 'blocks', $1,
                  'Unblock request submitted for unit ' || $2
           FROM users u
           WHERE u.role = 'financial_manager' AND u.active = TRUE`,
          [block.id, unit.code || unit.id]
        )
      } catch (_) {}

      return res.json({ ok: true, block_id: block.id })
    } catch (error) {
      console.error('Unblock request error:', error)
      return res.status(500).json({ error: { message: 'Internal error' } })
    }
  }
)

// List pending unblock requests (FM / TM views)
router.get('/unblock-pending', authMiddleware, async (req, res) => {
  try {
    await ensureBlocksSchema()

    const role = req.user.role
    if (role === 'admin' || role === 'superadmin' || role === 'property_consultant' || role === 'sales_manager') {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }

    let statuses = []
    if (role === 'financial_manager') {
      statuses = ['pending_fm']
    } else if (['ceo','chairman','vice_chairman','top_management'].includes(role)) {
      // TM can see both pending_fm (for direct override) and pending_tm
      statuses = ['pending_fm','pending_tm']
    } else {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }

    const r = await pool.query(
      `
      SELECT
        b.id,
        b.unit_id,
        u.code AS unit_code,
        u.unit_type,
        b.unblock_status,
        b.unblock_reason,
        b.unblock_requested_at,
        b.unblock_fm_id,
        b.unblock_tm_id,
        ru.email AS requested_by_email
      FROM blocks b
      JOIN units u ON u.id = b.unit_id
      LEFT JOIN users ru ON ru.id = b.unblock_requested_by
      WHERE b.status = 'approved'
        AND b.unblock_status = ANY($1::text[])
      ORDER BY b.unblock_requested_at DESC NULLS LAST, b.id DESC
      `,
      [statuses]
    )

    return res.json({ ok: true, requests: r.rows })
  } catch (error) {
    console.error('List unblock-pending error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// FM approve unblock (moves to TM) – Financial Manager
router.patch(
  '/:id/unblock-fm-approve',
  authMiddleware,
  requireRole(['financial_manager']),
  async (req, res) => {
    const blockId = Number(req.params.id)
    if (!Number.isFinite(blockId)) return res.status(400).json({ error: { message: 'Invalid block id' } })
    try {
      await ensureBlocksSchema()
      const bRes = await pool.query('SELECT * FROM blocks WHERE id = $1', [blockId])
      if (bRes.rows.length === 0) return res.status(404).json({ error: { message: 'Block not found' } })
      const row = bRes.rows[0]
      if (row.status !== 'approved') return res.status(400).json({ error: { message: 'Only approved blocks can be unblocked' } })
      if (row.unblock_status !== 'pending_fm') {
        return res.status(400).json({ error: { message: 'Unblock request is not pending FM approval' } })
      }

      await pool.query(
        `UPDATE blocks
         SET unblock_status = 'pending_tm',
             unblock_fm_id = $1,
             unblock_fm_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [req.user.id, blockId]
      )

      // Notify Top Management that an unblock request is pending their decision
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           SELECT u.id, 'unblock_request_pending_tm', 'blocks', $1,
                  'Unblock request approved by Financial Manager and pending TM decision.'
           FROM users u
           WHERE u.role IN ('ceo','chairman','vice_chairman','top_management') AND u.active = TRUE`,
          [blockId]
        )
      } catch (_) {}

      return res.json({ ok: true, unblock_status: 'pending_tm' })
    } catch (error) {
      console.error('Unblock FM approve error:', error)
      return res.status(500).json({ error: { message: 'Internal error' } })
    }
  }
)

// FM/TM reject unblock request
router.patch(
  '/:id/unblock-reject',
  authMiddleware,
  requireRole(['financial_manager','ceo','chairman','vice_chairman','top_management']),
  async (req, res) => {
    const blockId = Number(req.params.id)
    if (!Number.isFinite(blockId)) return res.status(400).json({ error: { message: 'Invalid block id' } })
    const reason = (req.body && req.body.reason) || null
    try {
      await ensureBlocksSchema()
      const bRes = await pool.query('SELECT * FROM blocks WHERE id = $1', [blockId])
      if (bRes.rows.length === 0) return res.status(404).json({ error: { message: 'Block not found' } })
      const row = bRes.rows[0]
      if (row.status !== 'approved') return res.status(400).json({ error: { message: 'Only approved blocks can be unblocked' } })
      if (!row.unblock_status || row.unblock_status === 'approved' || row.unblock_status === 'rejected') {
        return res.status(400).json({ error: { message: 'No pending unblock request to reject' } })
      }

      await pool.query(
        `UPDATE blocks
         SET unblock_status = 'rejected',
             updated_at = NOW()
         WHERE id = $1`,
        [blockId]
      )

      // Notify requester that unblock was rejected, with a remark when TM overrides FM
      try {
        if (row.unblock_requested_by) {
          const actorRole = (req.user && req.user.role) || ''
          const fmApproved = !!row.unblock_fm_id
          let baseMsg = 'Unblock request was rejected.'
          if (actorRole === 'financial_manager') {
            baseMsg = 'Unblock request was rejected by Financial Manager.'
          } else if (['ceo','chairman','vice_chairman','top_management'].includes(actorRole)) {
            baseMsg = fmApproved
              ? 'Unblock request was rejected by Top Management after FM approval.'
              : 'Unblock request was rejected by Top Management (FM stage bypassed).'
          }
          const finalMsg = reason ? `${baseMsg} Reason: ${reason}` : baseMsg
          await pool.query(
            `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
             VALUES ($1, 'unblock_request_rejected', 'blocks', $2, $3)`,
            [row.unblock_requested_by, blockId, finalMsg]
          )
        }
      } catch (_) {}

      return res.json({ ok: true, unblock_status: 'rejected' })
    } catch (error) {
      console.error('Unblock reject error:', error)
      return res.status(500).json({ error: { message: 'Internal error' } })
    }
  }
)

// TM approve unblock (actually unblocks unit)
// TM can either:
// - Approve a normal flow (unblock_status='pending_tm'), or
// - Override and approve directly when unblock_status='pending_fm' (FM not yet approved).
router.patch(
  '/:id/unblock-tm-approve',
  authMiddleware,
  requireRole(['ceo', 'chairman', 'vice_chairman', 'top_management']),
  async (req, res) => {
    const blockId = Number(req.params.id)
    if (!Number.isFinite(blockId)) return res.status(400).json({ error: { message: 'Invalid block id' } })
    try {
      await ensureBlocksSchema()
      const bRes = await pool.query('SELECT * FROM blocks WHERE id = $1', [blockId])
      if (bRes.rows.length === 0) return res.status(404).json({ error: { message: 'Block not found' } })
      const row = bRes.rows[0]
      if (row.status !== 'approved') return res.status(400).json({ error: { message: 'Only approved blocks can be unblocked' } })

      const statusBefore = row.unblock_status || null
      const normalFlow = statusBefore === 'pending_tm'
      const overrideFlow = statusBefore === 'pending_fm'

      if (!normalFlow && !overrideFlow) {
        return res.status(400).json({ error: { message: 'Unblock request is not pending FM or TM for TM approval' } })
      }

      await pool.query(
        `UPDATE blocks
         SET unblock_status = 'approved',
             unblock_tm_id = $1,
             unblock_tm_at = NOW(),
             status = 'expired',
             blocked_until = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [req.user.id, blockId]
      )
      await pool.query(
        `UPDATE units
         SET available = TRUE,
         unit_status = 'AVAILABLE',
         updated_at = NOW()
         WHERE id = $1`,
        [row.unit_id]
      )

      // Notify requester and FM, including note when TM bypassed FM
      try {
        const baseMsgRequester = 'Top Management approved your unblock request.'
        const baseMsgFM = 'Top Management approved unblock request and unit is now AVAILABLE.'
        const suffix = overrideFlow ? ' (TM override: FM stage bypassed).' : ''

        if (row.unblock_requested_by) {
          await pool.query(
            `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
             VALUES ($1, 'unblock_request_approved', 'blocks', $2, $3)`,
            [row.unblock_requested_by, blockId, baseMsgRequester + suffix]
          )
        }
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           SELECT u.id, 'unblock_request_approved', 'blocks', $1, $2
           FROM users u
           WHERE u.role = 'financial_manager' AND u.active = TRUE`,
          [blockId, baseMsgFM + suffix]
        )
      } catch (_) {}

      return res.json({ ok: true, unblock_status: 'approved', tm_override: overrideFlow })
    } catch (error) {
      console.error('Unblock TM approve error:', error)
      return res.status(500).json({ error: { message: 'Internal error' } })
    }
  }
)

// FM approve/reject
router.patch('/:id/approve', authMiddleware, requireRole(['financial_manager']), validate(blockApproveSchema), async (req, res) => {
  const { action, reason } = req.body || {}
  const blockId = Number(req.params.id)
  if (!Number.isFinite(blockId)) return res.status(400).json({ error: { message: 'Invalid block id' } })

  try {
    const block = await pool.query('SELECT * FROM blocks WHERE id = $1', [blockId])
    if (block.rows.length === 0) return res.status(404).json({ error: { message: 'Block not found' } })
    const row = block.rows[0]
    if (row.status !== 'pending') return res.status(400).json({ error: { message: 'Block request already processed' } })

    if (action === 'approve') {
      const finOk = String(row.financial_decision || '').toUpperCase() === 'ACCEPT'
      const overrideOk = String(row.override_status || '') === 'approved'
      if (!finOk && !overrideOk) {
        return res.status(400).json({ error: { message: 'Cannot approve block: financial criteria not met and no override approval present' } })
      }

      await pool.query(
        `
        UPDATE blocks
        SET status = 'approved',
            approved_by = $1,
            approved_at = NOW(),
            approval_reason = $2,
            updated_at = NOW()
        WHERE id = $3
        `,
        [req.user.id, reason || null, blockId]
      )
      await pool.query(
        `
        UPDATE units
        SET available = FALSE,
            unit_status = 'BLOCKED',
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.unit_id]
      )

      // Normal path: if financial criteria are met (ACCEPT) and no override was needed,
      // automatically set the latest matching deal for this unit to approved so the
      // consultant sees the offer as approved once the unit is blocked. In addition,
      // ensure there is an approved payment_plan row that exactly mirrors the deal
            if (deal.status !== 'approved') {
              const upd = await pool.query(
                `UPDATE deals SET status='approved', updated_at=NOW() WHERE id=$1 RETURNING id, status`,
                [deal.id]
              )
              const updated = upd.rows[0]
              if (updated) {
                await pool.query(
                  `INSERT INTO deal_history (deal_id, user_id, action, notes)
                   VALUES ($1, $2, $3, $4)`,
                  [
                    updated.id,
                    req.user.id,
                    'auto_approved_on_block',
                    JSON.stringify({
                      event: 'auto_approved_on_block',
                      by: { id: req.user.id, role: req.user.role },
                      reason: 'Block approved with financial decision ACCEPT and no override',
                      at: new Date().toISOString()
                    })
                  ]
                )
              }
            }

            // 2) Ensure there is an approved payment_plan that exactly mirrors this deal's snapshot
            try {
              const existingPlan = await pool.query(
                `
                SELECT id
                FROM payment_plans
                WHERE deal_id = $1
                  AND status = 'approved'
                ORDER BY id DESC
                LIMIT 1
                `,
                [deal.id]
              )
              if (existingPlan.rows.length === 0) {
                await pool.query(
                  `
                  INSERT INTO payment_plans (deal_id, details, created_by, status)
                  VALUES ($1, $2, $3, 'approved')
                  `,
                  [deal.id, deal.details || {}, deal.created_by]
                )
              }
            } catch (planErr) {
              console.warn('Auto-create approved payment_plan on block error:', planErr?.message || planErr)
            }
          }
        } catch (autoErr) {
          console.warn('Auto-approve deal on block error:', autoErr?.message || autoErr)
        }
      }
    } else if (action === 'reject') {
      await pool.query(
        `
        UPDATE blocks
        SET status = 'rejected',
            rejected_by = $1,
            rejected_at = NOW(),
            rejection_reason = $2,
            updated_at = NOW()
        WHERE id = $3
        `,
        [req.user.id, reason || null, blockId]
      )
    } else {
      return res.status(400).json({ error: { message: 'Invalid action' } })
    }

    await createNotification('block_decision', row.requested_by, 'blocks', blockId, `Block request ${action}ed`)
    return res.json({ ok: true, action })
  } catch (error) {
    console.error('Block approval error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Current blocks
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

// Pending requests (role-aware)
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }

    const base = `
      SELECT
        b.id, b.unit_id, b.duration_days, b.reason, b.status, b.blocked_until, b.created_at,
        b.override_status, b.financial_decision,
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
    if (req.user.role === 'property_consultant') {
      where = ' AND b.requested_by = $1'
      params.push(req.user.id)
    } else if (req.user.role === 'sales_manager') {
      joinTeam = ' JOIN sales_team_members stm ON stm.consultant_user_id = b.requested_by AND stm.active = TRUE '
      where = params.length ? ' AND stm.manager_user_id = $2' : ' AND stm.manager_user_id = $1'
      params.push(req.user.id)
    }
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

    const role = req.user.role
    const isOwner = row.requested_by === req.user.id
    const canCancel = (role === 'sales_manager') || (role === 'property_consultant' && isOwner)

    if (!canCancel) return res.status(403).json({ error: { message: 'Forbidden' } })

    await pool.query(
      `
      UPDATE blocks
      SET status='rejected', rejected_by=$1, rejected_at=NOW(), rejection_reason=COALESCE($2, 'Cancelled by requester'), updated_at=NOW()
      WHERE id=$3
      `,
      [req.user.id, req.body?.reason || null, id]
    )

    await createNotification('block_cancelled', row.requested_by, 'blocks', id, 'Block request was cancelled')
    return res.json({ ok: true })
  } catch (e) {
    console.error('Cancel block request error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Extend block duration (FM)
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

    await pool.query(
      `
      UPDATE blocks
      SET blocked_until = blocked_until + ($1::text || ' days')::interval,
          extension_count = COALESCE(extension_count, 0) + 1,
          last_extension_reason = $2,
          last_extended_by = $3,
          last_extended_at = NOW(),
          updated_at = NOW()
      WHERE id = $4
      `,
      [add, reason || null, req.user.id, blockId]
    )

    return res.json({ ok: true, message: 'Block extended successfully' })
  } catch (error) {
    console.error('Block extension error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Automatic block expiry job (daily)
async function processBlockExpiry() {
  try {
    const expiredBlocks = await pool.query(
      `
      UPDATE blocks
      SET status = 'expired', updated_at=NOW()
      WHERE status = 'approved' AND blocked_until < NOW()
      RETURNING id, unit_id
      `
    )
    for (const block of expiredBlocks.rows) {
      await pool.query(
        `
        UPDATE units
        SET available = TRUE,
            unit_status = 'AVAILABLE',
            updated_at = NOW()
        WHERE id = $1
        `,
        [block.unit_id]
      )
      await createNotification('block_expired', null, 'blocks', block.id, 'Block expired automatically')
    }
    if (expiredBlocks.rows.length > 0) {
      console.log(`[blocks] Processed ${expiredBlocks.rows.length} expired blocks`)
    }
  } catch (error) {
    console.error('Block expiry job error:', error)
  }
}
setInterval(processBlockExpiry, 24 * 60 * 60 * 1000)

export default router