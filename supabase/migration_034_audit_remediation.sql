-- migration_034_audit_remediation.sql
-- ============================================================
-- Auditoría → Bloque 1 (mínimo y seguro)
-- ============================================================
-- Cambios incluidos (todos NO destructivos e IDEMPOTENTES):
--
--   1. Índice faltante en bank_accounts.owner_id (D-010 / S-001)
--      Justificación: la RLS hace `auth.uid() = owner_id` en cada query;
--      sin índice, cada SELECT escanea la tabla completa por owner.
--
--   2. Índice de soporte para FK booking_payments.booking_id si falta
--      (FK con ON DELETE CASCADE → conviene índice para el cascade).
--
--   3. Función genérica `set_updated_at()` para triggers futuros.
--      NO se aplica a ninguna tabla en esta migración. La aplicación
--      por tabla se hará en una migración 035 separada y validable.
--
-- NO incluido (a propósito):
--   • FK listings.property_id → ya existe desde schema.sql/setup_completo.sql.
--   • Backfill de expenses.vendor → requiere análisis caso por caso (mig 035+).
--   • CHECK constraints de enums → requieren validar valores existentes primero.
--   • Cambios en triggers / triggers updated_at → mig 035.
--
-- Cómo aplicar (recomendación):
--   1. En Supabase SQL Editor, copia/pega TODO este archivo.
--   2. Ejecuta dentro de una transacción de prueba primero:
--        BEGIN;
--        <pega contenido>
--        -- revisa: select indexname from pg_indexes where tablename='bank_accounts';
--        ROLLBACK;  -- si todo OK, vuelve a correrlo con COMMIT.
--   3. Re-ejecutar es seguro: todo es IF NOT EXISTS.
-- ============================================================

-- 1) Índice por owner_id en bank_accounts -----------------------
create index if not exists idx_bank_accounts_owner_id
  on bank_accounts(owner_id);

-- 2) Índice de soporte para FK booking_payments.booking_id ------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'booking_payments') then
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename  = 'booking_payments'
        and indexdef ilike '%(booking_id%'
    ) then
      execute 'create index idx_booking_payments_booking_id on booking_payments(booking_id)';
    end if;
  end if;
end $$;

-- 3) Función genérica set_updated_at() (sin triggers todavía) ---
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger genérico para actualizar updated_at = now() en BEFORE UPDATE.
   Aplicar por tabla en migration_035 después de validar 034.';

-- ============================================================
-- Verificación post-aplicación (queries de validación)
-- ============================================================
-- Ejecuta esto manualmente para confirmar que todo quedó bien:
--
-- select indexname, indexdef from pg_indexes
--   where schemaname='public'
--     and tablename in ('bank_accounts','booking_payments')
--   order by tablename, indexname;
--
-- select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'set_updated_at';
-- ============================================================
