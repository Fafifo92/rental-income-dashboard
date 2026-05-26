-- migration_058_pending_digest_function.sql
-- ============================================================
-- Función SQL `get_pending_digest(owner, lead_days)` que retorna
-- conteos de pendientes por categoría para construir el email de
-- recordatorios diario. Devuelve JSONB con la estructura:
--
--   {
--     "recurring": 3,
--     "shared_bills": 2,
--     "maintenance": 1,
--     "cleanings": 4,
--     "checkout_pending": 2,
--     "inventory_pending": 1,
--     "payout_pending": 0,
--     "end_of_life": 1,
--     "total": 14
--   }
--
-- SECURITY DEFINER → se llama desde la Edge Function (service_role).
-- IDEMPOTENTE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pending_digest(
  p_owner_id   UUID,
  p_lead_days  INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_today        DATE := CURRENT_DATE;
  v_now_ym       TEXT := to_char(v_today, 'YYYY-MM');
  v_window_end   DATE := v_today + (p_lead_days || ' days')::interval;

  c_recurring   INTEGER := 0;
  c_shared      INTEGER := 0;
  c_maintenance INTEGER := 0;
  c_cleanings   INTEGER := 0;
  c_checkout    INTEGER := 0;
  c_inventory   INTEGER := 0;
  c_payout      INTEGER := 0;
  c_eol         INTEGER := 0;
BEGIN
  -- 1) Recurring expenses pending (últimos 6 meses, no shared)
  -- Un mes es pendiente si: el rubro está activo en ese mes y no hay
  -- entry en recurring_expense_periods con status='paid'|'skipped'.
  SELECT COUNT(*) INTO c_recurring
  FROM public.property_recurring_expenses pre
  JOIN public.properties p ON p.id = pre.property_id
  CROSS JOIN LATERAL (
    SELECT to_char(date_trunc('month', v_today) - (n || ' months')::interval, 'YYYY-MM') AS ym
    FROM generate_series(0, 5) n
  ) months
  WHERE p.owner_id = p_owner_id
    AND pre.is_shared = false
    AND (pre.valid_from IS NULL OR to_char(pre.valid_from, 'YYYY-MM') <= months.ym)
    AND (pre.valid_to   IS NULL OR to_char(pre.valid_to,   'YYYY-MM') >= months.ym)
    AND NOT EXISTS (
      SELECT 1 FROM public.recurring_expense_periods rep
      WHERE rep.recurring_id = pre.id AND rep.year_month = months.ym
    );

  -- 2) Shared bills pendientes (mes actual, vendors compartidos sin factura)
  SELECT COUNT(DISTINCT pre.vendor_id) INTO c_shared
  FROM public.property_recurring_expenses pre
  JOIN public.properties p ON p.id = pre.property_id
  WHERE p.owner_id = p_owner_id
    AND pre.is_shared = true
    AND pre.vendor_id IS NOT NULL
    AND (pre.valid_from IS NULL OR to_char(pre.valid_from, 'YYYY-MM') <= v_now_ym)
    AND (pre.valid_to   IS NULL OR to_char(pre.valid_to,   'YYYY-MM') >= v_now_ym)
    AND NOT EXISTS (
      SELECT 1 FROM public.shared_bills sb
      WHERE sb.vendor_id = pre.vendor_id AND sb.year_month = v_now_ym
    );

  -- 3) Maintenance pending dentro del lead_days
  SELECT COUNT(*) INTO c_maintenance
  FROM public.inventory_maintenance_schedules
  WHERE owner_id = p_owner_id
    AND status = 'pending'
    AND scheduled_date <= v_window_end;

  -- 4) Cleanings done sin pagar
  SELECT COUNT(*) INTO c_cleanings
  FROM public.booking_cleanings bc
  JOIN public.bookings b ON b.id = bc.booking_id
  JOIN public.listings l ON l.id = b.listing_id
  JOIN public.properties p ON p.id = l.property_id
  WHERE p.owner_id = p_owner_id
    AND bc.status = 'done'
    AND bc.paid_date IS NULL;

  -- 5) Booking alerts (reservas pasadas con flags pendientes, últimos 45 días)
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(b.checkout_done, false) = false),
    COUNT(*) FILTER (WHERE COALESCE(b.inventory_checked, false) = false)
  INTO c_checkout, c_inventory
  FROM public.bookings b
  JOIN public.listings l ON l.id = b.listing_id
  JOIN public.properties p ON p.id = l.property_id
  WHERE p.owner_id = p_owner_id
    AND b.end_date < v_today
    AND b.end_date >= v_today - INTERVAL '45 days'
    AND COALESCE(b.status, '') NOT ILIKE '%cancel%';

  -- 6) Payout pendientes: bookings con checkout pero sin bank account asignada
  -- (solo cuenta si la columna existe; tolerante a no-existencia)
  BEGIN
    EXECUTE format($q$
      SELECT COUNT(*)
      FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE p.owner_id = %L
        AND b.end_date < %L
        AND b.end_date >= %L - INTERVAL '45 days'
        AND COALESCE(b.status, '') NOT ILIKE '%%cancel%%'
        AND b.payout_bank_account_id IS NULL
    $q$, p_owner_id, v_today, v_today)
    INTO c_payout;
  EXCEPTION WHEN undefined_column THEN
    c_payout := 0;
  END;

  -- 7) End-of-life inventory
  SELECT COUNT(*) INTO c_eol
  FROM public.inventory_items
  WHERE owner_id = p_owner_id
    AND purchase_date IS NOT NULL
    AND expected_lifetime_months IS NOT NULL
    AND (purchase_date + (expected_lifetime_months || ' months')::interval)::date <= v_today
    AND COALESCE(status, '') <> 'end_of_life';

  RETURN jsonb_build_object(
    'recurring',         c_recurring,
    'shared_bills',      c_shared,
    'maintenance',       c_maintenance,
    'cleanings',         c_cleanings,
    'checkout_pending',  c_checkout,
    'inventory_pending', c_inventory,
    'payout_pending',    c_payout,
    'end_of_life',       c_eol,
    'total',             c_recurring + c_shared + c_maintenance + c_cleanings
                       + c_checkout + c_inventory + c_payout + c_eol
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_digest(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_digest(UUID, INTEGER) TO authenticated, service_role;
