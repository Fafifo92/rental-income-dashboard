-- ============================================================
-- MIGRATION 005 — Proveedor + persona a cargo en gastos recurrentes
-- ============================================================
-- Permite que cada rubro recurrente (internet, administración, etc.)
-- guarde quién lo provee (Claro, Tigo, edificio X) y a cargo de
-- quién está (dueño, administrador).
-- Idempotente: seguro correrlo varias veces.
-- ============================================================

ALTER TABLE property_recurring_expenses
  ADD COLUMN IF NOT EXISTS vendor TEXT;

ALTER TABLE property_recurring_expenses
  ADD COLUMN IF NOT EXISTS person_in_charge TEXT;

-- ── LISTO ────────────────────────────────────────────────────
