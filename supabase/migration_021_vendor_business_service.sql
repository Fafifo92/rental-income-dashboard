-- migration_021_vendor_business_service.sql
-- Bloque 12 — Aclaración semántica:
--   'utility'          → Servicios públicos (luz/agua/gas/internet)
--   'admin'            → Administración (contador, asesor legal, impuestos)
--   'business_service' → Servicios del negocio (Cámara de Comercio, SaaS de
--                        administración de rentas, marketing, etc.)
--
-- Idempotente.

alter table vendors
  drop constraint if exists vendors_kind_check;

alter table vendors
  add constraint vendors_kind_check
  check (kind in ('utility','admin','business_service','maintenance','cleaner','insurance','other'));
