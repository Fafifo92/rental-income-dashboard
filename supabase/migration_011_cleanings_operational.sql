-- ============================================================
-- MIGRATION 011 — Estado operativo de reserva + aseo
-- ============================================================
-- 1. Banderas operativas en bookings (check-in/out, inventario).
-- 2. Tarifa de aseo por defecto en cada propiedad.
-- 3. Tabla booking_cleanings: cada reserva puede tener un aseo
--    asignado a una persona (vendor kind='cleaner') con tarifa,
--    estado y trazabilidad de pago.
-- Idempotente.
-- ============================================================

-- ── 1. Banderas operativas en bookings ───────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checkin_done       BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checkout_done      BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS inventory_checked  BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS operational_notes  TEXT;

-- ── 2. Tarifa de aseo por defecto a nivel propiedad ──────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS default_cleaning_fee NUMERIC(12,2);

-- ── 3. Aseos por reserva ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_cleanings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  cleaner_id  UUID REFERENCES vendors(id) ON DELETE SET NULL,
  fee         NUMERIC(12,2) NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','done','paid')) DEFAULT 'pending',
  done_date   DATE,
  paid_date   DATE,
  notes       TEXT,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_cleanings_booking ON booking_cleanings(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_cleanings_cleaner_status
  ON booking_cleanings(cleaner_id, status);

ALTER TABLE booking_cleanings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_cleanings_own" ON booking_cleanings;
CREATE POLICY "booking_cleanings_own" ON booking_cleanings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM bookings b
    JOIN listings l ON l.id = b.listing_id
    JOIN properties p ON p.id = l.property_id
    WHERE b.id = booking_cleanings.booking_id
      AND p.owner_id = auth.uid()
  )
);

-- ── LISTO ────────────────────────────────────────────────────
