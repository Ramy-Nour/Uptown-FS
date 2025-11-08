-- Compatibility migration: add missing columns used by legacy queries

-- notifications: add updated_at to satisfy queries that try to update it
ALTER TABLE IF EXISTS notifications
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- standard_plan: add status and approved_by to satisfy legacy selectors
-- Note: current flow uses 'active' boolean; status is informational when present.
ALTER TABLE IF EXISTS standard_plan
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;