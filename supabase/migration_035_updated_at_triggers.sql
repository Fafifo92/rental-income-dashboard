-- migration_035_updated_at_triggers.sql
-- ============================================================
-- Auditoría → Bloque 2: Triggers updated_at
-- ============================================================
-- Aplica el trigger genérico `set_updated_at()` (creado en mig 034)
-- a las tablas principales que tienen columna updated_at.
--
-- IDEMPOTENTE: usa DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- SEGURO: no toca datos, no altera columnas.
--
-- Tablas incluidas:
--   properties, property_groups, property_tags, property_tag_links,
--   listings, bookings, expenses, bank_accounts,
--   inventory_items, inventory_maintenance_schedules,
--   recurring_expense_periods, vendors, credit_pools
--
-- Cómo aplicar:
--   1. SQL Editor de Supabase → pega y ejecuta.
--   2. Verificación al final del archivo.
-- ============================================================

-- ─── Helper: crea el trigger si la tabla existe y tiene updated_at ─────────
-- (se usa DO $$ para cada tabla — más legible y seguro que un loop dinámico)

-- 1. properties -------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='properties' and column_name='updated_at') then
    drop trigger if exists trg_properties_updated_at on public.properties;
    create trigger trg_properties_updated_at
      before update on public.properties
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 2. property_groups --------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='property_groups' and column_name='updated_at') then
    drop trigger if exists trg_property_groups_updated_at on public.property_groups;
    create trigger trg_property_groups_updated_at
      before update on public.property_groups
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 3. property_tags ----------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='property_tags' and column_name='updated_at') then
    drop trigger if exists trg_property_tags_updated_at on public.property_tags;
    create trigger trg_property_tags_updated_at
      before update on public.property_tags
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 4. listings ---------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='listings' and column_name='updated_at') then
    drop trigger if exists trg_listings_updated_at on public.listings;
    create trigger trg_listings_updated_at
      before update on public.listings
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 5. bookings ---------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='bookings' and column_name='updated_at') then
    drop trigger if exists trg_bookings_updated_at on public.bookings;
    create trigger trg_bookings_updated_at
      before update on public.bookings
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 6. expenses ---------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='expenses' and column_name='updated_at') then
    drop trigger if exists trg_expenses_updated_at on public.expenses;
    create trigger trg_expenses_updated_at
      before update on public.expenses
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 7. bank_accounts ----------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='bank_accounts' and column_name='updated_at') then
    drop trigger if exists trg_bank_accounts_updated_at on public.bank_accounts;
    create trigger trg_bank_accounts_updated_at
      before update on public.bank_accounts
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 8. inventory_items --------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='inventory_items' and column_name='updated_at') then
    drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
    create trigger trg_inventory_items_updated_at
      before update on public.inventory_items
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 9. inventory_maintenance_schedules ----------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='inventory_maintenance_schedules' and column_name='updated_at') then
    drop trigger if exists trg_maint_schedules_updated_at on public.inventory_maintenance_schedules;
    create trigger trg_maint_schedules_updated_at
      before update on public.inventory_maintenance_schedules
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 10. recurring_expense_periods ---------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='recurring_expense_periods' and column_name='updated_at') then
    drop trigger if exists trg_recurring_periods_updated_at on public.recurring_expense_periods;
    create trigger trg_recurring_periods_updated_at
      before update on public.recurring_expense_periods
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 11. vendors ---------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='vendors' and column_name='updated_at') then
    drop trigger if exists trg_vendors_updated_at on public.vendors;
    create trigger trg_vendors_updated_at
      before update on public.vendors
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 12. credit_pools ----------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='credit_pools' and column_name='updated_at') then
    drop trigger if exists trg_credit_pools_updated_at on public.credit_pools;
    create trigger trg_credit_pools_updated_at
      before update on public.credit_pools
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ============================================================
-- Verificación post-aplicación
-- ============================================================
-- Ejecuta en SQL Editor para confirmar los triggers creados:
--
-- select event_object_table as tabla,
--        trigger_name,
--        action_timing,
--        event_manipulation
-- from information_schema.triggers
-- where trigger_schema = 'public'
--   and trigger_name like 'trg_%_updated_at'
-- order by event_object_table;
--
-- Resultado esperado: ~12 filas (una por tabla que tenga updated_at).
-- Si una tabla no aparece, no tiene columna updated_at → normal.
-- ============================================================
