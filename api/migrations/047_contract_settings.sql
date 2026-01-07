-- Add contract settings columns to deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS contract_date DATE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS poa_statement TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS contract_settings_locked BOOLEAN DEFAULT FALSE;
