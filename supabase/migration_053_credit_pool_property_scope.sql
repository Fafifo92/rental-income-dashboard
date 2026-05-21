-- migration_053_credit_pool_property_scope.sql
--
-- Bolsa de créditos v2: scoping por propiedad, snapshot de precio/crédito
-- y vínculo bidireccional con el expense de compra/recarga.
--
-- Cambios:
--   1. Nueva tabla credit_pool_properties: cobertura cuando la bolsa NO
--      tiene vendor_id. Si la bolsa tiene vendor_id, la cobertura sale de
--      vendor_properties (sigue siendo una sola fuente por bolsa).
--   2. credit_pool_consumptions.unit_price_snapshot: congela el precio/crédito
--      al momento del consumo para que reportes históricos no cambien aunque
--      se edite la pool.
--   3. credit_pools.expense_id: liga la bolsa a su expense de compra/recarga.
--      Si es null, la bolsa fue creada manualmente desde /credit-pools.
--   4. Índice por (vendor_id, status, activated_at) para acelerar FIFO.
--
-- Modelo FIFO: cada recarga = nueva fila en credit_pools (NO se promedia
-- precio). El servicio de consumo elige el pool más antiguo activo aplicable.

-- 1) Cobertura independiente para bolsas sin vendor
create table if not exists credit_pool_properties (
  pool_id uuid not null references credit_pools(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pool_id, property_id)
);

create index if not exists credit_pool_properties_property_idx
  on credit_pool_properties (property_id);

alter table credit_pool_properties enable row level security;

drop policy if exists credit_pool_properties_owner on credit_pool_properties;
create policy credit_pool_properties_owner on credit_pool_properties
  for all using (
    exists (
      select 1 from credit_pools cp
      where cp.id = credit_pool_properties.pool_id
        and cp.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from credit_pools cp
      where cp.id = credit_pool_properties.pool_id
        and cp.owner_id = auth.uid()
    )
  );

-- 2) Snapshot del precio/crédito en cada consumption
alter table credit_pool_consumptions
  add column if not exists unit_price_snapshot numeric;

-- Backfill: derivar snapshot desde el pool actual para consumptions previas.
update credit_pool_consumptions c
set unit_price_snapshot = case
  when p.credits_total > 0 then p.total_price / p.credits_total
  else 0
end
from credit_pools p
where p.id = c.pool_id
  and c.unit_price_snapshot is null;

-- 3) Vínculo de la bolsa con el expense de compra/recarga
alter table credit_pools
  add column if not exists expense_id uuid references expenses(id) on delete set null;

create index if not exists credit_pools_expense_idx
  on credit_pools (expense_id);

-- 4) Índice FIFO por vendor
create index if not exists credit_pools_vendor_fifo_idx
  on credit_pools (vendor_id, status, activated_at asc);
