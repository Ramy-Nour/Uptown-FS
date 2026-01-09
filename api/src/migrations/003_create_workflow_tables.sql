-- Function for set_timestamp (required for triggers below)
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS standard_pricing (
  id SERIAL PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  price NUMERIC(18,2) NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | rejected
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standard_pricing_unit_id ON standard_pricing(unit_id);
CREATE INDEX IF NOT EXISTS idx_standard_pricing_status ON standard_pricing(status);

-- Trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_standard_pricing'
  ) THEN
    CREATE TRIGGER set_timestamp_standard_pricing
    BEFORE UPDATE ON standard_pricing
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS payment_plans (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  details JSONB NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | rejected
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_plans_deal_id ON payment_plans(deal_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_status ON payment_plans(status);

-- Trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_payment_plans'
  ) THEN
    CREATE TRIGGER set_timestamp_payment_plans
    BEFORE UPDATE ON payment_plans
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS reservation_forms (
  id SERIAL PRIMARY KEY,
  payment_plan_id INTEGER NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  details JSONB NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | rejected
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_forms_payment_plan_id ON reservation_forms(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_reservation_forms_status ON reservation_forms(status);

-- Trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_reservation_forms'
  ) THEN
    CREATE TRIGGER set_timestamp_reservation_forms
    BEFORE UPDATE ON reservation_forms
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  reservation_form_id INTEGER NOT NULL REFERENCES reservation_forms(id) ON DELETE CASCADE,
  details JSONB NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | rejected
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_reservation_form_id ON contracts(reservation_form_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

-- Trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_contracts'
  ) THEN
    CREATE TRIGGER set_timestamp_contracts
    BEFORE UPDATE ON contracts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END;
$$;
