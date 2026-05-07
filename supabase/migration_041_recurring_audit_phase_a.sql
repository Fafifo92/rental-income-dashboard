-- ============================================================
-- migration_041_recurring_audit_phase_a.sql
-- ============================================================
-- BLOQUE 6.5 — FASE A (NO destructiva, solo diagnóstico).
--
-- PROPÓSITO: Reportar el estado actual del modelo dual de
--   gastos recurrentes (property_recurring_expenses legacy
--   vs vendors + vendor_properties + shared_bills).
--
-- ESTA MIGRACIÓN NO MODIFICA DATOS. Solo emite NOTICEs con
--   conteos. Se puede ejecutar tantas veces como se quiera.
--
-- USO:
--   1. Ejecutar el archivo completo en el SQL editor de Supabase.
--   2. Revisar los mensajes NOTICE que aparecen en el panel de
--      logs / output.
--   3. Decidir si proceder con Fase B (backfill) basado en los
--      conteos. Fase B requiere staging + backup explícito.
-- ============================================================

DO $audit$
DECLARE
  v_total_recurring          INT;
  v_active_recurring         INT;
  v_active_no_vendor         INT;
  v_active_with_vendor       INT;
  v_overlap_with_vp          INT;
  v_periods_total            INT;
  v_periods_legacy_only      INT;
  v_categories_unmapped      INT;
  v_shared_bills_total       INT;
  v_vendors_recurring_ready  INT;
  v_owners_with_recurring    INT;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '  AUDITORÍA BLOQUE 6.5 — RECURRING EXPENSES (FASE A)';
  RAISE NOTICE '  Fecha: %', now();
  RAISE NOTICE '════════════════════════════════════════════════════════════';

  -- ── 1. property_recurring_expenses (legacy) ──────────────
  SELECT COUNT(*) INTO v_total_recurring
  FROM public.property_recurring_expenses;

  SELECT COUNT(*) INTO v_active_recurring
  FROM public.property_recurring_expenses
  WHERE valid_to IS NULL;

  SELECT COUNT(*) INTO v_active_no_vendor
  FROM public.property_recurring_expenses
  WHERE valid_to IS NULL AND vendor_id IS NULL;

  SELECT COUNT(*) INTO v_active_with_vendor
  FROM public.property_recurring_expenses
  WHERE valid_to IS NULL AND vendor_id IS NOT NULL;

  RAISE NOTICE '';
  RAISE NOTICE '── 1. property_recurring_expenses (legacy) ──';
  RAISE NOTICE '   Total filas (todas las versiones SCD):   %', v_total_recurring;
  RAISE NOTICE '   Activos (valid_to IS NULL):              %', v_active_recurring;
  RAISE NOTICE '     ├─ con vendor_id linkeado:             %', v_active_with_vendor;
  RAISE NOTICE '     └─ SIN vendor_id (pendientes Fase B):  %', v_active_no_vendor;

  -- ── 2. Solapamientos con vendor_properties ───────────────
  SELECT COUNT(*) INTO v_overlap_with_vp
  FROM public.property_recurring_expenses pre
  JOIN public.vendor_properties vp
    ON vp.vendor_id = pre.vendor_id
   AND vp.property_id = pre.property_id
  WHERE pre.valid_to IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '── 2. Solapamientos pre <-> vendor_properties ──';
  RAISE NOTICE '   Activos que YA tienen vendor_properties:  %', v_overlap_with_vp;
  RAISE NOTICE '   (Estos no requieren crear vp en Fase B.)';

  -- ── 3. recurring_expense_periods ─────────────────────────
  SELECT COUNT(*) INTO v_periods_total
  FROM public.recurring_expense_periods;

  SELECT COUNT(*) INTO v_periods_legacy_only
  FROM public.recurring_expense_periods rep
  JOIN public.property_recurring_expenses pre
    ON pre.id = rep.recurring_id
  WHERE pre.vendor_id IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '── 3. recurring_expense_periods (pagos mensuales) ──';
  RAISE NOTICE '   Total periodos registrados:               %', v_periods_total;
  RAISE NOTICE '   Periodos atados a recurring SIN vendor:   %', v_periods_legacy_only;

  -- ── 4. Categorías sin mapeo claro a vendor.kind ──────────
  -- Categorías legacy esperadas: utility, admin, insurance, maintenance, other
  SELECT COUNT(DISTINCT category) INTO v_categories_unmapped
  FROM public.property_recurring_expenses
  WHERE valid_to IS NULL
    AND vendor_id IS NULL
    AND category NOT IN ('utility','admin','insurance','maintenance','other');

  RAISE NOTICE '';
  RAISE NOTICE '── 4. Mapeo category -> vendor.kind ──';
  RAISE NOTICE '   Categorías activas SIN match canónico:   %', v_categories_unmapped;
  RAISE NOTICE '   (Si > 0, revisar y agregar al mapeo Fase B.)';

  -- ── 5. shared_bills + vendors listos para asumir recurrentes ──
  SELECT COUNT(*) INTO v_shared_bills_total
  FROM public.shared_bills;

  SELECT COUNT(*) INTO v_vendors_recurring_ready
  FROM public.vendors
  WHERE day_of_month IS NOT NULL
    AND default_amount IS NOT NULL;

  RAISE NOTICE '';
  RAISE NOTICE '── 5. Modelo nuevo (vendors / shared_bills) ──';
  RAISE NOTICE '   shared_bills creados:                     %', v_shared_bills_total;
  RAISE NOTICE '   vendors con day_of_month + default_amount: %', v_vendors_recurring_ready;

  -- ── 6. Owners afectados ──────────────────────────────────
  SELECT COUNT(DISTINCT owner_id) INTO v_owners_with_recurring
  FROM public.property_recurring_expenses
  WHERE valid_to IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '── 6. Cobertura por owner ──';
  RAISE NOTICE '   Owners con recurrentes activos:           %', v_owners_with_recurring;

  -- ── 7. Recomendación final ───────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  IF v_active_no_vendor = 0 THEN
    RAISE NOTICE '  ✅ No hay recurrentes activos sin vendor_id.';
    RAISE NOTICE '     Fase B no es estrictamente necesaria — el modelo';
    RAISE NOTICE '     legacy ya está linkeado al nuevo. Se puede plantear';
    RAISE NOTICE '     directamente Fase C (doble lectura) o Fase D (retiro).';
  ELSIF v_active_no_vendor < 10 THEN
    RAISE NOTICE '  🟡 Hay % recurrentes pendientes — backfill manual viable', v_active_no_vendor;
    RAISE NOTICE '     desde la UI antes de automatizar Fase B.';
  ELSE
    RAISE NOTICE '  🔴 Hay % recurrentes pendientes — recomendado Fase B', v_active_no_vendor;
    RAISE NOTICE '     automatizada en staging + revisión manual del mapeo.';
  END IF;
  RAISE NOTICE '════════════════════════════════════════════════════════════';
END;
$audit$ LANGUAGE plpgsql;

-- ============================================================
-- QUERIES DETALLADAS (descomentar y ejecutar manualmente
-- si los conteos sugieren investigar más a fondo)
-- ============================================================

-- a) Listado de recurrentes activos sin vendor_id (objetivo de Fase B):
-- SELECT pre.id, pre.property_id, p.name AS property_name,
--        pre.category, pre.subcategory, pre.amount, pre.day_of_month,
--        pre.valid_from, pre.notes
-- FROM public.property_recurring_expenses pre
-- JOIN public.properties p ON p.id = pre.property_id
-- WHERE pre.valid_to IS NULL AND pre.vendor_id IS NULL
-- ORDER BY p.name, pre.category;

-- b) Distribución por categoría (para diseñar mapeo a vendor.kind):
-- SELECT category, COUNT(*) AS n, MIN(valid_from) AS oldest, MAX(amount) AS max_amt
-- FROM public.property_recurring_expenses
-- WHERE valid_to IS NULL AND vendor_id IS NULL
-- GROUP BY category
-- ORDER BY n DESC;

-- c) Recurrentes con periodos pagados (riesgo de FK migration):
-- SELECT pre.id, pre.category, COUNT(rep.id) AS periodos_pagados
-- FROM public.property_recurring_expenses pre
-- LEFT JOIN public.recurring_expense_periods rep ON rep.recurring_id = pre.id
-- WHERE pre.valid_to IS NULL AND pre.vendor_id IS NULL
-- GROUP BY pre.id, pre.category
-- HAVING COUNT(rep.id) > 0
-- ORDER BY COUNT(rep.id) DESC;

-- ============================================================
-- PRÓXIMOS PASOS
-- ============================================================
-- - Si la auditoría arrojó 0 pendientes: ir a Fase D (retiro) directo.
-- - Si hay pendientes < 10: hacer backfill manual desde la UI.
-- - Si hay pendientes >> 10: diseñar migration_0XX_recurring_phase_b.sql
--   con el mapeo category → vendor.kind apropiado para tus datos.
-- ============================================================
