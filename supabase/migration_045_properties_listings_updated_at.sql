-- migration_045_properties_listings_updated_at.sql
-- ============================================================
-- Fix: "record 'new' has no field 'updated_at'"
-- ============================================================
-- migration_043 created trg_properties_updated_at and
-- trg_listings_updated_at unconditionally, but neither table
-- had the updated_at column yet.  Add it now.
--
-- IDEMPOTENTE: uses ADD COLUMN IF NOT EXISTS.
-- SEGURO: no altera datos ni políticas existentes.
-- ============================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- Verificación:
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('properties','listings')
--   AND column_name = 'updated_at';
-- Esperado: 2 filas.
-- ============================================================
