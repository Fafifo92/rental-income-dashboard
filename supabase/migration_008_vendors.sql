-- ============================================================
-- MIGRATION 008 — Vendors / Proveedores unificados
-- ============================================================
-- Tabla maestra para empresas y personas a las que se les paga:
--   • utility       → EPM, Tigo, Claro, Acueducto…
--   • admin         → Administración del edificio
--   • maintenance   → técnico de gas, fumigador, electricista…
--   • cleaner       → personal de aseo
--   • insurance     → aseguradoras (RC, hogar)
--   • other         → cualquier otro
-- Reemplaza progresivamente los strings sueltos en
-- property_recurring_expenses.vendor (los conserva como fallback).
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendors (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id   UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('utility','admin','maintenance','cleaner','insurance','other')),
  contact    TEXT,                        -- teléfono, email o ambos
  notes      TEXT,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_owner_kind ON vendors(owner_id, kind);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_own" ON vendors;
CREATE POLICY "vendors_own" ON vendors FOR ALL USING (owner_id = auth.uid());

-- FK opcional desde gastos recurrentes al vendor (mantiene .vendor TEXT como legacy)
ALTER TABLE property_recurring_expenses
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_vendor_id ON property_recurring_expenses(vendor_id);

-- FK opcional desde gastos puntuales al vendor (extiende, no rompe)
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_id ON expenses(vendor_id);

-- ── LISTO ────────────────────────────────────────────────────
