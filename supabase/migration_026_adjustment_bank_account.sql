-- migration_026_adjustment_bank_account.sql
-- Bloque 18 — Permitir asociar un booking_adjustment a la cuenta bancaria
-- donde efectivamente cayó la plata (típicamente recuperaciones por daños:
-- Airbnb consigna $X a una cuenta puntual, distinta del payout normal).
--
-- Sin esto, el saldo de la cuenta no refleja ese ingreso y queda dinero
-- "volando" sin reflejarse en el balance.
--
-- Idempotente.

alter table booking_adjustments
  add column if not exists bank_account_id uuid references bank_accounts(id) on delete set null;

comment on column booking_adjustments.bank_account_id is
  'Cuenta bancaria donde se acreditó este ajuste (cuando aplica). Ej: damage_charge cobrado por la plataforma cae a una cuenta específica.';

create index if not exists idx_booking_adjustments_bank_account_id
  on booking_adjustments (bank_account_id) where bank_account_id is not null;
