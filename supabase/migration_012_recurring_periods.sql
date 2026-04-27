-- ============================================================
-- MIGRATION 012 — Periodos mensuales de gastos recurrentes
--                 + preferencias de notificación
-- ============================================================
-- 1. Tabla recurring_expense_periods:
--    Una fila por (recurring_expense, YYYY-MM). Permite marcar el
--    estado mensual del pago: pending (no existe fila), paid, skipped.
--    Enlaza opcionalmente con el expense creado al pagar.
-- 2. Tabla user_notification_settings:
--    Preferencias por usuario para el sistema de alertas
--    (lead days, cadencia, categorías, email on/off).
-- Idempotente.
-- ============================================================

-- ── 1. Periodos mensuales de recurrentes ─────────────────────
CREATE TABLE IF NOT EXISTS recurring_expense_periods (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recurring_id  UUID REFERENCES property_recurring_expenses(id) ON DELETE CASCADE NOT NULL,
  year_month    CHAR(7) NOT NULL,          -- 'YYYY-MM'
  status        TEXT NOT NULL CHECK (status IN ('paid', 'skipped')),
  expense_id    UUID REFERENCES expenses(id) ON DELETE SET NULL,
  paid_at       TIMESTAMPTZ,
  amount        NUMERIC(14,2),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (recurring_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_recurring_periods_recurring
  ON recurring_expense_periods(recurring_id);
CREATE INDEX IF NOT EXISTS idx_recurring_periods_yearmonth
  ON recurring_expense_periods(year_month);

-- RLS: heredamos del owner vía property_recurring_expenses → properties.owner_id
ALTER TABLE recurring_expense_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_select_own" ON recurring_expense_periods;
CREATE POLICY "rep_select_own" ON recurring_expense_periods
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM property_recurring_expenses pre
      JOIN properties p ON p.id = pre.property_id
      WHERE pre.id = recurring_expense_periods.recurring_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rep_insert_own" ON recurring_expense_periods;
CREATE POLICY "rep_insert_own" ON recurring_expense_periods
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM property_recurring_expenses pre
      JOIN properties p ON p.id = pre.property_id
      WHERE pre.id = recurring_expense_periods.recurring_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rep_update_own" ON recurring_expense_periods;
CREATE POLICY "rep_update_own" ON recurring_expense_periods
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM property_recurring_expenses pre
      JOIN properties p ON p.id = pre.property_id
      WHERE pre.id = recurring_expense_periods.recurring_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rep_delete_own" ON recurring_expense_periods;
CREATE POLICY "rep_delete_own" ON recurring_expense_periods
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM property_recurring_expenses pre
      JOIN properties p ON p.id = pre.property_id
      WHERE pre.id = recurring_expense_periods.recurring_id
        AND p.owner_id = auth.uid()
    )
  );

-- ── 2. Preferencias de notificación por usuario ──────────────
CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reminders_enabled    BOOLEAN NOT NULL DEFAULT true,      -- recordatorios en-app (badge)
  email_enabled        BOOLEAN NOT NULL DEFAULT false,     -- email OFF por defecto
  lead_days            INTEGER NOT NULL DEFAULT 5,         -- cuántos días antes avisar
  repeat_cadence       TEXT    NOT NULL DEFAULT 'daily'    -- daily | every_2_days | weekly
                                CHECK (repeat_cadence IN ('daily','every_2_days','weekly')),
  send_hour            INTEGER NOT NULL DEFAULT 8
                                CHECK (send_hour BETWEEN 0 AND 23),
  notify_recurring     BOOLEAN NOT NULL DEFAULT true,
  notify_maintenance   BOOLEAN NOT NULL DEFAULT true,
  notify_shared_bills  BOOLEAN NOT NULL DEFAULT true,
  notify_damage        BOOLEAN NOT NULL DEFAULT true,
  notify_cleaner       BOOLEAN NOT NULL DEFAULT true,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uns_select_own" ON user_notification_settings;
CREATE POLICY "uns_select_own" ON user_notification_settings
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "uns_insert_own" ON user_notification_settings;
CREATE POLICY "uns_insert_own" ON user_notification_settings
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "uns_update_own" ON user_notification_settings;
CREATE POLICY "uns_update_own" ON user_notification_settings
  FOR UPDATE USING (user_id = auth.uid());

-- ── LISTO ────────────────────────────────────────────────────
