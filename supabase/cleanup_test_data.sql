-- ================================================================
-- CLEANUP: Reset completo — solo conserva properties y profiles
-- ================================================================
-- CONSERVA:  profiles, properties
-- BORRA:     todo lo demás (reservas, gastos, ajustes, aseos,
--            facturas, recurrentes, inventario, vendors, cuentas,
--            listings, grupos de limpieza)
--
-- ORDEN IMPORTANTE: respetar las FK para evitar errores.
-- Ejecutar en Supabase SQL Editor (o psql).
-- ================================================================

-- 1. Movimientos de inventario (FK → bookings, expenses, inventory_items)
TRUNCATE TABLE inventory_movements CASCADE;

-- 2. Períodos de recurrentes (FK → expenses, property_recurring_expenses)
TRUNCATE TABLE recurring_expense_periods CASCADE;

-- 3. Aseos de reserva (FK → bookings)
TRUNCATE TABLE booking_cleanings CASCADE;

-- 4. Ajustes de reserva (FK → bookings)
TRUNCATE TABLE booking_adjustments CASCADE;

-- 5. Gastos (FK → bookings, bank_accounts, vendors, shared_bills)
TRUNCATE TABLE expenses CASCADE;

-- 6. Facturas compartidas (FK → vendors, bank_accounts)
TRUNCATE TABLE shared_bills CASCADE;

-- 7. Reservas (FK → listings)
TRUNCATE TABLE bookings CASCADE;

-- 8. Items de inventario (FK → properties, inventory_categories)
TRUNCATE TABLE inventory_items CASCADE;

-- 9. Categorías de inventario
TRUNCATE TABLE inventory_categories CASCADE;

-- 10. Plantillas de gastos recurrentes (FK → properties, vendors)
TRUNCATE TABLE property_recurring_expenses CASCADE;

-- 11. Grupos de limpieza y membresías
TRUNCATE TABLE cleaner_group_members CASCADE;
TRUNCATE TABLE cleaner_groups CASCADE;

-- 12. Relación vendor ↔ propiedad
TRUNCATE TABLE vendor_properties CASCADE;

-- 13. Vendors / proveedores
TRUNCATE TABLE vendors CASCADE;

-- 14. Cuentas bancarias
TRUNCATE TABLE bank_accounts CASCADE;

-- 15. Listings (FK → properties — las properties se conservan)
TRUNCATE TABLE listings CASCADE;

-- ================================================================
-- VERIFICACIÓN: después de correr deberías ver 0 en todas.
-- ================================================================
SELECT tabla, cnt FROM (
  SELECT 'bookings'                  AS tabla, COUNT(*) AS cnt FROM bookings                 UNION ALL
  SELECT 'expenses',                           COUNT(*)         FROM expenses                UNION ALL
  SELECT 'booking_adjustments',                COUNT(*)         FROM booking_adjustments     UNION ALL
  SELECT 'booking_cleanings',                  COUNT(*)         FROM booking_cleanings       UNION ALL
  SELECT 'shared_bills',                       COUNT(*)         FROM shared_bills            UNION ALL
  SELECT 'recurring_expense_periods',          COUNT(*)         FROM recurring_expense_periods UNION ALL
  SELECT 'inventory_movements',                COUNT(*)         FROM inventory_movements     UNION ALL
  SELECT 'inventory_items',                    COUNT(*)         FROM inventory_items         UNION ALL
  SELECT 'inventory_categories',               COUNT(*)         FROM inventory_categories    UNION ALL
  SELECT 'property_recurring_expenses',        COUNT(*)         FROM property_recurring_expenses UNION ALL
  SELECT 'cleaner_groups',                     COUNT(*)         FROM cleaner_groups          UNION ALL
  SELECT 'vendors',                            COUNT(*)         FROM vendors                 UNION ALL
  SELECT 'bank_accounts',                      COUNT(*)         FROM bank_accounts           UNION ALL
  SELECT 'listings',                           COUNT(*)         FROM listings
) t
ORDER BY tabla;
