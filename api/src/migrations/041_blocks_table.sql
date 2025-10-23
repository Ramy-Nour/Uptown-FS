-- Blocks (unit blocking requests/approvals)
-- Creates the blocks table and common indexes. Safe to run multiple times via schema_migrations tracking.

CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  duration_days INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired
  blocked_until TIMESTAMPTZ NOT NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approval_reason TEXT,
  rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  extension_count INTEGER DEFAULT 0,
  expiry_notified BOOLEAN DEFAULT FALSE,
  last_extension_reason TEXT,
  last_extended_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_extended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_blocks_unit ON blocks(unit_id);
CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_until ON blocks(blocked_until);

-- Ensure timestamp trigger exists on blocks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_blocks') THEN
    CREATE TRIGGER set_timestamp_blocks
    BEFORE UPDATE ON blocks
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END;
$$;