-- migration_047_inventory_end_of_life.sql
-- ============================================================
-- Estado "cumplió vida útil" para items del inventario
-- ============================================================
-- El campo expected_lifetime_months ya existe (migration_024).
-- Este script agrega 'end_of_life' como valor válido en el
-- CHECK constraint de inventory_items.status.
--
-- IDEMPOTENTE: verifica si el constraint ya fue actualizado.
-- ============================================================

DO $$
BEGIN
  -- Eliminar constraint antiguo y crear uno nuevo que incluye end_of_life
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name LIKE '%inventory_items%status%'
  ) THEN
    ALTER TABLE public.inventory_items
      DROP CONSTRAINT IF EXISTS inventory_items_status_check;
  END IF;

  ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_status_check
    CHECK (status IN ('good', 'needs_maintenance', 'damaged', 'lost', 'depleted', 'end_of_life'));
END $$;

-- ============================================================
-- Verificación:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.inventory_items'::regclass
--   AND contype = 'c';
-- Esperado: status IN (... 'end_of_life')
-- ============================================================
