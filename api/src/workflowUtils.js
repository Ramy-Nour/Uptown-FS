import { pool } from './db.js'

// Shared response helpers
export function bad(res, code, message, details) {
  return res
    .status(code)
    .json({ error: { message, details }, timestamp: new Date().toISOString() })
}

export function ok(res, payload) {
  return res.json({ ok: true, ...payload })
}

export function ensureNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Resolve discount policy precedence for a payment plan:
// Project &gt; Unit Type &gt; Global (current DB mainly uses unit_type/global)
export async function getPolicyLimitForPlan(details) {
  try {
    const projectId = details?.project_id ? Number(details.project_id) : null
    const unitTypeId = details?.unit_type_id ? Number(details.unit_type_id) : null

    if (Number.isFinite(projectId)) {
      const r = await pool.query(
        `SELECT policy_limit_percent
         FROM approval_policies
         WHERE active=TRUE AND scope_type='project' AND scope_id=$1
         ORDER BY id DESC
         LIMIT 1`,
        [projectId]
      )
      if (r.rows.length) return Number(r.rows[0].policy_limit_percent) || 5
    }

    if (Number.isFinite(unitTypeId)) {
      const r = await pool.query(
        `SELECT policy_limit_percent
         FROM approval_policies
         WHERE active=TRUE AND scope_type='unit_type' AND scope_id=$1
         ORDER BY id DESC
         LIMIT 1`,
        [unitTypeId]
      )
      if (r.rows.length) return Number(r.rows[0].policy_limit_percent) || 5
    }

    const r = await pool.query(
      `SELECT policy_limit_percent
       FROM approval_policies
       WHERE active=TRUE AND scope_type='global'
       ORDER BY id DESC
       LIMIT 1`
    )
    if (r.rows.length) return Number(r.rows[0].policy_limit_percent) || 5
  } catch (e) {
    console.error('getPolicyLimitForPlan error:', e)
  }
  return 5
}

// Policy resolution for a deal by unit_type name (unit_types.name ILIKE deal.unit_type)
export async function resolvePolicyLimitForDeal(dealId) {
  try {
    const d = await pool.query('SELECT unit_type FROM deals WHERE id=$1', [dealId])
    const utName = (d.rows[0]?.unit_type || '').trim()
    if (utName) {
      const type = await pool.query(
        'SELECT id FROM unit_types WHERE name ILIKE $1 LIMIT 1',
        [utName]
      )
      if (type.rows.length > 0) {
        const r = await pool.query(
          `SELECT policy_limit_percent
           FROM approval_policies
           WHERE active=TRUE AND scope_type='unit_type' AND scope_id=$1
           ORDER BY id DESC LIMIT 1`,
          [type.rows[0].id]
        )
        if (r.rows.length > 0) {
          const v = Number(r.rows[0].policy_limit_percent)
          if (Number.isFinite(v) && v > 0) return v
        }
      }
    }

    const g = await pool.query(
      `SELECT policy_limit_percent
       FROM approval_policies
       WHERE active=TRUE AND scope_type='global'
       ORDER BY id DESC LIMIT 1`
    )
    if (g.rows.length > 0) {
      const v = Number(g.rows[0].policy_limit_percent)
      if (Number.isFinite(v) && v > 0) return v
    }
  } catch (e) {
    // fall back to default
  }
  return 5
}