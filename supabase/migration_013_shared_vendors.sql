-- ============================================================
-- MIGRATION 013 — Proveedores compartidos + facturas agrupadas
-- ============================================================
-- Cambios conceptuales:
-- 1. Un proveedor (vendor) puede cubrir N propiedades con UNA
--    misma factura. Se modela con tabla vendor_properties +
--    método de reparto (igual o porcentaje custom).
-- 2. Nueva entidad shared_bills: representa la factura mensual
--    del proveedor. Al pagarla se crean N expenses (uno por
--    propiedad) automáticamente, vinculados por shared_bill_id.
-- 3. property_recurring_expenses gana is_shared: si true, ese
--    rubro NO aparece como pendiente individual porque se paga
--    vía factura compartida del proveedor.
-- 4. Aseo ('cleaner') sale de vendors conceptualmente — se
--    gestiona en módulo Aseo. Los registros existentes no se
--    tocan para no romper datos.
-- Idempotente.
-- ============================================================

-- ── 1. vendor_properties: muchos-a-muchos vendor ↔ property ──
CREATE TABLE IF NOT EXISTS vendor_properties (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id      UUID REFERENCES vendors(id) ON DELETE CASCADE NOT NULL,
  property_id    UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  share_percent  NUMERIC(6,3),  -- NULL = reparto igual automático. Si se indica, suma ≤100 entre propiedades del vendor (no forzado por constraint).
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (vendor_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_properties_vendor   ON vendor_properties(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_properties_property ON vendor_properties(property_id);

ALTER TABLE vendor_properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vp_select_own" ON vendor_properties;
CREATE POLICY "vp_select_own" ON vendor_properties FOR SELECT USING (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "vp_insert_own" ON vendor_properties;
CREATE POLICY "vp_insert_own" ON vendor_properties FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "vp_update_own" ON vendor_properties;
CREATE POLICY "vp_update_own" ON vendor_properties FOR UPDATE USING (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "vp_delete_own" ON vendor_properties;
CREATE POLICY "vp_delete_own" ON vendor_properties FOR DELETE USING (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = vendor_properties.vendor_id AND v.owner_id = auth.uid())
);

-- ── 2. shared_bills: factura mensual del proveedor ───────────
CREATE TABLE IF NOT EXISTS shared_bills (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id           UUID REFERENCES vendors(id) ON DELETE CASCADE NOT NULL,
  year_month          CHAR(7) NOT NULL,              -- 'YYYY-MM'
  total_amount        NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  paid_date           DATE NOT NULL,
  bank_account_id     UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  category            TEXT,                           -- snapshot de categoría principal (opcional, para UI)
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (vendor_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_shared_bills_vendor     ON shared_bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_shared_bills_yearmonth  ON shared_bills(year_month);

ALTER TABLE shared_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sb_select_own" ON shared_bills;
CREATE POLICY "sb_select_own" ON shared_bills FOR SELECT USING (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "sb_insert_own" ON shared_bills;
CREATE POLICY "sb_insert_own" ON shared_bills FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "sb_update_own" ON shared_bills;
CREATE POLICY "sb_update_own" ON shared_bills FOR UPDATE USING (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);
DROP POLICY IF EXISTS "sb_delete_own" ON shared_bills;
CREATE POLICY "sb_delete_own" ON shared_bills FOR DELETE USING (
  EXISTS (SELECT 1 FROM vendors v WHERE v.id = shared_bills.vendor_id AND v.owner_id = auth.uid())
);

-- ── 3. Enlaces en tablas existentes ──────────────────────────
-- expenses gana shared_bill_id (si viene de una factura compartida)
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS shared_bill_id UUID REFERENCES shared_bills(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_shared_bill ON expenses(shared_bill_id);

-- property_recurring_expenses gana is_shared (flag)
-- Si true → este rubro se paga vía factura compartida del vendor;
-- se oculta del panel de "recurrentes individuales pendientes".
ALTER TABLE property_recurring_expenses
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

-- ── LISTO ────────────────────────────────────────────────────
