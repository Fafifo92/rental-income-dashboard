-- migration_056_account_approval.sql
-- ============================================================
-- Flujo de aprobación de cuentas por administrador.
--
-- Antes: cualquier signup creaba un profile inmediatamente operativo.
-- Después: nuevos usuarios entran en 'pending' y no pueden iniciar
-- sesión hasta que un admin los apruebe. El admin puede también
-- suspender o eliminar cuentas.
--
-- IDEMPOTENTE.
-- ============================================================

-- 1) Columnas nuevas en profiles ────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending','approved','suspended')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- 2) Backfill: cuentas existentes + bootstrap admin ─────────────
-- Marca TODAS las cuentas pre-existentes como aprobadas (no queremos
-- bloquear a nadie que ya estaba operando).
UPDATE public.profiles
   SET status      = 'approved',
       approved_at = COALESCE(approved_at, now())
 WHERE status = 'pending';

-- Eleva a admin la cuenta dueña del sistema.
UPDATE public.profiles
   SET role = 'admin'
 WHERE email = 'franconuezm@gmail.com';

-- 3) Trigger handle_new_user reescrito ──────────────────────────
-- El admin de bootstrap (franconuezm@gmail.com) entra ya aprobado y
-- con rol admin, por si se re-crea. Cualquier otro signup entra como
-- 'owner' pendiente de aprobación.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  is_bootstrap_admin BOOLEAN := (NEW.email = 'franconuezm@gmail.com');
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    CASE WHEN is_bootstrap_admin THEN 'admin' ELSE 'owner' END,
    CASE WHEN is_bootstrap_admin THEN 'approved' ELSE 'pending' END,
    CASE WHEN is_bootstrap_admin THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 4) RLS: el admin puede leer y actualizar todos los profiles ───
-- Usamos SECURITY DEFINER para evitar recursión infinita: la función
-- corre como postgres (sin RLS) al ser evaluada dentro de una policy.
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- 5) RPC: admin cambia el status de una cuenta ──────────────────
CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  target_id  UUID,
  new_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not admin';
  END IF;

  IF new_status NOT IN ('pending','approved','suspended') THEN
    RAISE EXCEPTION 'invalid status: %', new_status;
  END IF;

  UPDATE public.profiles
     SET status      = new_status,
         approved_at = CASE WHEN new_status = 'approved' THEN now()        ELSE approved_at END,
         approved_by = CASE WHEN new_status = 'approved' THEN auth.uid()   ELSE approved_by END
   WHERE id = target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_account_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(UUID, TEXT) TO authenticated;

-- 6) RPC: admin elimina cuenta completa (cascada borra todo) ────
-- Borra de auth.users (lo que cascadea a profiles y a todas las
-- tablas con FK ON DELETE CASCADE a auth.users(id)).
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not admin';
  END IF;

  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'admin cannot delete itself';
  END IF;

  DELETE FROM auth.users WHERE id = target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
