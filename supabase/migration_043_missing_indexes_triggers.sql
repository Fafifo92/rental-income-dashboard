-- ============================================================
-- migration_043_missing_indexes_triggers.sql
-- ============================================================
-- Crea los índices base y triggers updated_at que estaban en
-- schema_consolidated.sql pero NUNCA fueron aplicados por
-- ninguna migration anterior.
--
-- IDEMPOTENTE: todos los índices usan IF NOT EXISTS.
--   Los triggers usan DROP IF EXISTS + CREATE.
-- SEGURO: no toca datos ni columnas.
--
-- Grupos de trabajo:
--   A. Índices base (propiedades, listings, bookings, expenses,
--      recurring_periods) — definidos en schema_consolidated
--      pero omitidos en mig_034/mig_037.
--   B. Triggers updated_at para property_recurring_expenses y
--      booking_adjustments — omitidos en mig_035.
--   C. Re-aplica mig_035 triggers para garantizar que existen
--      (idempotente via DROP IF EXISTS + CREATE).
-- ============================================================

-- ─── A. Índices base faltantes ───────────────────────────────

-- properties.owner_id (RLS lo usa en cada SELECT)
CREATE INDEX IF NOT EXISTS idx_properties_owner
  ON public.properties(owner_id);

-- listings.property_id (soporte FK + joins frecuentes)
CREATE INDEX IF NOT EXISTS idx_listings_property
  ON public.listings(property_id);

-- bookings.listing_id (single-column base, mig_037 tiene compuesto)
CREATE INDEX IF NOT EXISTS idx_bookings_listing
  ON public.bookings(listing_id);

-- expenses.owner_id (RLS + filtros por owner)
CREATE INDEX IF NOT EXISTS idx_expenses_owner
  ON public.expenses(owner_id);

-- expenses(owner_id, date DESC) — filtros de periodo por usuario
CREATE INDEX IF NOT EXISTS idx_expenses_owner_date
  ON public.expenses(owner_id, date DESC);

-- recurring_expense_periods(recurring_id, year_month DESC)
CREATE INDEX IF NOT EXISTS idx_recurring_periods_rec_month
  ON public.recurring_expense_periods(recurring_id, year_month DESC);

-- ─── B + C. Triggers updated_at (todos idempotentes) ─────────
-- Requiere que public.set_updated_at() exista (creada en mig_034).

-- properties
DROP TRIGGER IF EXISTS trg_properties_updated_at ON public.properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- listings
DROP TRIGGER IF EXISTS trg_listings_updated_at ON public.listings;
CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bookings
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bank_accounts
DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- expenses
DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- vendors
DROP TRIGGER IF EXISTS trg_vendors_updated_at ON public.vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- property_recurring_expenses (faltaba en mig_035)
DROP TRIGGER IF EXISTS trg_recurring_updated_at ON public.property_recurring_expenses;
CREATE TRIGGER trg_recurring_updated_at
  BEFORE UPDATE ON public.property_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- booking_adjustments (faltaba en mig_035)
DROP TRIGGER IF EXISTS trg_booking_adjustments_updated_at ON public.booking_adjustments;
CREATE TRIGGER trg_booking_adjustments_updated_at
  BEFORE UPDATE ON public.booking_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- a) Confirmar índices:
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'idx_properties_owner','idx_listings_property','idx_bookings_listing',
--     'idx_expenses_owner','idx_expenses_owner_date','idx_recurring_periods_rec_month'
--   )
-- ORDER BY indexname;
-- Esperado: 6 filas.
--
-- b) Confirmar triggers:
-- SELECT tgname, c.relname AS tabla
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND tgname LIKE 'trg_%_updated_at'
--   AND NOT tgisinternal
-- ORDER BY c.relname;
-- Esperado: >= 8 filas.
-- ============================================================
