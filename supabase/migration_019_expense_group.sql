-- migration_019_expense_group.sql
-- Bloque 6 — Gastos compartidos entre múltiples propiedades.
-- Cada gasto compartido se materializa como N filas en `expenses` (una por
-- propiedad participante), todas vinculadas por el mismo `expense_group_id`.
-- Esto mantiene compatibilidad con todos los reportes existentes (que filtran
-- por `property_id`) y permite ver sólo la porción correspondiente cuando se
-- filtra por una propiedad.
-- Idempotente.

alter table expenses
  add column if not exists expense_group_id text;

create index if not exists idx_expenses_group_id
  on expenses (expense_group_id)
  where expense_group_id is not null;

comment on column expenses.expense_group_id is
  'Identificador de gasto compartido (Bloque 6). NULL = gasto individual. Todas las filas con el mismo group_id representan partes de un único gasto repartido entre N propiedades.';
