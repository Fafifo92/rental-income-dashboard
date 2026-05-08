# Naming Convention Audit — Bloque 6.6

> **Estado:** Inventario documentado. No se aplican renombres en producción sin staging.
> **Propósito:** Detectar inconsistencias de naming en tablas, columnas y código para decidir qué normalizar.

---

## 1. Tablas DB — Estado actual

| Tabla | Convención usada | Problema | Recomendación |
|-------|:----------------:|----------|---------------|
| `profiles` | ✅ snake_case plural | — | OK |
| `properties` | ✅ | — | OK |
| `property_groups` | ✅ | — | OK |
| `property_tags` | ✅ | — | OK |
| `property_tag_assignments` | ✅ | — | OK |
| `listings` | ✅ | — | OK |
| `bookings` | ✅ | — | OK |
| `bank_accounts` | ✅ | — | OK |
| `expenses` | ✅ | — | OK |
| `property_recurring_expenses` | ⚠️ | Nombre largo; "property_" prefijo redundante si se consolida a `vendors` | Renombrar a `recurring_expenses` en Bloque 6.5 |
| `recurring_expense_periods` | ⚠️ | Inconsistente con tabla padre (no tiene el prefijo `property_`) | Aceptable — no cambiar |
| `vendors` | ✅ | — | OK |
| `vendor_properties` | ✅ | — | OK |
| `shared_bills` | ✅ | — | OK |
| `booking_adjustments` | ✅ | — | OK |
| `booking_cleanings` | ✅ | — | OK |
| `booking_payments` | ✅ | — | OK |
| `cleaner_groups` | ✅ | — | OK |
| `cleaner_group_members` | ✅ | — | OK |
| `credit_pools` | ✅ | — | OK |
| `credit_pool_consumptions` | ✅ | — | OK |
| `inventory_categories` | ✅ | — | OK |
| `inventory_items` | ✅ | — | OK |
| `inventory_movements` | ✅ | — | OK |
| `inventory_maintenance_schedules` | ⚠️ | Nombre largo (35 chars) | Aceptar — ya está en código y migraciones |
| `user_notification_settings` | ✅ | — | OK |
| `audit_log` | ✅ | — | OK |

**Resumen DB:** 3 tablas con naming subóptimo, ninguna crítica. Renombrar sólo en Bloque 6.5 (fase D).

---

## 2. Columnas — Inconsistencias detectadas

| Tabla | Columna problemática | Problema | Recomendación |
|-------|---------------------|----------|---------------|
| `expenses` | `vendor TEXT` | Nombre idéntico a FK table; ambiguo | Renombrar a `vendor_name_legacy` o DROP en migration futura |
| `property_recurring_expenses` | `vendor TEXT` | Ídem | Mismo tratamiento |
| `bank_accounts` | `account_type` | Valores en español (`'ahorros'`, `'crédito'`) vs inglés de otras columnas | Normalizar a inglés en migración futura |
| `bank_accounts` | `opening_balance` vs `balance` | Dos conceptos mezclados en tipos TypeScript | Clarificar semántica |
| `bookings` | `channel` vs `listing.source` | Duplican el mismo dato con distintos nombres | Consolidar en `source` o `platform` |
| `properties` | `rnt` | Nombre colombiano no auto-explicativo para otros devs | Añadir `COMMENT ON COLUMN` (ya en schema_consolidated) |

---

## 3. Código TypeScript — Inconsistencias

| Archivo | Símbolo | Problema |
|---------|---------|----------|
| `src/types/database.ts` | `PropertyRow.rnt` | Mismatch con DB donde la columna es `rnt_number` (mig_018) |
| `src/types/database.ts` | `BankAccountRow.account_type` | Valores en español mezclados con los del CHECK constraint |
| `src/services/expenses.ts` | `ExpenseFilters.vendor` | Filtra por columna legacy TEXT; debería filtrar por `vendor_id` |
| `src/components/features/` | Carpetas en inglés pero texto UI en español | OK — convención correcta (código en inglés, UI en español) |

---

## 4. Política de naming (para nuevas entidades)

- **Tablas:** `snake_case`, plural, sin prefijos de dominio salvo colisión (ej: `booking_payments` sí, `property_properties` no).
- **Columnas:** `snake_case`. PKs siempre `id UUID`. FKs: `{tabla_singular}_id` (ej: `vendor_id`, `booking_id`).
- **Columnas de tiempo:** `created_at` (inmutable), `updated_at` (mutable vía trigger).
- **Flags booleanos:** `is_*` (ej: `is_credit`, `is_cash`, `is_shared`).
- **TypeScript types:** `PascalCase`. Interfaces de Row: `{Entidad}Row`. Tipos de enum como `type X = 'a' | 'b'` (no `enum`).
- **Servicios:** `src/services/{entidad}.ts` (singular). Funciones: `get{Entidades}`, `create{Entidad}`, `update{Entidad}`, `delete{Entidad}`.
- **Hooks:** `src/lib/hooks/use{Entidades}.ts`. PascalCase de entidad, camelCase del hook.
- **Componentes:** `PascalCase.tsx`. Features en `src/components/features/{feature}/`.

---

## 5. Acciones pendientes (priorizadas)

| # | Acción | Riesgo | Cuándo |
|---|--------|:------:|--------|
| N-01 | Renombrar `expenses.vendor TEXT` → `vendor_name_legacy` | 🔴 | Sólo cuando frontend deje de leerla |
| N-02 | Normalizar `bank_accounts.account_type` values a inglés | 🟡 | Próximo sprint con staging |
| N-03 | Unificar `bookings.channel` y `listings.source` | 🟡 | Bloque 6.5 |
| N-04 | Corregir `PropertyRow.rnt` → `rnt_number` en TypeScript | 🟢 | Inmediato (ver §6) |
| N-05 | Añadir `COMMENT ON COLUMN` a columnas técnicas en DB | 🟢 | Siguiente migración |

---

## 6. Fix inmediato — `PropertyRow.rnt` → `rnt_number`

Verificar si la columna real en Supabase es `rnt` o `rnt_number` y ajustar `database.ts` en consecuencia.

```sql
-- Verificar:
SELECT column_name FROM information_schema.columns
WHERE table_name = 'properties' AND column_name IN ('rnt', 'rnt_number');
```

Si la columna es `rnt_number`, actualizar `PropertyRow` en `database.ts`:
```ts
// antes
rnt: string | null;
// después
rnt_number: string | null;
```
