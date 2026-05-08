-- ============================================================
-- migration_039_audit_log.sql
-- ============================================================
-- PROPÓSITO: Tabla audit_log para trazabilidad de cambios en
--   entidades críticas (properties, expenses, bookings, vendors,
--   inventory_items). Implementa el patrón Append-Only Log.
--
-- DISEÑO:
--   • Una sola tabla genérica (evita proliferación de tablas por
--     entidad y facilita consultas cross-table de auditoría).
--   • old_data / new_data JSONB: snapshot completo antes/después.
--   • Trigger genérico audit_log_trigger() se instala en las
--     tablas críticas.
--   • RLS: owner puede leer sus propios registros; INSERT/UPDATE/
--     DELETE sólo via trigger (SECURITY DEFINER).
--
-- IDEMPOTENTE: usa CREATE TABLE IF NOT EXISTS + DROP/CREATE policy.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TABLA audit_log
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID,                 -- auth.uid() al momento del cambio (NULL en cascade deletes)
  table_name  TEXT NOT NULL,        -- ej: 'expenses', 'properties'
  record_id   UUID NOT NULL,        -- PK del registro afectado
  action      TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  old_data    JSONB,                -- NULL en INSERT
  new_data    JSONB,                -- NULL en DELETE
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta más frecuente
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user         ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at  ON public.audit_log(occurred_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Los usuarios sólo pueden leer sus propios registros de auditoría.
-- Escritura sólo vía trigger (SECURITY DEFINER) — ninguna política INSERT.
DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own" ON public.audit_log
  FOR SELECT USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. FUNCIÓN TRIGGER genérica (SECURITY DEFINER para bypassar RLS)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id UUID;
  v_action    TEXT;
  v_old_data  JSONB;
  v_new_data  JSONB;
BEGIN
  -- Determinar la acción y los datos
  IF TG_OP = 'INSERT' THEN
    v_action    := 'insert';
    v_record_id := NEW.id;
    v_old_data  := NULL;
    v_new_data  := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action    := 'update';
    v_record_id := NEW.id;
    v_old_data  := to_jsonb(OLD);
    v_new_data  := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action    := 'delete';
    v_record_id := OLD.id;
    v_old_data  := to_jsonb(OLD);
    v_new_data  := NULL;
  END IF;

  -- Insertar en audit_log (bypasa RLS por SECURITY DEFINER)
  INSERT INTO public.audit_log (user_id, table_name, record_id, action, old_data, new_data)
  VALUES (auth.uid(), TG_TABLE_NAME, v_record_id, v_action, v_old_data, v_new_data);

  -- Retornar la fila correcta según operación
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_audit_log() IS
  'Trigger genérico para registrar INSERT/UPDATE/DELETE en audit_log.
   Instalado en tablas críticas: properties, expenses, bookings, vendors, inventory_items.';

-- ─────────────────────────────────────────────────────────────
-- 4. INSTALAR TRIGGER en tablas críticas
-- ─────────────────────────────────────────────────────────────

-- properties
DROP TRIGGER IF EXISTS trg_audit_properties ON public.properties;
CREATE TRIGGER trg_audit_properties
  AFTER INSERT OR UPDATE OR DELETE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- expenses
DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- bookings
DROP TRIGGER IF EXISTS trg_audit_bookings ON public.bookings;
CREATE TRIGGER trg_audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- vendors
DROP TRIGGER IF EXISTS trg_audit_vendors ON public.vendors;
CREATE TRIGGER trg_audit_vendors
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- inventory_items
DROP TRIGGER IF EXISTS trg_audit_inventory_items ON public.inventory_items;
CREATE TRIGGER trg_audit_inventory_items
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Confirmar tabla creada:
--    SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_log';
--
-- 2. Confirmar triggers instalados:
--    SELECT trigger_name, event_object_table, event_manipulation
--    FROM information_schema.triggers
--    WHERE trigger_name LIKE 'trg_audit_%'
--    ORDER BY event_object_table;
--
-- 3. Test rápido (en una sesión autenticada):
--    UPDATE properties SET name = name WHERE id = '<un-id>';
--    SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT 1;
-- ============================================================
