-- Add explicit approval/rejection audit fields to reservation_forms
-- to match api/src/reservationFormsRoutes.js (approved_at, rejected_by, rejected_at).

ALTER TABLE reservation_forms
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;