-- migration_051_paid_status_invariants.sql
-- ============================================================
-- 1) RPC transaccional para registrar un aseo y, opcionalmente,
--    su pago consolidado (expense + bank_account_id) en UNA
--    sola transacción. Cierra el bug donde el modal
--    CleaningFormModal podía dejar un booking_cleaning con
--    status='paid' sin expense respaldatorio.
--
-- 2) Constraints CHECK (NOT VALID) que vuelven IMPOSIBLE volver
--    a caer en los estados inconsistentes:
--    - expenses paid  ⇒ bank_account_id IS NOT NULL
--    - cleanings paid ⇒ paid_date IS NOT NULL
--
-- Los constraints quedan NOT VALID al desplegar para que los
-- registros heredados no rompan; se promueven a VALID
-- manualmente tras limpiar datos desde /data-issues.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) RPC: rpc_create_cleaning_with_payment
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_cleaning_with_payment(
  p_booking_id            UUID,
  p_cleaner_id            UUID,
  p_fee                   NUMERIC,
  p_status                TEXT,
  p_done_date             DATE,
  p_notes                 TEXT,
  p_supplies_amount       NUMERIC,
  p_reimburse_to_cleaner  BOOLEAN,
  p_paid_date             DATE DEFAULT NULL,
  p_bank_account_id       UUID DEFAULT NULL
)
RETURNS TABLE (
  cleaning_id      UUID,
  expense_ids      UUID[]
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_cleaning_id    UUID;
  v_group_id       TEXT;
  v_inserted_ids   UUID[] := ARRAY[]::UUID[];
  v_expense_id     UUID;
  v_cleaner_name   TEXT;
  v_property_id    UUID;
  v_property_name  TEXT;
  v_code           TEXT;
  v_done_for_desc  DATE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  IF p_status NOT IN ('pending', 'done', 'paid') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  IF p_status = 'paid' THEN
    IF p_paid_date IS NULL THEN
      RAISE EXCEPTION 'Para marcar un aseo como pagado debes indicar la fecha de pago.';
    END IF;
    IF p_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'Para marcar un aseo como pagado debes indicar la cuenta bancaria de salida.';
    END IF;
    IF p_fee IS NULL OR p_fee < 0 THEN
      RAISE EXCEPTION 'Tarifa inválida para un aseo pagado.';
    END IF;
  END IF;

  -- 1) Insertar el booking_cleaning. Para 'paid' guardamos también paid_date.
  INSERT INTO public.booking_cleanings (
    booking_id, cleaner_id, fee, status,
    done_date, paid_date,
    notes, supplies_amount, reimburse_to_cleaner
  ) VALUES (
    p_booking_id, p_cleaner_id, p_fee, p_status,
    CASE WHEN p_status = 'pending' THEN NULL ELSE p_done_date END,
    CASE WHEN p_status = 'paid' THEN p_paid_date ELSE NULL END,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    COALESCE(p_supplies_amount, 0),
    COALESCE(p_reimburse_to_cleaner, FALSE)
  )
  RETURNING id INTO v_cleaning_id;

  -- 2) Si no se está pagando ahora, retornamos solo el cleaning.
  IF p_status <> 'paid' THEN
    RETURN QUERY SELECT v_cleaning_id, v_inserted_ids;
    RETURN;
  END IF;

  -- 3) Cargar contexto necesario para describir los expenses.
  SELECT v.name INTO v_cleaner_name
  FROM   public.vendors v
  WHERE  v.id = p_cleaner_id;

  IF v_cleaner_name IS NULL THEN
    RAISE EXCEPTION 'Persona de aseo no encontrada.';
  END IF;

  SELECT p.id, COALESCE(p.name, 'Sin propiedad'),
         COALESCE(b.confirmation_code, LEFT(b.id::text, 8)),
         COALESCE(p_done_date, b.end_date, p_paid_date)
    INTO v_property_id, v_property_name, v_code, v_done_for_desc
  FROM   public.bookings   b
  LEFT JOIN public.listings   l ON l.id = b.listing_id
  LEFT JOIN public.properties p ON p.id = l.property_id
  WHERE  b.id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada: %', p_booking_id;
  END IF;

  v_group_id := gen_random_uuid()::text;

  -- 4) Expense por la tarifa.
  IF COALESCE(p_fee, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Aseo', 'cleaning', 'variable',
      p_fee, 'COP', p_paid_date,
      format('Aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, p_booking_id,
      v_cleaner_name, p_cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  -- 5) Expense por insumos cuando aplica.
  IF COALESCE(p_reimburse_to_cleaner, FALSE) AND COALESCE(p_supplies_amount, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Insumos de aseo', 'cleaning', 'variable',
      p_supplies_amount, 'COP', p_paid_date,
      format('Insumos de aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, p_booking_id,
      v_cleaner_name, p_cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  RETURN QUERY SELECT v_cleaning_id, v_inserted_ids;
END;
$$;

COMMENT ON FUNCTION public.rpc_create_cleaning_with_payment IS
  'Inserta un booking_cleaning y, si status=paid, genera el expense respaldatorio (fee y opcional insumos) en una sola transacción. Garantiza el invariante: ningún cleaning paid puede existir sin expense respaldatorio con bank_account_id.';

GRANT EXECUTE ON FUNCTION public.rpc_create_cleaning_with_payment(
  UUID, UUID, NUMERIC, TEXT, DATE, TEXT, NUMERIC, BOOLEAN, DATE, UUID
) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) RPC: rpc_data_issues_summary  (banner /data-issues)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_data_issues_summary()
RETURNS TABLE (
  expenses_paid_without_account_count  INT,
  expenses_paid_without_account_amount NUMERIC,
  cleanings_paid_without_expense_count INT,
  cleanings_paid_without_date_count    INT,
  bookings_paid_without_account_count  INT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.expenses
       WHERE status = 'paid' AND bank_account_id IS NULL),
    (SELECT COALESCE(sum(amount), 0) FROM public.expenses
       WHERE status = 'paid' AND bank_account_id IS NULL),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status = 'paid'
         AND bc.paid_date IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.expenses e
            WHERE e.booking_id = bc.booking_id
              AND e.vendor_id  = bc.cleaner_id
              AND e.category   = 'Aseo'
         )),
    (SELECT count(*)::int FROM public.booking_cleanings bc
       WHERE bc.status = 'paid' AND bc.paid_date IS NULL),
    (SELECT count(*)::int FROM public.bookings b
       WHERE COALESCE(b.net_payout, 0) > 0
         AND b.payout_bank_account_id IS NULL
         AND lower(COALESCE(b.status, '')) NOT LIKE '%cancel%');
$$;

GRANT EXECUTE ON FUNCTION public.rpc_data_issues_summary() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3) CHECK constraints (NOT VALID — válidos para escrituras
--    nuevas; los registros existentes se validarán manualmente
--    desde Supabase Studio una vez se limpien todos los issues
--    en /data-issues).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_paid_requires_account;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_paid_requires_account
  CHECK (status <> 'paid' OR bank_account_id IS NOT NULL)
  NOT VALID;

ALTER TABLE public.booking_cleanings
  DROP CONSTRAINT IF EXISTS cleanings_paid_requires_date;
ALTER TABLE public.booking_cleanings
  ADD CONSTRAINT cleanings_paid_requires_date
  CHECK (status <> 'paid' OR paid_date IS NOT NULL)
  NOT VALID;

-- ============================================================
-- POST-DEPLOY (manual, en Supabase Studio, tras limpiar /data-issues):
--
--   ALTER TABLE public.expenses
--     VALIDATE CONSTRAINT expenses_paid_requires_account;
--
--   ALTER TABLE public.booking_cleanings
--     VALIDATE CONSTRAINT cleanings_paid_requires_date;
--
-- Si alguno falla, hay datos inconsistentes pendientes
-- (consulta /data-issues).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 4) RPC: rpc_repair_orphan_cleaning_with_expense
--    Para un booking_cleaning que ya está 'paid' y tiene paid_date
--    pero NO tiene expense respaldatorio, genera el (los) expense(s)
--    faltante(s) con el bank_account_id elegido por el usuario.
--    Idempotente: si ya existe expense para (booking_id, vendor_id,
--    category='Aseo'), no hace nada y retorna IDs vacíos.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_repair_orphan_cleaning_with_expense(
  p_cleaning_id     UUID,
  p_bank_account_id UUID
)
RETURNS TABLE (expense_ids UUID[])
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_cleaning       RECORD;
  v_cleaner_name   TEXT;
  v_property_id    UUID;
  v_property_name  TEXT;
  v_code           TEXT;
  v_done_for_desc  DATE;
  v_group_id       TEXT;
  v_inserted_ids   UUID[] := ARRAY[]::UUID[];
  v_expense_id     UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  IF p_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Debes indicar la cuenta bancaria de salida.';
  END IF;

  SELECT bc.*
    INTO v_cleaning
  FROM   public.booking_cleanings bc
  WHERE  bc.id = p_cleaning_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aseo no encontrado: %', p_cleaning_id;
  END IF;

  IF v_cleaning.status <> 'paid' THEN
    RAISE EXCEPTION 'Solo se pueden reparar aseos en estado paid (estado actual: %).', v_cleaning.status;
  END IF;

  IF v_cleaning.paid_date IS NULL THEN
    RAISE EXCEPTION 'El aseo no tiene fecha de pago; primero corrige la fecha antes de generar el gasto.';
  END IF;

  -- Cortocircuito si ya existe un expense respaldatorio.
  IF EXISTS (
    SELECT 1 FROM public.expenses e
     WHERE e.booking_id = v_cleaning.booking_id
       AND e.vendor_id  = v_cleaning.cleaner_id
       AND e.category   = 'Aseo'
  ) THEN
    RETURN QUERY SELECT v_inserted_ids;
    RETURN;
  END IF;

  SELECT v.name INTO v_cleaner_name FROM public.vendors v WHERE v.id = v_cleaning.cleaner_id;
  IF v_cleaner_name IS NULL THEN
    RAISE EXCEPTION 'Persona de aseo no encontrada.';
  END IF;

  SELECT p.id, COALESCE(p.name, 'Sin propiedad'),
         COALESCE(b.confirmation_code, LEFT(b.id::text, 8)),
         COALESCE(v_cleaning.done_date, b.end_date, v_cleaning.paid_date)
    INTO v_property_id, v_property_name, v_code, v_done_for_desc
  FROM   public.bookings b
  LEFT JOIN public.listings   l ON l.id = b.listing_id
  LEFT JOIN public.properties p ON p.id = l.property_id
  WHERE  b.id = v_cleaning.booking_id;

  v_group_id := gen_random_uuid()::text;

  IF COALESCE(v_cleaning.fee, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Aseo', 'cleaning', 'variable',
      v_cleaning.fee, 'COP', v_cleaning.paid_date,
      format('Aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, v_cleaning.booking_id,
      v_cleaner_name, v_cleaning.cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  IF COALESCE(v_cleaning.reimburse_to_cleaner, FALSE)
     AND COALESCE(v_cleaning.supplies_amount, 0) > 0 THEN
    INSERT INTO public.expenses (
      owner_id, property_id,
      category, subcategory, type,
      amount, currency, date,
      description, status,
      bank_account_id, booking_id,
      vendor, vendor_id, expense_group_id
    ) VALUES (
      v_user_id, v_property_id,
      'Insumos de aseo', 'cleaning', 'variable',
      v_cleaning.supplies_amount, 'COP', v_cleaning.paid_date,
      format('Insumos de aseo – %s · Reserva %s (%s) · %s',
             v_property_name, v_code, v_done_for_desc, v_cleaner_name),
      'paid',
      p_bank_account_id, v_cleaning.booking_id,
      v_cleaner_name, v_cleaning.cleaner_id, v_group_id
    )
    RETURNING id INTO v_expense_id;
    v_inserted_ids := array_append(v_inserted_ids, v_expense_id);
  END IF;

  RETURN QUERY SELECT v_inserted_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_repair_orphan_cleaning_with_expense(UUID, UUID) TO authenticated;
