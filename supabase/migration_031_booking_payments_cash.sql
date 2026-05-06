-- migration_031_booking_payments_cash.sql
-- 1. Agrega campo is_cash a bank_accounts (cuenta de efectivo especial).
-- 2. Crea tabla booking_payments para pagos parciales/múltiples por reserva.

-- ─── 1. Campo is_cash ─────────────────────────────────────────────────────────
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 2. Tabla booking_payments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  payment_date    DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'booking_payments' AND policyname = 'booking_payments_owner'
  ) THEN
    EXECUTE $p$
      CREATE POLICY booking_payments_owner ON public.booking_payments
        FOR ALL
        USING  (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $p$;
  END IF;
END;
$$;
