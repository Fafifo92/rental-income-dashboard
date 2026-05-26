-- Cron horario para invocar la Edge Function notify-reminders.
--
-- La función corre CADA HORA y, para cada usuario con email_enabled=true,
-- decide si toca enviar email basado en su timezone, send_hour y
-- repeat_cadence (daily / every_2_days / weekly).
--
-- REQUISITOS:
--   1) Habilitar las extensiones pg_cron y pg_net en Supabase
--      (Database → Extensions → activar las dos).
--   2) Configurar el secret de Resend:
--        npx supabase secrets set RESEND_API_KEY=re_xxxxxxxx
--        npx supabase secrets set REMINDER_FROM_EMAIL="STR Analytics <onboarding@resend.dev>"
--        npx supabase secrets set APP_BASE_URL="https://tu-dominio.com"
--   3) Desplegar la Edge Function:
--        npx supabase functions deploy notify-reminders
--   4) Reemplazar <PROJECT_REF> y <SERVICE_ROLE_KEY> abajo.
--
-- Ejecutar este SQL en: Supabase Studio → SQL Editor.

select cron.schedule(
  'notify-reminders-hourly',  -- nombre del job
  '5 * * * *',                -- cada hora al minuto 5 (UTC)
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-reminders',
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
-- Para forzar un test manual a un usuario específico (sin esperar hora):
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-reminders',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--       'Content-Type',  'application/json'
--     ),
--     body    := jsonb_build_object('force_user_id', '<uuid-del-usuario>')
--   );
--
-- Para eliminar este job:
--   select cron.unschedule('notify-reminders-hourly');
