import express from 'express'
import { pool } from './db.js'
import { authMiddleware, adminOnly } from './authRoutes.js'

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

// Helper: read active payment thresholds (latest row)
async function readActivePaymentThresholds(client) {
  const r = await client.query('SELECT * FROM payment_thresholds ORDER BY id DESC LIMIT 1')
  if (r.rows.length === 0) {
    return {
      first_year_percent_min: 10,
      first_year_percent_max: null,
      second_year_percent_min: 15,
      second_year_percent_max: null,
      handover_percent_min: null,
      handover_percent_max: 5
    }
  }
  return r.rows[0]
}

// Compute acceptability flags from a saved calculator snapshot and active thresholds
function evaluateAcceptability(snapshot, thresholdsRow) {
  try {
    const schedule = Array.isArray(snapshot?.generatedPlan?.schedule) ? snapshot.generatedPlan.schedule : []
    const totalNominal = Number(snapshot?.generatedPlan?.totals?.totalNominal) || schedule.reduce((s, r) => s + (Number(r?.amount) || 0), 0)
    if (totalNominal <= 0 || schedule.length === 0) {
      return { hasPlan: false }
    }

    // Sum by year buckets and handover
    const inputs = snapshot?.inputs || snapshot?.generatedPlan?.inputs || {}
    const handoverYear = Number(inputs?.handoverYear) || 0
    const handoverMonth = handoverYear > 0 ? handoverYear * 12 : null

    let y1 = 0
    let y2 = 0
    let hand = 0
    for (const row of schedule) {
      const m = Number(row?.month) || 0
      const amt = Number(row?.amount) || 0
      if (m <= 12) y1 += amt // include DP at month 0 in Y1
      if (m > 12 && m <= 24) y2 += amt
      const label = String(row?.label || '')
      if ((handoverMonth && m === handoverMonth) || /handover/i.test(label)) {
        hand += amt
      }
    }

    const pct = (v) => (totalNominal > 0 ? (v / totalNominal) * 100 : 0)
    const y1Pct = pct(y1)
    const y2Pct = pct(y2)
    const handPct = pct(hand)

    const within = (value, min, max) => {
      if (min != null && isFinite(Number(min)) && value < Number(min) - 1e-9) return false
      if (max != null && isFinite(Number(max)) && value > Number(max) + 1e-9) return false
      return true
    }

    const acceptable_first_year = within(
      y1Pct,
      thresholdsRow?.first_year_percent_min,
      thresholdsRow?.first_year_percent_max
    )
    const acceptable_second_year = within(
      y2Pct,
      thresholdsRow?.second_year_percent_min,
      thresholdsRow?.second_year_percent_max
    )
    const acceptable_handover = within(
      handPct,
      thresholdsRow?.handover_percent_min,
      thresholdsRow?.handover_percent_max
    )

    // PV acceptability not defined in thresholds; mark true by default if present
    const acceptable_pv = true

    return {
      hasPlan: true,
      flags: { acceptable_pv, acceptable_first_year, acceptable_second_year, acceptable_handover },
      percents: { firstYearPercent: y1Pct, secondYearPercent: y2Pct, handoverPercent: handPct }
    }
  } catch (e) {
    return { hasPlan: false }
  }
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

// Get single deal by id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const q = await pool.query(
      `SELECT d.*, u.email as created_by_email
       FROM deals d LEFT JOIN users u ON u.id = d.created_by
       WHERE d.id=$1`,
      [id]
    )
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    return res.json({ ok: true, deal: q.rows[0] })
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
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, amount, details, unitType, salesRepId, policyId } = req.body || {}
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: { message: 'title is required' } })
    }
    const amt = Number(amount || 0)
    const det = isObject(details) ? details : {}
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
router.patch('/:id', authMiddleware, async (req, res) => {
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
router.post('/:id/submit', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]
    const isOwner = deal.created_by === req.user.id
    const isAdmin = req.user.role === 'admin'
    if (!isOwner && !isAdmin) return res.status(403).json({ error: { message: 'Forbidden' } })
    if (deal.status !== 'draft') return res.status(400).json({ error: { message: 'Deal must be draft to submit' } })

    // Ensure a generated plan is saved in deal details
    const snapshot = (deal?.details && deal.details.calculator) ? deal.details.calculator : null
    if (!snapshot || !Array.isArray(snapshot?.generatedPlan?.schedule) || snapshot.generatedPlan.schedule.length === 0) {
      return res.status(400).json({ error: { message: 'Please generate and save a payment plan before submitting.' } })
    }

    // Evaluate thresholds from active configuration and persist acceptability flags
    try {
      const client = await pool.connect()
      try {
        const thresholds = await readActivePaymentThresholds(client)
        client.release()
        const evaluation = evaluateAcceptability(snapshot, thresholds)
        if (evaluation?.hasPlan && evaluation?.flags) {
          await setAcceptabilityFlags(id, evaluation.flags, req.user)
          const anyUnacceptable = !evaluation.flags.acceptable_first_year || !evaluation.flags.acceptable_second_year || !evaluation.flags.acceptable_handover || !evaluation.flags.acceptable_pv
          if (anyUnacceptable) {
            await pool.query(`UPDATE deals SET needs_override=TRUE, updated_at=now() WHERE id=$1`, [id])
          }
          const tnote = {
            event: 'thresholds_evaluated',
            by: { id: req.user.id, role: req.user.role },
            percents: evaluation.percents,
            flags: evaluation.flags,
            needs_override: anyUnacceptable,
            at: new Date().toISOString()
          }
          await logHistory(id, req.user.id, 'thresholds_evaluated', JSON.stringify(tnote))
        }
      } catch (e) {
        try { client.release() } catch {}
      }
    } catch {}

    // Optional: acceptability flags passed by client to persist (takes precedence)
    if (req.body?.acceptability) {
      await setAcceptabilityFlags(id, req.body.acceptability, req.user)
    }

    const upd = await pool.query('UPDATE deals SET status=$1 WHERE id=$2 RETURNING *', ['pending_approval', id])
    const note = {
      event: 'deal_submitted',
      by: { id: req.user.id, role: req.user.role },
      from: deal.status,
      to: 'pending_approval',
      at: new Date().toISOString()
    }
    await logHistory(id, req.user.id, 'submit', JSON.stringify(note))
    return res.json({ ok: true, deal: upd.rows[0] })
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
router.post('/:id/reject', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { reason } = req.body || {}
    const role = req.user.role
    if (!(role === 'sales_manager' || role === 'admin' || role === 'superadmin')) return res.status(403).json({ error: { message: 'Sales Manager role required' } })

    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })
    const deal = q.rows[0]
    if (deal.status !== 'pending_approval') return res.status(400).json({ error: { message: 'Deal must be pending approval' } })

    const upd = await pool.query('UPDATE deals SET status=$1 WHERE id=$2 RETURNING *', ['rejected', id])
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
router.post('/:id/request-override', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['sales_manager', 'financial_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Sales Manager or Financial Manager role required' } })
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

/**
 * Approve Top-Management override (TM roles only)
 * Records approver, timestamp and notes; logs in deal_history.
 */
router.post('/:id/override-approve', authMiddleware, async (req, res) => {
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

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-approve error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Reject Top-Management override (TM roles only)
 */
router.post('/:id/override-reject', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const role = req.user.role
    if (!['ceo', 'chairman', 'vice_chairman', 'top_management', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: { message: 'Top-Management role required to reject override' } })
    }
    const q = await pool.query('SELECT * FROM deals WHERE id=$1', [id])
    if (q.rows.length === 0) return res.status(404).json({ error: { message: 'Deal not found' } })

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

    return res.json({ ok: true, deal: upd.rows[0] })
  } catch (e) {
    console.error('POST /api/deals/:id/override-reject error', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router