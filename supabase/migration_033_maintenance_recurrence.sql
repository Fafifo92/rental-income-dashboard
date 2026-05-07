-- migration_033_maintenance_recurrence.sql
-- Extiende inventory_maintenance_schedules con:
--   • is_recurring      → si el mantenimiento es recurrente
--   • recurrence_days   → cada cuántos días repetir (nullable)
--   • expense_registered → si ya se registró el gasto asociado al mantenimiento hecho
--
-- Idempotente.

alter table inventory_maintenance_schedules
  add column if not exists is_recurring       boolean not null default false,
  add column if not exists recurrence_days    integer check (recurrence_days is null or recurrence_days > 0),
  add column if not exists expense_registered boolean not null default false;

-- Índice para buscar fácilmente los hechos sin gasto registrado
create index if not exists idx_maint_done_no_expense
  on inventory_maintenance_schedules(owner_id)
  where status = 'done' and expense_registered = false;
