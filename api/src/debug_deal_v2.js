
import 'dotenv/config'

async function run() {
  const { pool } = await import('./db.js')
  try {
    console.log('--- Checking Latest Deal ---')
    const res = await pool.query('SELECT id, created_by, status, details FROM deals ORDER BY id DESC LIMIT 1')
    if (res.rows.length === 0) {
      console.log('No deals found')
      return
    }
    const deal = res.rows[0]
    console.log(`Deal ID: ${deal.id}`)
    console.log(`Created By User ID: ${deal.created_by}`)
    console.log(`Status: ${deal.status}`)
    
    const unitId = deal.details?.calculator?.unitInfo?.unit_id
    const decision = deal.details?.calculator?.generatedPlan?.evaluation?.decision
    
    console.log(`Target Unit ID (from JSON): ${unitId}`)
    console.log(`Decision (from JSON): ${decision}`)
    
    if (!unitId) {
      console.log('ERROR: No unit_id found in deal details')
    }
    if (decision !== 'ACCEPT') {
      console.log('WARNING: Decision is not ACCEPT')
    }

    console.log('--- Testing SQL Query Match ---')
    // This is the exact query logic added to blockManagement.js
    const check = await pool.query(`
        SELECT d.id
        FROM deals d
        WHERE d.id = $1
          AND d.status NOT IN ('rejected', 'cancelled')
          AND (d.details->'calculator'->'unitInfo'->>'unit_id')::int = $2
          AND d.details->'calculator'->'generatedPlan'->'evaluation'->>'decision' = 'ACCEPT'
    `, [deal.id, unitId])
    
    if (check.rows.length > 0) {
      console.log('SUCCESS: SQL Query MATCHES this deal.')
    } else {
      console.log('FAILURE: SQL Query does NOT match this deal.')
      // Debug why
      if (deal.status === 'rejected' || deal.status === 'cancelled') console.log('- Status is rejected/cancelled')
      if (String(deal.details?.calculator?.unitInfo?.unit_id) !== String(unitId)) console.log('- Unit ID mismatch (type?)')
      if (deal.details?.calculator?.generatedPlan?.evaluation?.decision !== 'ACCEPT') console.log('- Decision is not ACCEPT')
    }

  } catch (e) {
    console.error(e)
  } finally {
    await pool.end()
  }
}

run()
