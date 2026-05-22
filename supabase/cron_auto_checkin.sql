-- Cron horario para invocar la Edge Function auto-checkin.
--
-- La función corre CADA HORA y procesa solo los owners cuya hora local
-- actual sea las 15:00 (3 PM). La timezone de cada owner se lee de
-- user_notification_settings.timezone, por lo que el horario se respeta
-- automáticamente para cualquier timezone configurada en la cuenta.
--
-- REQUISITOS:
--   1) Habilitar las extensiones pg_cron y pg_net en Supabase
--      (Database → Extensions → activar las dos).
--   2) Desplegar la Edge Function:
--        npx supabase functions deploy auto-checkin
--   3) Reemplazar <PROJECT_REF> y <SERVICE_ROLE_KEY> abajo.
--
-- Ejecutar este SQL en: Supabase Studio → SQL Editor.

select cron.schedule(
  'auto-checkin-hourly',      -- nombre del job
  '0 * * * *',                -- cada hora en punto (UTC)
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/auto-checkin',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Para verificar:
--   select * from cron.job;
--
-- Si ya existía el job 'auto-checkin-nightly', eliminarlo primero:
--   select cron.unschedule('auto-checkin-nightly');
--
-- Para eliminar este job:
--   select cron.unschedule('auto-checkin-hourly');
