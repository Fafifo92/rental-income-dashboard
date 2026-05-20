-- migration_052_data_issues_v2.sql
-- ============================================================
-- Manejo de errores ampliado.
--
-- 1) Tabla data_issue_ignores para persistir ignores (overlap "no es duplicado").
-- 2) rpc_data_issues_summary_v2 con todos los detectores (A-H + existentes).
-- 3) rpc_delete_booking_cascade: borra una reserva y sus dependencias.
-- 4) rpc_ignore_data_issue / rpc_unignore_data_issue.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) Tabla data_issue_ignores
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_issue_ignores (
  kind         TEXT        NOT NULL,
  key          TEXT        NOT NULL,
  note         TEXT,
  ignored_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ignored_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (kind, key)
);

COMMENT ON TABLE public.data_issue_ignores IS
  'Registros marcados como "no es un error real" desde /data-issues. Para overlap kind=overlap_booking, key=concat(min(id),"_",max(id)).';

ALTER TABLE public.data_issue_ignores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_issue_ignores_select" ON public.data_issue_ignores;
CREATE POLICY "data_issue_ignores_select"
  ON public.data_issue_ignores FOR SELECT
  TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "data_issue_ignores_insert" ON public.data_issue_ignores;
CREATE POLICY "data_issue_ignores_insert"
  ON public.data_issue_ignores FOR INSERT
  TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS "data_issue_ignores_delete" ON public.data_issue_ignores;
CREATE POLICY "data_issue_ignores_delete"
  ON public.data_issue_ignores FOR DELETE
  TO authenticated USING (TRUE);

-- ─────────────────────────────────────────────────────────────
-- 2) rpc_data_issues_summary_v2
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_data_issues_summary_v2()
RETURNS TABLE (
  expenses_paid_without_account_count   INT,
  expenses_paid_without_account_amount  NUMERIC,
  cleanings_paid_without_expense_count  INT,
  cleanings_paid_without_date_count     INT,
  overlapping_bookings_count            INT,
  bookings_without_payout_account_count INT,
  bookings_without_payout_account_amount NUMERIC,
  inconsistent_payouts_count            INT,
  invalid_expenses_count                INT,
  paid_cleanings_without_cleaner_count  INT,
  done_cleanings_without_date_count     INT,
  invalid_booking_dates_count           INT,
  duplicate_codes_count                 INT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.expenses
       WHERE status='paid' AND bank_account_id IS NULL),
    (SELECT COALESCE(sum(amount), 0) FROM public.expenses
       WHERE status='paid' AND bank_account_id IS NULL),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status='paid' AND bc.paid_date IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.expenses e
                          WHERE e.booking_id=bc.booking_id
                            AND e.vendor_id=bc.cleaner_id
                            AND e.category='Aseo')),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status='paid' AND bc.paid_date IS NULL),
    (SELECT count(*)::int FROM public.bookings b1
        JOIN public.bookings b2
          ON b1.listing_id=b2.listing_id
         AND b1.id < b2.id
         AND b1.start_date < b2.end_date
         AND b2.start_date < b1.end_date
        WHERE lower(COALESCE(b1.status,'')) NOT LIKE '%cancel%'
          AND lower(COALESCE(b2.status,'')) NOT LIKE '%cancel%'
          AND NOT EXISTS (
            SELECT 1 FROM public.data_issue_ignores i
             WHERE i.kind='overlap_booking'
               AND i.key = LEAST(b1.id::text, b2.id::text) || '_' || GREATEST(b1.id::text, b2.id::text)
          )),
    (SELECT count(*)::int FROM public.bookings
       WHERE COALESCE(net_payout,0) > 0
         AND payout_bank_account_id IS NULL
         AND lower(COALESCE(status,'')) NOT LIKE '%cancel%'),
    (SELECT COALESCE(sum(net_payout),0) FROM public.bookings
       WHERE COALESCE(net_payout,0) > 0
         AND payout_bank_account_id IS NULL
         AND lower(COALESCE(status,'')) NOT LIKE '%cancel%'),
    (SELECT count(*)::int FROM public.bookings
       WHERE COALESCE(net_payout,0) > 0
         AND ((payout_date IS NULL) <> (payout_bank_account_id IS NULL))
         AND lower(COALESCE(status,'')) NOT LIKE '%cancel%'),
    (SELECT count(*)::int FROM public.expenses
       WHERE COALESCE(amount,0) <= 0),
    (SELECT count(*)::int FROM public.booking_cleanings
       WHERE status='paid' AND cleaner_id IS NULL),
    (SELECT count(*)::int FROM public.booking_cleanings
       WHERE status='done' AND done_date IS NULL),
    (SELECT count(*)::int FROM public.bookings
       WHERE end_date <= start_date OR COALESCE(num_nights,0) <= 0),
    (SELECT count(*)::int FROM (
        SELECT confirmation_code, channel
        FROM public.bookings
        WHERE confirmation_code IS NOT NULL AND length(trim(confirmation_code)) > 0
        GROUP BY confirmation_code, channel
        HAVING count(*) > 1
    ) d);
$$;

GRANT EXECUTE ON FUNCTION public.rpc_data_issues_summary_v2() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3) rpc_delete_booking_cascade
--    Borra una reserva y todas sus dependencias en una transacción.
--    Devuelve el conteo de filas borradas por tabla.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_booking_cascade(
  p_booking_id UUID
)
RETURNS TABLE (
  cleanings_deleted   INT,
  expenses_deleted    INT,
  adjustments_deleted INT,
  payments_deleted    INT,
  deposits_deleted    INT,
  booking_deleted     INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_c INT := 0; v_e INT := 0; v_a INT := 0; v_p INT := 0; v_d INT := 0; v_b INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id es obligatorio.';
  END IF;

  WITH d AS (DELETE FROM public.booking_cleanings WHERE booking_id = p_booking_id RETURNING 1)
  SELECT count(*)::int INTO v_c FROM d;

  WITH d AS (DELETE FROM public.expenses WHERE booking_id = p_booking_id RETURNING 1)
  SELECT count(*)::int INTO v_e FROM d;

  -- booking_adjustments puede no existir en todos los entornos; usar EXECUTE defensivo.
  BEGIN
    WITH d AS (DELETE FROM public.booking_adjustments WHERE booking_id = p_booking_id RETURNING 1)
    SELECT count(*)::int INTO v_a FROM d;
  EXCEPTION WHEN undefined_table THEN v_a := 0;
  END;

  BEGIN
    WITH d AS (DELETE FROM public.booking_payments WHERE booking_id = p_booking_id RETURNING 1)
    SELECT count(*)::int INTO v_p FROM d;
  EXCEPTION WHEN undefined_table THEN v_p := 0;
  END;

  BEGIN
    WITH d AS (DELETE FROM public.booking_deposits WHERE booking_id = p_booking_id RETURNING 1)
    SELECT count(*)::int INTO v_d FROM d;
  EXCEPTION WHEN undefined_table THEN v_d := 0;
  END;

  WITH d AS (DELETE FROM public.bookings WHERE id = p_booking_id RETURNING 1)
  SELECT count(*)::int INTO v_b FROM d;

  IF v_b = 0 THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  RETURN QUERY SELECT v_c, v_e, v_a, v_p, v_d, v_b;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_booking_cascade(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4) rpc_ignore_data_issue / rpc_unignore_data_issue
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_ignore_data_issue(
  p_kind TEXT,
  p_key  TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;
  IF p_kind IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'kind y key son obligatorios.';
  END IF;
  INSERT INTO public.data_issue_ignores (kind, key, note, ignored_by)
  VALUES (p_kind, p_key, p_note, v_user_id)
  ON CONFLICT (kind, key) DO UPDATE SET
    note = EXCLUDED.note,
    ignored_at = NOW(),
    ignored_by = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ignore_data_issue(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_unignore_data_issue(
  p_kind TEXT,
  p_key  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.data_issue_ignores WHERE kind = p_kind AND key = p_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_unignore_data_issue(TEXT, TEXT) TO authenticated;
