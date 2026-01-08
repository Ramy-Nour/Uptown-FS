-- Add approved_at column to contracts table for CM approval timestamp
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
