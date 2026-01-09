import express from 'express';
import { pool } from './db.js';
import { authMiddleware, requireRole } from './authRoutes.js';

const router = express.Router();

// Ensure authentication for all pricing routes
router.use(authMiddleware);

// Upsert pricing for a unit model (FM)
router.post('/unit-model', requireRole(['financial_manager']), async (req, res) => {
  try {
    const {
      model_id,
      price,
      maintenance_price,
      garage_price,
      garden_price,
      roof_price,
      storage_price,
      std_financial_rate_percent,
      plan_duration_years,
      installment_frequency,
      standard_down_payment_percent,
      calculated_pv
    } = req.body || {};
    if (!model_id || !Number.isFinite(Number(price))) {
      return res.status(400).json({ error: { message: 'model_id and numeric price are required' } });
    }

    // Basic validation for new fields
    const rate = std_financial_rate_percent != null ? Number(std_financial_rate_percent) : null;
    const years = plan_duration_years != null ? Number(plan_duration_years) : null;
    const freq = installment_frequency != null ? String(installment_frequency).toLowerCase().trim() : null;
    const stdDp = standard_down_payment_percent != null ? Number(standard_down_payment_percent) : null;

    if (rate != null && !Number.isFinite(rate)) {
      return res.status(400).json({ error: { message: 'std_financial_rate_percent must be numeric when provided' } });
    }
    if (years != null && (!Number.isInteger(years) || years <= 0)) {
      return res.status(400).json({ error: { message: 'plan_duration_years must be integer >= 1 when provided' } });
    }
    if (freq != null && !['monthly','quarterly','biannually','annually','bi-annually'].includes(freq)) {
      return res.status(400).json({ error: { message: 'installment_frequency must be one of monthly|quarterly|biannually|bi-annually|annually when provided' } });
    }
    if (stdDp != null && (!Number.isFinite(stdDp) || stdDp < 0 || stdDp > 100)) {
      return res.status(400).json({ error: { message: 'standard_down_payment_percent must be 0..100' } });
    }

    const calcPv = calculated_pv != null ? Number(calculated_pv) : null;
    if (calcPv != null && (!Number.isFinite(calcPv) || calcPv < 0)) {
      return res.status(400).json({ error: { message: 'calculated_pv must be a non-negative number when provided' } });
    }

    const pid = Number(model_id);
    const pr = Number(price);
    const mp = Number(maintenance_price ?? 0);
    const gp = Number(garage_price ?? 0);
    const gdp = Number(garden_price ?? 0);
    const rfp = Number(roof_price ?? 0);
    const stp = Number(storage_price ?? 0);

    const existing = await pool.query('SELECT * FROM unit_model_pricing WHERE model_id=$1', [pid]);
    let out;
    if (existing.rows.length > 0) {
      const r = await pool.query(
        `UPDATE unit_model_pricing
         SET price=$1, maintenance_price=$2, garage_price=$3, garden_price=$4, roof_price=$5, storage_price=$6,
             std_financial_rate_percent=$7, plan_duration_years=$8, installment_frequency=$9, calculated_pv=$10,
             standard_down_payment_percent=$11,
             status='pending_approval', approved_by=NULL, updated_at=now()
         WHERE model_id=$12
         RETURNING *`,
        [pr, mp, gp, gdp, rfp, stp, rate, years, freq === 'biannually' ? 'biannually' : freq, calcPv, stdDp, pid]
      );
      out = r.rows[0];
    } else {
      const r = await pool.query(
        `INSERT INTO unit_model_pricing (model_id, price, maintenance_price, garage_price, garden_price, roof_price, storage_price,
                                         std_financial_rate_percent, plan_duration_years, installment_frequency, calculated_pv,
                                         standard_down_payment_percent,
                                         status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending_approval', $13)
         RETURNING *`,
        [pid, pr, mp, gp, gdp, rfp, stp, rate, years, (freq === 'biannually' ? 'biannually' : freq), calcPv, stdDp, req.user.id]
      );
      out = r.rows[0];
    }

    await pool.query(
      `INSERT INTO unit_model_pricing_audit (pricing_id, action, changed_by, details)
       VALUES ($1, $2, $3, $4)`,
      [out.id, 'upsert', req.user.id, JSON.stringify({
        model_id: pid,
        price: pr,
        maintenance_price: mp,
        garage_price: gp,
        garden_price: gdp,
        roof_price: rfp,
        storage_price: stp,
        std_financial_rate_percent: rate,
        plan_duration_years: years,
        installment_frequency: freq,
        calculated_pv: calcPv,
        standard_down_payment_percent: stdDp
      })]
    );

    return res.status(201).json({ ok: true, pricing: out });
  } catch (e) {
    console.error('POST /api/pricing/unit-model error:', e);
    res.status(500).json({ error: { message: 'Internal error' } });
  }
});

// Approve/reject (Top Management)
router.patch('/unit-model/:id/status', requireRole(['ceo', 'chairman', 'vice_chairman']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, reason } = req.body || {};
    if (!id) return res.status(400).json({ error: { message: 'Invalid id' } });
    if (!status || !['approved', 'rejected'].includes(String(status))) {
      return res.status(400).json({ error: { message: 'status must be "approved" or "rejected"' } });
    }
    const r = await pool.query(
      `UPDATE unit_model_pricing SET status=$1, approved_by=$2, updated_at=now() WHERE id=$3 RETURNING *`,
      [String(status), req.user.id, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: { message: 'Not found' } });

    await pool.query(
      `INSERT INTO unit_model_pricing_audit (pricing_id, action, changed_by, details)
       VALUES ($1, $2, $3, $4)`,
      [id, status === 'approved' ? 'approve' : 'reject', req.user.id, JSON.stringify({ reason: reason || null })]
    );

    // If approved, propagate prices to all linked units and log an audit entry (with count)
    if (String(status) === 'approved') {
      const approved = r.rows[0];
      const modelId = approved.model_id;
      const price = Number(approved.price) || 0;
      const mp = Number(approved.maintenance_price ?? 0) || 0;
      const gp = Number(approved.garage_price ?? 0) || 0;
      const gdp = Number(approved.garden_price ?? 0) || 0;
      const rfp = Number(approved.roof_price ?? 0) || 0;
      const stp = Number(approved.storage_price ?? 0) || 0;

      const upd = await pool.query(
        `UPDATE units
         SET base_price=$1, maintenance_price=$2, garage_price=$3, garden_price=$4, roof_price=$5, storage_price=$6, updated_at=now()
         WHERE model_id=$7`,
        [price, mp, gp, gdp, rfp, stp, modelId]
      );

      await pool.query(
        `INSERT INTO unit_model_pricing_audit (pricing_id, action, changed_by, details)
         VALUES ($1, 'propagate', $2, $3)`,
        [id, req.user.id, JSON.stringify({
          propagated_to_units: upd.rowCount || 0,
          model_id: modelId,
          new_price: price,
          maintenance_price: mp,
          garage_price: gp,
          garden_price: gdp,
          roof_price: rfp,
          storage_price: stp
        })]
      );
    }

    return res.json({ ok: true, pricing: r.rows[0] });
  } catch (e) {
    console.error('PATCH /api/pricing/unit-model/:id/status error:', e);
    res.status(500).json({ error: { message: 'Internal error' } });
  }
});

// List ALL pricing (FM + Top Management)
router.get('/unit-model', requireRole(['financial_manager', 'ceo', 'chairman', 'vice_chairman']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         p.id, p.model_id, p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price,
         p.std_financial_rate_percent, p.plan_duration_years, p.installment_frequency, p.calculated_pv, p.standard_down_payment_percent,
         p.status, p.created_at, p.updated_at,
         m.model_name,
         m.model_code,
         m.area,
         creator.email AS created_by_email,
         approver.email AS approved_by_email
       FROM unit_model_pricing p
       JOIN unit_models m ON m.id = p.model_id
       LEFT JOIN users creator ON creator.id = p.created_by
       LEFT JOIN users approver ON approver.id = p.approved_by
       ORDER BY p.updated_at DESC`
    );
    return res.json({ ok: true, pricings: r.rows });
  } catch (e) {
    console.error('GET /api/pricing/unit-model error:', e);
    res.status(500).json({ error: { message: 'Internal error' } });
  }
});

// List ONLY PENDING pricing for the approval queue (Top Management)
router.get('/unit-model/pending', requireRole(['ceo', 'chairman', 'vice_chairman']), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         p.id, p.model_id, p.price, p.maintenance_price, p.garage_price, p.garden_price, p.roof_price, p.storage_price,
         p.std_financial_rate_percent, p.plan_duration_years, p.installment_frequency, p.calculated_pv, p.standard_down_payment_percent,
         p.status,
         m.model_name,
         m.model_code,
         m.area,
         m.has_garden,
         m.garden_area,
         m.has_roof,
         m.roof_area,
         creator.email AS created_by_email
       FROM unit_model_pricing p
       JOIN unit_models m ON m.id = p.model_id
       LEFT JOIN users creator ON creator.id = p.created_by
       WHERE p.status = 'pending_approval'
       ORDER BY p.updated_at DESC`
    );
    return res.json({ ok: true, pendingPricings: r.rows });
  } catch (e) {
    console.error('GET /api/pricing/unit-model/pending error:', e);
    res.status(500).json({ error: { message: 'Internal error' } });
  }
});

// Financial Manager: cancel a pending pricing request they created
router.delete('/unit-model/:id', requireRole(['financial_manager']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: { message: 'Invalid id' } });
    const cur = await pool.query(`SELECT id, status, created_by FROM unit_model_pricing WHERE id=$1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: { message: 'Pricing not found' } });
    const p = cur.rows[0];
    if (p.status !== 'pending_approval') {
      return res.status(400).json({ error: { message: 'Only pending pricing can be cancelled' } });
    }
    if (p.created_by !== req.user.id) {
      return res.status(403).json({ error: { message: 'You can only cancel your own pricing requests' } });
    }
    await pool.query('DELETE FROM unit_model_pricing WHERE id=$1', [id]);
    await pool.query(
      `INSERT INTO unit_model_pricing_audit (pricing_id, action, changed_by, details)
       VALUES ($1, 'cancel', $2, $3)`,
      [id, req.user.id, JSON.stringify({ reason: 'cancelled_by_financial_manager' })]
    );
    return res.json({ ok: true, deleted_id: id });
  } catch (e) {
    console.error('DELETE /api/pricing/unit-model/:id error:', e);
    res.status(500).json({ error: { message: 'Internal error' } });
  }
});

// Pricing audit history
router.get('/unit-model/:id/audit', requireRole(['financial_manager', 'ceo', 'chairman', 'vice_chairman']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: { message: 'Invalid id' } });

    const r = await pool.query(
      `SELECT a.*, u.email AS changed_by_email
       FROM unit_model_pricing_audit a
       LEFT JOIN users u ON u.id = a.changed_by
       WHERE a.pricing_id=$1
       ORDER BY a.id DESC`,
      [id]
    );
    return res.json({ ok: true, audit: r.rows });
  } catch (e) {
    console.error('GET /api/pricing/unit-model/:id/audit error:', e);
    res.status(500).json({ error: { message: 'Internal error' } });
  }
});

export default router;