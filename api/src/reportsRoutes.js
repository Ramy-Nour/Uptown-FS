import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

function bad(res, code, message, details) {
  return res.status(code).json({ error: { message, details }, timestamp: new Date().toISOString() })
}
function ok(res, payload) { return res.json({ ok: true, ...payload }) }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

router.get('/workflow-logs', authMiddleware, requireRole(['ceo', 'chairman', 'vice_chairman', 'admin', 'superadmin']), async (req, res) => {
  try {
    const { startDate, endDate, type, consultant_id, manager_id } = req.query || {}
    const start = startDate ? new Date(startDate) : null
    const end = endDate ? new Date(endDate) : null
    const cid = consultant_id ? toNum(consultant_id) : null
    const mid = manager_id ? toNum(manager_id) : null

    // Build where clauses per entity with positional parameters
    const dateClause = (col, baseParamsCount = 0) => {
      const parts = []
      const params = []
      if (start) { params.push(start.toISOString()); parts.push(`${col} >= ${baseParamsCount + params.length}`) }
      if (end) { params.push(end.toISOString()); parts.push(`${col} <= ${baseParamsCount + params.length}`) }
      const prefix = parts.length ? (baseParamsCount > 0 ? ' AND ' : ' WHERE ') : ''
      return { sql: prefix + parts.join(' AND '), params }
    }

    // Offers (payment_plans)
    let offers = []
    let offerTotal = 0
    if (!type || type === 'offer' || type === 'offers') {
      const baseWhere = []
      const params = []
      // consultant filter
      if (cid) { params.push(cid); baseWhere.push(`pp.created_by = ${params.length}`) }
      // manager filter
      if (mid) {
        params.push(mid)
        baseWhere.push(`pp.created_by IN (SELECT consultant_user_id FROM sales_team_members WHERE manager_user_id=${params.length} AND active=TRUE)`)
      }
      const whereSql = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : ''
      const d = dateClause('pp.created_at', params.length + (whereSql ? 0 : 0))
      const q = `
        SELECT pp.id, pp.deal_id, pp.status, pp.version, pp.accepted, pp.created_at, pp.updated_at,
               pp.created_by,
               u.email AS created_by_email,
               u.name AS created_by_name,
               -- pick one active manager if any
               (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1) AS manager_user_id,
               (SELECT um.email FROM users um WHERE um.id = (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1)) AS manager_email,
               (SELECT um.name FROM users um WHERE um.id = (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1)) AS manager_name,
               COALESCE( (pp.details->>'totalNominalPrice')::numeric,
                         (pp.details->'data'->>'totalNominalPrice')::numeric,
                         0) AS total_nominal
        FROM payment_plans pp
        LEFT JOIN users u ON u.id = pp.created_by
        ${whereSql}${d.sql}
        ORDER BY pp.id DESC`
      const rows = await pool.query(q, params.concat(d.params))
      offers = rows.rows
      offerTotal = offers.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)
    }

    // Reservations
    let reservations = []
    let reservationTotal = 0
    if (!type || type === 'reservation' || type === 'reservations') {
      const baseWhere = []
      const params = []
      // Join to payment_plans to filter by consultant or manager
      if (cid) { params.push(cid); baseWhere.push(`pp.created_by = ${params.length}`) }
      if (mid) {
        params.push(mid)
        baseWhere.push(`pp.created_by IN (SELECT consultant_user_id FROM sales_team_members WHERE manager_user_id=${params.length} AND active=TRUE)`)
      }
      const whereSql = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : ''
      const d = dateClause('rf.created_at', params.length + (whereSql ? 0 : 0))
      const q = `
        SELECT rf.id, rf.payment_plan_id, rf.status, rf.created_at, rf.updated_at,
               pp.created_by,
               u.email AS created_by_email,
               u.name AS created_by_name,
               (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1) AS manager_user_id,
               (SELECT um.email FROM users um WHERE um.id = (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1)) AS manager_email,
               (SELECT um.name FROM users um WHERE um.id = (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1)) AS manager_name,
               COALESCE( (pp.details->>'totalNominalPrice')::numeric,
                         (pp.details->'data'->>'totalNominalPrice')::numeric,
                         0) AS total_nominal
        FROM reservation_forms rf
        JOIN payment_plans pp ON pp.id = rf.payment_plan_id
        LEFT JOIN users u ON u.id = pp.created_by
        ${whereSql}${d.sql}
        ORDER BY rf.id DESC`
      const rows = await pool.query(q, params.concat(d.params))
      reservations = rows.rows
      reservationTotal = reservations.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)
    }

    // Contracts
    let contracts = []
    let contractTotal = 0
    if (!type || type === 'contract' || type === 'contracts') {
      const baseWhere = []
      const params = []
      // Join to reservation_forms -> payment_plans
      if (cid) { params.push(cid); baseWhere.push(`pp.created_by = ${params.length}`) }
      if (mid) {
        params.push(mid)
        baseWhere.push(`pp.created_by IN (SELECT consultant_user_id FROM sales_team_members WHERE manager_user_id=${params.length} AND active=TRUE)`)
      }
      const whereSql = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : ''
      const d = dateClause('c.created_at', params.length + (whereSql ? 0 : 0))
      const q = `
        SELECT c.id, c.reservation_form_id, c.status, c.created_at, c.updated_at,
               pp.created_by,
               u.email AS created_by_email,
               u.name AS created_by_name,
               (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1) AS manager_user_id,
               (SELECT um.email FROM users um WHERE um.id = (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1)) AS manager_email,
               (SELECT um.name FROM users um WHERE um.id = (SELECT stm.manager_user_id FROM sales_team_members stm WHERE stm.consultant_user_id=pp.created_by AND stm.active=TRUE LIMIT 1)) AS manager_name,
               COALESCE( (pp.details->>'totalNominalPrice')::numeric,
                         (pp.details->'data'->>'totalNominalPrice')::numeric,
                         0) AS total_nominal
        FROM contracts c
        JOIN reservation_forms rf ON rf.id = c.reservation_form_id
        JOIN payment_plans pp ON pp.id = rf.payment_plan_id
        LEFT JOIN users u ON u.id = pp.created_by
        ${whereSql}${d.sql}
        ORDER BY c.id DESC`
      const rows = await pool.query(q, params.concat(d.params))
      contracts = rows.rows
      contractTotal = contracts.reduce((s, r) => s + (Number(r.total_nominal) || 0), 0)
    }

    const grandTotal = offerTotal + reservationTotal + contractTotal
    return ok(res, {
      filters: { startDate, endDate, type, consultant_id: cid, manager_id: mid },
      offers: { rows: offers, total: offerTotal },
      reservations: { rows: reservations, total: reservationTotal },
      contracts: { rows: contracts, total: contractTotal },
      grandTotal
    })
  } catch (e) {
    console.error('GET /api/reports/workflow-logs error:', e)
    return bad(res, 500, 'Internal error')
  }
})

export default router