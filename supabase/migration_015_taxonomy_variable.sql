-- ============================================================
-- MIGRATION 015 — Taxonomía 4+3 + servicios variables + insumos aseo
-- ============================================================
-- Cambios:
-- 1. vendors.is_variable: si true, al pagar la factura el usuario
--    debe ingresar el monto exacto por propiedad (sin auto-reparto).
-- 2. expenses.subcategory: id estable de la subcategoría
--    ('utilities','administration','maintenance','stock',
--     'cleaning','damage','guest_amenities'). Permite agrupar
--    sin depender del texto display de category.
-- 3. booking_cleanings.supplies_amount + reimburse_to_cleaner:
--    para registrar cuánto gastó el aseador en insumos y si se
--    le debe reembolsar.
-- 4. Backfill: heurística simple de subcategory desde category.
-- Idempotente.
-- ============================================================

-- 1. vendors.is_variable
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS is_variable BOOLEAN NOT NULL DEFAULT false;

-- 2. expenses.subcategory
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS subcategory TEXT;

CREATE INDEX IF NOT EXISTS idx_expenses_subcategory ON expenses(subcategory);

-- Backfill subcategory desde category (best-effort)
UPDATE expenses SET subcategory = CASE
  WHEN category ILIKE '%servicio%publico%' OR category ILIKE '%internet%'
       OR category ILIKE '%luz%' OR category ILIKE '%agua%' OR category ILIKE '%gas%'
       THEN 'utilities'
  WHEN category ILIKE '%administ%' OR category ILIKE '%predial%'
       OR category ILIKE '%seguro%' OR category ILIKE '%impuesto%'
       THEN 'administration'
  WHEN category ILIKE '%mantenim%' OR category ILIKE '%reparaci%'
       THEN 'maintenance'
  WHEN category ILIKE '%toalla%' OR category ILIKE '%utensil%'
       OR category ILIKE '%decora%' OR category ILIKE '%inventario%'
       THEN 'stock'
  WHEN category ILIKE '%limpieza%' OR category ILIKE '%aseo%'
       OR category ILIKE '%lavander%' OR category = 'cleaning'
       THEN 'cleaning'
  WHEN category ILIKE '%da%o%' OR category ILIKE '%reparaci%n da%'
       THEN 'damage'
  WHEN category ILIKE '%welcome%' OR category ILIKE '%kit%'
       THEN 'guest_amenities'
  ELSE NULL
END
WHERE subcategory IS NULL;

-- 3. booking_cleanings: insumos + reembolso
ALTER TABLE booking_cleanings
  ADD COLUMN IF NOT EXISTS supplies_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE booking_cleanings
  ADD COLUMN IF NOT EXISTS reimburse_to_cleaner BOOLEAN NOT NULL DEFAULT false;

-- ── LISTO ────────────────────────────────────────────────────
