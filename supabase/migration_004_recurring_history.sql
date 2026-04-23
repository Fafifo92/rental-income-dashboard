-- ============================================================
-- MIGRATION 004 — Historial de precios de gastos recurrentes
-- ============================================================
-- Permite que el valor de un gasto recurrente (administración,
-- internet, servicios) cambie en el tiempo sin perder historia.
-- Modelo: SCD Type 2 — cada cambio crea un nuevo registro con
-- valid_from y valid_to (NULL = vigente).
-- Idempotente: seguro correrlo varias veces.
-- ============================================================

-- ── 1. Columnas de vigencia en property_recurring_expenses ────
ALTER TABLE property_recurring_expenses
  ADD COLUMN IF NOT EXISTS valid_from DATE NOT NULL DEFAULT '2020-01-01';
ALTER TABLE property_recurring_expenses
  ADD COLUMN IF NOT EXISTS valid_to   DATE;  -- NULL = vigente hoy

-- Backfill: los registros existentes arrancan en 2020-01-01 (histórico)
UPDATE property_recurring_expenses
  SET valid_from = '2020-01-01'
  WHERE valid_from IS NULL;

-- ── 2. Índices útiles para queries por rango ─────────────────
CREATE INDEX IF NOT EXISTS idx_recurring_validity
  ON property_recurring_expenses(property_id, valid_from, valid_to);

-- ── 3. Constraint: un mismo (property_id, category) no puede
--      tener dos filas activas solapadas. Validación suave en app.
-- ── LISTO ────────────────────────────────────────────────────
