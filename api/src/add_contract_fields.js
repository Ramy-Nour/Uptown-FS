
import { pool } from './db.js';

async function migrate() {
  try {
    console.log('Adding contract fields to deals table...');
    
    // Add columns if they don't exist
    await pool.query(`
      ALTER TABLE deals 
      ADD COLUMN IF NOT EXISTS contract_date DATE,
      ADD COLUMN IF NOT EXISTS poa_statement TEXT,
      ADD COLUMN IF NOT EXISTS contract_settings_locked BOOLEAN DEFAULT FALSE;
    `);

    console.log('Successfully added columns: contract_date, poa_statement, contract_settings_locked');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
