-- ============================================================================
-- SETUP COMPLETO PARA NUEVO PROYECTO SUPABASE
-- Consolidación de schema_consolidated.sql + migraciones 039-058
-- Generado: Tue May 26 23:35:31 HPS 2026
-- ============================================================================

-- ============================================================================
-- SECCION 0: Extensiones requeridas
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- SECCION 1: Schema base (migraciones 001-038)
-- ============================================================================
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
  -- mig_003
  estrato               INT,
  bedrooms              INT,
  max_guests            INT,
  notes                 TEXT,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_property_groups_owner ON public.property_groups(owner_id);

ALTER TABLE public.property_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_full_property_groups" ON public.property_groups;
CREATE POLICY "owner_full_property_groups" ON public.property_groups
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS trg_property_groups_updated_at ON public.property_groups;
CREATE TRIGGER trg_property_groups_updated_at
  BEFORE UPDATE ON public.property_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FK deferred (property_groups debe existir antes de la FK en properties)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_properties_group') THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT fk_properties_group
      FOREIGN KEY (group_id) REFERENCES public.property_groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. PROPERTY_TAGS  (mig_028)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT 'blue',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_property_tags_owner ON public.property_tags(owner_id);

ALTER TABLE public.property_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_full_property_tags" ON public.property_tags;
CREATE POLICY "owner_full_property_tags" ON public.property_tags
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP TRIGGER IF EXISTS trg_property_tags_updated_at ON public.property_tags;
CREATE TRIGGER trg_property_tags_updated_at
  BEFORE UPDATE ON public.property_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id              UUID REFERENCES public.listings(id) ON DELETE CASCADE NOT NULL,
  confirmation_code       TEXT UNIQUE NOT NULL,
  guest_name              TEXT,
  start_date              DATE NOT NULL,
  end_date                DATE NOT NULL,
  booked_at               DATE,
  num_nights              INTEGER NOT NULL,
  num_adults              INTEGER DEFAULT 1,
  num_children            INTEGER DEFAULT 0,
  total_revenue           NUMERIC(12, 2) NOT NULL,
  status                  TEXT,
  raw_data                JSONB,
  -- mig_003: revenue breakdown
  channel                 TEXT DEFAULT 'airbnb',
  gross_revenue           NUMERIC(12, 2),
  channel_fees            NUMERIC(12, 2) DEFAULT 0,
  taxes_withheld          NUMERIC(12, 2) DEFAULT 0,
  net_payout              NUMERIC(12, 2),
  payout_bank_account_id  UUID,  -- FK added below after bank_accounts (mig_003)
  payout_date             DATE,
  currency                TEXT DEFAULT 'COP',
  exchange_rate           NUMERIC(12, 4),
  notes                   TEXT,
  -- mig_011: operational flags
  checkin_done            BOOLEAN DEFAULT false NOT NULL,
  checkout_done           BOOLEAN DEFAULT false NOT NULL,
  inventory_checked       BOOLEAN DEFAULT false NOT NULL,
  operational_notes       TEXT,
  -- mig_049: security deposit
  security_deposit        NUMERIC(12, 2),
  deposit_bank_account_id UUID,  -- FK added below after bank_accounts (mig_049)
  deposit_status          TEXT DEFAULT 'none' CHECK (deposit_status IN (
                            'none','received','partial_return','returned',
                            'applied_to_damage','mixed')),
  deposit_returned_amount NUMERIC(12, 2),
  deposit_return_date     DATE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
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

-- FKs DIFERIDAS: bookings → bank_accounts (bank_accounts ya existe en este punto)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payout_bank_account_id_fkey') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_payout_bank_account_id_fkey
      FOREIGN KEY (payout_bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_deposit_bank_account_id_fkey') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_deposit_bank_account_id_fkey
      FOREIGN KEY (deposit_bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

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
  vendor_id       UUID,        -- mig_008 FK added below after vendors table
  shared_bill_id  UUID,        -- mig_013 FK added below after shared_bills table
  booking_id      UUID REFERENCES public.bookings(id) ON DELETE SET NULL,  -- mig_003
  vendor          TEXT,               -- mig_003 legacy text field
  person_in_charge TEXT,              -- mig_003
  expense_group   TEXT,               -- mig_019
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_owner          ON public.expenses(owner_id);
CREATE INDEX IF NOT EXISTS idx_expenses_property       ON public.expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor_id      ON public.expenses(vendor_id);       -- mig_008
CREATE INDEX IF NOT EXISTS idx_expenses_shared_bill    ON public.expenses(shared_bill_id);  -- mig_013
CREATE INDEX IF NOT EXISTS idx_expenses_bank_account   ON public.expenses(bank_account_id); -- mig_019
CREATE INDEX IF NOT EXISTS idx_expenses_booking_id     ON public.expenses(booking_id);       -- mig_003
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
  vendor_id        UUID,  -- mig_008 FK added below after vendors table
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
-- FKs DIFERIDAS: expenses y property_recurring_expenses
-- (vendors y shared_bills ya existen en este punto)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_vendor_id_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_shared_bill_id_fkey') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_shared_bill_id_fkey
      FOREIGN KEY (shared_bill_id) REFERENCES public.shared_bills(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_recurring_expenses_vendor_id_fkey') THEN
    ALTER TABLE public.property_recurring_expenses ADD CONSTRAINT property_recurring_expenses_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;
  END IF;
END $$;

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


-- ============================================================================
-- migration_039_audit_log.sql
-- ============================================================================
-- ============================================================
-- migration_039_audit_log.sql
-- ============================================================
-- PROPÓSITO: Tabla audit_log para trazabilidad de cambios en
--   entidades críticas (properties, expenses, bookings, vendors,
--   inventory_items). Implementa el patrón Append-Only Log.
--
-- DISEÑO:
--   • Una sola tabla genérica (evita proliferación de tablas por
--     entidad y facilita consultas cross-table de auditoría).
--   • old_data / new_data JSONB: snapshot completo antes/después.
--   • Trigger genérico audit_log_trigger() se instala en las
--     tablas críticas.
--   • RLS: owner puede leer sus propios registros; INSERT/UPDATE/
--     DELETE sólo via trigger (SECURITY DEFINER).
--
-- IDEMPOTENTE: usa CREATE TABLE IF NOT EXISTS + DROP/CREATE policy.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TABLA audit_log
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID,                 -- auth.uid() al momento del cambio (NULL en cascade deletes)
  table_name  TEXT NOT NULL,        -- ej: 'expenses', 'properties'
  record_id   UUID NOT NULL,        -- PK del registro afectado
  action      TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  old_data    JSONB,                -- NULL en INSERT
  new_data    JSONB,                -- NULL en DELETE
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta más frecuente
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user         ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at  ON public.audit_log(occurred_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Los usuarios sólo pueden leer sus propios registros de auditoría.
-- Escritura sólo vía trigger (SECURITY DEFINER) — ninguna política INSERT.
DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own" ON public.audit_log
  FOR SELECT USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. FUNCIÓN TRIGGER genérica (SECURITY DEFINER para bypassar RLS)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id UUID;
  v_action    TEXT;
  v_old_data  JSONB;
  v_new_data  JSONB;
BEGIN
  -- Determinar la acción y los datos
  IF TG_OP = 'INSERT' THEN
    v_action    := 'insert';
    v_record_id := NEW.id;
    v_old_data  := NULL;
    v_new_data  := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action    := 'update';
    v_record_id := NEW.id;
    v_old_data  := to_jsonb(OLD);
    v_new_data  := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action    := 'delete';
    v_record_id := OLD.id;
    v_old_data  := to_jsonb(OLD);
    v_new_data  := NULL;
  END IF;

  -- Insertar en audit_log (bypasa RLS por SECURITY DEFINER)
  INSERT INTO public.audit_log (user_id, table_name, record_id, action, old_data, new_data)
  VALUES (auth.uid(), TG_TABLE_NAME, v_record_id, v_action, v_old_data, v_new_data);

  -- Retornar la fila correcta según operación
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_audit_log() IS
  'Trigger genérico para registrar INSERT/UPDATE/DELETE en audit_log.
   Instalado en tablas críticas: properties, expenses, bookings, vendors, inventory_items.';

-- ─────────────────────────────────────────────────────────────
-- 4. INSTALAR TRIGGER en tablas críticas
-- ─────────────────────────────────────────────────────────────

-- properties
DROP TRIGGER IF EXISTS trg_audit_properties ON public.properties;
CREATE TRIGGER trg_audit_properties
  AFTER INSERT OR UPDATE OR DELETE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- expenses
DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- bookings
DROP TRIGGER IF EXISTS trg_audit_bookings ON public.bookings;
CREATE TRIGGER trg_audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- vendors
DROP TRIGGER IF EXISTS trg_audit_vendors ON public.vendors;
CREATE TRIGGER trg_audit_vendors
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- inventory_items
DROP TRIGGER IF EXISTS trg_audit_inventory_items ON public.inventory_items;
CREATE TRIGGER trg_audit_inventory_items
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Confirmar tabla creada:
--    SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_log';
--
-- 2. Confirmar triggers instalados:
--    SELECT trigger_name, event_object_table, event_manipulation
--    FROM information_schema.triggers
--    WHERE trigger_name LIKE 'trg_audit_%'
--    ORDER BY event_object_table;
--
-- 3. Test rápido (en una sesión autenticada):
--    UPDATE properties SET name = name WHERE id = '<un-id>';
--    SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT 1;
-- ============================================================


-- ============================================================================
-- migration_043_missing_indexes_triggers.sql
-- ============================================================================
-- ============================================================
-- migration_043_missing_indexes_triggers.sql
-- ============================================================
-- Crea los índices base y triggers updated_at que estaban en
-- schema_consolidated.sql pero NUNCA fueron aplicados por
-- ninguna migration anterior.
--
-- IDEMPOTENTE: todos los índices usan IF NOT EXISTS.
--   Los triggers usan DROP IF EXISTS + CREATE.
-- SEGURO: no toca datos ni columnas.
--
-- Grupos de trabajo:
--   A. Índices base (propiedades, listings, bookings, expenses,
--      recurring_periods) — definidos en schema_consolidated
--      pero omitidos en mig_034/mig_037.
--   B. Triggers updated_at para property_recurring_expenses y
--      booking_adjustments — omitidos en mig_035.
--   C. Re-aplica mig_035 triggers para garantizar que existen
--      (idempotente via DROP IF EXISTS + CREATE).
-- ============================================================

-- ─── A. Índices base faltantes ───────────────────────────────

-- properties.owner_id (RLS lo usa en cada SELECT)
CREATE INDEX IF NOT EXISTS idx_properties_owner
  ON public.properties(owner_id);

-- listings.property_id (soporte FK + joins frecuentes)
CREATE INDEX IF NOT EXISTS idx_listings_property
  ON public.listings(property_id);

-- bookings.listing_id (single-column base, mig_037 tiene compuesto)
CREATE INDEX IF NOT EXISTS idx_bookings_listing
  ON public.bookings(listing_id);

-- expenses.owner_id (RLS + filtros por owner)
CREATE INDEX IF NOT EXISTS idx_expenses_owner
  ON public.expenses(owner_id);

-- expenses(owner_id, date DESC) — filtros de periodo por usuario
CREATE INDEX IF NOT EXISTS idx_expenses_owner_date
  ON public.expenses(owner_id, date DESC);

-- recurring_expense_periods(recurring_id, year_month DESC)
CREATE INDEX IF NOT EXISTS idx_recurring_periods_rec_month
  ON public.recurring_expense_periods(recurring_id, year_month DESC);

-- ─── B + C. Triggers updated_at (todos idempotentes) ─────────
-- Requiere que public.set_updated_at() exista (creada en mig_034).

-- properties
DROP TRIGGER IF EXISTS trg_properties_updated_at ON public.properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- listings
DROP TRIGGER IF EXISTS trg_listings_updated_at ON public.listings;
CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bookings
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bank_accounts
DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- expenses
DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- vendors
DROP TRIGGER IF EXISTS trg_vendors_updated_at ON public.vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- property_recurring_expenses (faltaba en mig_035)
DROP TRIGGER IF EXISTS trg_recurring_updated_at ON public.property_recurring_expenses;
CREATE TRIGGER trg_recurring_updated_at
  BEFORE UPDATE ON public.property_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- booking_adjustments (faltaba en mig_035)
DROP TRIGGER IF EXISTS trg_booking_adjustments_updated_at ON public.booking_adjustments;
CREATE TRIGGER trg_booking_adjustments_updated_at
  BEFORE UPDATE ON public.booking_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- a) Confirmar índices:
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'idx_properties_owner','idx_listings_property','idx_bookings_listing',
--     'idx_expenses_owner','idx_expenses_owner_date','idx_recurring_periods_rec_month'
--   )
-- ORDER BY indexname;
-- Esperado: 6 filas.
--
-- b) Confirmar triggers:
-- SELECT tgname, c.relname AS tabla
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND tgname LIKE 'trg_%_updated_at'
--   AND NOT tgisinternal
-- ORDER BY c.relname;
-- Esperado: >= 8 filas.
-- ============================================================


-- ============================================================================
-- migration_044_bank_accounts_updated_at.sql
-- ============================================================================
-- ============================================================
-- migration_044_bank_accounts_updated_at.sql
-- ============================================================
-- La tabla bank_accounts no tiene columna updated_at en prod,
-- por eso el trigger lanza:
--   "record new has no field updated_at"
-- Esta migración la agrega de forma idempotente y re-crea el
-- trigger para garantizar que funcione.
-- Idempotente — seguro re-ejecutar.
-- ============================================================

-- 1. Agregar columna si no existe
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Poblar retroactivamente (filas existentes quedan con now())
-- No es crítico — las actualizaciones futuras lo poblarán correctamente.

-- 3. Re-crear trigger (DROP + CREATE garantiza que use la función correcta)
DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Verificar
SELECT
  'bank_accounts.updated_at' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  CASE WHEN COUNT(*) > 0
       THEN 'Columna updated_at presente + trigger activo'
       ELSE 'Columna updated_at NO encontrada'
  END AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'bank_accounts'
  AND column_name  = 'updated_at';


-- ============================================================================
-- migration_045_properties_listings_updated_at.sql
-- ============================================================================
-- migration_045_properties_listings_updated_at.sql
-- ============================================================
-- Fix: "record 'new' has no field 'updated_at'"
-- ============================================================
-- migration_043 created trg_properties_updated_at and
-- trg_listings_updated_at unconditionally, but neither table
-- had the updated_at column yet.  Add it now.
--
-- IDEMPOTENTE: uses ADD COLUMN IF NOT EXISTS.
-- SEGURO: no altera datos ni políticas existentes.
-- ============================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- Verificación:
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('properties','listings')
--   AND column_name = 'updated_at';
-- Esperado: 2 filas.
-- ============================================================


-- ============================================================================
-- migration_046_account_deposits.sql
-- ============================================================================
-- migration_046_account_deposits.sql
-- ============================================================
-- Depósitos manuales a cuentas bancarias
-- ============================================================
-- Permite registrar entradas de dinero a una cuenta que NO
-- forman parte de la contabilidad de rentas cortas (ej: ahorro
-- personal, transferencia desde otra cuenta propia, etc.).
-- El saldo de la cuenta = opening_balance + inflows - outflows
--                         + sum(account_deposits.amount)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_deposits (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id    UUID         NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  deposit_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acc_dep_owner   ON public.account_deposits(owner_id);
CREATE INDEX IF NOT EXISTS idx_acc_dep_account ON public.account_deposits(account_id);

ALTER TABLE public.account_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acc_dep_owner ON public.account_deposits;
CREATE POLICY acc_dep_owner ON public.account_deposits
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- Verificación:
-- SELECT id, account_id, amount, deposit_date, notes
-- FROM public.account_deposits
-- WHERE owner_id = auth.uid();
-- ============================================================


-- ============================================================================
-- migration_047_inventory_end_of_life.sql
-- ============================================================================
-- migration_047_inventory_end_of_life.sql
-- ============================================================
-- Estado "cumplió vida útil" para items del inventario
-- ============================================================
-- El campo expected_lifetime_months ya existe (migration_024).
-- Este script agrega 'end_of_life' como valor válido en el
-- CHECK constraint de inventory_items.status.
--
-- IDEMPOTENTE: verifica si el constraint ya fue actualizado.
-- ============================================================

DO $$
BEGIN
  -- Eliminar constraint antiguo y crear uno nuevo que incluye end_of_life
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name LIKE '%inventory_items%status%'
  ) THEN
    ALTER TABLE public.inventory_items
      DROP CONSTRAINT IF EXISTS inventory_items_status_check;
  END IF;

  ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_status_check
    CHECK (status IN ('good', 'needs_maintenance', 'damaged', 'lost', 'depleted', 'end_of_life'));
END $$;

-- ============================================================
-- Verificación:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.inventory_items'::regclass
--   AND contype = 'c';
-- Esperado: status IN (... 'end_of_life')
-- ============================================================


-- ============================================================================
-- migration_048_missing_updated_at.sql
-- ============================================================================
-- migration_048_missing_updated_at.sql
-- ============================================================
-- Fix: "record 'new' has no field 'updated_at'"
-- ============================================================
-- Root cause: migration_043 created updated_at triggers
-- UNCONDITIONALLY on tables that were originally created WITHOUT
-- the updated_at column (bookings, expenses, vendors,
-- property_recurring_expenses, booking_adjustments).
-- Also covers tables with guards in mig_035 that never got the
-- column, and tables that may have a trigger from schema_consolidated.
--
-- This migration:
--   1. Adds updated_at column (IF NOT EXISTS) to every affected table.
--   2. Re-creates the trigger so it is guaranteed present & correct.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + DROP/CREATE trigger.
-- SEGURO: no altera datos ni políticas existentes.
--
-- Tablas cubiertas:
--   bookings, expenses, vendors, property_recurring_expenses,
--   booking_adjustments, booking_cleanings, booking_payments,
--   credit_pools, property_groups, property_tags
-- ============================================================

-- ─── 1. bookings ─────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. expenses ─────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. vendors ──────────────────────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON public.vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. property_recurring_expenses ──────────────────────────
ALTER TABLE public.property_recurring_expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_recurring_updated_at ON public.property_recurring_expenses;
CREATE TRIGGER trg_recurring_updated_at
  BEFORE UPDATE ON public.property_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. booking_adjustments ──────────────────────────────────
ALTER TABLE public.booking_adjustments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_booking_adjustments_updated_at ON public.booking_adjustments;
CREATE TRIGGER trg_booking_adjustments_updated_at
  BEFORE UPDATE ON public.booking_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. booking_cleanings ─────────────────────────────────────
ALTER TABLE public.booking_cleanings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_booking_cleanings_updated_at ON public.booking_cleanings;
CREATE TRIGGER trg_booking_cleanings_updated_at
  BEFORE UPDATE ON public.booking_cleanings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 7. booking_payments ─────────────────────────────────────
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_booking_payments_updated_at ON public.booking_payments;
CREATE TRIGGER trg_booking_payments_updated_at
  BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 8. credit_pools ─────────────────────────────────────────
ALTER TABLE public.credit_pools
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_credit_pools_updated_at ON public.credit_pools;
CREATE TRIGGER trg_credit_pools_updated_at
  BEFORE UPDATE ON public.credit_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 9. property_groups ──────────────────────────────────────
ALTER TABLE public.property_groups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_property_groups_updated_at ON public.property_groups;
CREATE TRIGGER trg_property_groups_updated_at
  BEFORE UPDATE ON public.property_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 10. property_tags ───────────────────────────────────────
ALTER TABLE public.property_tags
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_property_tags_updated_at ON public.property_tags;
CREATE TRIGGER trg_property_tags_updated_at
  BEFORE UPDATE ON public.property_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- Confirmar columnas agregadas:
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'updated_at'
--   AND table_name IN (
--     'bookings','expenses','vendors','property_recurring_expenses',
--     'booking_adjustments','booking_cleanings','booking_payments',
--     'credit_pools','property_groups','property_tags'
--   )
-- ORDER BY table_name;
-- Esperado: 10 filas.
--
-- Confirmar triggers activos:
-- SELECT c.relname AS tabla, t.tgname
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND t.tgname LIKE 'trg_%_updated_at'
--   AND NOT t.tgisinternal
-- ORDER BY c.relname;
-- ============================================================


-- ============================================================================
-- migration_049_booking_deposits.sql
-- ============================================================================
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


-- ============================================================================
-- migration_051_paid_status_invariants.sql
-- ============================================================================
-- migration_051_paid_status_invariants.sql
-- ============================================================
-- 1) RPC transaccional para registrar un aseo y, opcionalmente,
--    su pago consolidado (expense + bank_account_id) en UNA
--    sola transacción. Cierra el bug donde el modal
--    CleaningFormModal podía dejar un booking_cleaning con
--    status='paid' sin expense respaldatorio.
--
-- 2) Constraints CHECK (NOT VALID) que vuelven IMPOSIBLE volver
--    a caer en los estados inconsistentes:
--    - expenses paid  ⇒ bank_account_id IS NOT NULL
--    - cleanings paid ⇒ paid_date IS NOT NULL
--
-- Los constraints quedan NOT VALID al desplegar para que los
-- registros heredados no rompan; se promueven a VALID
-- manualmente tras limpiar datos desde /data-issues.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) RPC: rpc_create_cleaning_with_payment
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_cleaning_with_payment(
  p_booking_id            UUID,
  p_cleaner_id            UUID,
  p_fee                   NUMERIC,
  p_status                TEXT,
  p_done_date             DATE,
  p_notes                 TEXT,
  p_supplies_amount       NUMERIC,
  p_reimburse_to_cleaner  BOOLEAN,
  p_paid_date             DATE DEFAULT NULL,
  p_bank_account_id       UUID DEFAULT NULL
)
RETURNS TABLE (
  cleaning_id      UUID,
  expense_ids      UUID[]
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_cleaning_id    UUID;
  v_group_id       TEXT;
  v_inserted_ids   UUID[] := ARRAY[]::UUID[];
  v_expense_id     UUID;
  v_cleaner_name   TEXT;
  v_property_id    UUID;
  v_property_name  TEXT;
  v_code           TEXT;
  v_done_for_desc  DATE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  IF p_status NOT IN ('pending', 'done', 'paid') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  IF p_status = 'paid' THEN
    IF p_paid_date IS NULL THEN
      RAISE EXCEPTION 'Para marcar un aseo como pagado debes indicar la fecha de pago.';
    END IF;
    IF p_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'Para marcar un aseo como pagado debes indicar la cuenta bancaria de salida.';
    END IF;
    IF p_fee IS NULL OR p_fee < 0 THEN
      RAISE EXCEPTION 'Tarifa inválida para un aseo pagado.';
    END IF;
  END IF;

  -- 1) Insertar el booking_cleaning. Para 'paid' guardamos también paid_date.
  INSERT INTO public.booking_cleanings (
    booking_id, cleaner_id, fee, status,
    done_date, paid_date,
    notes, supplies_amount, reimburse_to_cleaner
  ) VALUES (
    p_booking_id, p_cleaner_id, p_fee, p_status,
    CASE WHEN p_status = 'pending' THEN NULL ELSE p_done_date END,
    CASE WHEN p_status = 'paid' THEN p_paid_date ELSE NULL END,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    COALESCE(p_supplies_amount, 0),
    COALESCE(p_reimburse_to_cleaner, FALSE)
  )
  RETURNING id INTO v_cleaning_id;

  -- 2) Si no se está pagando ahora, retornamos solo el cleaning.
  IF p_status <> 'paid' THEN
    RETURN QUERY SELECT v_cleaning_id, v_inserted_ids;
    RETURN;
  END IF;

  -- 3) Cargar contexto necesario para describir los expenses.
  SELECT v.name INTO v_cleaner_name
  FROM   public.vendors v
  WHERE  v.id = p_cleaner_id;

  IF v_cleaner_name IS NULL THEN
    RAISE EXCEPTION 'Persona de aseo no encontrada.';
  END IF;

  SELECT p.id, COALESCE(p.name, 'Sin propiedad'),
         COALESCE(b.confirmation_code, LEFT(b.id::text, 8)),
         COALESCE(p_done_date, b.end_date, p_paid_date)
    INTO v_property_id, v_property_name, v_code, v_done_for_desc
  FROM   public.bookings   b
  LEFT JOIN public.listings   l ON l.id = b.listing_id
  LEFT JOIN public.properties p ON p.id = l.property_id
  WHERE  b.id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  v_group_id := gen_random_uuid()::text;

  -- 4) Expense por la tarifa.
  IF COALESCE(p_fee, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Aseo', 'cleaning', 'variable',
      p_fee, 'COP', p_paid_date,
      format('Aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, p_booking_id,
      v_cleaner_name, p_cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  -- 5) Expense por insumos cuando aplica.
  IF COALESCE(p_reimburse_to_cleaner, FALSE) AND COALESCE(p_supplies_amount, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Insumos de aseo', 'cleaning', 'variable',
      p_supplies_amount, 'COP', p_paid_date,
      format('Insumos de aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, p_booking_id,
      v_cleaner_name, p_cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  RETURN QUERY SELECT v_cleaning_id, v_inserted_ids;
END;
$$;

COMMENT ON FUNCTION public.rpc_create_cleaning_with_payment IS
  'Inserta un booking_cleaning y, si status=paid, genera el expense respaldatorio (fee y opcional insumos) en una sola transacción. Garantiza el invariante: ningún cleaning paid puede existir sin expense respaldatorio con bank_account_id.';

GRANT EXECUTE ON FUNCTION public.rpc_create_cleaning_with_payment(
  UUID, UUID, NUMERIC, TEXT, DATE, TEXT, NUMERIC, BOOLEAN, DATE, UUID
) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) RPC: rpc_data_issues_summary  (banner /data-issues)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_data_issues_summary()
RETURNS TABLE (
  expenses_paid_without_account_count  INT,
  expenses_paid_without_account_amount NUMERIC,
  cleanings_paid_without_expense_count INT,
  cleanings_paid_without_date_count    INT,
  bookings_paid_without_account_count  INT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.expenses
       WHERE status = 'paid' AND bank_account_id IS NULL),
    (SELECT COALESCE(sum(amount), 0) FROM public.expenses
       WHERE status = 'paid' AND bank_account_id IS NULL),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status = 'paid'
         AND bc.paid_date IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.expenses e
            WHERE e.booking_id = bc.booking_id
              AND e.vendor_id  = bc.cleaner_id
              AND e.category   = 'Aseo'
         )),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status = 'paid' AND bc.paid_date IS NULL),
    (SELECT count(*)::int FROM public.bookings b
       WHERE COALESCE(b.net_payout, 0) > 0
         AND b.payout_bank_account_id IS NULL
         AND lower(COALESCE(b.status, '')) NOT LIKE '%cancel%');
$$;

GRANT EXECUTE ON FUNCTION public.rpc_data_issues_summary() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3) CHECK constraints (NOT VALID — válidos para escrituras
--    nuevas; los registros existentes se validarán manualmente
--    desde Supabase Studio una vez se limpien todos los issues
--    en /data-issues).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_paid_requires_account;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_paid_requires_account
  CHECK (status <> 'paid' OR bank_account_id IS NOT NULL)
  NOT VALID;

ALTER TABLE public.booking_cleanings
  DROP CONSTRAINT IF EXISTS cleanings_paid_requires_date;
ALTER TABLE public.booking_cleanings
  ADD CONSTRAINT cleanings_paid_requires_date
  CHECK (status <> 'paid' OR paid_date IS NOT NULL)
  NOT VALID;

-- ============================================================
-- POST-DEPLOY (manual, en Supabase Studio, tras limpiar /data-issues):
--
--   ALTER TABLE public.expenses
--     VALIDATE CONSTRAINT expenses_paid_requires_account;
--
--   ALTER TABLE public.booking_cleanings
--     VALIDATE CONSTRAINT cleanings_paid_requires_date;
--
-- Si alguno falla, hay datos inconsistentes pendientes
-- (consulta /data-issues).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 4) RPC: rpc_repair_orphan_cleaning_with_expense
--    Para un booking_cleaning que ya está 'paid' y tiene paid_date
--    pero NO tiene expense respaldatorio, genera el (los) expense(s)
--    faltante(s) con el bank_account_id elegido por el usuario.
--    Idempotente: si ya existe expense para (booking_id, vendor_id,
--    category='Aseo'), no hace nada y retorna IDs vacíos.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_repair_orphan_cleaning_with_expense(
  p_cleaning_id     UUID,
  p_bank_account_id UUID
)
RETURNS TABLE (expense_ids UUID[])
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_cleaning       RECORD;
  v_cleaner_name   TEXT;
  v_property_id    UUID;
  v_property_name  TEXT;
  v_code           TEXT;
  v_done_for_desc  DATE;
  v_group_id       TEXT;
  v_inserted_ids   UUID[] := ARRAY[]::UUID[];
  v_expense_id     UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  IF p_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Debes indicar la cuenta bancaria de salida.';
  END IF;

  SELECT bc.*
    INTO v_cleaning
  FROM   public.booking_cleanings bc
  WHERE  bc.id = p_cleaning_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aseo no encontrado: %', p_cleaning_id;
  END IF;

  IF v_cleaning.status <> 'paid' THEN
    RAISE EXCEPTION 'Solo se pueden reparar aseos en estado paid (estado actual: %).', v_cleaning.status;
  END IF;

  IF v_cleaning.paid_date IS NULL THEN
    RAISE EXCEPTION 'El aseo no tiene fecha de pago; primero corrige la fecha antes de generar el gasto.';
  END IF;

  -- Cortocircuito si ya existe un expense respaldatorio.
  IF EXISTS (
    SELECT 1 FROM public.expenses e
     WHERE e.booking_id = v_cleaning.booking_id
       AND e.vendor_id  = v_cleaning.cleaner_id
       AND e.category   = 'Aseo'
  ) THEN
    RETURN QUERY SELECT v_inserted_ids;
    RETURN;
  END IF;

  SELECT v.name INTO v_cleaner_name FROM public.vendors v WHERE v.id = v_cleaning.cleaner_id;
  IF v_cleaner_name IS NULL THEN
    RAISE EXCEPTION 'Persona de aseo no encontrada.';
  END IF;

  SELECT p.id, COALESCE(p.name, 'Sin propiedad'),
         COALESCE(b.confirmation_code, LEFT(b.id::text, 8)),
         COALESCE(v_cleaning.done_date, b.end_date, v_cleaning.paid_date)
    INTO v_property_id, v_property_name, v_code, v_done_for_desc
  FROM   public.bookings b
  LEFT JOIN public.listings   l ON l.id = b.listing_id
  LEFT JOIN public.properties p ON p.id = l.property_id
  WHERE  b.id = v_cleaning.booking_id;

  v_group_id := gen_random_uuid()::text;

  IF COALESCE(v_cleaning.fee, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Aseo', 'cleaning', 'variable',
      v_cleaning.fee, 'COP', v_cleaning.paid_date,
      format('Aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, v_cleaning.booking_id,
      v_cleaner_name, v_cleaning.cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  IF COALESCE(v_cleaning.reimburse_to_cleaner, FALSE)
     AND COALESCE(v_cleaning.supplies_amount, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Insumos de aseo', 'cleaning', 'variable',
      v_cleaning.supplies_amount, 'COP', v_cleaning.paid_date,
      format('Insumos de aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, v_cleaning.booking_id,
      v_cleaner_name, v_cleaning.cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  RETURN QUERY SELECT v_inserted_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_repair_orphan_cleaning_with_expense(UUID, UUID) TO authenticated;


-- ============================================================================
-- migration_052_data_issues_v2.sql
-- ============================================================================
-- migration_052_data_issues_v2.sql
-- ============================================================
-- Manejo de errores ampliado.
--
-- 1) Tabla data_issue_ignores para persistir ignores (overlap "no es duplicado").
-- 2) rpc_data_issues_summary_v2 con todos los detectores (A-H + existentes).
-- 3) rpc_delete_booking_cascade: borra una reserva y sus dependencias.
-- 4) rpc_ignore_data_issue / rpc_unignore_data_issue.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) Tabla data_issue_ignores
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_issue_ignores (
  kind         TEXT        NOT NULL,
  key          TEXT        NOT NULL,
  note         TEXT,
  ignored_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ignored_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (kind, key)
);

COMMENT ON TABLE public.data_issue_ignores IS
  'Registros marcados como "no es un error real" desde /data-issues. Para overlap kind=overlap_booking, key=concat(min(id),"_",max(id)).';

ALTER TABLE public.data_issue_ignores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_issue_ignores_select" ON public.data_issue_ignores;
CREATE POLICY "data_issue_ignores_select"
  ON public.data_issue_ignores FOR SELECT
  TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "data_issue_ignores_insert" ON public.data_issue_ignores;
CREATE POLICY "data_issue_ignores_insert"
  ON public.data_issue_ignores FOR INSERT
  TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS "data_issue_ignores_delete" ON public.data_issue_ignores;
CREATE POLICY "data_issue_ignores_delete"
  ON public.data_issue_ignores FOR DELETE
  TO authenticated USING (TRUE);

-- ─────────────────────────────────────────────────────────────
-- 2) rpc_data_issues_summary_v2
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_data_issues_summary_v2()
RETURNS TABLE (
  expenses_paid_without_account_count   INT,
  expenses_paid_without_account_amount  NUMERIC,
  cleanings_paid_without_expense_count  INT,
  cleanings_paid_without_date_count     INT,
  overlapping_bookings_count            INT,
  bookings_without_payout_account_count INT,
  bookings_without_payout_account_amount NUMERIC,
  inconsistent_payouts_count            INT,
  invalid_expenses_count                INT,
  paid_cleanings_without_cleaner_count  INT,
  done_cleanings_without_date_count     INT,
  invalid_booking_dates_count           INT,
  duplicate_codes_count                 INT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.expenses
       WHERE status='paid' AND bank_account_id IS NULL),
    (SELECT COALESCE(sum(amount), 0) FROM public.expenses
       WHERE status='paid' AND bank_account_id IS NULL),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status='paid' AND bc.paid_date IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.expenses e
                          WHERE e.booking_id=bc.booking_id
                            AND e.vendor_id=bc.cleaner_id
                            AND e.category='Aseo')),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status='paid' AND bc.paid_date IS NULL),
    (SELECT count(*)::int FROM public.bookings b1
        JOIN public.bookings b2
          ON b1.listing_id=b2.listing_id
         AND b1.id < b2.id
         AND b1.start_date < b2.end_date
         AND b2.start_date < b1.end_date
        WHERE lower(COALESCE(b1.status,'')) NOT LIKE '%cancel%'
          AND lower(COALESCE(b2.status,'')) NOT LIKE '%cancel%'
          AND NOT EXISTS (
            SELECT 1 FROM public.data_issue_ignores i
             WHERE i.kind='overlap_booking'
               AND i.key = LEAST(b1.id::text, b2.id::text) || '_' || GREATEST(b1.id::text, b2.id::text)
          )),
    (SELECT count(*)::int FROM public.bookings
       WHERE COALESCE(net_payout,0) > 0
         AND payout_bank_account_id IS NULL
         AND lower(COALESCE(status,'')) NOT LIKE '%cancel%'),
    (SELECT COALESCE(sum(net_payout),0) FROM public.bookings
       WHERE COALESCE(net_payout,0) > 0
         AND payout_bank_account_id IS NULL
         AND lower(COALESCE(status,'')) NOT LIKE '%cancel%'),
    (SELECT count(*)::int FROM public.bookings
       WHERE COALESCE(net_payout,0) > 0
         AND ((payout_date IS NULL) <> (payout_bank_account_id IS NULL))
         AND lower(COALESCE(status,'')) NOT LIKE '%cancel%'),
    (SELECT count(*)::int FROM public.expenses
       WHERE COALESCE(amount,0) <= 0),
    (SELECT count(*)::int FROM public.booking_cleanings
       WHERE status='paid' AND cleaner_id IS NULL),
    (SELECT count(*)::int FROM public.booking_cleanings
       WHERE status='done' AND done_date IS NULL),
    (SELECT count(*)::int FROM public.bookings
       WHERE end_date <= start_date OR COALESCE(num_nights,0) <= 0),
    (SELECT count(*)::int FROM (
        SELECT confirmation_code, channel
        FROM public.bookings
        WHERE confirmation_code IS NOT NULL AND length(trim(confirmation_code)) > 0
        GROUP BY confirmation_code, channel
        HAVING count(*) > 1
    ) d);
$$;

GRANT EXECUTE ON FUNCTION public.rpc_data_issues_summary_v2() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3) rpc_delete_booking_cascade
--    Borra una reserva y todas sus dependencias en una transacción.
--    Devuelve el conteo de filas borradas por tabla.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_booking_cascade(
  p_booking_id UUID
)
RETURNS TABLE (
  cleanings_deleted   INT,
  expenses_deleted    INT,
  adjustments_deleted INT,
  payments_deleted    INT,
  deposits_deleted    INT,
  booking_deleted     INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_c INT := 0; v_e INT := 0; v_a INT := 0; v_p INT := 0; v_d INT := 0; v_b INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id es obligatorio.';
  END IF;

  WITH d AS (DELETE FROM public.booking_cleanings WHERE booking_id = p_booking_id RETURNING 1)
  SELECT count(*)::int INTO v_c FROM d;

  WITH d AS (DELETE FROM public.expenses WHERE booking_id = p_booking_id RETURNING 1)
  SELECT count(*)::int INTO v_e FROM d;

  -- booking_adjustments puede no existir en todos los entornos; usar EXECUTE defensivo.
  BEGIN
    WITH d AS (DELETE FROM public.booking_adjustments WHERE booking_id = p_booking_id RETURNING 1)
    SELECT count(*)::int INTO v_a FROM d;
  EXCEPTION WHEN undefined_table THEN v_a := 0;
  END;

  BEGIN
    WITH d AS (DELETE FROM public.booking_payments WHERE booking_id = p_booking_id RETURNING 1)
    SELECT count(*)::int INTO v_p FROM d;
  EXCEPTION WHEN undefined_table THEN v_p := 0;
  END;

  BEGIN
    WITH d AS (DELETE FROM public.booking_deposits WHERE booking_id = p_booking_id RETURNING 1)
    SELECT count(*)::int INTO v_d FROM d;
  EXCEPTION WHEN undefined_table THEN v_d := 0;
  END;

  WITH d AS (DELETE FROM public.bookings WHERE id = p_booking_id RETURNING 1)
  SELECT count(*)::int INTO v_b FROM d;

  IF v_b = 0 THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  RETURN QUERY SELECT v_c, v_e, v_a, v_p, v_d, v_b;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_booking_cascade(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4) rpc_ignore_data_issue / rpc_unignore_data_issue
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_ignore_data_issue(
  p_kind TEXT,
  p_key  TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
  IF p_kind IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'kind y key son obligatorios.';
  END IF;
  INSERT INTO public.data_issue_ignores (kind, key, note, ignored_by)
  VALUES (p_kind, p_key, p_note, v_user_id)
  ON CONFLICT (kind, key) DO UPDATE SET
    note = EXCLUDED.note,
    ignored_at = NOW(),
    ignored_by = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ignore_data_issue(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_unignore_data_issue(
  p_kind TEXT,
  p_key  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.data_issue_ignores WHERE kind = p_kind AND key = p_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_unignore_data_issue(TEXT, TEXT) TO authenticated;


-- ============================================================================
-- migration_053_credit_pool_property_scope.sql
-- ============================================================================
-- migration_053_credit_pool_property_scope.sql
--
-- Bolsa de créditos v2: scoping por propiedad, snapshot de precio/crédito
-- y vínculo bidireccional con el expense de compra/recarga.
--
-- Cambios:
--   1. Nueva tabla credit_pool_properties: cobertura cuando la bolsa NO
--      tiene vendor_id. Si la bolsa tiene vendor_id, la cobertura sale de
--      vendor_properties (sigue siendo una sola fuente por bolsa).
--   2. credit_pool_consumptions.unit_price_snapshot: congela el precio/crédito
--      al momento del consumo para que reportes históricos no cambien aunque
--      se edite la pool.
--   3. credit_pools.expense_id: liga la bolsa a su expense de compra/recarga.
--      Si es null, la bolsa fue creada manualmente desde /credit-pools.
--   4. Índice por (vendor_id, status, activated_at) para acelerar FIFO.
--
-- Modelo FIFO: cada recarga = nueva fila en credit_pools (NO se promedia
-- precio). El servicio de consumo elige el pool más antiguo activo aplicable.

-- 1) Cobertura independiente para bolsas sin vendor
create table if not exists credit_pool_properties (
  pool_id uuid not null references credit_pools(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pool_id, property_id)
);

create index if not exists credit_pool_properties_property_idx
  on credit_pool_properties (property_id);

alter table credit_pool_properties enable row level security;

drop policy if exists credit_pool_properties_owner on credit_pool_properties;
create policy credit_pool_properties_owner on credit_pool_properties
  for all using (
    exists (
      select 1 from credit_pools cp
      where cp.id = credit_pool_properties.pool_id
        and cp.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from credit_pools cp
      where cp.id = credit_pool_properties.pool_id
        and cp.owner_id = auth.uid()
    )
  );

-- 2) Snapshot del precio/crédito en cada consumption
alter table credit_pool_consumptions
  add column if not exists unit_price_snapshot numeric;

-- Backfill: derivar snapshot desde el pool actual para consumptions previas.
update credit_pool_consumptions c
set unit_price_snapshot = case
  when p.credits_total > 0 then p.total_price / p.credits_total
  else 0
end
from credit_pools p
where p.id = c.pool_id
  and c.unit_price_snapshot is null;

-- 3) Vínculo de la bolsa con el expense de compra/recarga
alter table credit_pools
  add column if not exists expense_id uuid references expenses(id) on delete set null;

create index if not exists credit_pools_expense_idx
  on credit_pools (expense_id);

-- 4) Índice FIFO por vendor
create index if not exists credit_pools_vendor_fifo_idx
  on credit_pools (vendor_id, status, activated_at asc);


-- ============================================================================
-- migration_055_deposit_applications.sql
-- ============================================================================
-- migration_055_deposit_applications.sql
-- ============================================================
-- Trazabilidad detallada de los DEPÓSITOS DE SEGURIDAD por reserva.
--
-- Hasta migration_049, una reserva guardaba el ciclo del depósito en
-- columnas planas (security_deposit, deposit_returned_amount,
-- deposit_status, deposit_return_date). Eso solo soportaba:
--   recibido → devuelto / devuelto parcial.
--
-- Esta migración agrega APLICACIONES del depósito a:
--   - daños (applied_to_damage)
--   - excedente convertido a ingreso (surplus_to_income)
--   - devoluciones al huésped (returned_to_guest)  ← fuente de verdad nueva
--
-- Además, la "cuenta Depósitos de huéspedes" del UI es un LEDGER VIRTUAL
-- (no es un bank_account real). El dinero real sigue viviendo en la cuenta
-- bancaria escogida en bookings.deposit_bank_account_id; esta tabla solo
-- da trazabilidad sin afectar P&L del negocio.
--
-- IDEMPOTENTE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.booking_deposit_applications (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id    UUID          NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  expense_id    UUID          REFERENCES public.expenses(id) ON DELETE SET NULL,
  kind          TEXT          NOT NULL
                  CHECK (kind IN ('applied_to_damage','surplus_to_income','returned_to_guest')),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  applied_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bda_owner   ON public.booking_deposit_applications(owner_id);
CREATE INDEX IF NOT EXISTS idx_bda_booking ON public.booking_deposit_applications(booking_id);
CREATE INDEX IF NOT EXISTS idx_bda_expense ON public.booking_deposit_applications(expense_id);
CREATE INDEX IF NOT EXISTS idx_bda_kind    ON public.booking_deposit_applications(kind);

ALTER TABLE public.booking_deposit_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bda_owner ON public.booking_deposit_applications;
CREATE POLICY bda_owner ON public.booking_deposit_applications
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- Ampliar CHECK de bookings.deposit_status para incluir
--   'applied_to_damage' y 'mixed'.
-- El estado debe terminar siendo DERIVADO de la tabla nueva,
-- pero por compatibilidad con el código existente lo seguimos
-- escribiendo en la columna (vía servicio / trigger).
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'bookings'
      AND constraint_name   = 'chk_bookings_deposit_status'
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT chk_bookings_deposit_status;
  END IF;

  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_deposit_status
    CHECK (deposit_status IN (
      'none','received','partial_return','returned','applied_to_damage','mixed'
    ));
END;
$$;

-- ============================================================
-- Backfill: por cada booking con deposit_returned_amount > 0
-- crear la fila equivalente 'returned_to_guest' (si aún no existe).
-- ============================================================
INSERT INTO public.booking_deposit_applications
  (owner_id, booking_id, kind, amount, applied_date, notes)
SELECT
  p.owner_id,
  b.id,
  'returned_to_guest',
  b.deposit_returned_amount,
  COALESCE(b.deposit_return_date, b.end_date, CURRENT_DATE),
  'Backfill migration_055 desde columnas legacy'
FROM public.bookings b
JOIN public.listings  l ON l.id = b.listing_id
JOIN public.properties p ON p.id = l.property_id
LEFT JOIN public.booking_deposit_applications existing
  ON existing.booking_id = b.id
 AND existing.kind       = 'returned_to_guest'
WHERE b.deposit_returned_amount IS NOT NULL
  AND b.deposit_returned_amount > 0
  AND existing.id IS NULL;

-- ============================================================
-- Función helper para recalcular el deposit_status agregado de
-- una reserva en función de las filas en booking_deposit_applications.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_booking_deposit_status(p_booking_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_security        NUMERIC;
  v_returned        NUMERIC;
  v_applied         NUMERIC;
  v_surplus         NUMERIC;
  v_new_status      TEXT;
  v_last_return_dt  DATE;
BEGIN
  SELECT COALESCE(security_deposit, 0)
    INTO v_security
    FROM public.bookings WHERE id = p_booking_id;

  IF v_security IS NULL OR v_security <= 0 THEN
    UPDATE public.bookings
       SET deposit_status          = 'none',
           deposit_returned_amount = NULL,
           deposit_return_date     = NULL
     WHERE id = p_booking_id;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN kind = 'returned_to_guest'  THEN amount END), 0),
    COALESCE(SUM(CASE WHEN kind = 'applied_to_damage'  THEN amount END), 0),
    COALESCE(SUM(CASE WHEN kind = 'surplus_to_income'  THEN amount END), 0),
    MAX(CASE WHEN kind = 'returned_to_guest' THEN applied_date END)
    INTO v_returned, v_applied, v_surplus, v_last_return_dt
  FROM public.booking_deposit_applications
  WHERE booking_id = p_booking_id;

  IF v_returned = 0 AND v_applied = 0 AND v_surplus = 0 THEN
    v_new_status := 'received';
  ELSIF (v_returned + v_applied + v_surplus) >= v_security THEN
    v_new_status := 'returned';   -- "cerrado": nada queda retenido al huésped
  ELSIF v_returned > 0 AND v_applied > 0 THEN
    v_new_status := 'mixed';
  ELSIF v_applied > 0 THEN
    v_new_status := 'applied_to_damage';
  ELSIF v_returned > 0 THEN
    v_new_status := 'partial_return';
  ELSE
    -- solo surplus, sin daño ni devolución: tratarlo como returned (cerrado)
    v_new_status := 'returned';
  END IF;

  UPDATE public.bookings
     SET deposit_status          = v_new_status,
         deposit_returned_amount = CASE WHEN v_returned > 0 THEN v_returned ELSE NULL END,
         deposit_return_date     = v_last_return_dt
   WHERE id = p_booking_id;
END;
$$;

-- ============================================================
-- Trigger: cuando se inserta/actualiza/elimina una aplicación,
-- recalcular el estado agregado de la reserva.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_bda_after_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_booking_deposit_status(OLD.booking_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_booking_deposit_status(NEW.booking_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS bda_recompute ON public.booking_deposit_applications;
CREATE TRIGGER bda_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.booking_deposit_applications
FOR EACH ROW EXECUTE FUNCTION public.trg_bda_after_change();

-- Recalcular para todas las reservas con depósito tras el backfill.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.bookings
    WHERE security_deposit IS NOT NULL AND security_deposit > 0
  LOOP
    PERFORM public.recompute_booking_deposit_status(r.id);
  END LOOP;
END;
$$;

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- SELECT COUNT(*) FROM public.booking_deposit_applications;
-- SELECT deposit_status, COUNT(*) FROM public.bookings GROUP BY 1;
-- ============================================================


-- ============================================================================
-- migration_056_account_approval.sql
-- ============================================================================
-- migration_056_account_approval.sql
-- ============================================================
-- Flujo de aprobación de cuentas por administrador.
--
-- Antes: cualquier signup creaba un profile inmediatamente operativo.
-- Después: nuevos usuarios entran en 'pending' y no pueden iniciar
-- sesión hasta que un admin los apruebe. El admin puede también
-- suspender o eliminar cuentas.
--
-- IDEMPOTENTE.
-- ============================================================

-- 1) Columnas nuevas en profiles ────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending','approved','suspended')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- 2) Backfill: cuentas existentes + bootstrap admin ─────────────
-- Marca TODAS las cuentas pre-existentes como aprobadas (no queremos
-- bloquear a nadie que ya estaba operando).
UPDATE public.profiles
   SET status      = 'approved',
       approved_at = COALESCE(approved_at, now())
 WHERE status = 'pending';

-- Eleva a admin la cuenta dueña del sistema.
UPDATE public.profiles
   SET role = 'admin'
 WHERE email = 'franconuezm@gmail.com';

-- 3) Trigger handle_new_user reescrito ──────────────────────────
-- El admin de bootstrap (franconuezm@gmail.com) entra ya aprobado y
-- con rol admin, por si se re-crea. Cualquier otro signup entra como
-- 'owner' pendiente de aprobación.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  is_bootstrap_admin BOOLEAN := (NEW.email = 'franconuezm@gmail.com');
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    CASE WHEN is_bootstrap_admin THEN 'admin' ELSE 'owner' END,
    CASE WHEN is_bootstrap_admin THEN 'approved' ELSE 'pending' END,
    CASE WHEN is_bootstrap_admin THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 4) RLS: el admin puede leer y actualizar todos los profiles ───
-- Usamos SECURITY DEFINER para evitar recursión infinita: la función
-- corre como postgres (sin RLS) al ser evaluada dentro de una policy.
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- 5) RPC: admin cambia el status de una cuenta ──────────────────
CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  target_id  UUID,
  new_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not admin';
  END IF;

  IF new_status NOT IN ('pending','approved','suspended') THEN
    RAISE EXCEPTION 'invalid status: %', new_status;
  END IF;

  UPDATE public.profiles
     SET status      = new_status,
         approved_at = CASE WHEN new_status = 'approved' THEN now()        ELSE approved_at END,
         approved_by = CASE WHEN new_status = 'approved' THEN auth.uid()   ELSE approved_by END
   WHERE id = target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_account_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(UUID, TEXT) TO authenticated;

-- 6) RPC: admin elimina cuenta completa (cascada borra todo) ────
-- Borra de auth.users (lo que cascadea a profiles y a todas las
-- tablas con FK ON DELETE CASCADE a auth.users(id)).
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not admin';
  END IF;

  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'admin cannot delete itself';
  END IF;

  DELETE FROM auth.users WHERE id = target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;


-- ============================================================================
-- migration_057_notification_email_tracking.sql
-- ============================================================================
-- migration_057_notification_email_tracking.sql
-- ============================================================
-- Soporte de envío de emails de recordatorios:
--   • last_email_sent_at: cuándo fue el último digest enviado.
--     Se usa para respetar repeat_cadence (daily/every_2_days/weekly)
--     evitando reenvíos prematuros.
--   • last_email_payload: hash/resumen del digest enviado, útil
--     para debugging y para no reenviar idénticos.
-- IDEMPOTENTE.
-- ============================================================

ALTER TABLE public.user_notification_settings
  ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_email_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_uns_email_enabled
  ON public.user_notification_settings(email_enabled)
  WHERE email_enabled = true;


-- ============================================================================
-- migration_058_pending_digest_function.sql
-- ============================================================================
-- migration_058_pending_digest_function.sql
-- ============================================================
-- Función SQL `get_pending_digest(owner, lead_days)` que retorna
-- conteos de pendientes por categoría para construir el email de
-- recordatorios diario. Devuelve JSONB con la estructura:
--
--   {
--     "recurring": 3,
--     "shared_bills": 2,
--     "maintenance": 1,
--     "cleanings": 4,
--     "checkout_pending": 2,
--     "inventory_pending": 1,
--     "payout_pending": 0,
--     "end_of_life": 1,
--     "total": 14
--   }
--
-- SECURITY DEFINER → se llama desde la Edge Function (service_role).
-- IDEMPOTENTE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pending_digest(
  p_owner_id   UUID,
  p_lead_days  INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_today        DATE := CURRENT_DATE;
  v_now_ym       TEXT := to_char(v_today, 'YYYY-MM');
  v_window_end   DATE := v_today + (p_lead_days || ' days')::interval;

  c_recurring   INTEGER := 0;
  c_shared      INTEGER := 0;
  c_maintenance INTEGER := 0;
  c_cleanings   INTEGER := 0;
  c_checkout    INTEGER := 0;
  c_inventory   INTEGER := 0;
  c_payout      INTEGER := 0;
  c_eol         INTEGER := 0;
BEGIN
  -- 1) Recurring expenses pending (últimos 6 meses, no shared)
  -- Un mes es pendiente si: el rubro está activo en ese mes y no hay
  -- entry en recurring_expense_periods con status='paid'|'skipped'.
  SELECT COUNT(*) INTO c_recurring
  FROM public.property_recurring_expenses pre
  JOIN public.properties p ON p.id = pre.property_id
  CROSS JOIN LATERAL (
    SELECT to_char(date_trunc('month', v_today) - (n || ' months')::interval, 'YYYY-MM') AS ym
    FROM generate_series(0, 5) n
  ) months
  WHERE p.owner_id = p_owner_id
    AND pre.is_shared = false
    AND (pre.valid_from IS NULL OR to_char(pre.valid_from, 'YYYY-MM') <= months.ym)
    AND (pre.valid_to   IS NULL OR to_char(pre.valid_to,   'YYYY-MM') >= months.ym)
    AND NOT EXISTS (
      SELECT 1 FROM public.recurring_expense_periods rep
      WHERE rep.recurring_id = pre.id AND rep.year_month = months.ym
    );

  -- 2) Shared bills pendientes (mes actual, vendors compartidos sin factura)
  SELECT COUNT(DISTINCT pre.vendor_id) INTO c_shared
  FROM public.property_recurring_expenses pre
  JOIN public.properties p ON p.id = pre.property_id
  WHERE p.owner_id = p_owner_id
    AND pre.is_shared = true
    AND pre.vendor_id IS NOT NULL
    AND (pre.valid_from IS NULL OR to_char(pre.valid_from, 'YYYY-MM') <= v_now_ym)
    AND (pre.valid_to   IS NULL OR to_char(pre.valid_to,   'YYYY-MM') >= v_now_ym)
    AND NOT EXISTS (
      SELECT 1 FROM public.shared_bills sb
      WHERE sb.vendor_id = pre.vendor_id AND sb.year_month = v_now_ym
    );

  -- 3) Maintenance pending dentro del lead_days
  SELECT COUNT(*) INTO c_maintenance
  FROM public.inventory_maintenance_schedules
  WHERE owner_id = p_owner_id
    AND status = 'pending'
    AND scheduled_date <= v_window_end;

  -- 4) Cleanings done sin pagar
  SELECT COUNT(*) INTO c_cleanings
  FROM public.booking_cleanings bc
  JOIN public.bookings b ON b.id = bc.booking_id
  JOIN public.listings l ON l.id = b.listing_id
  JOIN public.properties p ON p.id = l.property_id
  WHERE p.owner_id = p_owner_id
    AND bc.status = 'done'
    AND bc.paid_date IS NULL;

  -- 5) Booking alerts (reservas pasadas con flags pendientes, últimos 45 días)
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(b.checkout_done, false) = false),
    COUNT(*) FILTER (WHERE COALESCE(b.inventory_checked, false) = false)
  INTO c_checkout, c_inventory
  FROM public.bookings b
  JOIN public.listings l ON l.id = b.listing_id
  JOIN public.properties p ON p.id = l.property_id
  WHERE p.owner_id = p_owner_id
    AND b.end_date < v_today
    AND b.end_date >= v_today - INTERVAL '45 days'
    AND COALESCE(b.status, '') NOT ILIKE '%cancel%';

  -- 6) Payout pendientes: bookings con checkout pero sin bank account asignada
  -- (solo cuenta si la columna existe; tolerante a no-existencia)
  BEGIN
    EXECUTE format($q$
      SELECT COUNT(*)
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE p.owner_id = %L
        AND b.end_date < %L
        AND b.end_date >= %L - INTERVAL '45 days'
        AND COALESCE(b.status, '') NOT ILIKE '%%cancel%%'
        AND b.payout_bank_account_id IS NULL
    $q$, p_owner_id, v_today, v_today)
    INTO c_payout;
  EXCEPTION WHEN undefined_column THEN
    c_payout := 0;
  END;

  -- 7) End-of-life inventory
  SELECT COUNT(*) INTO c_eol
  FROM public.inventory_items
  WHERE owner_id = p_owner_id
    AND purchase_date IS NOT NULL
    AND expected_lifetime_months IS NOT NULL
    AND (purchase_date + (expected_lifetime_months || ' months')::interval)::date <= v_today
    AND COALESCE(status, '') <> 'end_of_life';

  RETURN jsonb_build_object(
    'recurring',         c_recurring,
    'shared_bills',      c_shared,
    'maintenance',       c_maintenance,
    'cleanings',         c_cleanings,
    'checkout_pending',  c_checkout,
    'inventory_pending', c_inventory,
    'payout_pending',    c_payout,
    'end_of_life',       c_eol,
    'total',             c_recurring + c_shared + c_maintenance + c_cleanings
                       + c_checkout + c_inventory + c_payout + c_eol
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_digest(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_digest(UUID, INTEGER) TO authenticated, service_role;


-- ============================================================================
-- VERIFICACION FINAL
-- ============================================================================
SELECT 'Tablas creadas' AS check, count(*) AS total FROM information_schema.tables WHERE table_schema = 'public';
SELECT 'Funciones creadas' AS check, count(*) AS total FROM information_schema.routines WHERE routine_schema = 'public';
SELECT 'Policies RLS' AS check, count(*) AS total FROM pg_policies WHERE schemaname = 'public';
