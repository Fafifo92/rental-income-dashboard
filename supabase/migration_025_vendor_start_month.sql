-- migration_025_vendor_start_month.sql
-- Bloque 17 — Permitir definir desde qué mes empieza un vendor recurrente para
-- que no se generen periodos pendientes de meses anteriores que el usuario no
-- debe pagar (típicamente cuando da de alta el vendor "tarde").
--
-- También agrega 'tax' al check de vendor_kind (Predial / Impuestos), un rubro
-- que el usuario solicitó y que no encajaba en business_service ni admin.
--
-- Idempotente.

alter table vendors
  add column if not exists start_year_month text;

comment on column vendors.start_year_month is
  'Formato YYYY-MM. Si está seteado, NO se generan periodos pendientes anteriores a este mes. Útil cuando el vendor empezó a operar después de la fecha de creación del registro.';

-- Validar formato YYYY-MM (permite NULL)
alter table vendors drop constraint if exists vendors_start_year_month_format;
alter table vendors add constraint vendors_start_year_month_format
  check (start_year_month is null or start_year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Ampliar el check de vendor_kind para incluir 'tax'
alter table vendors drop constraint if exists vendors_kind_check;
-- Por si en algún ambiente el constraint quedó con otro nombre auto-generado:
do $$
declare
  cn text;
begin
  select conname into cn
  from pg_constraint
  where conrelid = 'vendors'::regclass
    and contype  = 'c'
    and pg_get_constraintdef(oid) ilike '%kind%=%';
  if cn is not null then
    execute format('alter table vendors drop constraint %I', cn);
  end if;
end $$;

alter table vendors add constraint vendors_kind_check
  check (kind in ('utility', 'admin', 'business_service', 'maintenance', 'cleaner', 'insurance', 'tax', 'other'));
