-- migration_036_booking_cleanup.sql
-- ============================================================
-- Limpieza de reservas y datos transaccionales
-- ============================================================
-- PROPÓSITO: Borrar todos los datos de reservas, gastos y
--   movimientos operativos, PRESERVANDO la configuración base.
--
-- ✅ SE CONSERVA (no se toca):
--   • properties
--   • property_groups / property_tags / property_tag_assignments
--   • listings (anuncios vinculados a propiedades)
--   • inventory_items + inventory_categories
--   • vendors (personal de aseo y proveedores)
--   • vendor_properties (asignaciones)
--   • cleaner_groups + cleaner_group_members
--   • bank_accounts
--   • property_recurring_expenses (configuración recurrente)
--   • credit_pools (configuración de bolsas)
--   • user_notification_settings
--
-- 🗑  SE ELIMINA (datos transaccionales):
--   • credit_pool_consumptions
--   • inventory_movements
--   • inventory_maintenance_schedules (historial mantenimiento)
--   • booking_cleanings
--   • booking_adjustments
--   • booking_payments
--   • recurring_expense_periods (historial pagos recurrentes)
--   • expenses
--   • shared_bills
--   • bookings
--
-- ⚠️  IRREVERSIBLE — sin backup en plan gratuito.
--     Lee bien antes de ejecutar.
--
-- CÓMO APLICAR:
--   1. Supabase SQL Editor → pega TODO el archivo.
--   2. Ejecuta. El orden respeta las FK (hijos antes que padres).
--   3. Corre la query de VERIFICACIÓN al final para confirmar.
-- ============================================================

-- 1. Consumos de bolsas de créditos (hijo de credit_pools y bookings)
DELETE FROM public.credit_pool_consumptions;

-- 2. Movimientos de inventario (historial de daños/estados)
DELETE FROM public.inventory_movements;

-- 3. Historial de mantenimientos (historial — el inventario queda)
DELETE FROM public.inventory_maintenance_schedules;

-- 4. Aseos vinculados a reservas
DELETE FROM public.booking_cleanings;

-- 5. Ajustes de reserva (extra_income, discount, damage_charge)
DELETE FROM public.booking_adjustments;

-- 6. Pagos de reservas
DELETE FROM public.booking_payments;

-- 7. Facturas compartidas de proveedores
DELETE FROM public.shared_bills;

-- 8. Historial de periodos de gastos recurrentes
DELETE FROM public.recurring_expense_periods;

-- 9. Todos los gastos (operativos, mantenimiento, daños)
DELETE FROM public.expenses;

-- 10. Reservas (padre — se borra después de todos sus hijos)
DELETE FROM public.bookings;

-- ============================================================
-- VERIFICACIÓN POST-LIMPIEZA
-- ============================================================
-- Ejecuta esto aparte para confirmar el resultado:
--
-- SELECT 'bookings'                       AS tabla, count(*) FROM public.bookings
-- UNION ALL SELECT 'booking_payments',              count(*) FROM public.booking_payments
-- UNION ALL SELECT 'booking_adjustments',           count(*) FROM public.booking_adjustments
-- UNION ALL SELECT 'booking_cleanings',             count(*) FROM public.booking_cleanings
-- UNION ALL SELECT 'expenses',                      count(*) FROM public.expenses
-- UNION ALL SELECT 'shared_bills',                  count(*) FROM public.shared_bills
-- UNION ALL SELECT 'recurring_expense_periods',     count(*) FROM public.recurring_expense_periods
-- UNION ALL SELECT 'inventory_movements',           count(*) FROM public.inventory_movements
-- UNION ALL SELECT 'maintenance_schedules',         count(*) FROM public.inventory_maintenance_schedules
-- UNION ALL SELECT 'credit_pool_consumptions',      count(*) FROM public.credit_pool_consumptions
-- UNION ALL SELECT '--- PRESERVADO ---',            0
-- UNION ALL SELECT 'properties (debe tener datos)', count(*) FROM public.properties
-- UNION ALL SELECT 'inventory_items (debe tener)',  count(*) FROM public.inventory_items
-- UNION ALL SELECT 'vendors (debe tener)',          count(*) FROM public.vendors
-- UNION ALL SELECT 'bank_accounts (debe tener)',    count(*) FROM public.bank_accounts
-- UNION ALL SELECT 'listings (debe tener)',         count(*) FROM public.listings
-- ORDER BY tabla;
--
-- Resultado esperado:
--   • Tablas de reservas/gastos → 0 filas
--   • properties, inventory_items, vendors, bank_accounts, listings → > 0 filas
-- ============================================================
