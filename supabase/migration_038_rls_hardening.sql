-- migration_038_rls_hardening.sql
-- ============================================================
-- Endurecimiento de políticas RLS (defense-in-depth)
-- ============================================================
-- PROPÓSITO:
--   • Añadir WITH CHECK explícito a políticas FOR ALL que sólo
--     tenían USING (Postgres lo deduce, pero formalizarlo evita
--     ambigüedades y prepara el terreno para futuras migraciones).
--   • Añadir WITH CHECK a la política UPDATE de
--     user_notification_settings (H-RLS-03).
--
-- IDEMPOTENTE: cada política se DROP IF EXISTS + CREATE.
-- NO CAMBIA SEMÁNTICA: las expresiones USING/WITH CHECK son
-- idénticas a las que ya estaban implícitas.
--
-- Ver auditoría completa en: audits/06_RLS_AUDIT.md
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. profiles
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_own" ON public.profiles;
CREATE POLICY "profiles_own" ON public.profiles
  FOR ALL
  USING      (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ──────────────────────────────────────────────────────────
-- 2. properties
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "properties_own" ON public.properties;
DROP POLICY IF EXISTS "Owners can manage own properties" ON public.properties;
CREATE POLICY "properties_own" ON public.properties
  FOR ALL
  USING      (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────
-- 3. expenses
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "expenses_own" ON public.expenses;
DROP POLICY IF EXISTS "Users manage own expenses" ON public.expenses;
CREATE POLICY "expenses_own" ON public.expenses
  FOR ALL
  USING      (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────
-- 4. listings
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "listings_own" ON public.listings;
DROP POLICY IF EXISTS "Access listings by property" ON public.listings;
CREATE POLICY "listings_own" ON public.listings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = listings.property_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = listings.property_id AND p.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 5. bookings
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bookings_own" ON public.bookings;
DROP POLICY IF EXISTS "Access bookings by listing" ON public.bookings;
CREATE POLICY "bookings_own" ON public.bookings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = bookings.listing_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.listings l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = bookings.listing_id AND p.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 6. property_recurring_expenses
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "recurring_own" ON public.property_recurring_expenses;
CREATE POLICY "recurring_own" ON public.property_recurring_expenses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_recurring_expenses.property_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_recurring_expenses.property_id AND p.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 7. bank_accounts
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bank_accounts_own" ON public.bank_accounts;
CREATE POLICY "bank_accounts_own" ON public.bank_accounts
  FOR ALL
  USING      (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────
-- 8. booking_adjustments
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "booking_adjustments_own" ON public.booking_adjustments;
CREATE POLICY "booking_adjustments_own" ON public.booking_adjustments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE b.id = booking_adjustments.booking_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE b.id = booking_adjustments.booking_id AND p.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 9. vendors
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "vendors_own" ON public.vendors;
CREATE POLICY "vendors_own" ON public.vendors
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 10. booking_cleanings
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "booking_cleanings_own" ON public.booking_cleanings;
CREATE POLICY "booking_cleanings_own" ON public.booking_cleanings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE b.id = booking_cleanings.booking_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE b.id = booking_cleanings.booking_id AND p.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 11. user_notification_settings  (H-RLS-03: añade WITH CHECK al UPDATE)
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "uns_update_own" ON public.user_notification_settings;
CREATE POLICY "uns_update_own" ON public.user_notification_settings
  FOR UPDATE
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- (las políticas SELECT/INSERT ya están bien — INSERT lleva WITH CHECK por definición)

-- ──────────────────────────────────────────────────────────
-- 12. cleaner_groups
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cleaner_groups_owner" ON public.cleaner_groups;
CREATE POLICY "cleaner_groups_owner" ON public.cleaner_groups
  FOR ALL
  USING      (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────
-- 13. cleaner_group_members
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cleaner_group_members_owner" ON public.cleaner_group_members;
CREATE POLICY "cleaner_group_members_owner" ON public.cleaner_group_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaner_groups g
      WHERE g.id = cleaner_group_members.group_id AND g.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cleaner_groups g
      WHERE g.id = cleaner_group_members.group_id AND g.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 14. inventory_categories
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inv_cat_owner" ON public.inventory_categories;
CREATE POLICY "inv_cat_owner" ON public.inventory_categories
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 15. inventory_items
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inv_items_owner" ON public.inventory_items;
CREATE POLICY "inv_items_owner" ON public.inventory_items
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 16. inventory_movements
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inv_mov_owner" ON public.inventory_movements;
CREATE POLICY "inv_mov_owner" ON public.inventory_movements
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 17. credit_pools
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "credit_pools_owner" ON public.credit_pools;
CREATE POLICY "credit_pools_owner" ON public.credit_pools
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 18. credit_pool_consumptions
-- NOTA: FK a credit_pools se llama pool_id (no credit_pool_id).
--       Además la tabla tiene su propio owner_id, así que
--       filtramos directo (más eficiente que el EXISTS join).
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "credit_pool_consumptions_owner" ON public.credit_pool_consumptions;
CREATE POLICY "credit_pool_consumptions_owner" ON public.credit_pool_consumptions
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 19. property_groups
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_full_property_groups" ON public.property_groups;
CREATE POLICY "owner_full_property_groups" ON public.property_groups
  FOR ALL
  USING      (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────
-- 20. property_tags
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_full_property_tags" ON public.property_tags;
CREATE POLICY "owner_full_property_tags" ON public.property_tags
  FOR ALL
  USING      (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────
-- 21. property_tag_assignments
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_full_property_tag_assignments" ON public.property_tag_assignments;
CREATE POLICY "owner_full_property_tag_assignments" ON public.property_tag_assignments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.property_tags t
      WHERE t.id = property_tag_assignments.tag_id AND t.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.property_tags t
      WHERE t.id = property_tag_assignments.tag_id AND t.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 22. booking_payments
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "booking_payments_owner" ON public.booking_payments;
CREATE POLICY "booking_payments_owner" ON public.booking_payments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE b.id = booking_payments.booking_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.properties p ON p.id = l.property_id
      WHERE b.id = booking_payments.booking_id AND p.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 23. inventory_maintenance_schedules
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "maint_owner" ON public.inventory_maintenance_schedules;
CREATE POLICY "maint_owner" ON public.inventory_maintenance_schedules
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- Ejecutar estas queries por separado para confirmar el resultado:
--
-- a) Tablas en public sin RLS (esperado: 0 filas)
-- SELECT relname FROM pg_class c
-- JOIN pg_namespace n ON n.oid=c.relnamespace
-- WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
--
-- b) Tablas con RLS pero sin políticas (esperado: 0 filas)
-- SELECT c.relname FROM pg_class c
-- JOIN pg_namespace n ON n.oid=c.relnamespace
-- LEFT JOIN pg_policies p ON p.tablename=c.relname AND p.schemaname=n.nspname
-- WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND p.policyname IS NULL;
--
-- c) Políticas FOR ALL sin WITH CHECK explícito (esperado: 0 filas)
-- SELECT schemaname, tablename, policyname FROM pg_policies
-- WHERE schemaname='public' AND cmd='ALL' AND qual IS NOT NULL AND with_check IS NULL;
-- ============================================================
