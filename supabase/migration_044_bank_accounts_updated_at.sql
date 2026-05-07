-- ============================================================
-- migration_044_bank_accounts_updated_at.sql
-- ============================================================
-- La tabla bank_accounts no tiene columna updated_at en prod,
-- por eso el trigger lanza:
--   "record new has no field updated_at"
-- Esta migración la agrega de forma idempotente y re-crea el
-- trigger para garantizar que funcione.
-- Idempotente — seguro re-ejecutar.
-- ============================================================

-- 1. Agregar columna si no existe
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Poblar retroactivamente (filas existentes quedan con now())
-- No es crítico — las actualizaciones futuras lo poblarán correctamente.

-- 3. Re-crear trigger (DROP + CREATE garantiza que use la función correcta)
DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Verificar
SELECT
  'bank_accounts.updated_at' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  CASE WHEN COUNT(*) > 0
       THEN 'Columna updated_at presente + trigger activo'
       ELSE 'Columna updated_at NO encontrada'
  END AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'bank_accounts'
  AND column_name  = 'updated_at';
