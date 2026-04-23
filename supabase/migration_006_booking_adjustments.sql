-- ============================================================
-- MIGRATION 006 — Ajustes de reserva (ingresos extra / descuentos / cargos por daño)
-- ============================================================
-- Permite registrar movimientos financieros atribuibles a una reserva
-- que NO son ni el bruto original ni un gasto propio:
--   • extra_income    → huésped paga por persona adicional, late check-out, etc.
--   • discount        → descuento/compensación que le diste al huésped (resta ingreso)
--   • damage_charge   → cobro al huésped por daño (suma ingreso; el gasto de reparar es otro)
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_adjustments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  UUID REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('extra_income', 'discount', 'damage_charge')),
  amount      NUMERIC(12, 2) NOT NULL,
  description TEXT,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE booking_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_adjustments_own" ON booking_adjustments;
CREATE POLICY "booking_adjustments_own" ON booking_adjustments FOR ALL USING (
  EXISTS (
    SELECT 1 FROM bookings b
    JOIN listings l ON l.id = b.listing_id
    JOIN properties p ON p.id = l.property_id
    WHERE b.id = booking_adjustments.booking_id
      AND p.owner_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_adjustments_booking ON booking_adjustments(booking_id);

-- ── LISTO ────────────────────────────────────────────────────
