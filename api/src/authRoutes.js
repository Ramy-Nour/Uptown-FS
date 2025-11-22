import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { pool } from './db.js'
import {
  validate,
  authRegisterSchema,
  authLoginSchema,
  refreshSchema,
  requestResetSchema,
  resetPasswordSchema,
  createUserSchema,
  setRoleSchema,
  setActiveSchema,
  updateUserSchema,
  setPasswordAdminSchema,
  usersByRoleQuerySchema
} from './validation.js'

const router = express.Router()

// Optional SMTP transporter for emails (password reset, etc.)
const mailer = (process.env.SMTP_USER && process.env.SMTP_HOST) ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
}) : null

const JWT_SECRET = process.env.JWT_SECRET || 'devsecretchange'
const ACCESS_EXPIRES_IN = '1h'
const REFRESH_TTL_DAYS = 30
const RESET_TTL_MINUTES = 60

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

function toBoolMaybe(v) {
  if (typeof v === 'boolean') return v
  const s = String(v || '').toLowerCase()
  if (['true', '1', 'yes'].includes(s)) return true
  if (['false', '0', 'no'].includes(s)) return false
  return null
}

async function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ error: { message: 'Unauthorized' } })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    // Fetch the latest user state to ensure active flag and role are honored even if changed after token issuance
    const result = await pool.query('SELECT id, email, role, active FROM users WHERE id=$1', [payload.id])
    if (result.rows.length === 0) {
      return res.status(401).json({ error: { message: 'Invalid token' } })
    }
    const user = result.rows[0]
    if (user.active === false) {
      return res.status(403).json({ error: { message: 'Account is deactivated' } })
    }
    // Attach the current user record to request
    req.user = { id: user.id, email: user.email, role: user.role, active: user.active }
    next()
  } catch (e) {
    return res.status(401).json({ error: { message: 'Invalid token' } })
  }
}

function adminOnly(req, res, next) {
  if (!['admin', 'superadmin'].includes(req.user?.role)) {
    return res.status(403).json({ error: { message: 'Forbidden' } })
  }
  next()
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.role
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: { message: 'Forbidden' } })
    }
    next()
  }
}

const VALID_ROLES = [
  'user',
  'admin',
  'superadmin',
  'manager',
  'sales_manager',
  'property_consultant',
  'financial_manager',
  'financial_admin',
  'crm_admin',
  'contract_manager',
  'contract_person',
  'chairman',
  'vice_chairman',
  'ceo'
]

function signAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN })
}

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
  await pool.query('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, expiresAt])
  return { token, expiresAt }
}

// Registration
router.post('/register', validate(authRegisterSchema), async (req, res) => {
  try {
    const { email, password, role } = req.body || {}
    const normalizedEmail = email.trim().toLowerCase()

    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [normalizedEmail])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: { message: 'Email already registered' } })
    }
    const hash = await bcrypt.hash(password, 10)
    const userRole = role && typeof role === 'string' ? role : 'user'
    const insert = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
      [normalizedEmail, hash, userRole]
    )
    const user = insert.rows[0]
    const accessToken = signAccessToken(user)
    const refresh = await issueRefreshToken(user.id)
    return res.json({ ok: true, user, accessToken, refreshToken: refresh.token })
  } catch (e) {
    console.error('POST /api/auth/register error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Login
router.post('/login', validate(authLoginSchema), async (req, res) => {
  try {
    const { email, password } = req.body || {}
    const normalizedEmail = String(email).trim().toLowerCase()
    const result = await pool.query('SELECT id, email, password_hash, role, active FROM users WHERE email=$1', [normalizedEmail])
    if (result.rows.length === 0) return res.status(401).json({ error: { message: 'Invalid credentials' } })
    const user = result.rows[0]
    if (user.active === false) return res.status(403).json({ error: { message: 'Account is deactivated' } })
    const ok = await bcrypt.compare(String(password), user.password_hash)
    if (!ok) return res.status(401).json({ error: { message: 'Invalid credentials' } })
    const accessToken = signAccessToken(user)
    const refresh = await issueRefreshToken(user.id)
    return res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role, active: user.active }, accessToken, refreshToken: refresh.token })
  } catch (e) {
    console.error('POST /api/auth/login error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Token refresh (rotate)
router.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const { refreshToken } = req.body || {}
    const now = new Date()
    const result = await pool.query('SELECT user_id, expires_at FROM refresh_tokens WHERE token=$1', [refreshToken])
    if (result.rows.length === 0) return res.status(401).json({ error: { message: 'Invalid refresh token' } })
    const row = result.rows[0]
    if (new Date(row.expires_at) < now) {
      await pool.query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken])
      return res.status(401).json({ error: { message: 'Refresh token expired' } })
    }
    // Rotate
    await pool.query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken])
    const userRes = await pool.query('SELECT id, email, role FROM users WHERE id=$1', [row.user_id])
    if (userRes.rows.length === 0) return res.status(401).json({ error: { message: 'User not found' } })
    const user = userRes.rows[0]
    const accessToken = signAccessToken(user)
    const refresh = await issueRefreshToken(user.id)
    return res.json({ ok: true, accessToken, refreshToken: refresh.token })
  } catch (e) {
    console.error('POST /api/auth/refresh error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Logout (revoke refresh token)
router.post('/logout', validate(refreshSchema), async (req, res) => {
  try {
    const { refreshToken } = req.body || {}
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken])
    }
    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/auth/logout error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Password reset: request
router.post('/request-password-reset', validate(requestResetSchema), async (req, res) => {
  try {
    const { email } = req.body || {}
    const normalizedEmail = String(email).trim().toLowerCase()
    const result = await pool.query('SELECT id FROM users WHERE email=$1', [normalizedEmail])
    // Always respond ok to avoid user enumeration
    if (result.rows.length === 0) {
      return res.json({ ok: true })
    }
    const userId = result.rows[0].id
    const token = crypto.randomBytes(48).toString('hex')
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000)
    await pool.query(
      'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, userId, expiresAt]
    )

    // Build reset URL (frontend route), configurable base
    const base = process.env.APP_BASE_URL || 'http://localhost:5173'
    // Trim trailing slashes from base before appending the path
    const resetUrl = `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`

    // Send email if SMTP configured; always log for debugging
    console.log('[password reset] token for', normalizedEmail, token, 'expiresAt:', expiresAt.toISOString(), 'url:', resetUrl)
    if (mailer) {
      try {
        await mailer.sendMail({
          from: process.env.SMTP_USER,
          to: normalizedEmail,
          subject: 'Password Reset Request',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2>Password Reset</h2>
              <p>We received a request to reset your password. Click the button below to proceed.</p>
              <p><a href="${resetUrl}" style="background:#1890ff;color:#fff;padding:10px 16px;text-decoration:none;border-radius:4px;">Reset Password</a></p>
              <p>Or copy this link into your browser:</p>
              <p style="word-break: break-all;"><a href="${resetUrl}">${resetUrl}</a></p>
              <p style="color:#666;font-size:12px;">This link expires in ${RESET_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.</p>
            </div>
          `
        })
      } catch (mailErr) {
        console.error('Password reset email send error:', mailErr)
        // Do not expose to client; continue to return ok
      }
    }

    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/auth/request-password-reset error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Password reset: confirm
router.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
  try {
    const { token, newPassword } = req.body || {}
    const now = new Date()
    const result = await pool.query('SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token=$1', [token])
    if (result.rows.length === 0) return res.status(400).json({ error: { message: 'Invalid token' } })
    const row = result.rows[0]
    if (row.used) return res.status(400).json({ error: { message: 'Token already used' } })
    if (new Date(row.expires_at) < now) return res.status(400).json({ error: { message: 'Token expired' } })
    const hash = await bcrypt.hash(String(newPassword), 10)
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, row.user_id])
    await pool.query('UPDATE password_reset_tokens SET used=TRUE WHERE token=$1', [token])
    // Optional: invalidate refresh tokens for this user
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [row.user_id])
    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/auth/reset-password error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, role FROM users WHERE id=$1', [req.user.id])
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    return res.json({ ok: true, user: result.rows[0] })
  } catch (e) {
    console.error('GET /api/auth/me error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// User management (admin)
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.email, u.role, u.active, u.created_at, u.updated_at, u.notes, u.meta,
        lr.created_at AS last_role_change_at,
        lr.changed_by AS last_role_changed_by
      FROM users u
      LEFT JOIN LATERAL (
        SELECT id, created_at, changed_by
        FROM user_audit_log
        WHERE user_id = u.id AND action = 'set_role'
        ORDER BY id DESC
        LIMIT 1
      ) lr ON true
      ORDER BY u.id ASC
    `)
    return res.json({ ok: true, users: result.rows })
  } catch (e) {
    console.error('GET /api/auth/users error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Limited: list users by role (for managers to assign teams)
router.get('/users/by-role', authMiddleware, requireRole(['admin', 'superadmin', 'sales_manager', 'contract_manager', 'financial_manager']), validate(usersByRoleQuerySchema, 'query'), async (req, res) => {
  try {
    const role = String(req.query.role || '').trim()
    // Only allow fetching limited fields and active users
    const r = await pool.query(
      `SELECT id, email, role, active, meta FROM users WHERE role=$1 AND active=TRUE ORDER BY id ASC`,
      [role]
    )
    return res.json({ ok: true, users: r.rows })
  } catch (e) {
    console.error('GET /api/auth/users/by-role error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Get single user (with notes/meta)
router.get('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const result = await pool.query('SELECT id, email, role, active, created_at, updated_at, notes, meta FROM users WHERE id=$1', [id])
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    return res.json({ ok: true, user: result.rows[0] })
  } catch (e) {
    console.error('GET /api/auth/users/:id error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

router.patch('/users/:id/role', authMiddleware, requireRole(['superadmin']), validate(setRoleSchema), async (req, res) => {
  try {
    const { role } = req.body || {}
    const id = Number(req.params.id)
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: { message: 'Invalid role specified' } })
    }
    const tgt = await pool.query('SELECT role FROM users WHERE id=$1', [id])
    if (tgt.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    const result = await pool.query('UPDATE users SET role=$1, updated_at=now() WHERE id=$2 RETURNING id, email, role, active', [role, id])
    // Audit (who and when are captured)
    await pool.query(
      'INSERT INTO user_audit_log (user_id, action, changed_by, details) VALUES ($1, $2, $3, $4)',
      [id, 'set_role', req.user.id, JSON.stringify({ new_role: role })]
    )
    return res.json({ ok: true, user: result.rows[0] })
  } catch (e) {
    console.error('PATCH /api/auth/users/:id/role error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Create user (admin or superadmin). Admin cannot create superadmin users.
router.post('/users', authMiddleware, adminOnly, validate(createUserSchema), async (req, res) => {
  try {
    const { email, password, role = 'user', notes, meta } = req.body || {}
    const normalizedEmail = email.trim().toLowerCase()
    const existing = await pool.query('SELECT 1 FROM users WHERE email=$1', [normalizedEmail])
    if (existing.rows.length > 0) return res.status(409).json({ error: { message: 'Email already registered' } })
    const hash = await bcrypt.hash(password, 10)

    // Only superadmin can choose initial role. Admins always create 'user'.
    let finalRole = 'user'
    if (req.user.role === 'superadmin') {
      finalRole = role || 'user'
    }

    const metaObj = isObject(meta) ? meta : {}
    const insert = await pool.query(
      'INSERT INTO users (email, password_hash, role, active, notes, meta) VALUES ($1, $2, $3, TRUE, $4, $5) RETURNING id, email, role, active, notes, meta',
      [normalizedEmail, hash, finalRole, notes || null, JSON.stringify(metaObj)]
    )
    const created = insert.rows[0]
    await pool.query(
      'INSERT INTO user_audit_log (user_id, action, changed_by, details) VALUES ($1, $2, $3, $4)',
      [created.id, 'create_user', req.user.id, JSON.stringify({ role: created.role })]
    )
    return res.json({ ok: true, user: created })
  } catch (e) {
    console.error('POST /api/auth/users error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Update active flag (deactivate/reactivate); admin cannot change superadmin
router.patch('/users/:id/active', authMiddleware, adminOnly, validate(setActiveSchema), async (req, res) => {
  try {
    const { active } = req.body || {}
    const id = Number(req.params.id)
    const tgt = await pool.query('SELECT role FROM users WHERE id=$1', [id])
    if (tgt.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    if (req.user.role === 'admin' && tgt.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: { message: 'Admins cannot modify superadmin accounts' } })
    }
    const result = await pool.query('UPDATE users SET active=$1, updated_at=now() WHERE id=$2 RETURNING id, email, role, active', [active, id])
    await pool.query(
      'INSERT INTO user_audit_log (user_id, action, changed_by, details) VALUES ($1, $2, $3, $4)',
      [id, 'set_active', req.user.id, JSON.stringify({ active })]
    )
    return res.json({ ok: true, user: result.rows[0] })
  } catch (e) {
    console.error('PATCH /api/auth/users/:id/active error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Update email (optional helper)
router.patch('/users/:id', authMiddleware, adminOnly, validate(updateUserSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { email, notes, meta } = req.body || {}
    const tgt = await pool.query('SELECT role, email, notes AS old_notes, meta AS old_meta FROM users WHERE id=$1', [id])
    if (tgt.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    if (req.user.role === 'admin' && tgt.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: { message: 'Admins cannot modify superadmin accounts' } })
    }

    const updates = []
    const params = []
    const audit = {}

    if (email != null) {
      const normalizedEmail = email.trim().toLowerCase()
      const existing = await pool.query('SELECT id FROM users WHERE email=$1 AND id<>$2', [normalizedEmail, id])
      if (existing.rows.length > 0) return res.status(409).json({ error: { message: 'Email already in use' } })
      params.push(normalizedEmail)
      updates.push(`email=$${params.length}`)
      audit.email = { from: tgt.rows[0].email, to: normalizedEmail }
    }

    if (notes !== undefined) {
      params.push(String(notes))
      updates.push(`notes=$${params.length}`)
      audit.notes = { from: tgt.rows[0].old_notes || null, to: String(notes) }
    }

    if (meta !== undefined) {
      params.push(JSON.stringify(meta))
      updates.push(`meta=$${params.length}`)
      audit.meta = true
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: { message: 'No updatable fields provided' } })
    }

    params.push(id)
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING id, email, role, active, notes, meta`,
      params
    )
    await pool.query(
      'INSERT INTO user_audit_log (user_id, action, changed_by, details) VALUES ($1, $2, $3, $4)',
      [id, 'update_profile', req.user.id, JSON.stringify(audit)]
    )
    return res.json({ ok: true, user: result.rows[0] })
  } catch (e) {
    console.error('PATCH /api/auth/users/:id error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// Delete guard: admin cannot delete superadmin
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const tgt = await pool.query('SELECT role FROM users WHERE id=$1', [id])
    if (tgt.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    if (req.user.role === 'admin' && tgt.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: { message: 'Admins cannot delete superadmin accounts' } })
    }
    // Soft delete by deactivating
    const result = await pool.query('UPDATE users SET active=FALSE, updated_at=now() WHERE id=$1 RETURNING id', [id])
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    await pool.query(
      'INSERT INTO user_audit_log (user_id, action, changed_by, details) VALUES ($1, $2, $3, $4)',
      [id, 'deactivate_user', req.user.id, JSON.stringify({ via: 'DELETE' })]
    )
    return res.json({ ok: true, id })
  } catch (e) {
    console.error('DELETE /api/auth/users/:id error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

/**
 * Admin set password for a user (without email token)
 * - Admin cannot change password for superadmin accounts.
 */
router.patch('/users/:id/password', authMiddleware, adminOnly, validate(setPasswordAdminSchema), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { newPassword } = req.body || {}
    const tgt = await pool.query('SELECT role FROM users WHERE id=$1', [id])
    if (tgt.rows.length === 0) return res.status(404).json({ error: { message: 'User not found' } })
    if (req.user.role === 'admin' && tgt.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: { message: 'Admins cannot modify superadmin accounts' } })
    }
    const hash = await bcrypt.hash(String(newPassword), 10)
    await pool.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [hash, id])
    // Invalidate existing refresh tokens
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [id])
    await pool.query(
      'INSERT INTO user_audit_log (user_id, action, changed_by, details) VALUES ($1, $2, $3, $4)',
      [id, 'set_password', req.user.id, JSON.stringify({})]
    )
    return res.json({ ok: true })
  } catch (e) {
    console.error('PATCH /api/auth/users/:id/password error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

// List audit log entries for a user
router.get('/users/:id/audit', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const r = await pool.query(
      `SELECT id, action, changed_by, details, created_at
       FROM user_audit_log
       WHERE user_id=$1
       ORDER BY id DESC
       LIMIT 200`,
      [id]
    )
    return res.json({ ok: true, audit: r.rows })
  } catch (e) {
    console.error('GET /api/auth/users/:id/audit error:', e)
    return res.status(500).json({ error: { message: 'Internal error' } })
  }
})

export { authMiddleware, adminOnly, requireRole }
export default router