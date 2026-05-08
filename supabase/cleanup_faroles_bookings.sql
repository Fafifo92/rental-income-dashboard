-- ============================================================
-- cleanup_faroles_bookings.sql
-- ============================================================
-- PROPÓSITO: Borrar ÚNICAMENTE las reservas ancladas a la
--   propiedad "Faroles" y todos sus datos dependientes.
--
-- ✅ SE CONSERVA (no se toca):
--   • La propiedad "Faroles" en sí
--   • Su listing
--   • Inventario de Faroles
--   • Gastos recurrentes de Faroles (configuración)
--   • Todas las otras propiedades y sus reservas
--   • Vendors, bank_accounts, groups, tags, etc.
--
-- 🗑  SE ELIMINA (solo datos de reservas de Faroles):
--   • bookings de Faroles
--   • booking_payments de esas reservas         (CASCADE auto)
--   • booking_adjustments de esas reservas      (CASCADE auto)
--   • booking_cleanings de esas reservas        (CASCADE auto)
--   • expenses directamente ligadas a esas reservas (booking_id)
--   • expenses ligadas a la propiedad Faroles   (property_id)
--   • credit_pool_consumptions de esas reservas
--   • shared_bills vinculadas a esas reservas
--   • recurring_expense_periods del listing de Faroles
--
-- ⚠️  IRREVERSIBLE — sin backup en plan gratuito.
--     Ejecuta primero el bloque VERIFICACIÓN para ver qué
--     se va a borrar ANTES de ejecutar el bloque DELETE.
--
-- CÓMO USAR:
--   1. Supabase SQL Editor → pega TODO el archivo.
--   2. Ejecuta primero la sección VERIFICACIÓN (SELECT).
--   3. Confirma los conteos, luego ejecuta la sección DELETE.
-- ============================================================

-- ============================================================
-- PASO 1: VERIFICACIÓN PREVIA (ejecuta esto primero, SIN borrar)
-- ============================================================
-- Descomenta el bloque, ejecútalo y confirma los conteos:
/*
WITH
  fp AS (
    SELECT id AS property_id FROM public.properties
    WHERE lower(name) LIKE '%faroles%'
  ),
  fl AS (
    SELECT l.id AS listing_id
    FROM   public.listings l JOIN fp ON fp.property_id = l.property_id
  ),
  fb AS (
    SELECT b.id AS booking_id
    FROM   public.bookings b JOIN fl ON fl.listing_id = b.listing_id
  ),
  fr AS (
    SELECT pre.id AS recurring_id
    FROM   public.property_recurring_expenses pre JOIN fp ON fp.property_id = pre.property_id
  )
SELECT 'propiedades Faroles'                   AS item, count(*) FROM fp
UNION ALL
SELECT 'listings de Faroles',                   count(*) FROM fl
UNION ALL
SELECT 'bookings a borrar',                     count(*) FROM fb
UNION ALL
SELECT 'booking_payments (CASCADE auto)',        count(*) FROM public.booking_payments    WHERE booking_id IN (SELECT booking_id FROM fb)
UNION ALL
SELECT 'booking_adjustments (CASCADE auto)',     count(*) FROM public.booking_adjustments WHERE booking_id IN (SELECT booking_id FROM fb)
UNION ALL
SELECT 'booking_cleanings (CASCADE auto)',       count(*) FROM public.booking_cleanings   WHERE booking_id IN (SELECT booking_id FROM fb)
UNION ALL
SELECT 'credit_pool_consumptions (CASCADE auto)',count(*) FROM public.credit_pool_consumptions WHERE booking_id IN (SELECT booking_id FROM fb)
UNION ALL
SELECT 'expenses de Faroles (property_id)',      count(*) FROM public.expenses WHERE property_id IN (SELECT property_id FROM fp)
UNION ALL
SELECT 'recurring_expense_periods de Faroles',   count(*) FROM public.recurring_expense_periods WHERE recurring_id IN (SELECT recurring_id FROM fr)
ORDER BY item;
*/

-- ============================================================
-- PASO 2: DELETE (ejecuta esto después de confirmar el paso 1)
-- ============================================================

BEGIN;

-- Guardia: aborta si no existe la propiedad
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.properties
  WHERE lower(name) LIKE '%faroles%';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No se encontró ninguna propiedad con nombre "Faroles". Abortando.';
  END IF;
  IF v_count > 1 THEN
    RAISE WARNING 'Encontradas % propiedades con "faroles". Revisa el filtro si no es lo esperado.', v_count;
  END IF;
END;
$$;

-- A. Historial de periodos de gastos recurrentes de Faroles
--    (recurring_expense_periods → property_recurring_expenses → property_id)
DELETE FROM public.recurring_expense_periods
WHERE recurring_id IN (
  SELECT pre.id
  FROM   public.property_recurring_expenses pre
  JOIN   public.properties p ON p.id = pre.property_id
  WHERE  lower(p.name) LIKE '%faroles%'
);

-- B. Gastos de la propiedad Faroles
--    (expenses.property_id → properties.id)
DELETE FROM public.expenses
WHERE property_id IN (
  SELECT id FROM public.properties
  WHERE lower(name) LIKE '%faroles%'
);

-- C. Reservas de Faroles
--    Los siguientes se eliminan automáticamente por ON DELETE CASCADE:
--      • booking_payments
--      • booking_adjustments
--      • booking_cleanings
--      • credit_pool_consumptions
DELETE FROM public.bookings
WHERE listing_id IN (
  SELECT l.id
  FROM   public.listings l
  JOIN   public.properties p ON p.id = l.property_id
  WHERE  lower(p.name) LIKE '%faroles%'
);

COMMIT;

-- ============================================================
-- PASO 3: VERIFICACIÓN POST-LIMPIEZA (ejecuta esto al final)
-- ============================================================
/*
WITH
  fp AS (
    SELECT id AS property_id FROM public.properties
    WHERE lower(name) LIKE '%faroles%'
  ),
  fl AS (
    SELECT l.id AS listing_id
    FROM   public.listings l JOIN fp ON fp.property_id = l.property_id
  )
SELECT 'bookings restantes'    AS check_name,
       count(*)                AS total,
       CASE WHEN count(*) = 0 THEN '✅ OK' ELSE '❌ REVISAR' END AS status
FROM   public.bookings WHERE listing_id IN (SELECT listing_id FROM fl)
UNION ALL
SELECT 'expenses restantes',
       count(*),
       CASE WHEN count(*) = 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.expenses WHERE property_id IN (SELECT property_id FROM fp)
UNION ALL
SELECT 'recurring_periods restantes',
       count(*),
       CASE WHEN count(*) = 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.recurring_expense_periods
WHERE  recurring_id IN (
  SELECT pre.id FROM public.property_recurring_expenses pre
  JOIN fp ON fp.property_id = pre.property_id
)
UNION ALL
SELECT 'Propiedad Faroles preservada ✅',
       count(*),
       CASE WHEN count(*) > 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.properties WHERE lower(name) LIKE '%faroles%'
UNION ALL
SELECT 'Listing Faroles preservado ✅',
       count(*),
       CASE WHEN count(*) > 0 THEN '✅ OK' ELSE '❌ REVISAR' END
FROM   public.listings l JOIN fp ON fp.property_id = l.property_id
ORDER BY check_name;
*/
