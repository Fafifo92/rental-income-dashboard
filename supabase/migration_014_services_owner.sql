-- ============================================================
-- MIGRATION 014 — Servicios y proveedores como fuente única
-- ============================================================
-- Cambios conceptuales:
-- 1. Vendors evolucionan a "Servicios": ahora tienen
--    `category` (1 de las 6 nuevas categorías), `default_amount`
--    (monto mensual esperado) y `day_of_month` (día estimado de
--    facturación). Esto reemplaza a property_recurring_expenses.
-- 2. vendor_properties admite `fixed_amount` (monto fijo por
--    propiedad) además de share_percent. Reglas de reparto:
--      a) si fixed_amount está seteado → esa propiedad paga ese monto
--      b) sino, si share_percent → reparte el resto por porcentaje
--      c) sino → reparto igual entre las que no tengan fixed_amount
-- 3. property_recurring_expenses queda LEGACY (no se borra para
--    preservar datos, pero la UI deja de leerla).
-- 4. Categorías canónicas para gastos (lo aplica el front en formularios).
-- Idempotente.
-- ============================================================

-- ── 1. vendor_properties: fixed_amount ───────────────────────
ALTER TABLE vendor_properties
  ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC(14,2);

-- ── 2. vendors: category + default_amount + day_of_month ─────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS category       TEXT,
  ADD COLUMN IF NOT EXISTS default_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS day_of_month   INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'vendors' AND constraint_name = 'vendors_day_of_month_chk'
  ) THEN
    ALTER TABLE vendors
      ADD CONSTRAINT vendors_day_of_month_chk
      CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31));
  END IF;
END $$;

-- ── 3. Backfill: vendors.category default 'Otros' donde sea NULL ──
UPDATE vendors SET category = CASE
  WHEN kind = 'utility'     THEN 'Servicios públicos'
  WHEN kind = 'admin'       THEN 'Administración'
  WHEN kind = 'maintenance' THEN 'Mantenimiento'
  WHEN kind = 'insurance'   THEN 'Seguros'
  ELSE 'Otros'
END
WHERE category IS NULL;

-- ── 4. Marcar property_recurring_expenses como legacy ────────
-- No se borra: solo agregamos un comentario para futura referencia.
COMMENT ON TABLE property_recurring_expenses IS
  'LEGACY desde mig 014. Reemplazado por vendors + vendor_properties + shared_bills.';

-- ── 5. Helper view: vendor_monthly_status ────────────────────
-- Lista para UI: vendor + mes + ¿pagado? (existencia en shared_bills).
-- Se materializa on-demand por la app, no es vista; aquí solo dejamos índices.
CREATE INDEX IF NOT EXISTS idx_shared_bills_vendor_ym
  ON shared_bills(vendor_id, year_month);

-- ── LISTO ────────────────────────────────────────────────────
