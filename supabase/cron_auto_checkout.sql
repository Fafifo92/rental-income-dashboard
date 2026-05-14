-- cron_auto_checkout.sql
-- Cron diario para invocar la Edge Function auto-checkout.
--
-- REQUISITOS:
--   1) Habilitar las extensiones pg_cron y pg_net en Supabase
--      (Database → Extensions → activar las dos).
--   2) Desplegar la Edge Function:
--        npx supabase functions deploy auto-checkout
--   3) Reemplazar <PROJECT_REF> y <SERVICE_ROLE_KEY> abajo.
--
-- Ejecutar este SQL en: Supabase Studio → SQL Editor.
-- Corre 5 min después de auto-checkin (05:10 UTC = 00:10 hora COL).

select cron.schedule(
  'auto-checkout-nightly',    -- nombre del job
  '10 5 * * *',               -- todos los días a las 05:10 UTC (00:10 hora COL)
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
-- Para cambiar la hora:
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'auto-checkout-nightly'),
--     schedule => '10 6 * * *'
--   );
--
-- Para eliminar el job:
--   select cron.unschedule('auto-checkout-nightly');

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
