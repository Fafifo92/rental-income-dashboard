-- migration_027_credit_pools.sql
-- Bolsas de créditos (típicamente seguros de responsabilidad civil): se compra
-- una "bolsa" con X créditos a un precio total, y los créditos se consumen
-- automáticamente al hacer check-in de las reservas confirmadas, según una
-- regla configurable por bolsa.
--
-- Reglas de consumo (consumption_rule):
--   per_person_per_night  → unidades = (adultos + niños·child_weight) * noches
--   per_person_per_booking → unidades = (adultos + niños·child_weight)
--   per_booking            → unidades = 1
-- Créditos consumidos = unidades * credits_per_unit
--
-- Importante: solo se consume créditos sobre reservas cuyo start_date sea
-- >= activated_at. Las reservas pasadas o importadas con start_date previo
-- al activated_at NO descuentan créditos.

create table if not exists credit_pools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete set null,
  name text not null,
  credits_total numeric not null check (credits_total >= 0),
  credits_used numeric not null default 0 check (credits_used >= 0),
  total_price numeric not null default 0,
  consumption_rule text not null check (
    consumption_rule in ('per_person_per_night','per_person_per_booking','per_booking')
  ),
  credits_per_unit numeric not null default 1 check (credits_per_unit > 0),
  child_weight numeric not null default 1 check (child_weight >= 0),
  activated_at date not null,
  expires_at date,
  status text not null default 'active' check (status in ('active','depleted','archived')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists credit_pools_owner_active_idx
  on credit_pools (owner_id, status, activated_at desc);

create table if not exists credit_pool_consumptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  pool_id uuid not null references credit_pools(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  units numeric not null,
  credits_used numeric not null,
  occurred_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (pool_id, booking_id)
);

create index if not exists credit_pool_consumptions_booking_idx
  on credit_pool_consumptions (booking_id);
create index if not exists credit_pool_consumptions_pool_idx
  on credit_pool_consumptions (pool_id);

alter table credit_pools enable row level security;
alter table credit_pool_consumptions enable row level security;

drop policy if exists credit_pools_owner on credit_pools;
create policy credit_pools_owner on credit_pools
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists credit_pool_consumptions_owner on credit_pool_consumptions;
create policy credit_pool_consumptions_owner on credit_pool_consumptions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
