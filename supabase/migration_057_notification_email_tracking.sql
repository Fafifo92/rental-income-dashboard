-- migration_057_notification_email_tracking.sql
-- ============================================================
-- Soporte de envío de emails de recordatorios:
--   • last_email_sent_at: cuándo fue el último digest enviado.
--     Se usa para respetar repeat_cadence (daily/every_2_days/weekly)
--     evitando reenvíos prematuros.
--   • last_email_payload: hash/resumen del digest enviado, útil
--     para debugging y para no reenviar idénticos.
-- IDEMPOTENTE.
-- ============================================================

ALTER TABLE public.user_notification_settings
  ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_email_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_uns_email_enabled
  ON public.user_notification_settings(email_enabled)
  WHERE email_enabled = true;
