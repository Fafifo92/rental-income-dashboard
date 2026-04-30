-- migration_020_bank_account_credit.sql
-- Bloque 4 — Distinción débito vs crédito en cuentas bancarias.
--
-- - is_credit = true  → cuenta de crédito (tarjeta). Permite saldo negativo.
-- - is_credit = false → cuenta de débito (ahorros, corriente, billetera). NO permite
--                       saldo negativo a la hora de registrar gastos pagados.
--
-- Idempotente.

alter table bank_accounts
  add column if not exists is_credit boolean not null default false;

-- Opcional: límite de crédito (para mostrar disponibilidad en cuentas de crédito).
alter table bank_accounts
  add column if not exists credit_limit numeric(14,2);

comment on column bank_accounts.is_credit is
  'TRUE si la cuenta es de crédito (tarjeta) y por tanto admite saldos negativos.';
comment on column bank_accounts.credit_limit is
  'Cupo total de la tarjeta (solo significativo cuando is_credit=true).';
