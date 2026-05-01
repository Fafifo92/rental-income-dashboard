-- Cron diario para invocar la Edge Function auto-checkin.
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
  'auto-checkin-nightly',     -- nombre del job
  '5 5 * * *',                -- todos los días a las 05:05 UTC (00:05 hora COL)
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
-- Para cambiar la hora:
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'auto-checkin-nightly'),
--     schedule => '0 6 * * *'
--   );
--
-- Para eliminarlo:
--   select cron.unschedule('auto-checkin-nightly');
