-- migration_046_account_deposits.sql
-- ============================================================
-- Depósitos manuales a cuentas bancarias
-- ============================================================
-- Permite registrar entradas de dinero a una cuenta que NO
-- forman parte de la contabilidad de rentas cortas (ej: ahorro
-- personal, transferencia desde otra cuenta propia, etc.).
-- El saldo de la cuenta = opening_balance + inflows - outflows
--                         + sum(account_deposits.amount)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_deposits (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id    UUID         NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  deposit_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acc_dep_owner   ON public.account_deposits(owner_id);
CREATE INDEX IF NOT EXISTS idx_acc_dep_account ON public.account_deposits(account_id);

ALTER TABLE public.account_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acc_dep_owner ON public.account_deposits;
CREATE POLICY acc_dep_owner ON public.account_deposits
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- Verificación:
-- SELECT id, account_id, amount, deposit_date, notes
-- FROM public.account_deposits
-- WHERE owner_id = auth.uid();
-- ============================================================
