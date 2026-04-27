-- ================================================================
-- CLEANUP: Borrar datos de prueba / resetear transacciones
-- ================================================================
-- CONSERVA:  profiles, properties, listings, bank_accounts,
--            vendors, vendor_properties, property_recurring_expenses
-- BORRA:     bookings, expenses, booking_adjustments,
--            booking_cleanings, shared_bills,
--            recurring_expense_periods
--
-- ORDEN IMPORTANTE: respetar las FK para evitar errores.
-- Ejecutar en Supabase SQL Editor (o psql).
-- ================================================================

-- 1. Períodos de recurrentes (FK → expenses + property_recurring_expenses)
TRUNCATE TABLE recurring_expense_periods CASCADE;

-- 2. Aseos de reserva (FK → bookings)
TRUNCATE TABLE booking_cleanings CASCADE;

-- 3. Ajustes de reserva (FK → bookings; expenses.adjustment_id → booking_adjustments)
--    Se hace después de booking_cleanings pero antes de expenses/bookings
TRUNCATE TABLE booking_adjustments CASCADE;

-- 4. Gastos (FK → bookings, bank_accounts, vendors, shared_bills, booking_adjustments)
TRUNCATE TABLE expenses CASCADE;

-- 5. Facturas compartidas (FK → vendors, bank_accounts)
TRUNCATE TABLE shared_bills CASCADE;

-- 6. Reservas (FK → listings)
TRUNCATE TABLE bookings CASCADE;

-- ----------------------------------------------------------------
-- OPCIONAL: si también quieres borrar las plantillas recurrentes
-- (las definiciones de gastos fijos mensuales), descomenta esto:
-- TRUNCATE TABLE property_recurring_expenses CASCADE;
-- ----------------------------------------------------------------

-- ================================================================
-- VERIFICACIÓN: después de correr deberías ver 0 en todas.
-- ================================================================
SELECT
  'bookings'                   AS tabla, COUNT(*) FROM bookings          UNION ALL
SELECT 'expenses',                                   COUNT(*) FROM expenses             UNION ALL
SELECT 'booking_adjustments',                        COUNT(*) FROM booking_adjustments  UNION ALL
SELECT 'booking_cleanings',                          COUNT(*) FROM booking_cleanings    UNION ALL
SELECT 'shared_bills',                               COUNT(*) FROM shared_bills         UNION ALL
SELECT 'recurring_expense_periods',                  COUNT(*) FROM recurring_expense_periods
ORDER BY tabla;
