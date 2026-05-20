-- cleanup_orphan_cleanings_2026_05.sql
-- ============================================================
-- LIMPIEZA DE DATOS HEREDADOS — booking_cleanings con
-- status='paid' pero SIN paid_date.
--
-- Detectado en auditoría del 2026-05-19 (audit_orphan_expenses.sql,
-- bloque 3): 23 aseos quedaron en estado 'paid' sin paid_date,
-- sin expense respaldatorio. Sin paid_date no hay evidencia
-- real de pago: lo más sano es regresarlos a 'pending' para
-- que entren en una próxima liquidación normal desde /aseo.
--
-- IDEMPOTENTE — corre múltiples veces sin efecto adicional.
-- Pegar en: Supabase Studio → SQL Editor.
-- ============================================================

-- 1) Vista previa (NO modifica). Verifica que solo afecte
--    cleanings sin paid_date y sin expense respaldatorio.
SELECT
  bc.id,
  bc.booking_id,
  bc.cleaner_id,
  v.name AS cleaner,
  bc.fee,
  bc.status,
  bc.paid_date,
  b.confirmation_code
FROM   public.booking_cleanings bc
JOIN   public.vendors v ON v.id = bc.cleaner_id
JOIN   public.bookings b ON b.id = bc.booking_id
WHERE  bc.status     = 'paid'
  AND  bc.paid_date IS NULL
  AND  NOT EXISTS (
    SELECT 1 FROM public.expenses e
     WHERE e.booking_id = bc.booking_id
       AND e.vendor_id  = bc.cleaner_id
       AND e.category   = 'Aseo')
ORDER BY v.name, b.confirmation_code;

-- 2) UPDATE (ejecutar solo después de revisar la vista previa).
--    Descomenta para aplicar:
--
-- UPDATE public.booking_cleanings
-- SET    status = 'pending'
-- WHERE  status = 'paid'
--   AND  paid_date IS NULL
--   AND  NOT EXISTS (
--     SELECT 1 FROM public.expenses e
--      WHERE e.booking_id = booking_cleanings.booking_id
--        AND e.vendor_id  = booking_cleanings.cleaner_id
--        AND e.category   = 'Aseo');

-- 3) Verificación post-ejecución (debería devolver 0 filas):
--
-- SELECT count(*)
-- FROM   public.booking_cleanings
-- WHERE  status = 'paid' AND paid_date IS NULL;
