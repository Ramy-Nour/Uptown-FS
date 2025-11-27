
import { pool } from './db.js';

async function fixMissingPlans() {
  const client = await pool.connect();
  try {
    console.log('Starting backfill of missing payment plans for approved blocks...');

    // 1. Get all active approved blocks
    const blocksRes = await client.query(`
      SELECT b.id, b.unit_id, b.requested_by, b.financial_decision, u.code as unit_code
      FROM blocks b
      JOIN units u ON u.id = b.unit_id
      WHERE b.status = 'approved' 
        AND b.blocked_until > NOW()
    `);
    
    console.log(`Found ${blocksRes.rows.length} active approved blocks.`);

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const block of blocksRes.rows) {
      // 2. Check if an approved payment plan already exists for this unit
      // Logic mirrors 'approved-for-unit' endpoint
      const planRes = await client.query(`
        WITH target AS (
          SELECT $1::int AS unit_id, TRIM($2) AS unit_code
        )
        SELECT pp.id
        FROM payment_plans pp, target t
        WHERE pp.status='approved'
          AND (
            (
              TRIM(COALESCE(pp.details->'calculator'->'unitInfo'->>'unit_id','')) ~ '^[0-9]+$'
              AND (TRIM(pp.details->'calculator'->'unitInfo'->>'unit_id')::int = t.unit_id)
            )
            OR (
              TRIM(COALESCE(pp.details->'calculator'->'unitInfo'->>'unit_code','')) = t.unit_code
            )
          )
        LIMIT 1
      `, [block.unit_id, block.unit_code]);

      if (planRes.rows.length > 0) {
        // Plan exists, nothing to do
        skippedCount++;
        continue;
      }

      console.log(`Block #${block.id} (Unit: ${block.unit_code}) has NO approved plan. Attempting to fix...`);

      // 3. Find the latest ACCEPT deal for this unit/consultant
      // Using the broadened lookup logic
      try {
        const dealRes = await client.query(`
            SELECT d.id, d.status, d.details, d.created_by
            FROM deals d
            WHERE d.created_by = $1
              AND d.status IN ('draft','pending_approval','approved')
              AND d.details->'calculator'->'generatedPlan'->'evaluation'->>'decision' = 'ACCEPT'
              AND (
                (
                  TRIM(COALESCE(d.details->'calculator'->'unitInfo'->>'unit_id','')) ~ '^[0-9]+'
                  AND TRIM(d.details->'calculator'->'unitInfo'->>'unit_id')::int = $2
                )
                OR
                (
                  TRIM(COALESCE(d.details->'calculator'->'unitInfo'->>'unit_code','')) = $3
                )
              )
            ORDER BY d.id DESC
            LIMIT 1
        `, [block.requested_by, block.unit_id, block.unit_code]);

        if (dealRes.rows.length === 0) {
          console.warn(`  -> No suitable ACCEPT deal found for Block #${block.id}. Skipping.`);
          errorCount++;
          continue;
        }

        const deal = dealRes.rows[0];

        // 4. Create the payment plan
        const insRes = await client.query(`
          INSERT INTO payment_plans (deal_id, details, created_by, status)
          VALUES ($1, $2, $3, 'approved')
          RETURNING id
        `, [deal.id, deal.details || {}, deal.created_by]);

        console.log(`  -> FIXED: Created Payment Plan #${insRes.rows[0].id} from Deal #${deal.id}`);
        fixedCount++;

      } catch (err) {
        console.error(`  -> Error processing Block #${block.id}:`, err.message);
        errorCount++;
      }
    }

    console.log('--------------------------------------------------');
    console.log(`Backfill Complete.`);
    console.log(`Total Blocks Checked: ${blocksRes.rows.length}`);
    console.log(`Skipped (Already OK): ${skippedCount}`);
    console.log(`Fixed (Plan Created): ${fixedCount}`);
    console.log(`Errors / No Deal Found: ${errorCount}`);
    console.log('--------------------------------------------------');

  } catch (e) {
    console.error('Fatal error in backfill script:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

fixMissingPlans();
