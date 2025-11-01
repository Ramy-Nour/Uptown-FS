-- Blocks override and financial validation extensions

-- Add columns to blocks if they do not exist
ALTER TABLE IF EXISTS blocks
  ADD COLUMN IF NOT EXISTS requested_plan_id INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS financial_decision TEXT,
  ADD COLUMN IF NOT EXISTS financial_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS override_status TEXT; -- null|pending_sm|pending_fm|pending_tm|approved|rejected

-- Audit table for block overrides (optional but recommended)
CREATE TABLE IF NOT EXISTS block_overrides (
  id SERIAL PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  decision TEXT NOT NULL, -- request_sm|approve_sm|reject_sm|approve_fm|reject_fm|approve_tm|reject_tm
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_block_overrides_block_id ON block_overrides(block_id);