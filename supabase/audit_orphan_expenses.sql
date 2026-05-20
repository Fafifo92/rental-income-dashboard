-- =====================================================================
-- AUDITORÍA: gastos huérfanos y aseos pagados sin respaldo contable.
-- Pegar bloque por bloque en Supabase Studio → SQL Editor.
-- Sólo lee, no modifica nada.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) RESUMEN EJECUTIVO — un sólo número por cada problema
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM expenses
    WHERE status = 'paid' AND bank_account_id IS NULL)          AS gastos_pagados_sin_cuenta,
  (SELECT COALESCE(sum(amount),0) FROM expenses
    WHERE status = 'paid' AND bank_account_id IS NULL)          AS monto_pagado_sin_cuenta,
  (SELECT count(*) FROM booking_cleanings bc
    WHERE bc.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM expenses e
         WHERE e.booking_id = bc.booking_id
           AND e.vendor_id  = bc.cleaner_id
           AND e.category   = 'Aseo'))                          AS aseos_fantasma,
  (SELECT count(*) FROM bookings
    WHERE COALESCE(net_payout,0) > 0
      AND payout_bank_account_id IS NULL
      AND lower(COALESCE(status,'')) NOT LIKE '%cancel%')       AS reservas_cobradas_sin_cuenta,
  (SELECT count(*) FROM expenses
    WHERE status = 'pending')                                   AS cuentas_por_pagar_legitimas;

-- ─────────────────────────────────────────────────────────────────────
-- 2) DETALLE — gastos pagados sin cuenta bancaria (lo más grave)
-- "Pagados" según el sistema, pero ¿de dónde salió la plata?
-- ─────────────────────────────────────────────────────────────────────
SELECT
  e.id, e.date, e.amount, e.category, e.subcategory,
  e.description, e.vendor, e.booking_id, e.expense_group_id,
  p.name AS propiedad,
  e.created_at
FROM   expenses e
LEFT JOIN properties p ON p.id = e.property_id
WHERE  e.status = 'paid'
  AND  e.bank_account_id IS NULL
ORDER BY e.date DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 3) DETALLE — aseos marcados 'paid' en booking_cleanings sin expense respaldatorio
-- (Si esto da filas, son aseos que muestra "Liquidado" en /aseo pero NUNCA salieron de una cuenta.)
-- ─────────────────────────────────────────────────────────────────────
SELECT
  bc.id          AS cleaning_id,
  bc.booking_id,
  bc.paid_date,
  bc.fee,
  bc.supplies_amount,
  bc.reimburse_to_cleaner,
  v.name         AS aseador,
  b.confirmation_code,
  p.name         AS propiedad
FROM   booking_cleanings bc
JOIN   vendors v   ON v.id = bc.cleaner_id
JOIN   bookings b  ON b.id = bc.booking_id
LEFT JOIN listings   l ON l.id = b.listing_id
LEFT JOIN properties p ON p.id = l.property_id
WHERE  bc.status = 'paid'
  AND  NOT EXISTS (
    SELECT 1 FROM expenses e
     WHERE e.booking_id = bc.booking_id
       AND e.vendor_id  = bc.cleaner_id
       AND e.category   = 'Aseo')
ORDER BY bc.paid_date DESC NULLS LAST;

-- ─────────────────────────────────────────────────────────────────────
-- 4) DETALLE — reservas cobradas sin cuenta destino
-- (Plata entró pero no se sabe a qué cuenta. Afecta tus saldos.)
-- ─────────────────────────────────────────────────────────────────────
SELECT
  b.id, b.confirmation_code, b.guest_name,
  b.start_date, b.end_date, b.net_payout, b.status,
  p.name AS propiedad
FROM   bookings b
LEFT JOIN listings   l ON l.id = b.listing_id
LEFT JOIN properties p ON p.id = l.property_id
WHERE  COALESCE(b.net_payout, 0) > 0
  AND  b.payout_bank_account_id IS NULL
  AND  lower(COALESCE(b.status,'')) NOT LIKE '%cancel%'
ORDER BY b.start_date DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 5) DESGLOSE — gastos huérfanos AGRUPADOS por categoría y mes
-- (te dice si el problema viene principalmente de aseo, servicios, etc.)
-- ─────────────────────────────────────────────────────────────────────
SELECT
  to_char(date_trunc('month', e.date), 'YYYY-MM') AS mes,
  e.category,
  count(*)         AS cantidad,
  sum(e.amount)    AS monto_total
FROM   expenses e
WHERE  e.status = 'paid'
  AND  e.bank_account_id IS NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 6) CONTEXTO — ¿cuántos pendientes legítimos tienes? (cuentas por pagar)
-- (status=pending y bank_account_id NULL es VÁLIDO — es una factura aún no pagada)
-- ─────────────────────────────────────────────────────────────────────
SELECT
  e.category,
  count(*)        AS cantidad,
  sum(e.amount)   AS monto_total
FROM   expenses e
WHERE  e.status = 'pending'
GROUP BY 1
ORDER BY 3 DESC;
