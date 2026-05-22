-- cron_auto_checkout.sql
-- Cron horario para invocar la Edge Function auto-checkout.
--
-- La función corre CADA HORA y procesa solo los owners cuya hora local
-- actual sea las 12:00 (mediodía). La timezone de cada owner se lee de
-- user_notification_settings.timezone, por lo que el horario se respeta
-- automáticamente para cualquier timezone configurada en la cuenta.
--
-- REQUISITOS:
--   1) Habilitar las extensiones pg_cron y pg_net en Supabase
--      (Database → Extensions → activar las dos).
--   2) Desplegar la Edge Function:
--        npx supabase functions deploy auto-checkout
--   3) Reemplazar <PROJECT_REF> y <SERVICE_ROLE_KEY> abajo.
--
-- Ejecutar este SQL en: Supabase Studio → SQL Editor.

select cron.schedule(
  'auto-checkout-hourly',     -- nombre del job
  '0 * * * *',                -- cada hora en punto (UTC)
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/auto-checkout',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Para verificar los jobs activos:
--   select * from cron.job;
--
-- Si ya existía el job 'auto-checkout-nightly', eliminarlo primero:
--   select cron.unschedule('auto-checkout-nightly');
--
-- Para eliminar este job:
--   select cron.unschedule('auto-checkout-hourly');

-- ============================================================
-- CORRECCIÓN DE RESERVAS HISTÓRICAS (ejecutar UNA sola vez)
-- Marca checkout_done (y checkin_done si aplica) en todas las
-- reservas pasadas que quedaron sin verificar.
-- ============================================================
-- UPDATE public.bookings
-- SET
--   checkin_done  = true,
--   checkout_done = true
-- WHERE end_date  <= CURRENT_DATE
--   AND (checkout_done IS NULL OR checkout_done = false)
--   AND (status IS NULL OR lower(status) NOT LIKE '%cancel%');
