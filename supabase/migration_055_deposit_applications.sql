-- migration_055_deposit_applications.sql
-- ============================================================
-- Trazabilidad detallada de los DEPÓSITOS DE SEGURIDAD por reserva.
--
-- Hasta migration_049, una reserva guardaba el ciclo del depósito en
-- columnas planas (security_deposit, deposit_returned_amount,
-- deposit_status, deposit_return_date). Eso solo soportaba:
--   recibido → devuelto / devuelto parcial.
--
-- Esta migración agrega APLICACIONES del depósito a:
--   - daños (applied_to_damage)
--   - excedente convertido a ingreso (surplus_to_income)
--   - devoluciones al huésped (returned_to_guest)  ← fuente de verdad nueva
--
-- Además, la "cuenta Depósitos de huéspedes" del UI es un LEDGER VIRTUAL
-- (no es un bank_account real). El dinero real sigue viviendo en la cuenta
-- bancaria escogida en bookings.deposit_bank_account_id; esta tabla solo
-- da trazabilidad sin afectar P&L del negocio.
--
-- IDEMPOTENTE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.booking_deposit_applications (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id    UUID          NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  expense_id    UUID          REFERENCES public.expenses(id) ON DELETE SET NULL,
  kind          TEXT          NOT NULL
                  CHECK (kind IN ('applied_to_damage','surplus_to_income','returned_to_guest')),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  applied_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bda_owner   ON public.booking_deposit_applications(owner_id);
CREATE INDEX IF NOT EXISTS idx_bda_booking ON public.booking_deposit_applications(booking_id);
CREATE INDEX IF NOT EXISTS idx_bda_expense ON public.booking_deposit_applications(expense_id);
CREATE INDEX IF NOT EXISTS idx_bda_kind    ON public.booking_deposit_applications(kind);

ALTER TABLE public.booking_deposit_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bda_owner ON public.booking_deposit_applications;
CREATE POLICY bda_owner ON public.booking_deposit_applications
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- Ampliar CHECK de bookings.deposit_status para incluir
--   'applied_to_damage' y 'mixed'.
-- El estado debe terminar siendo DERIVADO de la tabla nueva,
-- pero por compatibilidad con el código existente lo seguimos
-- escribiendo en la columna (vía servicio / trigger).
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'bookings'
      AND constraint_name   = 'chk_bookings_deposit_status'
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT chk_bookings_deposit_status;
  END IF;

  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_deposit_status
    CHECK (deposit_status IN (
      'none','received','partial_return','returned','applied_to_damage','mixed'
    ));
END;
$$;

-- ============================================================
-- Backfill: por cada booking con deposit_returned_amount > 0
-- crear la fila equivalente 'returned_to_guest' (si aún no existe).
-- ============================================================
INSERT INTO public.booking_deposit_applications
  (owner_id, booking_id, kind, amount, applied_date, notes)
SELECT
  p.owner_id,
  b.id,
  'returned_to_guest',
  b.deposit_returned_amount,
  COALESCE(b.deposit_return_date, b.end_date, CURRENT_DATE),
  'Backfill migration_055 desde columnas legacy'
FROM public.bookings b
JOIN public.listings  l ON l.id = b.listing_id
JOIN public.properties p ON p.id = l.property_id
LEFT JOIN public.booking_deposit_applications existing
  ON existing.booking_id = b.id
 AND existing.kind       = 'returned_to_guest'
WHERE b.deposit_returned_amount IS NOT NULL
  AND b.deposit_returned_amount > 0
  AND existing.id IS NULL;

-- ============================================================
-- Función helper para recalcular el deposit_status agregado de
-- una reserva en función de las filas en booking_deposit_applications.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_booking_deposit_status(p_booking_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_security        NUMERIC;
  v_returned        NUMERIC;
  v_applied         NUMERIC;
  v_surplus         NUMERIC;
  v_new_status      TEXT;
  v_last_return_dt  DATE;
BEGIN
  SELECT COALESCE(security_deposit, 0)
    INTO v_security
    FROM public.bookings WHERE id = p_booking_id;

  IF v_security IS NULL OR v_security <= 0 THEN
    UPDATE public.bookings
       SET deposit_status          = 'none',
           deposit_returned_amount = NULL,
           deposit_return_date     = NULL
     WHERE id = p_booking_id;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN kind = 'returned_to_guest'  THEN amount END), 0),
    COALESCE(SUM(CASE WHEN kind = 'applied_to_damage'  THEN amount END), 0),
    COALESCE(SUM(CASE WHEN kind = 'surplus_to_income'  THEN amount END), 0),
    MAX(CASE WHEN kind = 'returned_to_guest' THEN applied_date END)
    INTO v_returned, v_applied, v_surplus, v_last_return_dt
  FROM public.booking_deposit_applications
  WHERE booking_id = p_booking_id;

  IF v_returned = 0 AND v_applied = 0 AND v_surplus = 0 THEN
    v_new_status := 'received';
  ELSIF (v_returned + v_applied + v_surplus) >= v_security THEN
    v_new_status := 'returned';   -- "cerrado": nada queda retenido al huésped
  ELSIF v_returned > 0 AND v_applied > 0 THEN
    v_new_status := 'mixed';
  ELSIF v_applied > 0 THEN
    v_new_status := 'applied_to_damage';
  ELSIF v_returned > 0 THEN
    v_new_status := 'partial_return';
  ELSE
    -- solo surplus, sin daño ni devolución: tratarlo como returned (cerrado)
    v_new_status := 'returned';
  END IF;

  UPDATE public.bookings
     SET deposit_status          = v_new_status,
         deposit_returned_amount = CASE WHEN v_returned > 0 THEN v_returned ELSE NULL END,
         deposit_return_date     = v_last_return_dt
   WHERE id = p_booking_id;
END;
$$;

-- ============================================================
-- Trigger: cuando se inserta/actualiza/elimina una aplicación,
-- recalcular el estado agregado de la reserva.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_bda_after_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_booking_deposit_status(OLD.booking_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_booking_deposit_status(NEW.booking_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS bda_recompute ON public.booking_deposit_applications;
CREATE TRIGGER bda_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.booking_deposit_applications
FOR EACH ROW EXECUTE FUNCTION public.trg_bda_after_change();

-- Recalcular para todas las reservas con depósito tras el backfill.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.bookings
    WHERE security_deposit IS NOT NULL AND security_deposit > 0
  LOOP
    PERFORM public.recompute_booking_deposit_status(r.id);
  END LOOP;
END;
$$;

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- SELECT COUNT(*) FROM public.booking_deposit_applications;
-- SELECT deposit_status, COUNT(*) FROM public.bookings GROUP BY 1;
-- ============================================================
