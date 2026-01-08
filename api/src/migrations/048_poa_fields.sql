-- Add POA multi-field columns to deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS poa_number TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS poa_letter TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS poa_year TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS poa_office TEXT;
