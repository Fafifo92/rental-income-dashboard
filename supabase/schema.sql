-- TABLES

-- Profiles
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'owner' CHECK (role IN ('admin', 'owner')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Properties
CREATE TABLE properties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  base_currency TEXT DEFAULT 'COP' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Listings (Maps CSV names to properties)
CREATE TABLE listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  external_name TEXT NOT NULL,
  source TEXT DEFAULT 'airbnb',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(property_id, external_name)
);

-- Bookings
CREATE TABLE bookings (
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

-- Expense Categories
CREATE TABLE expense_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('fixed', 'variable')) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Expenses
CREATE TABLE expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT DEFAULT 'COP',
  date DATE NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'partial')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS POLICIES

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Owners can manage own properties" ON properties FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "Access listings by property" ON listings FOR ALL USING (
  EXISTS (SELECT 1 FROM properties WHERE properties.id = listings.property_id AND properties.owner_id = auth.uid())
);

CREATE POLICY "Access bookings by listing" ON bookings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM listings
    JOIN properties ON listings.property_id = properties.id
    WHERE listings.id = bookings.listing_id AND properties.owner_id = auth.uid()
  )
);

CREATE POLICY "Access expenses by property" ON expenses FOR ALL USING (
  EXISTS (SELECT 1 FROM properties WHERE properties.id = expenses.property_id AND properties.owner_id = auth.uid())
);

-- SEED DATA
INSERT INTO expense_categories (name, type) VALUES
('Limpieza', 'variable'),
('Mantenimiento', 'variable'),
('Internet', 'fixed'),
('Servicios', 'fixed'),
('Administración', 'fixed');
