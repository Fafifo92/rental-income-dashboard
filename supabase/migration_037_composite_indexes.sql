-- migration_037_composite_indexes.sql
-- ============================================================
-- Auditoría → Bloque 6.3: Índices compuestos de performance
-- ============================================================
-- OBJETIVO: Acelerar los queries más frecuentes de la app.
--   Cada índice se diseñó trazando el patrón real de cada
--   servicio (bookings.ts, expenses.ts, cleanings.ts, etc.)
--
-- PRINCIPIO: RLS de Supabase inyecta `owner_id = auth.uid()` en
--   cada SELECT. Arrancar el índice por owner_id (cardinalidad baja
--   per‑user = alta selectividad efectiva) + columna de orden/filtro.
--
-- IDEMPOTENTE: todos los índices usan CREATE INDEX IF NOT EXISTS.
-- NO DESTRUCTIVO: no altera columnas, no borra datos.
--
-- ============================================================
-- BLOQUE A — bookings
-- ============================================================

-- NOTA: bookings NO tiene columna owner_id propia; el owner se resuelve
-- vía listing_id → listings → properties.owner_id (RLS join).
-- Los índices de bookings se construyen sobre listing_id + columna de filtro/orden.

-- A1. Lista principal de reservas (orden por start_date DESC por anuncio)
--     src/services/bookings.ts → listBookings() `.order('start_date',…)`
create index if not exists idx_bookings_listing_start
  on public.bookings(listing_id, start_date desc);

-- A2. Queries del dashboard de ingresos (end_date range por anuncio)
--     bookings.ts → getBookingsForDashboard() `.gte('end_date',…)` `.lte('end_date',…)`
create index if not exists idx_bookings_listing_end
  on public.bookings(listing_id, end_date desc);

-- A3. Solapamiento de calendario por anuncio (disponibilidad / overlap check)
--     bookings.ts → getBookingsByListing(), getOverlappingBookings()
--     `.eq('listing_id',…)` + range sobre start_date/end_date
create index if not exists idx_bookings_listing_dates
  on public.bookings(listing_id, start_date, end_date);

-- A4. Filtro por estado por anuncio (ej: status = 'confirmed' para panel operativo)
create index if not exists idx_bookings_listing_status
  on public.bookings(listing_id, status);

-- ============================================================
-- BLOQUE B — expenses
-- ============================================================

-- B1. Lista principal de gastos (orden fecha DESC, con filtro de propiedad)
--     expenses.ts → listExpenses() `.order('date',…)` + `.eq('property_id',…)`
create index if not exists idx_expenses_owner_prop_date
  on public.expenses(owner_id, property_id, date desc);

-- B2. Gastos de una reserva (BookingDetailModal → gastos vinculados)
--     expenses.ts → `.eq('booking_id',…)`
create index if not exists idx_expenses_booking
  on public.expenses(booking_id)
  where booking_id is not null;

-- B3. Gastos de un vendedor/aseador por subcategoría y estado
--     cleanings.ts → `.eq('vendor_id',…).eq('subcategory','cleaning').eq('status','pending')`
create index if not exists idx_expenses_vendor_sub_status
  on public.expenses(owner_id, vendor_id, subcategory, status)
  where vendor_id is not null;

-- B4. Gastos por grupo (shared bills / expense_group_id)
--     expenses.ts → `.eq('expense_group_id',…)`
create index if not exists idx_expenses_group
  on public.expenses(expense_group_id)
  where expense_group_id is not null;

-- ============================================================
-- BLOQUE C — booking_cleanings
-- ============================================================

-- C1. Aseos de una reserva (BookingDetailModal → sección cleanings)
--     cleanings.ts → `.eq('booking_id',…).order('created_at',…)`
create index if not exists idx_cleanings_booking
  on public.booking_cleanings(booking_id, created_at desc);

-- C2. Historial de aseos por aseador (AseoClient, saldo de aseadores)
--     cleanings.ts → `.eq('cleaner_id',…).order('done_date',…)`
create index if not exists idx_cleanings_cleaner_date
  on public.booking_cleanings(cleaner_id, done_date desc nulls last);

-- ============================================================
-- BLOQUE D — booking_adjustments
-- ============================================================

-- D1. Ajustes de una reserva (BookingDetailModal → sección adjustments)
--     bookingAdjustments.ts → `.eq('booking_id',…).order('date',…)`
create index if not exists idx_adjustments_booking
  on public.booking_adjustments(booking_id, date desc);

-- ============================================================
-- BLOQUE E — inventory_maintenance_schedules
-- ============================================================

-- E1. Panel de mantenimientos pendientes/vencidos/próximos
--     maintenanceSchedules service → status filter + scheduled_date range
--     (Complementa el índice parcial de migration_033 que cubre solo done+no_expense)
create index if not exists idx_maint_owner_status_date
  on public.inventory_maintenance_schedules(owner_id, status, scheduled_date);

-- ============================================================
-- BLOQUE F — recurring_expense_periods
-- ============================================================

-- F1. Períodos recurrentes pendientes por propiedad
--     RecurringPendingPanel → query por property_id + status = 'pending'
create index if not exists idx_recurring_periods_prop_status
  on public.recurring_expense_periods(property_recurring_expense_id, status);

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- Ejecuta en SQL Editor para confirmar los índices:
--
-- select indexname, tablename, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and indexname like 'idx_%'
-- order by tablename, indexname;
--
-- Resultado esperado: todos los idx_ de este archivo más los de
-- migration_034 (idx_bank_accounts_owner_id, idx_booking_payments_booking_id)
-- y migration_033 (idx_maint_done_no_expense).
-- ============================================================
