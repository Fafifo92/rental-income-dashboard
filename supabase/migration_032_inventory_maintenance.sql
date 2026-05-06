-- migration_032_inventory_maintenance.sql
-- Módulo: Agendamiento de mantenimiento para items del inventario.
--
-- Diseño:
--   • inventory_maintenance_schedules → registro de mantenimientos programados
--     por item. No es un gasto, es solo un recordatorio con fecha.
--   • status: pending | done | cancelled
--   • email_notify: infraestructura lista, activación futura (feature-flag en
--     user_notification_settings.notify_maintenance / email_enabled).
--
-- Idempotente.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla principal
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_maintenance_schedules (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users on delete cascade,
  item_id            uuid not null references inventory_items(id) on delete cascade,
  property_id        uuid not null references properties(id) on delete cascade,
  title              text not null,
  description        text,
  scheduled_date     date not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'done', 'cancelled')),
  notify_before_days integer not null default 3,
  email_notify       boolean not null default false,   -- reservado: activar via email_enabled en settings
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Índices
create index if not exists idx_maint_owner    on inventory_maintenance_schedules(owner_id);
create index if not exists idx_maint_item     on inventory_maintenance_schedules(item_id);
create index if not exists idx_maint_status   on inventory_maintenance_schedules(status);
create index if not exists idx_maint_date     on inventory_maintenance_schedules(scheduled_date);

-- RLS
alter table inventory_maintenance_schedules enable row level security;
drop policy if exists maint_owner on inventory_maintenance_schedules;
create policy maint_owner on inventory_maintenance_schedules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Trigger updated_at (reutiliza la función creada en migration_024_inventory)
drop trigger if exists trg_maint_updated_at on inventory_maintenance_schedules;
create trigger trg_maint_updated_at
  before update on inventory_maintenance_schedules
  for each row execute function set_inventory_updated_at();
