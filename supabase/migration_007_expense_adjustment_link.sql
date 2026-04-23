-- ============================================================
-- MIGRATION 007 — Vínculo fuerte gasto ↔ ajuste de reserva
-- ============================================================
-- Cuando un "damage_charge" (cobro al huésped por daño) auto-crea
-- un gasto pendiente de reparación, los dos registros quedan
-- vinculados. Esto permite:
--   • Mostrar al usuario el contexto del daño desde el gasto.
--   • Descartar ambos atómicamente si el usuario decide que no
--     aplica (sin dejar ajustes huérfanos).
--   • Saber si una obligación de reparar ya fue pagada
--     cotejando expenses.status contra el ajuste.
-- ON DELETE SET NULL: si se borra el ajuste, el gasto sobrevive
-- (el usuario puede haber decidido mantener el gasto como registro).
-- Idempotente.
-- ============================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS adjustment_id UUID
    REFERENCES booking_adjustments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_adjustment
  ON expenses(adjustment_id);

-- ── LISTO ────────────────────────────────────────────────────
