-- migration_018_property_rnt.sql
-- Bloque 1 — Añade el campo RNT (Registro Nacional de Turismo) a propiedades.
-- Idempotente.

alter table properties
  add column if not exists rnt text;

comment on column properties.rnt is
  'Registro Nacional de Turismo (Colombia). Identificador legal de la propiedad turística.';
