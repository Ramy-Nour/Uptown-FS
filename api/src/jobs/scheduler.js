import { pool } from '../db.js'

export function startSchedulers() {
  // Simple in-process notifier for hold reminders (runs hourly)
  setInterval(async () => {
    try {
      const r = await pool.query(
        `SELECT h.id, h.unit_id, h.next_notify_at
         FROM holds h
         WHERE h.status='approved' AND (h.next_notify_at IS NULL OR h.next_notify_at <= now())`
      )
      for (const row of r.rows) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
           SELECT u.id, 'hold_reminder', 'holds', $1, 'Hold requires decision: unblock or extend.'
           FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
          [row.id]
        )
        await pool.query(
          `UPDATE holds SET next_notify_at = now() + INTERVAL '7 days' WHERE id=$1`,
          [row.id]
        )
      }
    } catch (e) {
      console.error('Hold reminder scheduler error:', e)
    }
  }, 60 * 60 * 1000) // hourly

  // Daily job to expire holds past expires_at (runs every 24 hours)
  setInterval(async () => {
    try {
      const rows = await pool.query(
        `SELECT h.id, h.unit_id, h.payment_plan_id
         FROM holds h
         WHERE h.status='approved' AND h.expires_at IS NOT NULL AND h.expires_at < now()`
      )
      for (const h of rows.rows) {
        // Check reservation exists
        let reserved = false
        if (h.payment_plan_id) {
          const rf = await pool.query(
            `SELECT 1 FROM reservation_forms WHERE payment_plan_id=$1 AND status='approved' LIMIT 1`,
            [h.payment_plan_id]
          )
          reserved = rf.rows.length > 0
        }
        if (!reserved) {
          await pool.query('UPDATE holds SET status=\'expired\', updated_at=now() WHERE id=$1', [h.id])
          await pool.query('UPDATE units SET available=TRUE, updated_at=now() WHERE id=$1', [h.unit_id])
          // notify FMs
          await pool.query(
            `INSERT INTO notifications (user_id, type, ref_table, ref_id, message)
             SELECT u.id, 'hold_expired', 'holds', $1, 'Hold expired automatically and unit was unblocked.'
             FROM users u WHERE u.role='financial_manager' AND u.active=TRUE`,
            [h.id]
          )
        }
      }
    } catch (e) {
      console.error('Daily hold expiry job error:', e)
    }
  }, 24 * 60 * 60 * 1000) // daily
}