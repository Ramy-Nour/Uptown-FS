-- Add standard_down_payment_percent to unit_model_pricing
ALTER TABLE IF EXISTS unit_model_pricing
  ADD COLUMN IF NOT EXISTS standard_down_payment_percent NUMERIC(5,2) DEFAULT 0;
