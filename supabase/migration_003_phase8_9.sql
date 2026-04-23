-- ============================================================
-- MIGRATION 003 — Fase 8 + 9
-- Configuración por propiedad + Gastos recurrentes + Cuentas bancarias + Payout real
-- ============================================================
-- Seguro correrlo varias veces (idempotente).
-- ============================================================

-- ── 1. PROPERTIES: campos de configuración ─────────────────
ALTER TABLE properties ADD COLUMN IF NOT EXISTS estrato       INT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS bedrooms      INT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS max_guests    INT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS notes         TEXT;

-- ── 2. PROPERTY_RECURRING_EXPENSES ─────────────────────────
CREATE TABLE IF NOT EXISTS property_recurring_expenses (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  category      TEXT NOT NULL,
  amount        NUMERIC(12, 2) NOT NULL,
  is_active     BOOLEAN DEFAULT true NOT NULL,
  day_of_month  INT DEFAULT 1,
  description   TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE property_recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recurring_own" ON property_recurring_expenses;
CREATE POLICY "recurring_own" ON property_recurring_expenses FOR ALL USING (
  EXISTS (
    SELECT 1 FROM properties
    WHERE properties.id = property_recurring_expenses.property_id
      AND properties.owner_id = auth.uid()
  )
);

-- ── 3. BANK_ACCOUNTS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name                TEXT NOT NULL,
  bank                TEXT,
  account_type        TEXT CHECK (account_type IN ('ahorros','corriente','billetera','otro')),
  account_number_mask TEXT,
  currency            TEXT DEFAULT 'COP' NOT NULL,
  opening_balance     NUMERIC(14, 2) DEFAULT 0 NOT NULL,
  is_active           BOOLEAN DEFAULT true NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bank_accounts_own" ON bank_accounts;
CREATE POLICY "bank_accounts_own" ON bank_accounts FOR ALL USING (auth.uid() = owner_id);

-- ── 4. BOOKINGS: canal + payout real ───────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'airbnb';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gross_revenue NUMERIC(12, 2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS channel_fees  NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS taxes_withheld NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS net_payout    NUMERIC(12, 2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payout_bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payout_date   DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency      TEXT DEFAULT 'COP';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12, 4);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes         TEXT;

-- Backfill: gross_revenue := total_revenue para filas históricas
UPDATE bookings SET gross_revenue = total_revenue WHERE gross_revenue IS NULL;

-- ── 5. EXPENSES: ampliaciones para Fase 9+ ─────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor          TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS person_in_charge TEXT;

-- ── 6. ÍNDICES útiles ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_recurring_property ON property_recurring_expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_payout_bank ON bookings(payout_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_bank ON expenses(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_booking ON expenses(booking_id);

-- ── 7. LISTO ───────────────────────────────────────────────
-- Todas las columnas son opcionales/con defaults, los históricos no se rompen.
