import express from 'express'
import { pool } from './db.js'
import { authMiddleware } from './authRoutes.js'
import { validate, customerCreateSchema, customerUpdateSchema, customerSearchQuerySchema } from './validation.js'

const router = express.Router()

// Create new customer
router.post('/customers', authMiddleware, validate(customerCreateSchema), async (req, res) => {
  const { 
    name, email, phone, nationality, id_number, id_type, 
    address, date_of_birth, occupation, company 
  } = req.body || {}
  
  try {
    // Check for existing customer
    const existing = await pool.query(
      'SELECT id FROM customers WHERE email = $1 OR phone = $2',
      [String(email).toLowerCase(), String(phone)]
    )
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        error: { message: 'Customer with this email or phone already exists' } 
      })
    }
    
    const result = await pool.query(`
      INSERT INTO customers (
        name, email, phone, nationality, id_number, id_type,
        address, date_of_birth, occupation, company, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      name, String(email).toLowerCase(), phone, nationality || null, id_number || null, id_type || null,
      address || null, date_of_birth || null, occupation || null, company || null, req.user.id
    ])
    
    return res.json({ ok: true, customer: result.rows[0] })
    
  } catch (error) {
    console.error('Create customer error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get all customers with search and filter
router.get('/customers', authMiddleware, async (req, res) => {
  const pageNum = Number(req.query.page || 1)
  const limitNum = Number(req.query.limit || 20)
  const offset = (pageNum - 1) * limitNum
  const search = req.query.search ? String(req.query.search) : null
  
  try {
    let query = `
      SELECT 
        c.*,
        COUNT(o.id) as total_offers,
        u.email as created_by_name
      FROM customers c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN offers o ON c.id = o.customer_id
      WHERE 1=1
    `
    
    const params = []
    
    if (search) {
      params.push(`%${search}%`)
      query += ` AND (c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length})`
    }
    
    // Sales reps can only see their own customers
    if (req.user.role === 'property_consultant') {
      params.push(req.user.id)
      query += ` AND c.created_by = $${params.length}`
    }
    
    params.push(limitNum)
    params.push(offset)
    query += `
      GROUP BY c.id, u.email
      ORDER BY c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `
    
    const customers = await pool.query(query, params)
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) AS count
      FROM customers c
      WHERE 1=1
    `
    const countParams = []
    
    if (search) {
      countParams.push(`%${search}%`)
      countQuery += ` AND (c.name ILIKE $${countParams.length} OR c.email ILIKE $${countParams.length} OR c.phone ILIKE $${countParams.length})`
    }
    
    if (req.user.role === 'property_consultant') {
      countParams.push(req.user.id)
      countQuery += ` AND c.created_by = $${countParams.length}`
    }
    
    const totalCount = await pool.query(countQuery, countParams)
    const total = Number(totalCount.rows[0]?.count || 0)
    
    return res.json({ 
      ok: true, 
      customers: customers.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / (limitNum || 1))
      }
    })
    
  } catch (error) {
    console.error('Get customers error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get customer by ID
router.get('/customers/:id', authMiddleware, async (req, res) => {
  const customerId = Number(req.params.id)
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: { message: 'Invalid id' } })
  
  try {
    const customer = await pool.query(`
      SELECT 
        c.*,
        u.email as created_by_name,
        json_agg(
          json_build_object(
            'id', o.id,
            'title', o.title,
            'status', o.status,
            'total_amount', o.total_amount,
            'created_at', o.created_at
          ) ORDER BY o.created_at DESC
        ) FILTER (WHERE o.id IS NOT NULL) as offers
      FROM customers c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN offers o ON c.id = o.customer_id
      WHERE c.id = $1
      GROUP BY c.id, u.email
    `, [customerId])
    
    if (customer.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Customer not found' } })
    }
    
    // Check access permission
    if (req.user.role === 'property_consultant' && customer.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: { message: 'Access denied' } })
    }
    
    return res.json({ ok: true, customer: customer.rows[0] })
    
  } catch (error) {
    console.error('Get customer error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Update customer
router.patch('/customers/:id', authMiddleware, validate(customerUpdateSchema), async (req, res) => {
  const customerId = Number(req.params.id)
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: { message: 'Invalid id' } })
  const updates = req.body || {}
  
  try {
    // Check if customer exists and user has permission
    const existing = await pool.query(
      'SELECT created_by FROM customers WHERE id = $1',
      [customerId]
    )
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Customer not found' } })
    }
    
    if (req.user.role === 'property_consultant' && existing.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: { message: 'Access denied' } })
    }
    
    // Build dynamic update query
    const allowedFields = ['name', 'email', 'phone', 'nationality', 'id_number', 'id_type', 'address', 'date_of_birth', 'occupation', 'company']
    const updateFields = []
    const values = []
    let paramCount = 1
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramCount}`)
        values.push(key === 'email' ? String(value).toLowerCase() : value)
        paramCount++
      }
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: { message: 'No valid fields to update' } })
    }
    
    updateFields.push(`updated_at = NOW()`)
    values.push(customerId)
    
    const result = await pool.query(
      `UPDATE customers SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    )
    
    return res.json({ ok: true, customer: result.rows[0] })
    
  } catch (error) {
    console.error('Update customer error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Delete customer (soft delete)
router.delete('/customers/:id', authMiddleware, async (req, res) => {
  const customerId = Number(req.params.id)
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: { message: 'Invalid id' } })
  
  try {
    // Check permissions
    const customer = await pool.query(
      'SELECT created_by FROM customers WHERE id = $1',
      [customerId]
    )
    
    if (customer.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Customer not found' } })
    }
    
    if (req.user.role === 'property_consultant' && customer.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: { message: 'Access denied' } })
    }
    
    // Check if customer has active offers
    const activeOffers = await pool.query(
      `SELECT id FROM offers WHERE customer_id = $1 AND status NOT IN ('cancelled','rejected')`,
      [customerId]
    )
    
    if (activeOffers.rows.length > 0) {
      return res.status(400).json({ 
        error: { message: 'Cannot delete customer with active offers' } 
      })
    }
    
    // Soft delete
    await pool.query(
      'UPDATE customers SET active = false, updated_at = NOW() WHERE id = $1',
      [customerId]
    )
    
    return res.json({ ok: true, message: 'Customer deleted successfully' })
    
  } catch (error) {
    console.error('Delete customer error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Customer search for offer creation
router.get('/customers/search', authMiddleware, validate(customerSearchQuerySchema, 'query'), async (req, res) => {
  const q = req.query.q ? String(req.query.q) : ''
  
  try {
    const params = [`%${q}%`]
    let clauseCreated = ''
    if (req.user.role === 'property_consultant') {
      params.push(req.user.id)
      clauseCreated = 'AND created_by = $2'
    }
    const customers = await pool.query(`
      SELECT 
        id,
        name,
        email,
        phone,
        nationality
      FROM customers
      WHERE (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1)
      AND active = true
      ${clauseCreated}
      ORDER BY name
      LIMIT 10
    `, params)
    
    return res.json({ ok: true, customers: customers.rows })
    
  } catch (error) {
    console.error('Customer search error:', error)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export default router