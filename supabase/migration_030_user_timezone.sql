-- migration_030_user_timezone.sql
-- Agrega columna timezone a user_notification_settings.
-- El valor es una timezone IANA (ej. 'America/Bogota').
-- Default: 'America/Bogota' (GMT-5, Colombia).

ALTER TABLE public.user_notification_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Bogota';
