-- ============================================================
-- schema_consolidated.sql
-- ============================================================
-- SNAPSHOT CANÓNICO del esquema completo de la base de datos.
-- Generado a partir de schema.sql + migraciones 001–038.
-- Fecha: 2026-05-07
--
-- PROPÓSITO:
--   • Referencia única y legible del estado actual de la DB.
--   • Punto de partida para nuevos entornos / staging.
--   • Input para herramientas de diagramado y documentación.
--
-- ¿CÓMO APLICAR?
--   Este archivo es un SNAPSHOT de referencia, NO se debe aplicar
--   sobre una DB que ya tiene las migraciones individuales. Para
--   nuevos entornos, aplícalo completo en orden; luego salta al
--   número de migración más alto (actualmente 038).
--
-- CONVENCIONES:
--   • snake_case, plural para tablas.
--   • owner_id UUID → auth.users(id) en toda tabla de usuario.
--   • RLS habilitada en 100% de tablas públicas.
--   • Todas las políticas usan auth.uid() — sin SECURITY DEFINER
--     salvo handle_new_user (trigger de perfil).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- EXTENSIONES
-- ─────────────────────────────────────────────────────────────
-- (Supabase ya instala pgcrypto y uuid-ossp por defecto.)

-- ─────────────────────────────────────────────────────────────
-- FUNCIONES DE UTILIDAD
-- ─────────────────────────────────────────────────────────────

-- Trigger genérico: actualiza updated_at = now() en BEFORE UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Trigger legacy para inventory_items / inventory_maintenance_schedules.
-- Alias que apunta a la misma lógica. Se mantiene por compatibilidad.
CREATE OR REPLACE FUNCTION public.set_inventory_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Auto-crea perfil cuando un usuario se registra en auth.users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 1. PROFILES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT,
  role       TEXT DEFAULT 'owner' CHECK (role IN ('admin', 'owner')),
  timezone   TEXT NOT NULL DEFAULT 'America/Bogota',  -- mig_030
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_own" ON public.profiles;
CREATE POLICY "profiles_own" ON public.profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ─────────────────────────────────────────────────────────────
-- 2. PROPERTIES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.properties (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name                  TEXT NOT NULL,
  address               TEXT,
  base_currency         TEXT DEFAULT 'COP' NOT NULL,
  default_cleaning_fee  NUMERIC(12,2),              -- mig_011
  rnt_number            TEXT,                        -- mig_018
  group_id              UUID,                        -- FK added after property_groups (mig_028)
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_properties_owner   ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_group   ON public.properties(group_id);  -- mig_028

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_own" ON public.properties;
CREATE POLICY "properties_own" ON public.properties
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS trg_properties_updated_at ON public.properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. PROPERTY_GROUPS  (mig_028)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT 'slate',   -- tailwind color name or hex
  sort_order INT  DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_property_groups_owner ON public.property_groups(owner_id);

ALTER TABLE public.property_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_full_property_groups" ON public.property_groups;
CREATE POLICY "owner_full_property_groups" ON public.property_groups
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- FK deferred (property_groups debe existir antes de la FK en properties)
ALTER TABLE public.properties
  ADD CONSTRAINT IF NOT EXISTS fk_properties_group
  FOREIGN KEY (group_id) REFERENCES public.property_groups(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. PROPERTY_TAGS  (mig_028)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT 'blue',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_property_tags_owner ON public.property_tags(owner_id);

ALTER TABLE public.property_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_full_property_tags" ON public.property_tags;
CREATE POLICY "owner_full_property_tags" ON public.property_tags
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────
-- 5. PROPERTY_TAG_ASSIGNMENTS  (mig_028)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_tag_assignments (
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES public.property_tags(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (property_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_pta_owner ON public.property_tag_assignments(owner_id);
CREATE INDEX IF NOT EXISTS idx_pta_tag   ON public.property_tag_assignments(tag_id);

ALTER TABLE public.property_tag_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_full_property_tag_assignments" ON public.property_tag_assignments;
CREATE POLICY "owner_full_property_tag_assignments" ON public.property_tag_assignments
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.property_tags t WHERE t.id = property_tag_assignments.tag_id AND t.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.property_tags t WHERE t.id = property_tag_assignments.tag_id AND t.owner_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 6. LISTINGS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.listings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  external_name TEXT NOT NULL,
  source        TEXT DEFAULT 'airbnb',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  UNIQUE(property_id, external_name)
);

CREATE INDEX IF NOT EXISTS idx_listings_property ON public.listings(property_id);

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listings_own" ON public.listings;
CREATE POLICY "listings_own" ON public.listings
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = listings.property_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = listings.property_id AND p.owner_id = auth.uid()));

DROP TRIGGER IF EXISTS trg_listings_updated_at ON public.listings;
CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 7. BOOKINGS
-- ─────────────────────────────────────────────────────────────
-- IMPORTANTE: bookings NO tiene owner_id propio.
-- El owner se resuelve via: listing_id → listings → properties.owner_id
CREATE TABLE IF NOT EXISTS public.bookings (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id        UUID REFERENCES public.listings(id) ON DELETE CASCADE NOT NULL,
  confirmation_code TEXT UNIQUE NOT NULL,
  guest_name        TEXT,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  booked_at         DATE,
  num_nights        INTEGER NOT NULL,
  num_adults        INTEGER DEFAULT 1,
  num_children      INTEGER DEFAULT 0,
  total_revenue     NUMERIC(12, 2) NOT NULL,
  status            TEXT,
  raw_data          JSONB,
  -- Banderas operativas (mig_011)
  checkin_done      BOOLEAN DEFAULT false NOT NULL,
  checkout_done     BOOLEAN DEFAULT false NOT NULL,
  inventory_checked BOOLEAN DEFAULT false NOT NULL,
  operational_notes TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_listing       ON public.bookings(listing_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates         ON public.bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status        ON public.bookings(status);
-- Composite (mig_037): para queries con filtro por listing + fecha (RLS resuelve via listing)
CREATE INDEX IF NOT EXISTS idx_bookings_listing_dates ON public.bookings(listing_id, start_date DESC);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_own" ON public.bookings;
CREATE POLICY "bookings_own" ON public.bookings
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.listings l
    JOIN public.properties p ON p.id = l.property_id
    WHERE l.id = bookings.listing_id AND p.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.listings l
    JOIN public.properties p ON p.id = l.property_id
    WHERE l.id = bookings.listing_id AND p.owner_id = auth.uid()
  ));

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 8. BANK_ACCOUNTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name         TEXT NOT NULL,
  bank         TEXT,
  account_type TEXT DEFAULT 'checking' CHECK (account_type IN ('checking','savings','credit','digital','other','credito')),  -- mig_029
  balance      NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency     TEXT DEFAULT 'COP',
  is_credit    BOOLEAN NOT NULL DEFAULT false,  -- mig_020
  credit_limit NUMERIC(14,2),                   -- mig_020
  is_cash      BOOLEAN NOT NULL DEFAULT FALSE,  -- mig_031
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_owner_id ON public.bank_accounts(owner_id);  -- mig_034

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_accounts_own" ON public.bank_accounts;
CREATE POLICY "bank_accounts_own" ON public.bank_accounts
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 9. EXPENSES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  property_id     UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  category        TEXT NOT NULL,
  subcategory     TEXT,                                 -- mig_015
  type            TEXT CHECK (type IN ('fixed', 'variable')) NOT NULL DEFAULT 'variable',
  amount          NUMERIC(12, 2) NOT NULL,
  currency        TEXT DEFAULT 'COP',
  date            DATE NOT NULL,
  description     TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial')),
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,  -- mig_019
  vendor_id       UUID REFERENCES public.vendors(id) ON DELETE SET NULL,        -- mig_008 (FK added after vendors)
  shared_bill_id  UUID REFERENCES public.shared_bills(id) ON DELETE SET NULL,   -- mig_013 (FK added after shared_bills)
  expense_group   TEXT,                                 -- mig_019 (grouping key for multi-property expenses)
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_owner          ON public.expenses(owner_id);
CREATE INDEX IF NOT EXISTS idx_expenses_property       ON public.expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor_id      ON public.expenses(vendor_id);       -- mig_008
CREATE INDEX IF NOT EXISTS idx_expenses_shared_bill    ON public.expenses(shared_bill_id);  -- mig_013
CREATE INDEX IF NOT EXISTS idx_expenses_bank_account   ON public.expenses(bank_account_id); -- mig_019
-- Composite (mig_037)
CREATE INDEX IF NOT EXISTS idx_expenses_owner_date     ON public.expenses(owner_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_category ON public.expenses(owner_id, category);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_own" ON public.expenses;
CREATE POLICY "expenses_own" ON public.expenses
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 10. PROPERTY_RECURRING_EXPENSES
-- ─────────────────────────────────────────────────────────────
-- Gastos recurrentes configurados por propiedad (internet, admin, etc.)
-- NOTA: legacy — se espera consolidación futura hacia vendors (Bloque 6.5).
CREATE TABLE IF NOT EXISTS public.property_recurring_expenses (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id      UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  category         TEXT NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  frequency        TEXT DEFAULT 'monthly',
  description      TEXT,
  vendor           TEXT,                   -- mig_005 legacy text (→ vendor_id cuando se backfillee)
  person_in_charge TEXT,                   -- mig_005
  valid_from       DATE NOT NULL DEFAULT '2020-01-01',  -- mig_004
  valid_to         DATE,                   -- mig_004 NULL = vigente
  vendor_id        UUID REFERENCES public.vendors(id) ON DELETE SET NULL,  -- mig_008
  is_shared        BOOLEAN NOT NULL DEFAULT false,                          -- mig_013
  day_of_month     INTEGER,                -- mig_015
  is_variable      BOOLEAN DEFAULT false,  -- mig_015
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recurring_property    ON public.property_recurring_expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_recurring_validity    ON public.property_recurring_expenses(property_id, valid_from, valid_to);  -- mig_004
CREATE INDEX IF NOT EXISTS idx_recurring_vendor_id   ON public.property_recurring_expenses(vendor_id);  -- mig_008

ALTER TABLE public.property_recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recurring_own" ON public.property_recurring_expenses;
CREATE POLICY "recurring_own" ON public.property_recurring_expenses
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_recurring_expenses.property_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_recurring_expenses.property_id AND p.owner_id = auth.uid()));

DROP TRIGGER IF EXISTS trg_recurring_updated_at ON public.property_recurring_expenses;
CREATE TRIGGER trg_recurring_updated_at
  BEFORE UPDATE ON public.property_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 11. RECURRING_EXPENSE_PERIODS  (mig_012)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recurring_expense_periods (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recurring_id UUID REFERENCES public.property_recurring_expenses(id) ON DELETE CASCADE NOT NULL,
  year_month   CHAR(7) NOT NULL,    -- 'YYYY-MM'
  status       TEXT NOT NULL CHECK (status IN ('paid', 'skipped')),
  expense_id   UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  paid_at      TIMESTAMPTZ,
  amount       NUMERIC(14,2),
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (recurring_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_recurring_periods_recurring  ON public.recurring_expense_periods(recurring_id);
CREATE INDEX IF NOT EXISTS idx_recurring_periods_yearmonth  ON public.recurring_expense_periods(year_month);
-- Composite (mig_037)
CREATE INDEX IF NOT EXISTS idx_recurring_periods_rec_month  ON public.recurring_expense_periods(recurring_id, year_month DESC);

ALTER TABLE public.recurring_expense_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_select_own" ON public.recurring_expense_periods;
CREATE POLICY "rep_select_own" ON public.recurring_expense_periods FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.property_recurring_expenses pre
    JOIN public.properties p ON p.id = pre.property_id
    WHERE pre.id = recurring_expense_periods.recurring_id AND p.owner_id = auth.uid()
  )
);
DROP POLICY IF EXISTS "rep_insert_own" ON public.recurring_expense_periods;
CREATE POLICY "rep_insert_own" ON public.recurring_expense_periods FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.property_recurring_expenses pre
    JOIN public.properties p ON p.id = pre.property_id
    WHERE pre.id = recurring_expense_periods.recurring_id AND p.owner_id = auth.uid()
  )
);
DROP POLICY IF EXISTS "rep_update_own" ON public.recurring_expense_periods;
CREATE POLICY "rep_update_own" ON public.recurring_expense_periods FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.property_recurring_expenses pre
    JOIN public.properties p ON p.id = pre.property_id
    WHERE pre.id = recurring_expense_periods.recurring_id AND p.owner_id = auth.uid()
  )
);
DROP POLICY IF EXISTS "rep_delete_own" ON public.recurring_expense_periods;
CREATE POLICY "rep_delete_own" ON public.recurring_expense_periods FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.property_recurring_expenses pre
    JOIN public.properties p ON p.id = pre.property_id
    WHERE pre.id = recurring_expense_periods.recurring_id AND p.owner_id = auth.uid()
  )
);

-- ─────────────────────────────────────────────────────────────
-- 12. VENDORS  (mig_008)
-- ─────────────────────────────────────────────────────────────
-- utility | admin | maintenance | cleaner | insurance | other | business_service | tax
CREATE TABLE IF NOT EXISTS public.vendors (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id       UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('utility','admin','maintenance','cleaner','insurance','other','business_service','tax')),  -- mig_021 añade business_service
  category       TEXT,              -- snapshot categoría de gasto para clasificación automática
  contact        TEXT,
  notes          TEXT,
  active         BOOLEAN DEFAULT true,
  default_amount NUMERIC(12,2),     -- mig_013 (via shared_bills context)
  day_of_month   INTEGER,
  start_year_month CHAR(7),         -- mig_025
  is_variable    BOOLEAN DEFAULT false,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_owner_kind ON public.vendors(owner_id, kind);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_own" ON public.vendors;
CREATE POLICY "vendors_own" ON public.vendors
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON public.vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 13. VENDOR_PROPERTIES  (mig_013)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_properties (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id     UUID REFERENCES public.vendors(id) ON DELETE CASCADE NOT NULL,
  property_id   UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  share_percent NUMERIC(6,3),   -- NULL = reparto igual automático
  fixed_amount  NUMERIC(12,2),  -- mig_014 (monto fijo por propiedad)
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (vendor_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_properties_vendor   ON public.vendor_properties(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_properties_property ON public.vendor_properties(property_id);

ALTER TABLE public.vendor_properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vp_select_own" ON public.vendor_properties;
CREATE POLICY "vp_select_own" ON public.vendor_properties FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "vp_insert_own" ON public.vendor_properties;
CREATE POLICY "vp_insert_own" ON public.vendor_properties FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "vp_update_own" ON public.vendor_properties;
CREATE POLICY "vp_update_own" ON public.vendor_properties FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "vp_delete_own" ON public.vendor_properties;
CREATE POLICY "vp_delete_own" ON public.vendor_properties FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);

-- ─────────────────────────────────────────────────────────────
-- 14. SHARED_BILLS  (mig_013)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shared_bills (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id       UUID REFERENCES public.vendors(id) ON DELETE CASCADE NOT NULL,
  year_month      CHAR(7) NOT NULL,
  total_amount    NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  paid_date       DATE NOT NULL,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  category        TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (vendor_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_shared_bills_vendor    ON public.shared_bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_shared_bills_yearmonth ON public.shared_bills(year_month);

ALTER TABLE public.shared_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sb_select_own" ON public.shared_bills;
CREATE POLICY "sb_select_own" ON public.shared_bills FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "sb_insert_own" ON public.shared_bills;
CREATE POLICY "sb_insert_own" ON public.shared_bills FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "sb_update_own" ON public.shared_bills;
CREATE POLICY "sb_update_own" ON public.shared_bills FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "sb_delete_own" ON public.shared_bills;
CREATE POLICY "sb_delete_own" ON public.shared_bills FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);

-- ─────────────────────────────────────────────────────────────
-- 15. BOOKING_ADJUSTMENTS  (mig_006)
-- ─────────────────────────────────────────────────────────────
-- extra_income | discount | damage_charge
CREATE TABLE IF NOT EXISTS public.booking_adjustments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id      UUID REFERENCES public.bookings(id) ON DELETE CASCADE NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('extra_income', 'discount', 'damage_charge', 'platform_fee', 'tax')),  -- mig_023 añade platform_fee, tax
  amount          NUMERIC(12, 2) NOT NULL,
  description     TEXT,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,  -- mig_026
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_adjustments_booking          ON public.booking_adjustments(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_adjustments_bank_account_id  ON public.booking_adjustments(bank_account_id) WHERE bank_account_id IS NOT NULL;  -- mig_026
-- Composite (mig_037)
CREATE INDEX IF NOT EXISTS idx_booking_adjustments_booking_kind     ON public.booking_adjustments(booking_id, kind);

ALTER TABLE public.booking_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_adjustments_own" ON public.booking_adjustments;
CREATE POLICY "booking_adjustments_own" ON public.booking_adjustments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.properties p ON p.id = l.property_id
    WHERE b.id = booking_adjustments.booking_id AND p.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.properties p ON p.id = l.property_id
    WHERE b.id = booking_adjustments.booking_id AND p.owner_id = auth.uid()
  ));

DROP TRIGGER IF EXISTS trg_booking_adjustments_updated_at ON public.booking_adjustments;
CREATE TRIGGER trg_booking_adjustments_updated_at
  BEFORE UPDATE ON public.booking_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 16. BOOKING_CLEANINGS  (mig_011)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_cleanings (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE NOT NULL,
  cleaner_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  fee        NUMERIC(12,2) NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pending','done','paid')) DEFAULT 'pending',
  done_date  DATE,
  paid_date  DATE,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_cleanings_booking        ON public.booking_cleanings(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_cleanings_cleaner_status ON public.booking_cleanings(cleaner_id, status);
-- Composite (mig_037)
CREATE INDEX IF NOT EXISTS idx_booking_cleanings_cleaner_date   ON public.booking_cleanings(cleaner_id, done_date DESC);

ALTER TABLE public.booking_cleanings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_cleanings_own" ON public.booking_cleanings;
CREATE POLICY "booking_cleanings_own" ON public.booking_cleanings
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.properties p ON p.id = l.property_id
    WHERE b.id = booking_cleanings.booking_id AND p.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.properties p ON p.id = l.property_id
    WHERE b.id = booking_cleanings.booking_id AND p.owner_id = auth.uid()
  ));

DROP TRIGGER IF EXISTS trg_booking_cleanings_updated_at ON public.booking_cleanings;
CREATE TRIGGER trg_booking_cleanings_updated_at
  BEFORE UPDATE ON public.booking_cleanings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 17. BOOKING_PAYMENTS  (mig_031)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  payment_date    DATE,
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_payments_booking_id    ON public.booking_payments(booking_id);  -- mig_034
CREATE INDEX IF NOT EXISTS idx_booking_payments_owner         ON public.booking_payments(owner_id);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_payments_owner" ON public.booking_payments;
CREATE POLICY "booking_payments_owner" ON public.booking_payments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.properties p ON p.id = l.property_id
    WHERE b.id = booking_payments.booking_id AND p.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.listings l ON l.id = b.listing_id
    JOIN public.properties p ON p.id = l.property_id
    WHERE b.id = booking_payments.booking_id AND p.owner_id = auth.uid()
  ));

DROP TRIGGER IF EXISTS trg_booking_payments_updated_at ON public.booking_payments;
CREATE TRIGGER trg_booking_payments_updated_at
  BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 18. CLEANER_GROUPS  (mig_022)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaner_groups_owner ON public.cleaner_groups(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cleaner_groups_owner_name ON public.cleaner_groups(owner_id, lower(name));

ALTER TABLE public.cleaner_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cleaner_groups_owner" ON public.cleaner_groups;
CREATE POLICY "cleaner_groups_owner" ON public.cleaner_groups
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────
-- 19. CLEANER_GROUP_MEMBERS  (mig_022)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_group_members (
  group_id   UUID NOT NULL REFERENCES public.cleaner_groups(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, cleaner_id)
);

CREATE INDEX IF NOT EXISTS idx_cleaner_group_members_cleaner ON public.cleaner_group_members(cleaner_id);

ALTER TABLE public.cleaner_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cleaner_group_members_owner" ON public.cleaner_group_members;
CREATE POLICY "cleaner_group_members_owner" ON public.cleaner_group_members
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.cleaner_groups g WHERE g.id = cleaner_group_members.group_id AND g.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cleaner_groups g WHERE g.id = cleaner_group_members.group_id AND g.owner_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 20. CREDIT_POOLS  (mig_027)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_pools (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id        UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  credits_total    NUMERIC NOT NULL CHECK (credits_total >= 0),
  credits_used     NUMERIC NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  total_price      NUMERIC NOT NULL DEFAULT 0,
  consumption_rule TEXT NOT NULL CHECK (consumption_rule IN ('per_person_per_night','per_person_per_booking','per_booking')),
  credits_per_unit NUMERIC NOT NULL DEFAULT 1 CHECK (credits_per_unit > 0),
  child_weight     NUMERIC NOT NULL DEFAULT 1 CHECK (child_weight >= 0),
  activated_at     DATE NOT NULL,
  expires_at       DATE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','archived')),
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_pools_owner_active_idx ON public.credit_pools(owner_id, status, activated_at DESC);

ALTER TABLE public.credit_pools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_pools_owner" ON public.credit_pools;
CREATE POLICY "credit_pools_owner" ON public.credit_pools
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_credit_pools_updated_at ON public.credit_pools;
CREATE TRIGGER trg_credit_pools_updated_at
  BEFORE UPDATE ON public.credit_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 21. CREDIT_POOL_CONSUMPTIONS  (mig_027)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_pool_consumptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pool_id     UUID NOT NULL REFERENCES public.credit_pools(id) ON DELETE CASCADE,
  booking_id  UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  units       NUMERIC NOT NULL,
  credits_used NUMERIC NOT NULL,
  occurred_at DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pool_id, booking_id)
);

CREATE INDEX IF NOT EXISTS credit_pool_consumptions_booking_idx ON public.credit_pool_consumptions(booking_id);
CREATE INDEX IF NOT EXISTS credit_pool_consumptions_pool_idx    ON public.credit_pool_consumptions(pool_id);
CREATE INDEX IF NOT EXISTS idx_cpc_owner                        ON public.credit_pool_consumptions(owner_id);

ALTER TABLE public.credit_pool_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_pool_consumptions_owner" ON public.credit_pool_consumptions;
CREATE POLICY "credit_pool_consumptions_owner" ON public.credit_pool_consumptions
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 22. INVENTORY_CATEGORIES  (mig_024)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_cat_owner ON public.inventory_categories(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_cat_owner_name ON public.inventory_categories(owner_id, lower(name));

ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_cat_owner" ON public.inventory_categories;
CREATE POLICY "inv_cat_owner" ON public.inventory_categories
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 23. INVENTORY_ITEMS  (mig_024)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                 UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  property_id              UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category_id              UUID REFERENCES public.inventory_categories(id) ON DELETE SET NULL,
  name                     TEXT NOT NULL,
  description              TEXT,
  location                 TEXT,
  status                   TEXT NOT NULL DEFAULT 'good'
                           CHECK (status IN ('good','needs_maintenance','damaged','lost','depleted')),
  quantity                 NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit                     TEXT DEFAULT 'unidad',
  min_stock                NUMERIC(12,2),
  is_consumable            BOOLEAN NOT NULL DEFAULT false,
  purchase_date            DATE,
  purchase_price           NUMERIC(14,2),
  expected_lifetime_months INTEGER,
  photo_url                TEXT,
  notes                    TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_items_owner    ON public.inventory_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_property ON public.inventory_items(property_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_category ON public.inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_status   ON public.inventory_items(status);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_items_owner" ON public.inventory_items;
CREATE POLICY "inv_items_owner" ON public.inventory_items
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_inv_items_updated_at ON public.inventory_items;
CREATE TRIGGER trg_inv_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 24. INVENTORY_MOVEMENTS  (mig_024)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  item_id            UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  type               TEXT NOT NULL CHECK (type IN ('added','used','damaged','repaired','restocked','discarded','lost','status_change')),
  quantity_delta     NUMERIC(12,2) NOT NULL DEFAULT 0,
  new_status         TEXT CHECK (new_status IN ('good','needs_maintenance','damaged','lost','depleted')),
  notes              TEXT,
  related_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  related_expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_owner   ON public.inventory_movements(owner_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_item    ON public.inventory_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_booking ON public.inventory_movements(related_booking_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_expense ON public.inventory_movements(related_expense_id);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_mov_owner" ON public.inventory_movements;
CREATE POLICY "inv_mov_owner" ON public.inventory_movements
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 25. INVENTORY_MAINTENANCE_SCHEDULES  (mig_032 + mig_033)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_maintenance_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  item_id             UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  property_id         UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  scheduled_date      DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  notify_before_days  INTEGER NOT NULL DEFAULT 3,
  email_notify        BOOLEAN NOT NULL DEFAULT false,
  is_recurring        BOOLEAN NOT NULL DEFAULT false,    -- mig_033
  recurrence_days     INTEGER CHECK (recurrence_days IS NULL OR recurrence_days > 0),  -- mig_033
  expense_registered  BOOLEAN NOT NULL DEFAULT false,    -- mig_033
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_owner  ON public.inventory_maintenance_schedules(owner_id);
CREATE INDEX IF NOT EXISTS idx_maint_item   ON public.inventory_maintenance_schedules(item_id);
CREATE INDEX IF NOT EXISTS idx_maint_status ON public.inventory_maintenance_schedules(status);
CREATE INDEX IF NOT EXISTS idx_maint_date   ON public.inventory_maintenance_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_maint_done_no_expense ON public.inventory_maintenance_schedules(owner_id)
  WHERE status = 'done' AND expense_registered = false;  -- mig_033

ALTER TABLE public.inventory_maintenance_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maint_owner" ON public.inventory_maintenance_schedules;
CREATE POLICY "maint_owner" ON public.inventory_maintenance_schedules
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_maint_updated_at ON public.inventory_maintenance_schedules;
CREATE TRIGGER trg_maint_updated_at
  BEFORE UPDATE ON public.inventory_maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 26. USER_NOTIFICATION_SETTINGS  (mig_012)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_notification_settings (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reminders_enabled   BOOLEAN NOT NULL DEFAULT true,
  email_enabled       BOOLEAN NOT NULL DEFAULT false,
  lead_days           INTEGER NOT NULL DEFAULT 5,
  repeat_cadence      TEXT NOT NULL DEFAULT 'daily' CHECK (repeat_cadence IN ('daily','every_2_days','weekly')),
  send_hour           INTEGER NOT NULL DEFAULT 8 CHECK (send_hour BETWEEN 0 AND 23),
  notify_recurring    BOOLEAN NOT NULL DEFAULT true,
  notify_maintenance  BOOLEAN NOT NULL DEFAULT true,
  notify_shared_bills BOOLEAN NOT NULL DEFAULT true,
  notify_damage       BOOLEAN NOT NULL DEFAULT true,
  notify_cleaner      BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uns_select_own" ON public.user_notification_settings;
CREATE POLICY "uns_select_own" ON public.user_notification_settings
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "uns_insert_own" ON public.user_notification_settings;
CREATE POLICY "uns_insert_own" ON public.user_notification_settings
  FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "uns_update_own" ON public.user_notification_settings;
CREATE POLICY "uns_update_own" ON public.user_notification_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- TABLA MAP (resumen para referencia rápida)
-- ─────────────────────────────────────────────────────────────
-- #  | Tabla                             | owner anchor       | RLS  | mig
-- ---|-----------------------------------|--------------------|------|----
--  1 | profiles                          | id = user          | ✅   | base
--  2 | properties                        | owner_id           | ✅   | base
--  3 | property_groups                   | owner_id           | ✅   | 028
--  4 | property_tags                     | owner_id           | ✅   | 028
--  5 | property_tag_assignments          | owner_id (tag)     | ✅   | 028
--  6 | listings                          | via property       | ✅   | base
--  7 | bookings                          | via listing        | ✅   | base
--  8 | bank_accounts                     | owner_id           | ✅   | base
--  9 | expenses                          | owner_id           | ✅   | base
-- 10 | property_recurring_expenses       | via property       | ✅   | base
-- 11 | recurring_expense_periods         | via recurring_exp  | ✅   | 012
-- 12 | vendors                           | owner_id           | ✅   | 008
-- 13 | vendor_properties                 | via vendor         | ✅   | 013
-- 14 | shared_bills                      | via vendor         | ✅   | 013
-- 15 | booking_adjustments               | via booking        | ✅   | 006
-- 16 | booking_cleanings                 | via booking        | ✅   | 011
-- 17 | booking_payments                  | owner_id           | ✅   | 031
-- 18 | cleaner_groups                    | owner_id           | ✅   | 022
-- 19 | cleaner_group_members             | via group          | ✅   | 022
-- 20 | credit_pools                      | owner_id           | ✅   | 027
-- 21 | credit_pool_consumptions          | owner_id           | ✅   | 027
-- 22 | inventory_categories              | owner_id           | ✅   | 024
-- 23 | inventory_items                   | owner_id           | ✅   | 024
-- 24 | inventory_movements               | owner_id           | ✅   | 024
-- 25 | inventory_maintenance_schedules   | owner_id           | ✅   | 032/033
-- 26 | user_notification_settings        | user_id            | ✅   | 012
-- ─────────────────────────────────────────────────────────────
-- Total: 26 tablas · 100% con RLS habilitada
-- Próxima migración: 039
-- ─────────────────────────────────────────────────────────────
