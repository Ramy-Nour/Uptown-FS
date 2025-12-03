-- Align reservation_forms schema with new workflow fields
-- Adds explicit unit linkage and basic metadata columns used by
-- api/src/reservationFormsRoutes.js.

ALTER TABLE reservation_forms
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reservation_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preliminary_payment NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS language TEXT;

CREATE INDEX IF NOT EXISTS idx_reservation_forms_unit_id ON reservation_forms(unit_id);