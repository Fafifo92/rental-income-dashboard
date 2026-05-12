-- migration_049_booking_deposits.sql
-- ============================================================
-- Adds security deposit tracking to bookings.
--
-- A security deposit is money collected from the guest at
-- check-in (or booking time) that is:
--   - Held in a bank account (tracked via deposit_bank_account_id)
--   - Returned to the guest at check-out (if no damage)
--   - Partially or fully applied to damage charges when damage occurs
--
-- deposit_status lifecycle:
--   none          → no deposit was taken
--   received      → deposit received, not yet returned
--   partial_return → partial return done (damage deducted)
--   returned      → deposit fully returned to guest
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + ADD CONSTRAINT IF NOT EXISTS
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS security_deposit          NUMERIC       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_bank_account_id   UUID          DEFAULT NULL
    REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deposit_status            TEXT          NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS deposit_returned_amount   NUMERIC       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_return_date       DATE          DEFAULT NULL;

-- Add CHECK constraint if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name         = 'bookings'
      AND constraint_name    = 'chk_bookings_deposit_status'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT chk_bookings_deposit_status
        CHECK (deposit_status IN ('none', 'received', 'partial_return', 'returned'));
  END IF;
END;
$$;

-- Index for quickly finding bookings with pending deposit returns
CREATE INDEX IF NOT EXISTS idx_bookings_deposit_status
  ON public.bookings (deposit_status)
  WHERE deposit_status <> 'none';

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'bookings'
--   AND column_name  IN (
--     'security_deposit','deposit_bank_account_id',
--     'deposit_status','deposit_returned_amount','deposit_return_date'
--   );
-- Esperado: 5 filas.
-- ============================================================
