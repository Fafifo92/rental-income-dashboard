-- ============================================================
-- migration_040_vendor_id_backfill.sql
-- ============================================================
-- BLOQUE 6.1 — Backfill de expenses.vendor_id desde la columna
-- legacy expenses.vendor TEXT.
--
-- ESTRATEGIA (no destructiva):
--   1. Para cada (owner_id, vendor TEXT) DISTINCT donde vendor_id
--      es NULL y vendor TEXT no es vacío, intentar matchear contra
--      vendors.name (case-insensitive). Si existe → backfill.
--   2. Si no hay match, crear un vendor (kind='other') con ese
--      nombre y backfillearlo. El usuario podrá renombrar/cambiar
--      kind después en la UI de Vendors.
--   3. Replicar la misma lógica para property_recurring_expenses
--      (también tiene columnas legacy vendor TEXT + vendor_id).
--
-- IMPORTANTE:
--   • La columna `vendor` TEXT NO se elimina en esta migración.
--     Sigue siendo usada por código (filtros, búsqueda, display).
--     La deprecación se hará en una migración 0XX posterior, una
--     vez que el código frontend deje de leer/escribir esa columna.
--   • Idempotente: re-correr no duplica vendors ni sobre-escribe
--     vendor_id ya seteado.
--
-- VERIFICACIÓN PRE/POST: ejecuta los SELECT del final.
-- ============================================================

-- ── 0. Snapshot pre-backfill (informativo) ────────────────────
-- SELECT
--   COUNT(*) FILTER (WHERE vendor_id IS NULL AND vendor IS NOT NULL AND vendor <> '')   AS pendientes_expenses,
--   COUNT(*) FILTER (WHERE vendor_id IS NOT NULL)                                       AS ya_linkeadas,
--   COUNT(*)                                                                             AS total
-- FROM public.expenses;

-- ── 1. EXPENSES: backfill vendor_id ───────────────────────────
DO $mig$
DECLARE
  v_owner UUID;
  v_name  TEXT;
  v_id    UUID;
BEGIN
  FOR v_owner, v_name IN
    SELECT DISTINCT owner_id, btrim(vendor)
    FROM public.expenses
    WHERE vendor_id IS NULL
      AND vendor IS NOT NULL
      AND btrim(vendor) <> ''
  LOOP
    -- ¿Existe ya un vendor con ese nombre (case-insensitive) para este owner?
    SELECT id INTO v_id
    FROM public.vendors
    WHERE owner_id = v_owner
      AND lower(name) = lower(v_name)
    LIMIT 1;

    -- Si no existe, lo creamos como 'other' (el usuario reclasificará)
    IF v_id IS NULL THEN
      INSERT INTO public.vendors (owner_id, name, kind, active, notes)
      VALUES (v_owner, v_name, 'other', true,
              'Auto-creado por migration_040 desde expenses.vendor (revisar kind).')
      RETURNING id INTO v_id;
    END IF;

    -- Backfill TODAS las expenses con ese (owner, vendor) que aún no estén linkeadas
    UPDATE public.expenses
    SET vendor_id = v_id
    WHERE owner_id = v_owner
      AND vendor_id IS NULL
      AND lower(btrim(vendor)) = lower(v_name);
  END LOOP;
END;
$mig$ LANGUAGE plpgsql;

-- ── 2. PROPERTY_RECURRING_EXPENSES: misma lógica ──────────────
-- NOTA: property_recurring_expenses no tiene owner_id propio.
-- Lo resolvemos via properties.owner_id.
DO $mig2$
DECLARE
  v_owner UUID;
  v_name  TEXT;
  v_id    UUID;
BEGIN
  FOR v_owner, v_name IN
    SELECT DISTINCT p.owner_id, btrim(pre.vendor)
    FROM public.property_recurring_expenses pre
    JOIN public.properties p ON p.id = pre.property_id
    WHERE pre.vendor_id IS NULL
      AND pre.vendor IS NOT NULL
      AND btrim(pre.vendor) <> ''
  LOOP
    SELECT id INTO v_id
    FROM public.vendors
    WHERE owner_id = v_owner
      AND lower(name) = lower(v_name)
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.vendors (owner_id, name, kind, active, notes)
      VALUES (v_owner, v_name, 'other', true,
              'Auto-creado por migration_040 desde property_recurring_expenses.vendor.')
      RETURNING id INTO v_id;
    END IF;

    UPDATE public.property_recurring_expenses pre
    SET vendor_id = v_id
    FROM public.properties p
    WHERE pre.property_id = p.id
      AND p.owner_id = v_owner
      AND pre.vendor_id IS NULL
      AND lower(btrim(pre.vendor)) = lower(v_name);
  END LOOP;
END;
$mig2$ LANGUAGE plpgsql;

-- ── 3. Comentarios de deprecación (señalización) ──────────────
COMMENT ON COLUMN public.expenses.vendor IS
  'DEPRECATED — usar vendor_id (FK a vendors). Mantener mientras el frontend siga leyéndola.
   Plan de retiro: una vez que ExpensesClient/services/expenses.ts dejen de proyectar/escribir
   esta columna, crear migration 0XX_drop_expenses_vendor.sql.';

COMMENT ON COLUMN public.property_recurring_expenses.vendor IS
  'DEPRECATED — usar vendor_id (FK a vendors). Mantener mientras el frontend la lea.';

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- a) Cobertura de backfill en expenses (esperado: 0 pendientes con vendor TEXT no vacío):
-- SELECT
--   COUNT(*) FILTER (WHERE vendor_id IS NULL AND vendor IS NOT NULL AND btrim(vendor) <> '') AS pendientes,
--   COUNT(*) FILTER (WHERE vendor_id IS NOT NULL)                                            AS linkeadas
-- FROM public.expenses;
--
-- b) Cobertura en property_recurring_expenses:
-- SELECT
--   COUNT(*) FILTER (WHERE vendor_id IS NULL AND vendor IS NOT NULL AND btrim(vendor) <> '') AS pendientes,
--   COUNT(*) FILTER (WHERE vendor_id IS NOT NULL)                                            AS linkeadas
-- FROM public.property_recurring_expenses;
--
-- c) Vendors auto-creados (revisar y reclasificar si quieres):
-- SELECT id, name, kind, notes, created_at
-- FROM public.vendors
-- WHERE notes LIKE 'Auto-creado por migration_040%'
-- ORDER BY created_at DESC;
--
-- d) Si quieres "limpiar" vendors auto-creados sin uso (raro pero posible):
-- SELECT v.id, v.name FROM public.vendors v
-- WHERE v.notes LIKE 'Auto-creado por migration_040%'
--   AND NOT EXISTS (SELECT 1 FROM public.expenses                  e WHERE e.vendor_id = v.id)
--   AND NOT EXISTS (SELECT 1 FROM public.property_recurring_expenses r WHERE r.vendor_id = v.id);
-- ============================================================
