-- Contract Settings Unlock Requests table
CREATE TABLE IF NOT EXISTS contract_settings_requests (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_settings_requests_deal_id ON contract_settings_requests(deal_id);
CREATE INDEX IF NOT EXISTS idx_contract_settings_requests_status ON contract_settings_requests(status);
