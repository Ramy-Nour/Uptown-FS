-- Unit inventory change requests (FA requests, FM approves/rejects)
CREATE TABLE IF NOT EXISTS unit_inventory_changes (
  id SERIAL PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'update' | 'delete'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, -- for 'update' holds proposed fields
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | rejected
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_unit_inventory_changes') THEN
    CREATE TRIGGER set_timestamp_unit_inventory_changes
    BEFORE UPDATE ON unit_inventory_changes
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_unit_inventory_changes_status ON unit_inventory_changes(status);
CREATE INDEX IF NOT EXISTS idx_unit_inventory_changes_unit ON unit_inventory_changes(unit_id);