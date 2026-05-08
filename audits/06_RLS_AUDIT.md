# 🛡️ AUDITORÍA EXHAUSTIVA DE RLS Y SEGURIDAD A NIVEL DE BASE DE DATOS

> **Bloque 7.1** del roadmap consolidado.
> Modelo usado: Claude Opus 4.7.
> Fecha: revisión sobre el árbol de migraciones `supabase/migration_001…037` + `schema.sql` + `setup_completo.sql`.
> **Estado global:** ✅ **APROBADO con mejoras menores recomendadas** (ver `migration_038_rls_hardening.sql`).

---

## 1. Resumen ejecutivo

| Categoría | Resultado |
|---|---|
| Tablas en `public` | **26** |
| Tablas con `ENABLE ROW LEVEL SECURITY` | **26 / 26** ✅ |
| Tablas sin política asociada | **0** ✅ |
| Políticas que filtran por `auth.uid()` | **100%** ✅ |
| Políticas `FOR ALL` sin `WITH CHECK` explícito | **8** ⚠️ (Postgres aplica USING como fallback — seguro, pero ambiguo. Migration 038 lo formaliza.) |
| Funciones `SECURITY DEFINER` | 2 (triggers `set_updated_at` y `handle_new_user`); ambas con `SET search_path = public` ✅ |
| Datos accesibles sin auth (anónimos) | **Ninguno** ✅ |

**Conclusión:** la base está segura desde el punto de vista de aislamiento por usuario. No se detectó ningún camino de exfiltración cruzada entre `owner_id` distintos. Las mejoras de `migration_038` son de **endurecimiento defensivo** (defense-in-depth), no remedian un agujero activo.

---

## 2. Inventario de tablas y políticas

| # | Tabla | RLS ON | Política | Filtro de owner | Origen |
|---|-------|:------:|----------|------------------|--------|
| 1 | `profiles` | ✅ | `profiles_own` FOR ALL | `auth.uid() = id` | setup_completo |
| 2 | `properties` | ✅ | `properties_own` FOR ALL | `auth.uid() = owner_id` | setup_completo |
| 3 | `listings` | ✅ | `listings_own` FOR ALL | EXISTS join a `properties.owner_id` | setup_completo |
| 4 | `bookings` | ✅ | `bookings_own` FOR ALL | EXISTS join `listings → properties.owner_id` | setup_completo |
| 5 | `expenses` | ✅ | `expenses_own` FOR ALL | `auth.uid() = owner_id` | mig_001 / setup |
| 6 | `property_recurring_expenses` | ✅ | `recurring_own` FOR ALL | EXISTS `properties.owner_id` | mig_003 |
| 7 | `bank_accounts` | ✅ | `bank_accounts_own` FOR ALL | `auth.uid() = owner_id` | mig_003 |
| 8 | `booking_adjustments` | ✅ | `booking_adjustments_own` FOR ALL | EXISTS `bookings → listings → properties` | mig_006 |
| 9 | `vendors` | ✅ | `vendors_own` FOR ALL | `owner_id = auth.uid()` | mig_008 |
| 10 | `booking_cleanings` | ✅ | `booking_cleanings_own` FOR ALL | EXISTS `bookings → listings → properties` | mig_011 |
| 11 | `recurring_expense_periods` | ✅ | 4 políticas separadas SELECT/INSERT/UPDATE/DELETE | EXISTS `property_recurring_expenses → properties` | mig_012 |
| 12 | `user_notification_settings` | ✅ | 3 políticas SELECT/INSERT/UPDATE | `auth.uid() = user_id` | mig_012 |
| 13 | `vendor_properties` | ✅ | 4 políticas separadas | EXISTS `vendors → owner_id` | mig_013 |
| 14 | `shared_bills` | ✅ | 4 políticas separadas | EXISTS `vendors → owner_id` | mig_013 |
| 15 | `cleaner_groups` | ✅ | `cleaner_groups_owner` FOR ALL | `auth.uid() = owner_id` | mig_022 |
| 16 | `cleaner_group_members` | ✅ | `cleaner_group_members_owner` FOR ALL | EXISTS `cleaner_groups.owner_id` | mig_022 |
| 17 | `inventory_categories` | ✅ | `inv_cat_owner` FOR ALL | `owner_id = auth.uid()` | mig_024 |
| 18 | `inventory_items` | ✅ | `inv_items_owner` FOR ALL | `owner_id = auth.uid()` | mig_024 |
| 19 | `inventory_movements` | ✅ | `inv_mov_owner` FOR ALL | `owner_id = auth.uid()` | mig_024 |
| 20 | `credit_pools` | ✅ | `credit_pools_owner` FOR ALL | `owner_id = auth.uid()` | mig_027 |
| 21 | `credit_pool_consumptions` | ✅ | `credit_pool_consumptions_owner` FOR ALL | EXISTS `credit_pools.owner_id` | mig_027 |
| 22 | `property_groups` | ✅ | `owner_full_property_groups` FOR ALL | `auth.uid() = owner_id` | mig_028 |
| 23 | `property_tags` | ✅ | `owner_full_property_tags` FOR ALL | `auth.uid() = owner_id` | mig_028 |
| 24 | `property_tag_assignments` | ✅ | `owner_full_property_tag_assignments` FOR ALL | EXISTS `property_tags.owner_id` | mig_028 |
| 25 | `booking_payments` | ✅ | `booking_payments_owner` FOR ALL | EXISTS `bookings → listings → properties` | mig_031 |
| 26 | `inventory_maintenance_schedules` | ✅ | `maint_owner` FOR ALL | `owner_id = auth.uid()` | mig_032 |

---

## 3. Hallazgos

### 3.1 ✅ Sin issues críticos
No hay tablas sin RLS, ni políticas que dejen pasar filas ajenas, ni funciones `SECURITY DEFINER` con `search_path` mutable.

### 3.2 ⚠️ Mejoras recomendadas (defense-in-depth)

**H-RLS-01 — `WITH CHECK` implícito en políticas `FOR ALL`**
8 políticas usan `FOR ALL USING (...)` sin un `WITH CHECK` explícito. Postgres reutiliza `USING` como `WITH CHECK`, lo que es seguro pero:
- Es ambiguo al leer.
- En políticas con subconsulta `EXISTS`, el ruteo del optimizador puede diferir mínimamente entre USING y WITH CHECK.

→ **Acción:** `migration_038` añade `WITH CHECK` explícito a cada política `FOR ALL` usando la **misma expresión** del `USING`. No cambia semántica.

**H-RLS-02 — Owner doble check redundante en tablas con join**
`bookings`, `booking_adjustments`, `booking_cleanings`, `booking_payments` filtran owner sólo vía join (3 niveles: booking → listing → property). Si un día se agrega una columna `owner_id` denormalizada (recomendado por performance), el predicado debería usarla y validar tanto `owner_id = auth.uid()` **como** la consistencia del join (vía constraint o trigger). De momento no hay denormalización, así que esto queda como nota de diseño.

**H-RLS-03 — Política UPDATE de `user_notification_settings` sin restricción WITH CHECK**
La política `uns_update_own` solo tiene `USING`, no `WITH CHECK`. Un usuario podría (en teoría) hacer UPDATE de su fila cambiando `user_id` a otro id (la USING valida el viejo, pero no el nuevo). Postgres aplica USING como WITH CHECK por defecto, así que el ataque falla, pero conviene formalizarlo.

→ **Acción:** `migration_038` agrega `WITH CHECK (user_id = auth.uid())`.

**H-RLS-04 — `SECURITY DEFINER` sin `STABLE`/`IMMUTABLE` declarado**
Las funciones de trigger `set_updated_at` y `handle_new_user` no son problema (modifican estado y son trigger-bound), pero conviene revisar **periódicamente** si se introducen funciones nuevas con `SECURITY DEFINER`: cada nueva debe llevar `SET search_path = public, pg_temp` y un comentario justificando por qué necesita el privilegio.

### 3.3 🟢 Notas de auditoría (no requieren acción)

- **`profiles`** se auto-inserta vía trigger `handle_new_user` desde `setup_completo.sql`. Verificado: está conectado al evento `AFTER INSERT ON auth.users`. ✅
- **`auth` schema** no se manipula directamente desde la app, sólo a través de Supabase Auth API. ✅
- **No existen `GRANT`/`REVOKE` manuales** sobre tablas en `public` desde las migraciones — se usan exclusivamente las concesiones por defecto de Supabase (anon/authenticated) + RLS. ✅
- **No existen `VIEW` ni `MATERIALIZED VIEW`** que pudieran saltarse RLS (se confirmó por búsqueda). ✅

---

## 4. Recomendaciones operativas (fuera del SQL)

1. **Habilitar Postgres logs en Supabase** y revisar trimestralmente si aparecen errores de policy violation (señal de intento de bypass).
2. **Antes de cada migración nueva**, ejecutar el snippet de verificación al final de `migration_038`.
3. **Cuando se agregue una tabla nueva**, seguir el checklist:
   - [ ] `ALTER TABLE … ENABLE ROW LEVEL SECURITY;`
   - [ ] Política con filtro directo o transitivo a `auth.uid()`.
   - [ ] Si es `FOR ALL`, añadir tanto `USING` como `WITH CHECK`.
   - [ ] Index sobre la columna del filtro (`owner_id` o FK que llega al `owner_id`).
4. **Service role key** (no la `anon`): nunca debe estar en el cliente. Verificado que `.env` no la incluye en variables `PUBLIC_*` (Astro). ✅

---

## 5. Verificación post-migration_038

Después de aplicar `migration_038_rls_hardening.sql`, ejecutar:

```sql
-- Tablas en public sin RLS
SELECT relname AS tabla
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
-- Esperado: 0 filas

-- Tablas con RLS pero sin políticas
SELECT c.relname AS tabla
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = n.nspname
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND p.policyname IS NULL;
-- Esperado: 0 filas

-- Políticas FOR ALL sin WITH CHECK explícito
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public' AND cmd = 'ALL' AND qual IS NOT NULL AND with_check IS NULL;
-- Esperado: 0 filas tras migration_038
```

---

## 6. Estado del bloque 7

| # | Acción | Estado |
|---|--------|:------:|
| 7.1 | Auditoría exhaustiva de RLS + hardening | ✅ |
| 7.2 | Auditoría de Edge Functions (si existen) | ⏳ pendiente — no se detectaron Edge Functions custom en `supabase/functions/`; revisar al introducirse |
| 7.3 | Tabla `audit_log` para acciones críticas | ⏳ pendiente — diseño separado |
