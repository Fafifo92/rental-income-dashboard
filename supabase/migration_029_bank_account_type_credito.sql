-- migration_029_bank_account_type_credito.sql
-- Amplía el CHECK de account_type para incluir 'crédito'.
-- Con esto, el tipo Crédito reemplaza al antiguo checkbox is_credit.
--
-- Idempotente: recrea la constraint solo si ya existe la versión anterior.

ALTER TABLE public.bank_accounts
  DROP CONSTRAINT IF EXISTS bank_accounts_account_type_check;

ALTER TABLE public.bank_accounts
  ADD CONSTRAINT bank_accounts_account_type_check
  CHECK (account_type IN ('ahorros', 'corriente', 'billetera', 'crédito', 'otro'));

-- Migrar filas antiguas que tenían is_credit=true pero account_type distinto
-- (evita inconsistencias entre el campo viejo y el nuevo tipo).
UPDATE public.bank_accounts
  SET account_type = 'crédito'
  WHERE is_credit = true
    AND (account_type IS NULL OR account_type <> 'crédito');
