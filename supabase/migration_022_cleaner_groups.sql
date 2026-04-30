-- migration_022_cleaner_groups.sql
-- Bloque 2 — Agrupación dinámica del personal de aseo (por región o cualquier
-- criterio del usuario). Una limpiadora puede pertenecer a 0..N grupos.
--
-- Idempotente.

create table if not exists cleaner_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users on delete cascade,
  name       text not null,
  color      text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cleaner_groups_owner on cleaner_groups(owner_id);
create unique index if not exists uq_cleaner_groups_owner_name on cleaner_groups(owner_id, lower(name));

create table if not exists cleaner_group_members (
  group_id   uuid not null references cleaner_groups(id) on delete cascade,
  cleaner_id uuid not null references vendors(id) on delete cascade,
  primary key (group_id, cleaner_id)
);

create index if not exists idx_cleaner_group_members_cleaner on cleaner_group_members(cleaner_id);

-- RLS
alter table cleaner_groups enable row level security;
alter table cleaner_group_members enable row level security;

drop policy if exists cleaner_groups_owner on cleaner_groups;
create policy cleaner_groups_owner on cleaner_groups
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists cleaner_group_members_owner on cleaner_group_members;
create policy cleaner_group_members_owner on cleaner_group_members
  for all using (
    exists (select 1 from cleaner_groups g where g.id = cleaner_group_members.group_id and g.owner_id = auth.uid())
  ) with check (
    exists (select 1 from cleaner_groups g where g.id = cleaner_group_members.group_id and g.owner_id = auth.uid())
  );

comment on table cleaner_groups is 'Grupos dinámicos para agrupar limpiadoras (vendors.kind=cleaner) por región o criterio libre.';
comment on table cleaner_group_members is 'Pertenencia M:N entre limpiadoras y grupos.';
