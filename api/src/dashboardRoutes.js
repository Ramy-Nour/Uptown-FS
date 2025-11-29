import express from 'express'
import { pool } from './db.js'
import { authMiddleware, requireRole } from './authRoutes.js'

const router = express.Router()

// Property Consultant stats (formerly \"Sales Rep\" dashboard)
router.get('/sales-rep/stats', authMiddleware, requireRole(['property_consultant']), async (req, res) => {
  try {
    const userId = req.user.id

    const totalOffersRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM offers WHERE created_by = $1`,
      [userId]
    )

    const approvedOffersRes = await pool.query(
      `SELECT COUNT(*)::int AS c 
       FROM offers 
       WHERE created_by = $1 AND status IN ('preliminary_approved','reserved')`,
      [userId]
    )

    const pendingOffersRes = await pool.query(
      `SELECT COUNT(*)::int AS c 
       FROM offers 
       WHERE created_by = $1 AND status IN ('pending_sm','pending_fm','pending_tm')`,
      [userId]
    )

    const totalOffers = totalOffersRes.rows[0]?.c || 0
    const approvedOffers = approvedOffersRes.rows[0]?.c || 0
    const pendingOffers = pendingOffersRes.rows[0]?.c || 0
    const conversionRate = totalOffers > 0 ? Math.round((approvedOffers / totalOffers) * 100) : 0

    return res.json({
      ok: true,
      data: { totalOffers, approvedOffers, pendingOffers, conversionRate }
    })
  } catch (error) {
    console.error('GET /api/dashboard/sales-rep/stats error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Property Consultant recent offers
router.get('/sales-rep/offers', authMiddleware, requireRole(['property_consultant']), async (req, res) => {
  try {
    const userId = req.user.id
    const offers = await pool.query(
      `SELECT 
         o.id,
         o.title,
         o.status,
         o.total_amount,
         o.created_at,
         c.name AS customer_name,
         u.code AS unit_code
       FROM offers o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN units u ON u.id = o.unit_id
       WHERE o.created_by = $1
       ORDER BY o.created_at DESC
       LIMIT 20`,
      [userId]
    )

    return res.json({ ok: true, data: offers.rows })
  } catch (error) {
    console.error('GET /api/dashboard/sales-rep/offers error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Property Consultant recent customers
router.get('/sales-rep/customers', authMiddleware, requireRole(['property_consultant']), async (req, res) => {
  try {
    const userId = req.user.id
    const customers = await pool.query(
      `SELECT 
         id,
         name,
         email,
         phone,
         nationality,
         created_at
       FROM customers
       WHERE created_by = $1 AND active = TRUE
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    )

    return res.json({ ok: true, data: customers.rows })
  } catch (error) {
    console.error('GET /api/dashboard/sales-rep/customers error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router