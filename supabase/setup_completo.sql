-- ============================================================
-- SETUP COMPLETO v2 — Limpia y recrea todo desde cero
-- ============================================================
-- Supabase Dashboard → SQL Editor → New query → pegar → Run
-- ► Seguro correrlo varias veces (idempotente)
-- ============================================================

-- ── 0. LIMPIEZA TOTAL ────────────────────────────────────────
DROP TABLE IF EXISTS expenses   CASCADE;
DROP TABLE IF EXISTS bookings   CASCADE;
DROP TABLE IF EXISTS listings   CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS profiles   CASCADE;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ── 1. PROFILES ──────────────────────────────────────────────
CREATE TABLE profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT,
  role       TEXT DEFAULT 'owner' CHECK (role IN ('admin', 'owner')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ── 2. PROPERTIES ────────────────────────────────────────────
CREATE TABLE properties (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  base_currency TEXT DEFAULT 'COP' NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ── 3. LISTINGS ──────────────────────────────────────────────
CREATE TABLE listings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  external_name TEXT NOT NULL,
  source        TEXT DEFAULT 'airbnb',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
  UNIQUE(property_id, external_name)
);

-- ── 4. BOOKINGS ──────────────────────────────────────────────
CREATE TABLE bookings (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id        UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
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
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ── 5. EXPENSES ──────────────────────────────────────────────
-- owner_id: el usuario dueño del gasto (para RLS)
-- property_id: opcional — no es obligatorio asignar a una propiedad
CREATE TABLE expenses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  category    TEXT NOT NULL,
  type        TEXT CHECK (type IN ('fixed', 'variable')) NOT NULL DEFAULT 'variable',
  amount      NUMERIC(12, 2) NOT NULL,
  currency    TEXT DEFAULT 'COP',
  date        DATE NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- ── 6. RLS (Row Level Security) ──────────────────────────────
ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own"   ON profiles   FOR ALL USING (auth.uid() = id);
CREATE POLICY "properties_own" ON properties FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "expenses_own"   ON expenses   FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "listings_own" ON listings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM properties
    WHERE properties.id = listings.property_id
      AND properties.owner_id = auth.uid()
  )
);

CREATE POLICY "bookings_own" ON bookings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM listings
    JOIN properties ON listings.property_id = properties.id
    WHERE listings.id = bookings.listing_id
      AND properties.owner_id = auth.uid()
  )
);

-- ── 7. TRIGGER: auto-crear perfil al registrarse ─────────────
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

-- ── 8. BACKFILL: perfiles para usuarios ya existentes ────────
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

