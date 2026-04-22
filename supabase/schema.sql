-- TABLES

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'owner' CHECK (role IN ('admin', 'owner')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Properties
CREATE TABLE IF NOT EXISTS properties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  base_currency TEXT DEFAULT 'COP' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Listings (Maps CSV external names to properties)
CREATE TABLE IF NOT EXISTS listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  external_name TEXT NOT NULL,
  source TEXT DEFAULT 'airbnb',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(property_id, external_name)
);

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
  confirmation_code TEXT UNIQUE NOT NULL,
  guest_name TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  booked_at DATE,
  num_nights INTEGER NOT NULL,
  num_adults INTEGER DEFAULT 1,
  num_children INTEGER DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL,
  status TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Expenses (denormalized per ARCHITECTURE.md — category as text, type inline)
-- owner_id: direct user link for RLS; property_id: optional FK
CREATE TABLE IF NOT EXISTS expenses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid(),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  category    TEXT NOT NULL,
  type        TEXT CHECK (type IN ('fixed', 'variable')) NOT NULL DEFAULT 'variable',
  amount      NUMERIC(12, 2) NOT NULL,
  currency    TEXT DEFAULT 'COP',
  date        DATE NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS POLICIES

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Owners can manage own properties"
  ON properties FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "Access listings by property"
  ON listings FOR ALL USING (
    EXISTS (SELECT 1 FROM properties WHERE properties.id = listings.property_id AND properties.owner_id = auth.uid())
  );

CREATE POLICY "Access bookings by listing"
  ON bookings FOR ALL USING (
    EXISTS (
      SELECT 1 FROM listings
      JOIN properties ON listings.property_id = properties.id
      WHERE listings.id = bookings.listing_id AND properties.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users manage own expenses"
  ON expenses FOR ALL USING (auth.uid() = owner_id);

-- SEED: Default expense categories as reference (not a table — just a comment for the UI)
-- Categories: Limpieza, Lavandería, Internet, Servicios Públicos, Mantenimiento,
--             Administración, Welcome Kit, Seguros, Impuestos, Otro

