import express from 'express'
import { pool } from './db.js'
import { authMiddleware, adminOnly } from './authRoutes.js'
import { validate, dealCreateSchema, dealUpdateSchema, dealSubmitSchema, dealRejectSchema, overrideRequestSchema, overrideApproveSchema, editRequestSchema, editsAddressedSchema } from './validation.js'
import { emitNotification } from './socket.js'

const router = express.Router()

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

async function logHistory(dealId, userId, action, notes = null) {
  await pool.query(
    'INSERT INTO deal_history (deal_id, user_id, action, notes) VALUES ($1, $2, $3, $4)',
    [dealId, userId, action, notes]
  )
}

// Helper: update acceptability flags on a deal (optional, from client-calculated values)
async function setAcceptabilityFlags(id, flags, user) {
  if (!flags || typeof flags !== 'object') return null
  const {
    acceptable_pv,
    acceptable_first_year,
    acceptable_second_year,
    acceptable_handover
  } = flags
  const upd = await pool.query(
    `UPDATE deals
      SET acceptable_pv=$1,
          acceptable_first_year=$2,
          acceptable_second_year=$3,
          acceptable_handover=$4,
          updated_at=now()
      WHERE id=$5
      RETURNING *`,
    [
      acceptable_pv == null ? null : !!acceptable_pv,
      acceptable_first_year == null ? null : !!acceptable_first_year,
      acceptable_second_year == null ? null : !!acceptable_second_year,
      acceptable_handover == null ? null : !!acceptable_handover,
      id
    ]
  )
  const note = {
    event: 'acceptability_flags_set',
    by: { id: user.id, role: user.role },
    flags: { acceptable_pv, acceptable_first_year, acceptable_second_year, acceptable_handover },
    at: new Date().toISOString()
  }
  await logHistory(id, user.id, 'acceptability_flags_set', JSON.stringify(note))
  return upd.rows[0]
}

function toNumber(v) {
  const n = Number(v)
  return isFinite(n) ? n : null
}

// List deals with optional filtering, pagination and sort
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      status,
      search,
      creatorId,
      creatorEmail,
      reviewerId,
      reviewerEmail,
      approverId,
      approverEmail,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      unitType,
      sortBy,
      sortDir
    } = req.query

    const page = Math.max(1, parseInt(req.query.page || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)))
    const offset = (page - 1) * pageSize

    const where = []
    const params = []

    if (status && typeof status === 'string') {
      params.push(status)
      where.push(`d.status = $${params.length}`)
    }
    if (search && typeof search === 'string' && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`)
      where.push(`(LOWER(d.title) LIKE $${params.length})`)
    }
    if (creatorId && toNumber(creatorId)) {
      params.push(toNumber(creatorId))
      where.push(`d.created_by = $${params.length}`)
    }
    if (creatorEmail && typeof creatorEmail === 'string' && creatorEmail.trim()) {
      params.push(creatorEmail.trim().toLowerCase())
      where.push(`EXISTS (SELECT 1 FROM users cu WHERE cu.id=d.created_by AND LOWER(cu.email) = $${params.length})`)
    }
    if (reviewerId && toNumber(reviewerId)) {
      params.push(toNumber(reviewerId))
      where.push(`EXISTS (SELECT 1 FROM deal_history h WHERE h.deal_id=d.id AND h.action='submit' AND h.user_id=$${params.length})`)
    }
    if (reviewerEmail && typeof reviewerEmail === 'string' && reviewerEmail.trim()) {
      params.push(reviewerEmail.trim().toLowerCase())
      where.push(`EXISTS (
        SELECT 1 FROM deal_history h
        JOIN users ru ON ru.id = h.user_id
        WHERE h.deal_id=d.id AND h.action='submit' AND LOWER(ru.email) = $${params.length}
      )`)
    }
    if (approverId && toNumber(approverId)) {
      params.push(toNumber(approverId))
      where.push(`EXISTS (SELECT 1 FROM deal_history h WHERE h.deal_id=d.id AND h.action='approve' AND h.user_id=$${params.length})`)
    }
    if (approverEmail && typeof approverEmail === 'string' && approverEmail.trim()) {
      params.push(approverEmail.trim().toLowerCase())
      where.push(`EXISTS (
        SELECT 1 FROM deal_history h
        JOIN users au ON au.id = h.user_id
        WHERE h.deal_id=d.id AND h.action='approve' AND LOWER(au.email) = $${params.length}
      )`)
    }
    if (startDate) {
      params.push(new Date(startDate))
      where.push(`d.created_at >= $${params.length}`)
    }
    if (endDate) {
      params.push(new Date(endDate))
      where.push(`d.created_at <= $${params.length}`)
    }
    if (minAmount && toNumber(minAmount) != null) {
      params.push(toNumber(minAmount))
      where.push(`d.amount >= $${params.length}`)
    }
    if (maxAmount && toNumber(maxAmount) != null) {
      params.push(toNumber(maxAmount))
      where.push(`d.amount <= $${params.length}`)
    }
    if (unitType && typeof unitType === 'string' && unitType.trim()) {
      params.push(unitType.trim())
      where.push(`d.unit_type = $${params.length}`)
    }

    // Role-based visibility: non-elevated users can only see their own deals
    const elevatedRoles = new Set(['admin', 'superadmin', 'sales_manager', 'financial_manager'])
    const isElevated = elevatedRoles.has(req.user?.role)
    if (!isElevated) {
      params.push(req.user.id)
      where.push(`d.created_by = $${params.length}`)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sortCols = {
      id: 'd.id',
      title: 'd.title',
      amount: 'd.amount',
      status: 'd.status',
      created_at: 'd.created_at',
      updated_at: 'd.updated_at'
    }
    const sortCol = sortCols[String(sortBy || '').toLowerCase()] || 'd.id'
    const dir = String(sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const countSql = `SELECT COUNT(*)::int AS c FROM deals d ${whereSql}`
    const countRes = await pool.query(countSql, params)
    const total = countRes.rows[0]?.c || 0

    params.push(pageSize)
    params.push(offset)
    const listSql = `
      SELECT d.*, u.email as created_by_email
      FROM deals d
      LEFT JOIN users u ON u.id = d.created_by
      ${whereSql}
      ORDER BY ${sortCol} ${dir}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `
    const rows = await pool.query(listSql, params)

    return res.json({ ok: true, deals: rows.rows, pagination: { page, pageSize, total } })
  } catch (e) {
    console.error('GET /api/deals error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Focused: pending approval for Sales Manager review
router.get('/pending-sm', authMiddleware, async (req, res) => {
  try {
    const role = req.user?.role
    if (!(role === 'sales_manager' || role === 'admin' || role === 'superadmin')) {
      return res.status(403).json({ error: { message: 'Sales Manager role required' } })
    }
    // Include reviewer names (from meta->>'name' or fallback to email) and positions (roles) for timeline tooltips.
    const rows = await pool.query(
      `SELECT 
         d.*,
         cu.email AS created_by_email,
         COALESCE(mu.meta->>'name', mu.email) AS manager_review_by_name,
         mu.role AS manager_review_by_role,
         COALESCE(fu.meta->>'name', fu.email) AS fm_review_by_name,
         fu.role AS fm_review_by_role,
         COALESCE(tu.meta->>'name', tu.email) AS override_approved_by_name,
         tu.role AS override_approved_by_role
       FROM deals d
       LEFT JOIN users cu ON cu.id = d.created_by
       LEFT JOIN users mu ON mu.id = d.manager_review_by
       LEFT JOIN users fu ON fu.id = d.fm_review_by
       LEFT JOIN users tu ON tu.id = d.override_approved_by
       WHERE d.status='pending_approval'
       ORDER BY d.id DESC`
    )
    return res.json({ ok: true, deals: rows.rows })
  } catch (e) {
    console.error('GET /api/deals/pending-sm error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Convenience: my deals (created_by = current user)
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT d.*, u.email as created_by_email
       FROM deals d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.created_by=$1
       ORDER BY d.id DESC`,
      [req.user.id]
    )
    return res.json({ ok: true, deals: rows.rows })
  } catch (e) {
    console.error('GET /api/deals/my error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Client alias: some legacy clients call /api/deals/my-proposals — map to /my for compatibility
router.get('/my-proposals', authMiddleware, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT d.*, u.email as created_by_email
       FROM deals d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.created_by=$1
       ORDER BY d.id DESC`,
      [req.user.id]
    )
    return res.json({ ok: true, deals: rows.rows })
  } catch (e) {
    console.error('GET /api/deals/my-proposals error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get single deal by id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const q = await pool.query(
      `SELECT 
         d.*,
    const elevatedRoles = new Set(['admin', 'superadmin', 'sales_manager', 'financial_manager'])
    const isElevated = elevatedRoles.has(req.user?.role)
    if (!isElevated && deal.created_by !== req.user.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }
    return res.json({ ok: true, deal })
  } catch (e) {
    console.error('GET /api/deals/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Deal history
router.get('/:id/history', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const rows = await pool.query(
      `SELECT h.*, u.email as user_email
       FROM deal_history h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.deal_id=$1
       ORDER BY h.id ASC`,
      [id]
    )
    return res.json({ ok: true, history: rows.rows })
  } catch (e) {
    console.error('GET /api/deals/:id/history error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Create a new deal (any authenticated user)
router.post('/', authMiddleware, validate(dealCreateSchema), async (req, res) => {
  try {
    const { title, amount, details, unitType, salesRepId, policyId } = req.body || {}
    const amt = Number(amount || 0)
    const det = isObject(details) ? details : {}

    // Enforce: creating an offer/deal requires a generated payment plan from the calculator
    const plan = det?.calculator?.generatedPlan
    const hasPlan = !!(plan && Array.isArray(plan.schedule) && plan.schedule.length > 0)
    if (!hasPlan) {
      return res.status(400).json({ error: { message: 'A generated payment plan is required to create an offer.' } })
    }

    // Enforce: offers can only be created for AVAILABLE units
    const unitIdRaw = det?.calculator?.unitInfo?.unit_id
    const unitId = Number(unitIdRaw)
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return res.status(400).json({ error: { message: 'Unit selection is required to create an offer.' } })
    }
    const unitRow = await pool.query(
      `SELECT id, available, unit_status FROM units WHERE id=$1`,
      [unitId]
    )
    if (unitRow.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Unit not found' } })
    }
    const available = unitRow.rows[0].available === true && String(unitRow.rows[0].unit_status || '').toUpperCase() === 'AVAILABLE'
    if (!available) {
      return res.status(400).json({ error: { message: 'Offers can only be created for AVAILABLE units.' } })
    }

    const result = await pool.query(
      'INSERT INTO deals (title, amount, details, unit_type, sales_rep_id, policy_id, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [title.trim(), isFinite(amt) ? amt : 0, det, unitType || null, salesRepId || null, policyId || null, 'draft', req.user.id]
    )
    const deal = result.rows[0]
    const note = {
      event: 'deal_created',
      by: { id: req.user.id, role: req.user.role },
      fields: {
        title: deal.title,
        amount: Number(deal.amount || 0),
        unit_type: deal.unit_type || null,
        sales_rep_id: deal.sales_rep_id || null,
        policy_id: deal.policy_id || null
      },
      createdAt: new Date().toISOString()
    }
    await logHistory(deal.id, req.user.id, 'create', JSON.stringify(note))
    return res.json({ ok: true, deal })
  } catch (e) {
    console.error('POST /api/deals error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Modify an existing deal (only if status is draft; owner or admin)
router.patch('/:id', authMiddleware, validate(dealUpdateSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { title, amount, details, unitType, salesRepId, policyId } = req.body || {}
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]
    const isOwner = deal.created_by === req.user.id
    const isAdmin = req.user.role === 'admin'
    if (deal.status !== 'draft') return res.status(400).json({ error: { message: 'Only draft deals can be modified' } })
    if (!isOwner && !isAdmin) return res.status(403).json({ error: { message: 'Forbidden' } })

    const newTitle = typeof title === 'string' && title.trim() ? title.trim() : deal.title
    const newAmount = amount != null && isFinite(Number(amount)) ? Number(amount) : deal.amount
    const newDetails = isObject(details) ? details : deal.details
    const newUnitType = typeof unitType === 'string' && unitType.trim() ? unitType.trim() : deal.unit_type
    const newSalesRepId = salesRepId !== undefined ? (salesRepId || null) : deal.sales_rep_id
    const newPolicyId = policyId !== undefined ? (policyId || null) : deal.policy_id

    const upd = await pool.query(
      'UPDATE deals SET title=$1, amount=$2, details=$3, unit_type=$4, sales_rep_id=$5, policy_id=$6 WHERE id=$7 RETURNING *',
      [newTitle, newAmount, newDetails, newUnitType, newSalesRepId, newPolicyId, id]
    )
    const updated = upd.rows[0]
    const changed = {}
    if (deal.title !== updated.title) changed.title = { from: deal.title, to: updated.title }
    if (Number(deal.amount) !== Number(updated.amount)) changed.amount = { from: Number(deal.amount), to: Number(updated.amount) }
    if ((deal.unit_type || null) !== (updated.unit_type || null)) changed.unit_type = { from: deal.unit_type || null, to: updated.unit_type || null }
    if ((deal.sales_rep_id || null) !== (updated.sales_rep_id || null)) changed.sales_rep_id = { from: deal.sales_rep_id || null, to: updated.sales_rep_id || null }
    if ((deal.policy_id || null) !== (updated.policy_id || null)) changed.policy_id = { from: deal.policy_id || null, to: updated.policy_id || null }
    const detailsChanged = JSON.stringify(deal.details || {}) !== JSON.stringify(updated.details || {})
    const note = {
      event: 'deal_modified',
      by: { id: req.user.id, role: req.user.role },
      changed,
      detailsChanged,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'modify', JSON.stringify(note))
    return res.json({ ok: true, deal: updated })
  } catch (e) {
    console.error('PATCH /api/deals/:id error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Submit for approval (only from draft -> pending_approval; owner or admin)
router.post('/:id/submit', authMiddleware, validate(dealSubmitSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]
    const isOwner = deal.created_by === req.user.id
    const isAdmin = req.user.role === 'admin'
    if (!isOwner && !isAdmin) return res.status(403).json({ error: { message: 'Forbidden' } })
    if (deal.status !== 'draft') return res.status(400).json({ error: { message: 'Deal must be draft to submit' } })

    // Enforce: submitted deals must contain a generated payment plan
    try {
      const det = deal.details || {}
      const plan = det?.calculator?.generatedPlan
      const hasPlan = !!(plan && Array.isArray(plan.schedule) && plan.schedule.length > 0)
      if (!hasPlan) {
        return res.status(400).json({ error: { message: 'A generated payment plan is required to submit an offer.' } })
      }
      // Also enforce that the unit is AVAILABLE at submission time
      const unitId = Number(det?.calculator?.unitInfo?.unit_id)
      if (!Number.isFinite(unitId) || unitId <= 0) {
        return res.status(400).json({ error: { message: 'Unit selection is required to submit an offer.' } })
      }
      const unitRow = await pool.query(`SELECT available, unit_status FROM units WHERE id=$1`, [unitId])
      if (unitRow.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Unit not found' } })
      }
      const available = unitRow.rows[0].available === true && String(unitRow.rows[0].unit_status || '').toUpperCase() === 'AVAILABLE'
      if (!available) {
        return res.status(400).json({ error: { message: 'Offers can only be submitted for AVAILABLE units.' } })
      }
    } catch (_) {
      return res.status(400).json({ error: { message: 'A generated payment plan is required to submit an offer.' } })
    }

    // Optional: acceptability flags passed by client to persist
    if (req.body?.acceptability) {
      await setAcceptabilityFlags(id, req.body.acceptability, req.user)
    }

    // Auto-evaluate based on calculator snapshot stored in deal.details
    // If evaluation exists and decision = REJECT, mark needs_override and log immediately.
    // Also enforce: submission is blocked unless an override has already been approved.
    try {
      const det = deal.details || {}
      const evalObj = det?.calculator?.generatedPlan?.evaluation || null
      if (evalObj && evalObj.decision === 'REJECT') {
        await pool.query(
          `UPDATE deals
           SET needs_override=TRUE,
               override_requested_by=COALESCE(override_requested_by, $1),
               override_requested_at=COALESCE(override_requested_at, now()),
               updated_at=now()
           WHERE id=$2`,
          [req.user.id, id]
        )
        const overrideNote = {
          event: 'override_requested',
          by: { id: req.user.id, role: req.user.role },
          reason: 'auto: evaluation REJECT at submission',
          evaluation: evalObj,
          at: new Date().toISOString()
        }
        await logHistory(id, req.user.id, 'override_requested', JSON.stringify(overrideNote))

        // Enforce block on submission unless override already approved
        const approvedAt = deal.override_approved_at
        if (!approvedAt) {
          return res.status(400).json({ error: { message: 'Submission denied: payment plan evaluation is REJECT. Top-Management override approval is required.' } })
        }
      }
    } catch (autoErr) {
      // Do not block submission if evaluation parsing fails
      console.warn('Auto-override on submit warning:', autoErr?.message || autoErr)
    }

    const upd = await pool.query('UPDATE deals SET status=$1 WHERE id=$2 RETURNING *', ['pending_approval', id])
    const submittedDeal = upd.rows[0]
    const note = {
      event: 'deal_submitted',
      by: { id: req.user.id, role: req.user.role },
      from: deal.status,
      to: 'pending_approval',
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'submit', JSON.stringify(note))

    // Real-time notification to active Sales Managers
    try {
      const mgrs = await pool.query(`SELECT id FROM users WHERE role='sales_manager' AND active=TRUE`)
      for (const m of mgrs.rows) {
        await emitNotification('deal_submitted', m.id, 'deals', submittedDeal.id, `Deal #${submittedDeal.id} submitted for approval`)
      }
    } catch (notifyErr) {
      console.error('Emit notification error (deal submitted):', notifyErr)
    }

    return res.json({ ok: true, deal: submittedDeal })
  } catch (e) {
    console.error('POST /api/deals/:id/submit error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Approve (sales_manager or admin only; pending_approval -> approved)
router.post('/:id/approve', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!(role === 'sales_manager' || role === 'admin' || role === 'superadmin')) return res.status(403).json({ error: { message: 'Sales Manager role required' } })

    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]
    if (deal.status !== 'pending_approval') return res.status(400).json({ error: { message: 'Deal must be pending approval' } })

    const upd = await pool.query('UPDATE deals SET status=$1 WHERE id=$2 RETURNING *', ['approved', id])
    const approveNote = {
      event: 'deal_approved',
      by: { id: req.user.id, role: req.user.role },
      from: deal.status,
      to: 'approved',
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'approve', JSON.stringify(approveNote))

    // Auto-calc commission if sales rep assigned
    const approvedDeal = upd.rows[0]
    let commissionRecord = null
    if (approvedDeal.sales_rep_id) {
      // fetch chosen policy or latest active
      let policy
      if (approvedDeal.policy_id) {
        const p = await pool.query('SELECT * FROM commission_policies WHERE id=$1', [approvedDeal.policy_id])
        policy = p.rows[0]
      } else {
        const p = await pool.query('SELECT * FROM commission_policies WHERE active=true ORDER BY id DESC LIMIT 1')
        policy = p.rows[0]
      }
      if (policy) {
        const amt = Number(approvedDeal.amount || 0)
        const rules = policy.rules || {}
        const calc = (amount, rules) => {
          const a = Number(amount) || 0
          if (a <= 0) return { amount: 0, details: { reason: 'zero_amount' } }
          if (!rules || typeof rules !== 'object') return { amount: 0, details: { reason: 'no_rules' } }
          if (rules.type === 'percentage') {
            const rate = Number(rules.rate) || 0
            return { amount: Math.max(0, a * rate / 100), details: { mode: 'percentage', rate } }
          }
          if (rules.type === 'tiered' && Array.isArray(rules.tiers)) {
            let remaining = a
            let total = 0
            const applied = []
            for (const t of rules.tiers) {
              const upTo = t.upTo == null ? remaining : Math.max(0, Math.min(remaining, Number(t.upTo)))
              const rate = Number(t.rate) || 0
              if (upTo > 0) {
                const part = upTo * rate / 100
                total += part
                applied.push({ base: upTo, rate, commission: part })
                remaining -= upTo
              }
              if (remaining <= 0) break
            }
            return { amount: total, details: { mode: 'tiered', applied } }
          }
          return { amount: 0, details: { mode: 'unknown' } }
        }
        const { amount: commissionAmount, details } = calc(amt, rules)
        const ins = await pool.query(
          `INSERT INTO deal_commissions (deal_id, sales_person_id, policy_id, amount, details)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [approvedDeal.id, approvedDeal.sales_rep_id, policy.id, commissionAmount, { ...details, deal_amount: amt }]
        )
        commissionRecord = ins.rows[0]

        // Audit log entry for auto commission calculation (structured JSON in notes)
        const noteObj = {
          event: 'auto_commission',
          policy: { id: policy.id, name: policy.name || null, active: !!policy.active },
          amounts: { deal: amt, commission: commissionAmount },
          calc: details, // includes mode, tiers applied, etc.
          triggeredBy: { id: req.user.id, role: req.user.role },
          triggeredAt: new Date().toISOString()
        }
        await logHistory(approvedDeal.id, req.user.id, 'commission_calculated', JSON.stringify(noteObj))
      }
    }

    return res.json({ ok: true, deal: approvedDeal, commission: commissionRecord })
  } catch (e) {
    console.error('POST /api/deals/:id/approve error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Reject (sales_manager or admin only; pending_approval -> rejected)
router.post('/:id/reject', authMiddleware, validate(dealRejectSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { reason } = req.body || {}
    const role = req.user.role
    if (!(role === 'sales_manager' || role === 'admin' || role === 'superadmin')) return res.status(403).json({ error: { message: 'Sales Manager role required' } })

    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]
    if (deal.status !== 'pending_approval') return res.status(400).json({ error: { message: 'Deal must be pending approval' } })

    // Persist rejection reason to deal record and set status
    const upd = await pool.query('UPDATE deals SET status=$1, rejection_reason=$2 WHERE id=$3 RETURNING *', ['rejected', (typeof reason === 'string' ? reason : null), id])

    const rejectNote = {
      event: 'deal_rejected',
      by: { id: req.user.id, role: req.user.role },
      from: deal.status,
      to: 'rejected',
      reason: typeof reason === 'string' ? reason : null,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'reject', JSON.stringify(rejectNote))
    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/reject error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Request Top-Management override for a deal (Sales Manager or Financial Manager)
 * Does not change approval status; sets needs_override and timestamps; logs in deal_history.
 */
router.post('/:id/request-override', authMiddleware, validate(overrideRequestSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    // Property Consultant can initiate; Sales Manager and Financial Manager can also initiate if needed
    if (!['property_consultant', 'sales_manager', 'financial_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Property Consultant, Sales Manager or Financial Manager role required' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]

    const upd = await pool.query(
      `UPDATE deals
       SET needs_override=TRUE,
           override_requested_by=$1,
           override_requested_at=now(),
           updated_at=now()
       WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )

    const note = {
      event: 'override_requested',
      by: { id: req.user.id, role },
      reason: (req.body && req.body.reason) || null,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_requested', JSON.stringify(note))

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/request-override error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Sales Manager approve stage (escalate to FM)
router.post('/:id/override-sm-approve', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['sales_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Sales Manager role required' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const dealRow = q.rows[0]

    const upd = await pool.query(
      `UPDATE deals
       SET manager_review_by=$1,
           manager_review_at=now(),
           updated_at=now()
       WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )

    const note = {
      event: 'override_sm_approved',
      by: { id: req.user.id, role },
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_sm_approved', JSON.stringify(note))

    // Notify consultant that SM approved and FM review is next
    try {
      await emitNotification('override_sm_approved', dealRow.created_by, 'deals', id, 'Override approved by Sales Manager')
    } catch (notifyErr) {
      console.error('Emit notification error (override_sm_approved):', notifyErr)
    }

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-sm-approve error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Sales Manager reject stage
router.post('/:id/override-sm-reject', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['sales_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Sales Manager role required' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const dealRow = q.rows[0]

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null

    const upd = await pool.query(
      `UPDATE deals
       SET needs_override=FALSE,
           manager_review_by=$1,
           manager_review_at=now(),
           override_notes=$2,
           updated_at=now()
       WHERE id=$3 RETURNING *`,
      [req.user.id, notes, id]
    )

    const note = {
      event: 'override_sm_rejected',
      by: { id: req.user.id, role },
      notes,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_sm_rejected', JSON.stringify(note))

    // Notify consultant of rejection
    try {
      await emitNotification('override_sm_rejected', dealRow.created_by, 'deals', id, 'Override rejected by Sales Manager')
    } catch (notifyErr) {
      console.error('Emit notification error (override_sm_rejected):', notifyErr)
    }

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-sm-reject error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Financial Manager approve stage (blocks unit)
router.post('/:id/override-fm-approve', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['financial_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Financial Manager role required' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]

    const upd = await pool.query(
      `UPDATE deals
       SET fm_review_by=$1,
           fm_review_at=now(),
           updated_at=now()
       WHERE id=$2 RETURNING *`,
      [req.user.id, id]
    )

    // Attempt to block unit upon FM approval
    try {
      const det = deal.details || {}
      const unitId = det?.calculator?.unitInfo?.unit_id
      if (Number.isFinite(Number(unitId)) && Number(unitId) > 0) {
        await pool.query('UPDATE units SET available=FALSE, updated_at=now() WHERE id=$1', [Number(unitId)])
      }
    } catch (blkErr) {
      console.warn('Unit block warning:', blkErr?.message || blkErr)
    }

    const note = {
      event: 'override_fm_approved',
      by: { id: req.user.id, role },
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_fm_approved', JSON.stringify(note))

    // Notify consultant that FM approved and TM review is next
    try {
      await emitNotification('override_fm_approved', deal.created_by, 'deals', id, 'Override approved by Financial Manager')
    } catch (notifyErr) {
      console.error('Emit notification error (override_fm_approved):', notifyErr)
    }

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-fm-approve error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Financial Manager reject stage
router.post('/:id/override-fm-reject', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['financial_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Financial Manager role required' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const dealRow = q.rows[0]

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null

    const upd = await pool.query(
      `UPDATE deals
       SET needs_override=FALSE,
           fm_review_by=$1,
           fm_review_at=now(),
           override_notes=$2,
           updated_at=now()
       WHERE id=$3 RETURNING *`,
      [req.user.id, notes, id]
    )

    const note = {
      event: 'override_fm_rejected',
      by: { id: req.user.id, role },
      notes,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_fm_rejected', JSON.stringify(note))

    // Notify consultant of rejection
    try {
      await emitNotification('override_fm_rejected', dealRow.created_by, 'deals', id, 'Override rejected by Financial Manager')
    } catch (notifyErr) {
      console.error('Emit notification error (override_fm_rejected):', notifyErr)
    }

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-fm-reject error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Approve Top-Management override (TM roles only)
 * Records approver, timestamp and notes; logs in deal_history.
 */
router.post('/:id/override-approve', authMiddleware, validate(overrideApproveSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['ceo', 'chairman', 'vice_chairman', 'top_management', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Top-Management role required to approve override' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null

    const upd = await pool.query(
      `UPDATE deals
       SET override_approved_by=$1,
           override_approved_at=now(),
           override_notes=$2,
           updated_at=now()
       WHERE id=$3 RETURNING *`,
      [req.user.id, notes, id]
    )

    const note = {
      event: 'override_approved',
      by: { id: req.user.id, role },
      notes,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_approved', JSON.stringify(note))

    // Notify consultant of final approval
    try {
      await emitNotification('override_approved', deal.created_by, 'deals', id, 'Override approved by Top Management')
    } catch (notifyErr) {
      console.error('Emit notification error (override_approved):', notifyErr)
    }

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-approve error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Reject Top-Management override (TM roles only)
 */
router.post('/:id/override-reject', authMiddleware, validate(overrideApproveSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    // Allow Sales Manager, Financial Manager and Top-Management to reject (deny) with reasons
    if (!['sales_manager', 'financial_manager', 'ceo', 'chairman', 'vice_chairman', 'top_management', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Role not permitted to reject override' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null

    const upd = await pool.query(
      `UPDATE deals
       SET needs_override=FALSE,
           override_notes=$1,
           updated_at=now()
       WHERE id=$2 RETURNING *`,
      [notes, id]
    )

    const note = {
      event: 'override_rejected',
      by: { id: req.user.id, role },
      notes,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'override_rejected', JSON.stringify(note))

    // Notify consultant of rejection (stage may be SM/FM/TM)
    try {
      await emitNotification('override_rejected', deal.created_by, 'deals', id, `Override rejected by ${role.replace('_', ' ')}`)
    } catch (notifyErr) {
      console.error('Emit notification error (override_rejected):', notifyErr)
    }

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-reject error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Request edits from the consultant (Financial Admin or Financial Manager).
 * Does not modify the deal; logs the request in deal_history and notifies the deal creator.
 */
router.post('/:id/request-edits', authMiddleware, validate(editRequestSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['financial_admin', 'financial_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Financial Admin or Financial Manager role required' } })
    }
    const q = await pool.query('SELECT id, created_by FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const dealRow = q.rows[0]

    const fields = Array.isArray(req.body?.fields) ? req.body.fields : []
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null

    const note = {
      event: 'request_edits',
      by: { id: req.user.id, role },
      fields,
      reason,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'request_edits', JSON.stringify(note))

    // Notify the consultant (deal creator)
    try {
      await emitNotification('request_edits', dealRow.created_by, 'deals', id, reason || 'Edits requested by Financial Admin')
    } catch (notifyErr) {
      console.error('Emit notification error (request edits):', notifyErr)
    }

    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/deals/:id/request-edits error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Mark edits addressed (Consultant or Sales Manager).
 * Logs 'edits_addressed' to history with optional notes.
 */
router.post('/:id/edits-addressed', authMiddleware, validate(editsAddressedSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['property_consultant', 'sales_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Property Consultant or Sales Manager role required' } })
    }
    const q = await pool.query('SELECT id FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null
    const note = {
      event: 'edits_addressed',
      by: { id: req.user.id, role },
      notes,
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'edits_addressed', JSON.stringify(note))
    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/deals/:id/edits-addressed error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router