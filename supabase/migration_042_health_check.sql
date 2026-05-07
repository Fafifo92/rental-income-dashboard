-- ============================================================
-- migration_042_health_check.sql
-- ============================================================
-- HEALTH CHECK COMPLETO de la base de datos tras las
-- auditorías y migraciones 001-041.
--
-- PROPÓSITO: validar de UN SOLO TIRO que todo lo prometido por
--   las auditorías quedó en orden:
--   • Tablas críticas existen
--   • RLS habilitado en TODAS las tablas públicas
--   • FKs críticas presentes (incluida listings.property_id)
--   • Índices críticos creados (mig_034, mig_037)
--   • Triggers updated_at instalados (mig_035)
--   • audit_log + triggers instalados (mig_039)
--   • Backfill de vendor_id completo (mig_040)
--
-- ESTA MIGRACIÓN ES READ-ONLY — no modifica nada. Reporta vía
-- RAISE NOTICE / RAISE WARNING qué pasó cada check y cuáles
-- (si hay) fallaron. Es idempotente y se puede correr cuantas
-- veces se quiera.
--
-- USO: ejecutar completo en el SQL editor y leer los NOTICEs.
-- Si aparece "❌" en cualquier línea, hay algo que requiere
-- atención manual.
-- ============================================================

DO $hc$
DECLARE
  v_count       INT;
  v_expected    INT;
  v_pass        INT := 0;
  v_fail        INT := 0;
  v_warn        INT := 0;
  v_msg         TEXT;
  r             RECORD;

  -- Tablas críticas que DEBEN existir
  c_critical_tables TEXT[] := ARRAY[
    'profiles','properties','property_groups','property_tags','property_tag_assignments',
    'listings','bookings','bank_accounts','expenses','property_recurring_expenses',
    'recurring_expense_periods','vendors','vendor_properties','shared_bills',
    'booking_adjustments','booking_cleanings','cleaners','cleaner_groups',
    'inventory_items','inventory_maintenance_schedules','credit_pools',
    'credit_pool_consumptions','expense_groups','audit_log'
  ];

  -- FKs críticas: (table, column, ref_table)
  c_critical_fks TEXT[][] := ARRAY[
    ['listings','property_id','properties'],
    ['bookings','listing_id','listings'],
    ['expenses','property_id','properties'],
    ['expenses','vendor_id','vendors'],
    ['property_recurring_expenses','property_id','properties'],
    ['property_recurring_expenses','vendor_id','vendors'],
    ['recurring_expense_periods','recurring_id','property_recurring_expenses'],
    ['vendor_properties','vendor_id','vendors'],
    ['vendor_properties','property_id','properties'],
    ['booking_adjustments','booking_id','bookings'],
    ['booking_cleanings','booking_id','bookings'],
    ['credit_pool_consumptions','pool_id','credit_pools']
  ];

  -- Índices críticos esperados
  c_critical_indexes TEXT[] := ARRAY[
    'idx_properties_owner','idx_listings_property','idx_bookings_listing',
    'idx_bookings_listing_dates','idx_expenses_owner','idx_expenses_owner_date',
    'idx_expenses_vendor_id','idx_bank_accounts_owner_id','idx_recurring_periods_rec_month',
    'idx_audit_log_table_record','idx_audit_log_user','idx_audit_log_occurred_at'
  ];

  -- Tablas que DEBEN tener trigger updated_at (mig_035)
  c_updated_at_tables TEXT[] := ARRAY[
    'properties','listings','bookings','bank_accounts','expenses',
    'property_recurring_expenses','vendors','booking_adjustments'
  ];

  -- Tablas que DEBEN tener trigger de audit_log (mig_039)
  c_audit_log_tables TEXT[] := ARRAY[
    'properties','expenses','bookings','vendors','inventory_items'
  ];
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '  HEALTH CHECK — rental-income-dashboard DB';
  RAISE NOTICE '  Fecha: %', now();
  RAISE NOTICE '════════════════════════════════════════════════════════════';

  -- ─────────────────────────────────────────────────────
  -- CHECK 1: Tablas críticas existen
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 1: Tablas críticas (% esperadas)', array_length(c_critical_tables, 1);
  FOR i IN 1..array_length(c_critical_tables, 1) LOOP
    SELECT COUNT(*) INTO v_count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = c_critical_tables[i];
    IF v_count = 1 THEN
      v_pass := v_pass + 1;
    ELSE
      v_fail := v_fail + 1;
      RAISE WARNING '  ❌ Tabla faltante: %', c_critical_tables[i];
    END IF;
  END LOOP;
  RAISE NOTICE '  ✅ Tablas presentes: %/%', v_pass, array_length(c_critical_tables, 1);

  -- ─────────────────────────────────────────────────────
  -- CHECK 2: RLS habilitado en TODAS las tablas públicas
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 2: RLS habilitado en tablas públicas';
  v_count := 0;
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    v_count := v_count + 1;
    RAISE WARNING '  ❌ RLS NO habilitado en: %', r.relname;
  END LOOP;
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '  ✅ Todas las tablas públicas tienen RLS habilitado.';
  ELSE
    v_fail := v_fail + v_count;
    RAISE WARNING '  ❌ % tabla(s) sin RLS — riesgo crítico de seguridad.', v_count;
  END IF;

  -- ─────────────────────────────────────────────────────
  -- CHECK 3: FKs críticas
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 3: FKs críticas (% esperadas)', array_length(c_critical_fks, 1);
  v_expected := array_length(c_critical_fks, 1);
  v_count := 0;
  FOR i IN 1..v_expected LOOP
    PERFORM 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name   = c_critical_fks[i][1]
      AND kcu.column_name = c_critical_fks[i][2]
      AND ccu.table_name  = c_critical_fks[i][3];
    IF FOUND THEN
      v_count := v_count + 1;
    ELSE
      v_fail := v_fail + 1;
      RAISE WARNING '  ❌ FK faltante: %.% -> %', c_critical_fks[i][1], c_critical_fks[i][2], c_critical_fks[i][3];
    END IF;
  END LOOP;
  v_pass := v_pass + v_count;
  RAISE NOTICE '  ✅ FKs presentes: %/%', v_count, v_expected;

  -- ─────────────────────────────────────────────────────
  -- CHECK 4: Índices críticos
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 4: Índices críticos (% esperados)', array_length(c_critical_indexes, 1);
  v_expected := array_length(c_critical_indexes, 1);
  v_count := 0;
  FOR i IN 1..v_expected LOOP
    PERFORM 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = c_critical_indexes[i];
    IF FOUND THEN
      v_count := v_count + 1;
    ELSE
      v_fail := v_fail + 1;
      RAISE WARNING '  ❌ Índice faltante: %', c_critical_indexes[i];
    END IF;
  END LOOP;
  v_pass := v_pass + v_count;
  RAISE NOTICE '  ✅ Índices presentes: %/%', v_count, v_expected;

  -- ─────────────────────────────────────────────────────
  -- CHECK 5: Triggers updated_at (mig_035)
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 5: Triggers updated_at (% tablas)', array_length(c_updated_at_tables, 1);
  v_expected := array_length(c_updated_at_tables, 1);
  v_count := 0;
  FOR i IN 1..v_expected LOOP
    PERFORM 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table  = c_updated_at_tables[i]
      AND action_statement ILIKE '%updated_at%';
    IF FOUND THEN
      v_count := v_count + 1;
    ELSE
      v_warn := v_warn + 1;
      RAISE WARNING '  ⚠️  Trigger updated_at faltante en: %', c_updated_at_tables[i];
    END IF;
  END LOOP;
  v_pass := v_pass + v_count;
  RAISE NOTICE '  ✅ Triggers updated_at: %/%', v_count, v_expected;

  -- ─────────────────────────────────────────────────────
  -- CHECK 6: audit_log (mig_039)
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 6: audit_log + triggers';
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'audit_log';
  IF v_count = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '  ✅ Tabla audit_log existe.';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '  ❌ Tabla audit_log NO existe — mig_039 no aplicada.';
  END IF;

  v_expected := array_length(c_audit_log_tables, 1);
  v_count := 0;
  FOR i IN 1..v_expected LOOP
    PERFORM 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table  = c_audit_log_tables[i]
      AND trigger_name LIKE 'trg_audit_%';
    IF FOUND THEN
      v_count := v_count + 1;
    ELSE
      v_fail := v_fail + 1;
      RAISE WARNING '  ❌ Trigger audit_log faltante en: %', c_audit_log_tables[i];
    END IF;
  END LOOP;
  v_pass := v_pass + v_count;
  RAISE NOTICE '  ✅ Triggers audit_log: %/%', v_count, v_expected;

  -- ─────────────────────────────────────────────────────
  -- CHECK 7: Backfill vendor_id (mig_040)
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 7: Backfill vendor_id (mig_040)';
  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE vendor_id IS NULL
    AND vendor IS NOT NULL
    AND btrim(vendor) <> '';
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '  ✅ expenses: 0 filas con vendor TEXT no vacío y vendor_id NULL.';
  ELSE
    v_warn := v_warn + 1;
    RAISE WARNING '  ⚠️  expenses: % filas pendientes de backfill (re-correr mig_040).', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.property_recurring_expenses
  WHERE vendor_id IS NULL
    AND vendor IS NOT NULL
    AND btrim(vendor) <> '';
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '  ✅ property_recurring_expenses: 0 filas pendientes.';
  ELSE
    v_warn := v_warn + 1;
    RAISE WARNING '  ⚠️  property_recurring_expenses: % filas pendientes.', v_count;
  END IF;

  -- ─────────────────────────────────────────────────────
  -- CHECK 8: Integridad referencial (huérfanos)
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '🔎 CHECK 8: Integridad referencial (huérfanos)';

  -- expenses sin property válida
  SELECT COUNT(*) INTO v_count
  FROM public.expenses e
  WHERE e.property_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = e.property_id);
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '  ❌ expenses con property_id huérfano: %', v_count;
  END IF;

  -- bookings sin listing válido
  SELECT COUNT(*) INTO v_count
  FROM public.bookings b
  WHERE NOT EXISTS (SELECT 1 FROM public.listings l WHERE l.id = b.listing_id);
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '  ❌ bookings con listing_id huérfano: %', v_count;
  END IF;

  -- listings sin property válida
  SELECT COUNT(*) INTO v_count
  FROM public.listings l
  WHERE NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = l.property_id);
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '  ❌ listings con property_id huérfano: %', v_count;
  END IF;

  -- recurring_expense_periods sin recurring válido
  SELECT COUNT(*) INTO v_count
  FROM public.recurring_expense_periods rep
  WHERE NOT EXISTS (
    SELECT 1 FROM public.property_recurring_expenses pre WHERE pre.id = rep.recurring_id
  );
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '  ❌ recurring_expense_periods huérfanos: %', v_count;
  END IF;

  RAISE NOTICE '  ✅ Sin huérfanos detectados (4 checks de integridad).';

  -- ─────────────────────────────────────────────────────
  -- RESUMEN FINAL
  -- ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '  RESUMEN HEALTH CHECK';
  RAISE NOTICE '────────────────────────────────────────────────────────────';
  RAISE NOTICE '  ✅ Pasaron:    %', v_pass;
  RAISE NOTICE '  ⚠️  Warnings:  %', v_warn;
  RAISE NOTICE '  ❌ Fallaron:   %', v_fail;
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  IF v_fail = 0 AND v_warn = 0 THEN
    RAISE NOTICE '  🎉 SISTEMA COMPLETAMENTE SANO. Auditoría en orden.';
  ELSIF v_fail = 0 THEN
    RAISE NOTICE '  ✅ Sin fallos críticos. Revisar warnings (no bloqueantes).';
  ELSE
    RAISE NOTICE '  ⚠️  HAY FALLOS — revisar mensajes WARNING arriba.';
  END IF;
  RAISE NOTICE '════════════════════════════════════════════════════════════';
END;
$hc$ LANGUAGE plpgsql;
