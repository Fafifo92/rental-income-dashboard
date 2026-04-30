-- migration_024_inventory.sql
-- Bloque 13 — Módulo Inventario.
--
-- Diseño:
--   • inventory_categories       → categorías por owner (Mueble, Electrodoméstico,
--                                  Utensilio, Lencería, Insumo de aseo, Decoración,
--                                  Otro). Editables.
--   • inventory_items            → items físicos con cantidad, status, ubicación,
--                                  costo y vínculo a propiedad. Insumos consumibles
--                                  usan min_stock para alertas de reposición.
--   • inventory_movements        → bitácora inmutable (added/used/damaged/repaired/
--                                  restocked/discarded/lost) con quantity_delta y
--                                  vínculos opcionales a booking y/o expense.
--
-- Idempotente.

-- ────────────────────────────────────────────────────────────────────────────
-- Categorías
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_categories (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users on delete cascade,
  name       text not null,
  icon       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inv_cat_owner on inventory_categories(owner_id);
create unique index if not exists uq_inv_cat_owner_name on inventory_categories(owner_id, lower(name));

alter table inventory_categories enable row level security;
drop policy if exists inv_cat_owner on inventory_categories;
create policy inv_cat_owner on inventory_categories
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- Items
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_items (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users on delete cascade,
  property_id     uuid not null references properties(id) on delete cascade,
  category_id     uuid references inventory_categories(id) on delete set null,
  name            text not null,
  description     text,
  location        text,                            -- "Habitación principal", "Cocina", "Baño 1"
  status          text not null default 'good'
                  check (status in ('good', 'needs_maintenance', 'damaged', 'lost', 'depleted')),
  quantity        numeric(12,2) not null default 1,
  unit            text default 'unidad',           -- "unidad", "litro", "paquete", "rollo"
  min_stock       numeric(12,2),                   -- alerta cuando quantity <= min_stock (insumos)
  is_consumable   boolean not null default false,  -- true = insumo de aseo / repone constantemente
  purchase_date   date,
  purchase_price  numeric(14,2),
  expected_lifetime_months integer,                -- vida útil estimada (informativo)
  photo_url       text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_inv_items_owner    on inventory_items(owner_id);
create index if not exists idx_inv_items_property on inventory_items(property_id);
create index if not exists idx_inv_items_category on inventory_items(category_id);
create index if not exists idx_inv_items_status   on inventory_items(status);

alter table inventory_items enable row level security;
drop policy if exists inv_items_owner on inventory_items;
create policy inv_items_owner on inventory_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Trigger updated_at
create or replace function set_inventory_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_inv_items_updated_at on inventory_items;
create trigger trg_inv_items_updated_at
  before update on inventory_items
  for each row execute function set_inventory_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Movimientos (bitácora)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists inventory_movements (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users on delete cascade,
  item_id             uuid not null references inventory_items(id) on delete cascade,
  type                text not null
                      check (type in ('added', 'used', 'damaged', 'repaired',
                                      'restocked', 'discarded', 'lost', 'status_change')),
  quantity_delta      numeric(12,2) not null default 0,
  new_status          text check (new_status in ('good','needs_maintenance','damaged','lost','depleted')),
  notes               text,
  related_booking_id  uuid references bookings(id) on delete set null,
  related_expense_id  uuid references expenses(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_inv_mov_owner   on inventory_movements(owner_id);
create index if not exists idx_inv_mov_item    on inventory_movements(item_id);
create index if not exists idx_inv_mov_booking on inventory_movements(related_booking_id);
create index if not exists idx_inv_mov_expense on inventory_movements(related_expense_id);

alter table inventory_movements enable row level security;
drop policy if exists inv_mov_owner on inventory_movements;
create policy inv_mov_owner on inventory_movements
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- Comentarios documentales
-- ────────────────────────────────────────────────────────────────────────────
comment on table inventory_categories is 'Categorías editables del inventario por owner.';
comment on table inventory_items is 'Items del inventario por propiedad. is_consumable=true → insumos de aseo (usar min_stock para alertas).';
comment on table inventory_movements is 'Bitácora inmutable de cambios sobre items. Vincula a booking/expense para trazabilidad.';
comment on column inventory_items.status is 'good | needs_maintenance | damaged | lost | depleted (este último para insumos agotados).';
comment on column inventory_items.is_consumable is 'TRUE para insumos consumibles (jabón, detergente). Activa lógica de min_stock.';
