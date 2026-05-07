-- ============================================================
-- migration_042_health_check.sql  (v3 — corregido post-mig_043)
-- ============================================================
-- HEALTH CHECK COMPLETO de la base de datos tras las
-- auditorias y migraciones 001-041.
--
-- ESTA VERSION devuelve una tabla de resultados visible en el
-- SQL editor de Supabase (columnas: check_name, status, detail).
-- Es READ-ONLY — no modifica nada. Idempotente.
--
-- USO: ejecutar completo. Ver columna "status":
--   PASS    = todo en orden
--   WARN    = no bloqueante, revisar
--   FAIL    = problema que requiere accion
-- ============================================================

WITH
-- ─── 1. Tablas criticas ──────────────────────────────────────
tables_check AS (
  SELECT
    'CHECK 1: Tablas criticas' AS check_name,
    CASE WHEN missing = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN missing = 0
         THEN 'Todas las ' || total::text || ' tablas criticas existen'
         ELSE missing::text || ' tabla(s) faltante(s): ' || missing_names
    END AS detail
  FROM (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE t.table_name IS NULL) AS missing,
      string_agg(e.tbl, ', ') FILTER (WHERE t.table_name IS NULL) AS missing_names
    FROM unnest(ARRAY[
      'profiles','properties','property_groups','property_tags','property_tag_assignments',
      'listings','bookings','bank_accounts','expenses','property_recurring_expenses',
      'recurring_expense_periods','vendors','vendor_properties','shared_bills',
      'booking_adjustments','booking_cleanings','cleaner_groups',
      'inventory_items','inventory_maintenance_schedules','credit_pools',
      'credit_pool_consumptions','cleaner_group_members','audit_log'
    ]) AS e(tbl)
    LEFT JOIN information_schema.tables t
      ON t.table_schema = 'public' AND t.table_name = e.tbl
  ) x
),

-- ─── 2. RLS habilitado ───────────────────────────────────────
rls_check AS (
  SELECT
    'CHECK 2: RLS en tablas publicas' AS check_name,
    CASE WHEN no_rls = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN no_rls = 0
         THEN 'Todas las tablas publicas tienen RLS habilitado'
         ELSE no_rls::text || ' tabla(s) sin RLS: ' || names
    END AS detail
  FROM (
    SELECT
      COUNT(*) AS no_rls,
      string_agg(c.relname, ', ') AS names
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  ) x
),

-- ─── 3. FKs criticas ─────────────────────────────────────────
fks_check AS (
  SELECT
    'CHECK 3: FKs criticas' AS check_name,
    CASE WHEN missing = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN missing = 0
         THEN 'Las 12 FKs criticas presentes'
         ELSE missing::text || ' FK(s) faltante(s): ' || missing_names
    END AS detail
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE tc.constraint_name IS NULL) AS missing,
      string_agg(e.tbl || '.' || e.col, ', ') FILTER (WHERE tc.constraint_name IS NULL) AS missing_names
    FROM (VALUES
      ('listings','property_id','properties'),
      ('bookings','listing_id','listings'),
      ('expenses','property_id','properties'),
      ('expenses','vendor_id','vendors'),
      ('property_recurring_expenses','property_id','properties'),
      ('property_recurring_expenses','vendor_id','vendors'),
      ('recurring_expense_periods','recurring_id','property_recurring_expenses'),
      ('vendor_properties','vendor_id','vendors'),
      ('vendor_properties','property_id','properties'),
      ('booking_adjustments','booking_id','bookings'),
      ('booking_cleanings','booking_id','bookings'),
      ('credit_pool_consumptions','pool_id','credit_pools')
    ) AS e(tbl, col, ref_tbl)
    LEFT JOIN (
      SELECT DISTINCT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ) tc ON tc.table_name = e.tbl AND tc.column_name = e.col AND tc.ref_table = e.ref_tbl
  ) x
),

-- ─── 4. Indices criticos ─────────────────────────────────────
indexes_check AS (
  SELECT
    'CHECK 4: Indices criticos' AS check_name,
    CASE WHEN missing = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN missing = 0
         THEN 'Los 12 indices criticos presentes'
         ELSE missing::text || ' indice(s) faltante(s): ' || missing_names
    END AS detail
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE pi.indexname IS NULL) AS missing,
      string_agg(e.idx, ', ') FILTER (WHERE pi.indexname IS NULL) AS missing_names
    FROM unnest(ARRAY[
      'idx_properties_owner','idx_listings_property','idx_bookings_listing',
      'idx_bookings_listing_dates','idx_expenses_owner','idx_expenses_owner_date',
      'idx_expenses_vendor_id','idx_bank_accounts_owner_id',
      'idx_recurring_periods_rec_month',
      'idx_audit_log_table_record','idx_audit_log_user','idx_audit_log_occurred_at'
    ]) AS e(idx)
    LEFT JOIN pg_indexes pi ON pi.schemaname = 'public' AND pi.indexname = e.idx
  ) x
),

-- ─── 5. Triggers updated_at ──────────────────────────────────
updated_at_check AS (
  SELECT
    'CHECK 5: Triggers updated_at' AS check_name,
    CASE WHEN missing = 0 THEN 'PASS' ELSE 'WARN' END AS status,
    CASE WHEN missing = 0
         THEN 'Triggers updated_at en las 8 tablas esperadas'
         ELSE missing::text || ' trigger(s) faltante(s): ' || missing_names
    END AS detail
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE trg.tbl IS NULL) AS missing,
      string_agg(e.tbl, ', ') FILTER (WHERE trg.tbl IS NULL) AS missing_names
    FROM unnest(ARRAY[
      'properties','listings','bookings','bank_accounts','expenses',
      'property_recurring_expenses','vendors','booking_adjustments'
    ]) AS e(tbl)
    LEFT JOIN (
      SELECT DISTINCT c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND t.tgname LIKE 'trg_%_updated_at'
        AND NOT t.tgisinternal
    ) trg ON trg.tbl = e.tbl
  ) x
),

-- ─── 6. audit_log tabla ──────────────────────────────────────
audit_table_check AS (
  SELECT
    'CHECK 6a: Tabla audit_log' AS check_name,
    CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN n > 0 THEN 'Tabla audit_log existe'
         ELSE 'Tabla audit_log NO existe — mig_039 no aplicada' END AS detail
  FROM (SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'audit_log') x
),

-- ─── 7. audit_log triggers ───────────────────────────────────
audit_triggers_check AS (
  SELECT
    'CHECK 6b: Triggers audit_log' AS check_name,
    CASE WHEN missing = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN missing = 0
         THEN 'Triggers audit_log en las 5 tablas criticas'
         ELSE missing::text || ' trigger(s) faltante(s): ' || missing_names
    END AS detail
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE trg.tbl IS NULL) AS missing,
      string_agg(e.tbl, ', ') FILTER (WHERE trg.tbl IS NULL) AS missing_names
    FROM unnest(ARRAY[
      'properties','expenses','bookings','vendors','inventory_items'
    ]) AS e(tbl)
    LEFT JOIN (
      SELECT DISTINCT c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND t.tgname LIKE 'trg_audit_%'
        AND NOT t.tgisinternal
    ) trg ON trg.tbl = e.tbl
  ) x
),

-- ─── 8. Backfill vendor_id (expenses) ────────────────────────
backfill_expenses_check AS (
  SELECT
    'CHECK 7a: Backfill vendor_id en expenses' AS check_name,
    CASE WHEN n = 0 THEN 'PASS' ELSE 'WARN' END AS status,
    CASE WHEN n = 0
         THEN '0 expenses con vendor TEXT sin vendor_id (backfill completo)'
         ELSE n::text || ' fila(s) pendientes — re-ejecutar mig_040'
    END AS detail
  FROM (
    SELECT COUNT(*) AS n
    FROM public.expenses
    WHERE vendor_id IS NULL AND vendor IS NOT NULL AND btrim(vendor) <> ''
  ) x
),

-- ─── 9. Backfill vendor_id (recurring) ───────────────────────
backfill_recurring_check AS (
  SELECT
    'CHECK 7b: Backfill vendor_id en property_recurring_expenses' AS check_name,
    CASE WHEN n = 0 THEN 'PASS' ELSE 'WARN' END AS status,
    CASE WHEN n = 0
         THEN '0 filas con vendor TEXT sin vendor_id'
         ELSE n::text || ' fila(s) pendientes — re-ejecutar mig_040'
    END AS detail
  FROM (
    SELECT COUNT(*) AS n
    FROM public.property_recurring_expenses
    WHERE vendor_id IS NULL AND vendor IS NOT NULL AND btrim(vendor) <> ''
  ) x
),

-- ─── 10. Huerfanos: expenses → properties ────────────────────
orphan_expenses_check AS (
  SELECT
    'CHECK 8a: Huerfanos expenses.property_id' AS check_name,
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN n = 0 THEN '0 expenses con property_id huerfano'
         ELSE n::text || ' expense(s) con property_id sin propiedad valida' END AS detail
  FROM (
    SELECT COUNT(*) AS n FROM public.expenses e
    WHERE e.property_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = e.property_id)
  ) x
),

-- ─── 11. Huerfanos: bookings → listings ──────────────────────
orphan_bookings_check AS (
  SELECT
    'CHECK 8b: Huerfanos bookings.listing_id' AS check_name,
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN n = 0 THEN '0 bookings con listing_id huerfano'
         ELSE n::text || ' booking(s) con listing_id sin listing valido' END AS detail
  FROM (
    SELECT COUNT(*) AS n FROM public.bookings b
    WHERE NOT EXISTS (SELECT 1 FROM public.listings l WHERE l.id = b.listing_id)
  ) x
),

-- ─── 12. Huerfanos: listings → properties ────────────────────
orphan_listings_check AS (
  SELECT
    'CHECK 8c: Huerfanos listings.property_id' AS check_name,
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN n = 0 THEN '0 listings con property_id huerfano'
         ELSE n::text || ' listing(s) con property_id sin propiedad valida' END AS detail
  FROM (
    SELECT COUNT(*) AS n FROM public.listings l
    WHERE NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = l.property_id)
  ) x
),

-- ─── 13. Huerfanos: recurring_periods → recurring ─────────────
orphan_periods_check AS (
  SELECT
    'CHECK 8d: Huerfanos recurring_expense_periods.recurring_id' AS check_name,
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN n = 0 THEN '0 periodos recurrentes huerfanos'
         ELSE n::text || ' periodo(s) sin parent recurring valido' END AS detail
  FROM (
    SELECT COUNT(*) AS n FROM public.recurring_expense_periods rep
    WHERE NOT EXISTS (
      SELECT 1 FROM public.property_recurring_expenses pre WHERE pre.id = rep.recurring_id
    )
  ) x
),

-- ─── UNION de todos los checks ────────────────────────────────
all_checks AS (
  SELECT * FROM tables_check UNION ALL
  SELECT * FROM rls_check UNION ALL
  SELECT * FROM fks_check UNION ALL
  SELECT * FROM indexes_check UNION ALL
  SELECT * FROM updated_at_check UNION ALL
  SELECT * FROM audit_table_check UNION ALL
  SELECT * FROM audit_triggers_check UNION ALL
  SELECT * FROM backfill_expenses_check UNION ALL
  SELECT * FROM backfill_recurring_check UNION ALL
  SELECT * FROM orphan_expenses_check UNION ALL
  SELECT * FROM orphan_bookings_check UNION ALL
  SELECT * FROM orphan_listings_check UNION ALL
  SELECT * FROM orphan_periods_check
),

-- ─── Resumen final ────────────────────────────────────────────
summary AS (
  SELECT
    '=== RESUMEN ===' AS check_name,
    CASE
      WHEN COUNT(*) FILTER (WHERE status = 'FAIL') = 0
       AND COUNT(*) FILTER (WHERE status = 'WARN') = 0 THEN 'PASS'
      WHEN COUNT(*) FILTER (WHERE status = 'FAIL') = 0 THEN 'WARN'
      ELSE 'FAIL'
    END AS status,
    COUNT(*) FILTER (WHERE status = 'PASS')::text || ' PASS  |  ' ||
    COUNT(*) FILTER (WHERE status = 'WARN')::text || ' WARN  |  ' ||
    COUNT(*) FILTER (WHERE status = 'FAIL')::text || ' FAIL  — ' ||
    CASE
      WHEN COUNT(*) FILTER (WHERE status = 'FAIL') = 0
       AND COUNT(*) FILTER (WHERE status = 'WARN') = 0 THEN '🎉 Sistema completamente sano'
      WHEN COUNT(*) FILTER (WHERE status = 'FAIL') = 0 THEN '✅ Sin fallos criticos — revisar warnings'
      ELSE '⚠️ Hay fallos — revisar filas con FAIL arriba'
    END AS detail
  FROM all_checks
)

SELECT * FROM all_checks
UNION ALL
SELECT * FROM summary
ORDER BY check_name;
