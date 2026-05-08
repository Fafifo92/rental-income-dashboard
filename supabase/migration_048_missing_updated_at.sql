-- migration_048_missing_updated_at.sql
-- ============================================================
-- Fix: "record 'new' has no field 'updated_at'"
-- ============================================================
-- Root cause: migration_043 created updated_at triggers
-- UNCONDITIONALLY on tables that were originally created WITHOUT
-- the updated_at column (bookings, expenses, vendors,
-- property_recurring_expenses, booking_adjustments).
-- Also covers tables with guards in mig_035 that never got the
-- column, and tables that may have a trigger from schema_consolidated.
--
-- This migration:
--   1. Adds updated_at column (IF NOT EXISTS) to every affected table.
--   2. Re-creates the trigger so it is guaranteed present & correct.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + DROP/CREATE trigger.
-- SEGURO: no altera datos ni políticas existentes.
--
-- Tablas cubiertas:
--   bookings, expenses, vendors, property_recurring_expenses,
--   booking_adjustments, booking_cleanings, booking_payments,
--   credit_pools, property_groups, property_tags
-- ============================================================

-- ─── 1. bookings ─────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. expenses ─────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. vendors ──────────────────────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON public.vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. property_recurring_expenses ──────────────────────────
ALTER TABLE public.property_recurring_expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_recurring_updated_at ON public.property_recurring_expenses;
CREATE TRIGGER trg_recurring_updated_at
  BEFORE UPDATE ON public.property_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. booking_adjustments ──────────────────────────────────
ALTER TABLE public.booking_adjustments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_booking_adjustments_updated_at ON public.booking_adjustments;
CREATE TRIGGER trg_booking_adjustments_updated_at
  BEFORE UPDATE ON public.booking_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. booking_cleanings ─────────────────────────────────────
ALTER TABLE public.booking_cleanings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_booking_cleanings_updated_at ON public.booking_cleanings;
CREATE TRIGGER trg_booking_cleanings_updated_at
  BEFORE UPDATE ON public.booking_cleanings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 7. booking_payments ─────────────────────────────────────
ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_booking_payments_updated_at ON public.booking_payments;
CREATE TRIGGER trg_booking_payments_updated_at
  BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 8. credit_pools ─────────────────────────────────────────
ALTER TABLE public.credit_pools
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_credit_pools_updated_at ON public.credit_pools;
CREATE TRIGGER trg_credit_pools_updated_at
  BEFORE UPDATE ON public.credit_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 9. property_groups ──────────────────────────────────────
ALTER TABLE public.property_groups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_property_groups_updated_at ON public.property_groups;
CREATE TRIGGER trg_property_groups_updated_at
  BEFORE UPDATE ON public.property_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 10. property_tags ───────────────────────────────────────
ALTER TABLE public.property_tags
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_property_tags_updated_at ON public.property_tags;
CREATE TRIGGER trg_property_tags_updated_at
  BEFORE UPDATE ON public.property_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- Confirmar columnas agregadas:
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'updated_at'
--   AND table_name IN (
--     'bookings','expenses','vendors','property_recurring_expenses',
--     'booking_adjustments','booking_cleanings','booking_payments',
--     'credit_pools','property_groups','property_tags'
--   )
-- ORDER BY table_name;
-- Esperado: 10 filas.
--
-- Confirmar triggers activos:
-- SELECT c.relname AS tabla, t.tgname
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND t.tgname LIKE 'trg_%_updated_at'
--   AND NOT t.tgisinternal
-- ORDER BY c.relname;
-- ============================================================
