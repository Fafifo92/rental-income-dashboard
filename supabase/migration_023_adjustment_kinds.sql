-- migration_023_adjustment_kinds.sql
-- Bloque 3 — Ajustes de reserva: añadir nuevos kinds.
--   • platform_refund  → la plataforma me devuelve dinero (resolution center,
--                        impuestos, reembolso por cancelación). SUMA al neto.
--   • extra_guest_fee  → cobro por huésped adicional (separado de extra_income
--                        genérico para mejor reporting). SUMA al neto.
--
-- Idempotente: drop + recreate del CHECK constraint.

alter table booking_adjustments
  drop constraint if exists booking_adjustments_kind_check;

alter table booking_adjustments
  add constraint booking_adjustments_kind_check
  check (kind in ('extra_income', 'discount', 'damage_charge', 'platform_refund', 'extra_guest_fee'));

comment on column booking_adjustments.kind is
  'Tipo de ajuste: extra_income | discount | damage_charge | platform_refund | extra_guest_fee. Solo flujos de dinero LIGADOS A LA RESERVA. Servicios públicos NO van aquí.';
