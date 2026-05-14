-- migration_050_backfill_cleaning_expenses.sql
-- ============================================================
-- Retroactively create expense rows for paid booking_cleanings
-- that have no corresponding expense record.
--
-- Root cause: a silent-failure bug in payoutCleanerConsolidated
-- caused booking_cleanings to be marked status='paid' without
-- the matching INSERT into the expenses table succeeding.
--
-- This script is IDEMPOTENT: it only inserts rows when no
-- 'Aseo' expense exists for the (booking_id, vendor_id) pair.
--
-- Run in: Supabase Studio → SQL Editor (as project owner).
-- ============================================================

DO $$
DECLARE
  v_group_rec RECORD;
  v_cleaning  RECORD;
  v_group_id  TEXT;
  v_inserted  INT := 0;
BEGIN
  -- ── For each payout group (cleaner × paid_date) that is missing expenses ──
  FOR v_group_rec IN (
    SELECT DISTINCT
      bc.cleaner_id,
      bc.paid_date,
      v.name     AS cleaner_name,
      v.owner_id AS owner_id
    FROM  public.booking_cleanings bc
    JOIN  public.vendors v ON v.id = bc.cleaner_id
    WHERE bc.status    = 'paid'
      AND bc.paid_date IS NOT NULL
      AND bc.fee       > 0
      AND NOT EXISTS (
        SELECT 1
        FROM   public.expenses e
        WHERE  e.booking_id = bc.booking_id
          AND  e.vendor_id  = bc.cleaner_id
          AND  e.category   = 'Aseo'
      )
    ORDER BY bc.paid_date, v.name
  )
  LOOP
    -- One shared expense_group_id per (cleaner, paid_date) liquidation batch
    v_group_id := gen_random_uuid()::text;

    -- ── Insert one expense row per cleaning in this group ──
    FOR v_cleaning IN (
      SELECT
        bc.booking_id,
        bc.fee,
        bc.supplies_amount,
        bc.reimburse_to_cleaner,
        COALESCE(bc.done_date::text, b.end_date::text, v_group_rec.paid_date::text)  AS done_date,
        COALESCE(b.confirmation_code, LEFT(bc.booking_id::text, 8))            AS code,
        p.id                                                                    AS property_id,
        COALESCE(p.name, 'Sin propiedad')                                      AS property_name
      FROM  public.booking_cleanings bc
      JOIN  public.bookings    b  ON b.id  = bc.booking_id
      LEFT JOIN public.listings   l  ON l.id  = b.listing_id
      LEFT JOIN public.properties p  ON p.id  = l.property_id
      WHERE bc.cleaner_id = v_group_rec.cleaner_id
        AND bc.paid_date  = v_group_rec.paid_date
        AND bc.status     = 'paid'
        AND NOT EXISTS (
          SELECT 1
          FROM   public.expenses e
          WHERE  e.booking_id = bc.booking_id
            AND  e.vendor_id  = bc.cleaner_id
            AND  e.category   = 'Aseo'
        )
    )
    LOOP
      -- Aseo fee row
      IF v_cleaning.fee > 0 THEN
        INSERT INTO public.expenses (
          owner_id, property_id,
          category, subcategory, type,
          amount, currency,
          date, description, status,
          bank_account_id, booking_id,
          vendor, vendor_id, expense_group_id
        ) VALUES (
          v_group_rec.owner_id,
          v_cleaning.property_id,
          'Aseo', 'cleaning', 'variable',
          v_cleaning.fee, 'COP',
          v_group_rec.paid_date,
          format('Aseo – %s · Reserva %s (%s) · %s',
            v_cleaning.property_name, v_cleaning.code,
            v_cleaning.done_date,     v_group_rec.cleaner_name),
          'paid',
          NULL,
          v_cleaning.booking_id,
          v_group_rec.cleaner_name,
          v_group_rec.cleaner_id,
          v_group_id
        );
        v_inserted := v_inserted + 1;
      END IF;

      -- Insumos row (only when the cleaner paid for supplies AND reimbursement is requested)
      IF v_cleaning.reimburse_to_cleaner IS TRUE
         AND COALESCE(v_cleaning.supplies_amount, 0) > 0 THEN
        INSERT INTO public.expenses (
          owner_id, property_id,
          category, subcategory, type,
          amount, currency,
          date, description, status,
          bank_account_id, booking_id,
          vendor, vendor_id, expense_group_id
        ) VALUES (
          v_group_rec.owner_id,
          v_cleaning.property_id,
          'Insumos de aseo', 'cleaning', 'variable',
          v_cleaning.supplies_amount, 'COP',
          v_group_rec.paid_date,
          format('Insumos de aseo – %s · Reserva %s (%s) · %s',
            v_cleaning.property_name, v_cleaning.code,
            v_cleaning.done_date,     v_group_rec.cleaner_name),
          'paid',
          NULL,
          v_cleaning.booking_id,
          v_group_rec.cleaner_name,
          v_group_rec.cleaner_id,
          v_group_id
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;

    RAISE NOTICE 'Procesado: limpiadora=%, fecha=%', v_group_rec.cleaner_name, v_group_rec.paid_date;
  END LOOP;

  RAISE NOTICE 'Total filas de gastos creadas: %', v_inserted;
  IF v_inserted = 0 THEN
    RAISE NOTICE 'No se encontraron liquidaciones huérfanas — todo OK o no hay datos pendientes.';
  END IF;
END;
$$;

-- ============================================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- Debería devolver 0 filas si el backfill fue exitoso:
-- ============================================================
-- SELECT bc.id, bc.cleaner_id, bc.paid_date, v.name
-- FROM   public.booking_cleanings bc
-- JOIN   public.vendors v ON v.id = bc.cleaner_id
-- WHERE  bc.status = 'paid'
--   AND  bc.paid_date IS NOT NULL
--   AND  bc.fee > 0
--   AND  NOT EXISTS (
--     SELECT 1 FROM public.expenses e
--     WHERE e.booking_id = bc.booking_id
--       AND e.vendor_id  = bc.cleaner_id
--       AND e.category   = 'Aseo'
--   );
