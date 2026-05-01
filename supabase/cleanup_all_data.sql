-- ============================================================
-- SCRIPT DE LIMPIEZA TOTAL
-- Borra todos los datos transaccionales y de configuración,
-- dejando SOLO las filas de `properties` y los usuarios de auth.
--
-- CÓMO USARLO:
--   Supabase Studio → SQL Editor → pegar y ejecutar.
--
-- ⚠️  IRREVERSIBLE — haz un backup si quieres guardar algo.
-- ============================================================

-- 1. Consumos de bolsas de créditos
DELETE FROM public.credit_pool_consumptions;

-- 2. Bolsas de créditos
DELETE FROM public.credit_pools;

-- 3. Movimientos de inventario
DELETE FROM public.inventory_movements;

-- 4. Items de inventario
DELETE FROM public.inventory_items;

-- 5. Categorías de inventario
DELETE FROM public.inventory_categories;

-- 6. Aseos por reserva
DELETE FROM public.booking_cleanings;

-- 7. Ajustes de reserva (daños, ingresos extra, descuentos)
DELETE FROM public.booking_adjustments;

-- 8. Periodos de gastos recurrentes (historial de pagos)
DELETE FROM public.recurring_expense_periods;

-- 9. Gastos
DELETE FROM public.expenses;

-- 10. Facturas compartidas de proveedores
DELETE FROM public.shared_bills;

-- 11. Reservas
DELETE FROM public.bookings;

-- 12. Listings (anuncios vinculados a propiedades)
DELETE FROM public.listings;

-- 13. Gastos recurrentes de propiedades (servicios configurados)
DELETE FROM public.property_recurring_expenses;

-- 14. Miembros de grupos de personal de aseo
DELETE FROM public.cleaner_group_members;

-- 15. Grupos de personal de aseo
DELETE FROM public.cleaner_groups;

-- 16. Asignación de propiedades a proveedores
DELETE FROM public.vendor_properties;

-- 17. Proveedores (vendedores / personal de aseo)
DELETE FROM public.vendors;

-- 18. Cuentas bancarias
DELETE FROM public.bank_accounts;

-- 19. Etiquetas asignadas a propiedades
DELETE FROM public.property_tag_assignments;

-- 20. Etiquetas de propiedades
DELETE FROM public.property_tags;

-- 21. Limpiar group_id en propiedades ANTES de borrar grupos
--     (evita error de FK)
UPDATE public.properties SET group_id = NULL;

-- 22. Grupos de propiedades
DELETE FROM public.property_groups;

-- 23. Preferencias de notificación de usuario
DELETE FROM public.user_notification_settings;

-- ── VERIFICACIÓN ──────────────────────────────────────────────
-- Corre este bloque aparte para confirmar que quedó limpio:
/*
SELECT 'bookings'                  AS tabla, count(*) FROM public.bookings
UNION ALL SELECT 'expenses',                count(*) FROM public.expenses
UNION ALL SELECT 'vendors',                 count(*) FROM public.vendors
UNION ALL SELECT 'bank_accounts',           count(*) FROM public.bank_accounts
UNION ALL SELECT 'inventory_items',         count(*) FROM public.inventory_items
UNION ALL SELECT 'credit_pools',            count(*) FROM public.credit_pools
UNION ALL SELECT 'properties (DEBE TENER)', count(*) FROM public.properties;
*/
