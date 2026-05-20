-- ============================================================
-- audit_all_data_issues.sql
--
-- Read-only audit completo de la plataforma. Corre cada bloque
-- en Supabase Studio (SQL editor) y comparte los conteos.
-- NO modifica datos.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0) RESUMEN GLOBAL (un solo SELECT con todos los conteos)
-- ─────────────────────────────────────────────────────────────
WITH
  expenses_no_account AS (
    SELECT count(*)::int c, COALESCE(sum(amount), 0)::numeric s
    FROM public.expenses
    WHERE status = 'paid' AND bank_account_id IS NULL
  ),
  cleanings_no_expense AS (
    SELECT count(*)::int c
    FROM public.booking_cleanings bc
    WHERE bc.status = 'paid' AND bc.paid_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.expenses e
         WHERE e.booking_id = bc.booking_id
           AND e.vendor_id  = bc.cleaner_id
           AND e.category   = 'Aseo'
      )
  ),
  cleanings_no_date AS (
    SELECT count(*)::int c
    FROM public.booking_cleanings bc
    WHERE bc.status = 'paid' AND bc.paid_date IS NULL
  ),
  overlap_bookings AS (
    SELECT count(*)::int c
    FROM public.bookings b1
    JOIN public.bookings b2
      ON b1.listing_id = b2.listing_id
     AND b1.id < b2.id
     AND b1.start_date < b2.end_date
     AND b2.start_date < b1.end_date
    WHERE lower(COALESCE(b1.status, '')) NOT LIKE '%cancel%'
      AND lower(COALESCE(b2.status, '')) NOT LIKE '%cancel%'
  ),
  bookings_no_payout_account AS (
    SELECT count(*)::int c, COALESCE(sum(net_payout), 0)::numeric s
    FROM public.bookings
    WHERE COALESCE(net_payout, 0) > 0
      AND payout_bank_account_id IS NULL
      AND lower(COALESCE(status, '')) NOT LIKE '%cancel%'
  ),
  inconsistent_payouts AS (
    SELECT count(*)::int c
    FROM public.bookings
    WHERE COALESCE(net_payout, 0) > 0
      AND ((payout_date IS NULL) <> (payout_bank_account_id IS NULL))
      AND lower(COALESCE(status, '')) NOT LIKE '%cancel%'
  ),
  invalid_expenses AS (
    SELECT count(*)::int c
    FROM public.expenses
    WHERE COALESCE(amount, 0) <= 0
  ),
  paid_cleanings_no_cleaner AS (
    SELECT count(*)::int c
    FROM public.booking_cleanings
    WHERE status = 'paid' AND cleaner_id IS NULL
  ),
  done_cleanings_no_date AS (
    SELECT count(*)::int c
    FROM public.booking_cleanings
    WHERE status = 'done' AND done_date IS NULL
  ),
  invalid_booking_dates AS (
    SELECT count(*)::int c
    FROM public.bookings
    WHERE end_date <= start_date OR COALESCE(num_nights, 0) <= 0
  ),
  duplicate_codes AS (
    SELECT count(*)::int c
    FROM (
      SELECT confirmation_code, channel
      FROM public.bookings
      WHERE confirmation_code IS NOT NULL AND length(trim(confirmation_code)) > 0
      GROUP BY confirmation_code, channel
      HAVING count(*) > 1
    ) d
  )
SELECT
  (SELECT c FROM expenses_no_account)            AS expenses_paid_without_account,
  (SELECT s FROM expenses_no_account)            AS expenses_paid_without_account_amount,
  (SELECT c FROM cleanings_no_expense)           AS cleanings_paid_without_expense,
  (SELECT c FROM cleanings_no_date)              AS cleanings_paid_without_date,
  (SELECT c FROM overlap_bookings)               AS overlapping_bookings_pairs,
  (SELECT c FROM bookings_no_payout_account)     AS bookings_without_payout_account,
  (SELECT s FROM bookings_no_payout_account)     AS bookings_without_payout_account_amount,
  (SELECT c FROM inconsistent_payouts)           AS bookings_inconsistent_payouts,
  (SELECT c FROM invalid_expenses)               AS expenses_amount_invalid,
  (SELECT c FROM paid_cleanings_no_cleaner)      AS paid_cleanings_without_cleaner,
  (SELECT c FROM done_cleanings_no_date)         AS done_cleanings_without_date,
  (SELECT c FROM invalid_booking_dates)          AS invalid_booking_dates,
  (SELECT c FROM duplicate_codes)                AS duplicate_confirmation_codes;

-- ─────────────────────────────────────────────────────────────
-- A) Reservas solapadas (TOP 50)
-- ─────────────────────────────────────────────────────────────
SELECT
  l.id                                                                AS listing_id,
  COALESCE(p.name, l.external_name)                                   AS property_name,
  b1.id                                                               AS booking_1_id,
  b1.confirmation_code                                                AS booking_1_code,
  b1.guest_name                                                       AS booking_1_guest,
  b1.start_date                                                       AS booking_1_start,
  b1.end_date                                                         AS booking_1_end,
  b1.channel                                                          AS booking_1_channel,
  b1.status                                                           AS booking_1_status,
  b1.net_payout                                                       AS booking_1_net,
  b2.id                                                               AS booking_2_id,
  b2.confirmation_code                                                AS booking_2_code,
  b2.guest_name                                                       AS booking_2_guest,
  b2.start_date                                                       AS booking_2_start,
  b2.end_date                                                         AS booking_2_end,
  b2.channel                                                          AS booking_2_channel,
  b2.status                                                           AS booking_2_status,
  b2.net_payout                                                       AS booking_2_net
FROM public.bookings b1
JOIN public.bookings b2
  ON b1.listing_id = b2.listing_id
 AND b1.id < b2.id
 AND b1.start_date < b2.end_date
 AND b2.start_date < b1.end_date
LEFT JOIN public.listings   l ON l.id = b1.listing_id
LEFT JOIN public.properties p ON p.id = l.property_id
WHERE lower(COALESCE(b1.status, '')) NOT LIKE '%cancel%'
  AND lower(COALESCE(b2.status, '')) NOT LIKE '%cancel%'
ORDER BY b1.start_date DESC
LIMIT 50;

-- ─────────────────────────────────────────────────────────────
-- B) Ingresos huérfanos (bookings con net_payout sin cuenta)
-- ─────────────────────────────────────────────────────────────
SELECT
  b.id,
  b.confirmation_code,
  b.channel,
  b.guest_name,
  b.start_date,
  b.end_date,
  b.net_payout,
  b.payout_date,
  COALESCE(p.name, l.external_name) AS property_name
FROM public.bookings b
LEFT JOIN public.listings   l ON l.id = b.listing_id
LEFT JOIN public.properties p ON p.id = l.property_id
WHERE COALESCE(b.net_payout, 0) > 0
  AND b.payout_bank_account_id IS NULL
  AND lower(COALESCE(b.status, '')) NOT LIKE '%cancel%'
ORDER BY b.start_date DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- C) Pagos parciales (solo fecha o solo cuenta, no ambos)
-- ─────────────────────────────────────────────────────────────
SELECT
  b.id, b.confirmation_code, b.channel, b.guest_name,
  b.start_date, b.end_date, b.net_payout, b.payout_date,
  b.payout_bank_account_id,
  CASE
    WHEN b.payout_date IS NULL THEN 'sin fecha'
    ELSE 'sin cuenta'
  END AS missing
FROM public.bookings b
WHERE COALESCE(b.net_payout, 0) > 0
  AND ((b.payout_date IS NULL) <> (b.payout_bank_account_id IS NULL))
  AND lower(COALESCE(b.status, '')) NOT LIKE '%cancel%'
ORDER BY b.start_date DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- D) Gastos con monto <= 0
-- ─────────────────────────────────────────────────────────────
SELECT id, date, category, subcategory, amount, status, description
FROM public.expenses
WHERE COALESCE(amount, 0) <= 0
ORDER BY date DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- E) Aseos paid sin cleaner_id
-- ─────────────────────────────────────────────────────────────
SELECT bc.id, bc.booking_id, bc.fee, bc.paid_date, b.confirmation_code
FROM public.booking_cleanings bc
LEFT JOIN public.bookings b ON b.id = bc.booking_id
WHERE bc.status = 'paid' AND bc.cleaner_id IS NULL
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- F) Aseos done sin done_date
-- ─────────────────────────────────────────────────────────────
SELECT bc.id, bc.booking_id, bc.cleaner_id, bc.fee, b.confirmation_code
FROM public.booking_cleanings bc
LEFT JOIN public.bookings b ON b.id = bc.booking_id
WHERE bc.status = 'done' AND bc.done_date IS NULL
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- G) Bookings con fechas inválidas
-- ─────────────────────────────────────────────────────────────
SELECT id, confirmation_code, start_date, end_date, num_nights, status
FROM public.bookings
WHERE end_date <= start_date OR COALESCE(num_nights, 0) <= 0
LIMIT 100;

-- ─────────────────────────────────────────────────────────────
-- H) Duplicados de confirmation_code en el mismo channel
-- ─────────────────────────────────────────────────────────────
SELECT confirmation_code, channel, count(*) AS dup_count,
       array_agg(id ORDER BY created_at) AS booking_ids
FROM public.bookings
WHERE confirmation_code IS NOT NULL AND length(trim(confirmation_code)) > 0
GROUP BY confirmation_code, channel
HAVING count(*) > 1
ORDER BY dup_count DESC
LIMIT 50;
