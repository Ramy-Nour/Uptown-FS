import express from 'express'
import { pool } from './db.js'
import { authMiddleware } from './authRoutes.js'
import rateLimit from 'express-rate-limit'

const router = express.Router()

// Reuse the auth limiter pattern from app.js
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
})

// List notifications for the authenticated user
router.get('/', authLimiter, authMiddleware, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20)
    const offset = Number(req.query.offset || 0)
    const rows = await pool.query(
      `SELECT *
       FROM notifications
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    )
    res.json({ ok: true, notifications: rows.rows })
  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Unread count
router.get('/unread-count', authLimiter, authMiddleware, async (req, res) => {
  try {
    const countRes = await pool.query(
      `SELECT COUNT(*) AS c
       FROM notifications
       WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    )
    const count = Number(countRes.rows[0]?.c || 0)
    res.json({ ok: true, count })
  } catch (error) {
    console.error('Get unread count error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Mark single notification as read
router.patch('/:id/read', authLimiter, authMiddleware, async (req, res) => {
  try {
    const notificationId = Number(req.params.id)
    await pool.query(
      `UPDATE notifications SET is_read = true, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [notificationId, req.user.id]
    )
    res.json({ ok: true })
  } catch (error) {
    console.error('Mark as read error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Mark all as read
router.patch('/mark-all-read', authLimiter, authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true, updated_at = now() WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    )
    res.json({ ok: true })
  } catch (error) {
    console.error('Mark all as read error:', error)
    res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router