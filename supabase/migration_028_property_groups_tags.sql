-- Migration 028: grupos y etiquetas para propiedades
--
-- - property_groups: 1 grupo por propiedad (FK opcional). Sirve como carpeta.
--   Ej: "Edificio Aurora", "Casas centro", "Apartamentos playa".
-- - property_tags: etiquetas reutilizables. Many-to-many con propiedades.
--   Ej: "Pet-friendly", "Premium", "Vista al mar".

-- ── property_groups ─────────────────────────────────────────────────────────
create table if not exists public.property_groups (
  id           uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text default 'slate',          -- tailwind color name
  sort_order  int  default 0,
  created_at  timestamptz default now(),
  unique (owner_id, name)
);

create index if not exists idx_property_groups_owner on public.property_groups(owner_id);

alter table public.property_groups enable row level security;

drop policy if exists "owner_full_property_groups" on public.property_groups;
create policy "owner_full_property_groups" on public.property_groups
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── properties.group_id ─────────────────────────────────────────────────────
alter table public.properties
  add column if not exists group_id uuid references public.property_groups(id) on delete set null;

create index if not exists idx_properties_group on public.properties(group_id);

-- ── property_tags ───────────────────────────────────────────────────────────
create table if not exists public.property_tags (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text default 'blue',
  created_at  timestamptz default now(),
  unique (owner_id, name)
);

create index if not exists idx_property_tags_owner on public.property_tags(owner_id);

alter table public.property_tags enable row level security;

drop policy if exists "owner_full_property_tags" on public.property_tags;
create policy "owner_full_property_tags" on public.property_tags
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── property_tag_assignments (M:N) ──────────────────────────────────────────
create table if not exists public.property_tag_assignments (
  property_id uuid not null references public.properties(id) on delete cascade,
  tag_id      uuid not null references public.property_tags(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (property_id, tag_id)
);

create index if not exists idx_pta_owner on public.property_tag_assignments(owner_id);
create index if not exists idx_pta_tag on public.property_tag_assignments(tag_id);

alter table public.property_tag_assignments enable row level security;

drop policy if exists "owner_full_property_tag_assignments" on public.property_tag_assignments;
create policy "owner_full_property_tag_assignments" on public.property_tag_assignments
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
