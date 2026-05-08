-- ============================================================
-- cleanup_bookings_after_apr2026.sql
-- ============================================================
-- PROPÓSITO: Borrar TODAS las reservas con check-in ESTRICTAMENTE
--   después del 1 de abril de 2026 (start_date > '2026-04-01').
--
-- REGLA DE CORTE:
--   ✅ start_date = '2026-03-31' → se conserva (check-in antes)
--   ✅ start_date = '2026-04-01' → se conserva (justo el 1 de abril)
--   🗑  start_date = '2026-04-02' → se elimina
--   🗑  start_date > '2026-04-01' → se elimina
--
--   Una reserva con check-in en marzo pero checkout en mayo
--   NO se toca — solo importa start_date.
--
-- 🗑  SE ELIMINA (en orden de FK):
--   • expenses vinculadas via adjustment_id a esas reservas
--   • booking_payments          (CASCADE auto al borrar bookings)
--   • booking_adjustments       (CASCADE auto al borrar bookings)
--   • booking_cleanings         (CASCADE auto al borrar bookings)
--   • credit_pool_consumptions  (CASCADE auto al borrar bookings)
--   • bookings con start_date > '2026-04-01'
--
-- ✅ SE CONSERVA (no se toca):
--   • Reservas con start_date <= '2026-04-01'
--   • Properties, listings, vendors, inventory
--   • Expenses sin vínculo a estas reservas
--   • Bank accounts, groups, tags, etc.
--
-- ⚠️  IRREVERSIBLE — sin backup en plan gratuito.
--     Ejecuta el PASO 1 (SELECT) antes de ejecutar el PASO 2 (DELETE).
-- ============================================================

-- ============================================================
-- PASO 1: VERIFICACIÓN PREVIA (ejecuta esto primero, sin borrar)
-- ============================================================
-- Descomenta el bloque, ejecútalo y revisa los conteos:
/*
WITH target_bookings AS (
  SELECT id AS booking_id, start_date, end_date, status
  FROM   public.bookings
  WHERE  start_date > '2026-04-01'
),
target_adjustments AS (
  SELECT ba.id AS adjustment_id
  FROM   public.booking_adjustments ba
  WHERE  ba.booking_id IN (SELECT booking_id FROM target_bookings)
)
SELECT 'bookings a borrar (start_date > 2026-04-01)'  AS item,
       count(*)                                        AS total
FROM target_bookings
UNION ALL
SELECT 'booking más reciente a borrar',               1
  -- muestra la fecha más reciente para confirmar el corte
UNION ALL
SELECT '  → start_date max: ' || max(start_date)::text, count(*)
FROM target_bookings
UNION ALL
SELECT '  → start_date min del lote', count(*)
FROM target_bookings
UNION ALL
SELECT 'booking_payments (CASCADE auto)',              count(*)
FROM public.booking_payments WHERE booking_id IN (SELECT booking_id FROM target_bookings)
UNION ALL
SELECT 'booking_adjustments (CASCADE auto)',           count(*)
FROM public.booking_adjustments WHERE booking_id IN (SELECT booking_id FROM target_bookings)
UNION ALL
SELECT 'booking_cleanings (CASCADE auto)',             count(*)
FROM public.booking_cleanings WHERE booking_id IN (SELECT booking_id FROM target_bookings)
UNION ALL
SELECT 'credit_pool_consumptions (CASCADE auto)',      count(*)
FROM public.credit_pool_consumptions WHERE booking_id IN (SELECT booking_id FROM target_bookings)
UNION ALL
SELECT 'expenses vinculadas via adjustment_id',        count(*)
FROM public.expenses WHERE adjustment_id IN (SELECT adjustment_id FROM target_adjustments)
UNION ALL
SELECT '--- REFERENCIA: reservas que SE CONSERVAN ---', 0
UNION ALL
SELECT 'bookings conservados (start_date <= 2026-04-01)', count(*)
FROM public.bookings WHERE start_date <= '2026-04-01'
ORDER BY item;
*/

-- ============================================================
-- PASO 1b: VISTA PREVIA de las reservas a borrar (opcional)
-- ============================================================
-- Para revisar cuáles reservas se van a eliminar:
/*
SELECT
  b.id,
  b.start_date,
  b.end_date,
  b.status,
  b.guest_name,
  b.confirmation_code,
  l.name AS listing_name
FROM   public.bookings b
JOIN   public.listings l ON l.id = b.listing_id
WHERE  b.start_date > '2026-04-01'
ORDER  BY b.start_date;
*/

-- ============================================================
-- PASO 2: DELETE (ejecuta esto después de confirmar el paso 1)
-- ============================================================

BEGIN;

-- Paso previo: expenses vinculadas a booking_adjustments de estas reservas.
-- Las borramos ANTES de que el CASCADE de bookings deje adjustment_id = NULL.
-- (Solo expenses cuyo ÚNICO propósito era documentar un damage_charge/ajuste
--  de reservas que vamos a eliminar.)
DELETE FROM public.expenses
WHERE adjustment_id IN (
  SELECT ba.id
  FROM   public.booking_adjustments ba
  WHERE  ba.booking_id IN (
    SELECT id FROM public.bookings
    WHERE  start_date > '2026-04-01'
  )
);

-- Borrar las reservas.
-- Los siguientes se eliminan automáticamente por ON DELETE CASCADE:
--   • booking_payments
--   • booking_adjustments
--   • booking_cleanings
--   • credit_pool_consumptions
DELETE FROM public.bookings
WHERE start_date > '2026-04-01';

COMMIT;

-- ============================================================
-- PASO 3: VERIFICACIÓN POST-LIMPIEZA
-- ============================================================
/*
SELECT 'bookings restantes con start > 2026-04-01'  AS check_name,
       count(*)                                      AS total,
       CASE WHEN count(*) = 0 THEN '✅ OK' ELSE '❌ REVISAR' END AS status
FROM   public.bookings
WHERE  start_date > '2026-04-01'
UNION ALL
SELECT 'bookings conservados (start <= 2026-04-01)',
       count(*),
       CASE WHEN count(*) > 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.bookings
WHERE  start_date <= '2026-04-01'
UNION ALL
SELECT 'booking_payments huérfanos',
       count(*),
       CASE WHEN count(*) = 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.booking_payments bp
WHERE  NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = bp.booking_id)
UNION ALL
SELECT 'booking_adjustments huérfanos',
       count(*),
       CASE WHEN count(*) = 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.booking_adjustments ba
WHERE  NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = ba.booking_id)
ORDER BY check_name;
*/
