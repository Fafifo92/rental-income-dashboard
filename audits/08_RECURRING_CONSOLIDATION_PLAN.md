# 🗄️ Bloque 6.5 — Plan de consolidación `property_recurring_expenses` → `vendors`

> **Estado:** Diseño aprobado en papel. NO ejecutar sin staging y backup.
> **Riesgo:** 🔴 Alto — toca datos productivos críticos (recurrentes mensuales, periodos pagados).

## 1. Diagnóstico actual

Hoy conviven **dos modelos paralelos** para representar gastos recurrentes:

| Modelo                                        | Uso real                                                                 |
|-----------------------------------------------|--------------------------------------------------------------------------|
| `property_recurring_expenses` (legacy)        | Una fila por (propiedad, rubro). Tiene `valid_from/valid_to` (SCD-2).    |
| `vendors` + `vendor_properties` + `shared_bills` (nuevo) | Un vendor cubre N propiedades; una factura mensual se reparte. |

**Problema:**
- El usuario tiene que decidir caso a caso cuál usar.
- `property_recurring_expenses.vendor_id` (mig_008) y `is_shared` (mig_013) ya intentan unirlos pero la fuente de verdad sigue siendo legacy.
- Dos pantallas distintas, dos lógicas de "pendientes del mes".

## 2. Estado objetivo

```
vendors (con campo recurrente: day_of_month, default_amount, start_year_month)
   ├── vendor_properties (1-N: a qué propiedades aplica)
   ├── shared_bills      (factura mensual real, una por (vendor, year_month))
   └── recurring_expense_periods (heredado, ahora apuntando a un vendor + periodo)
```

`property_recurring_expenses` → **vista legacy de solo lectura** o tabla congelada hasta retiro completo.

## 3. Estrategia de migración (4 fases)

### Fase A — Auditoría de datos (NO destructiva, días)

```sql
-- Cuántos recurrentes activos hay sin vendor_id
SELECT COUNT(*) FROM property_recurring_expenses
WHERE valid_to IS NULL AND vendor_id IS NULL;

-- Solapamientos sospechosos: mismo vendor cubre la misma propiedad ya en vendor_properties
SELECT pre.id, pre.property_id, pre.vendor_id, vp.id AS vp_id
FROM property_recurring_expenses pre
JOIN vendor_properties vp ON vp.vendor_id = pre.vendor_id AND vp.property_id = pre.property_id
WHERE pre.valid_to IS NULL;

-- Recurrentes con periodos pagados que apuntan al modelo legacy
SELECT COUNT(*) FROM recurring_expense_periods rep
JOIN property_recurring_expenses pre ON pre.id = rep.recurring_id
WHERE pre.vendor_id IS NULL;
```

### Fase B — Backfill (migration_0XX)

1. Para cada `property_recurring_expenses` activo (`valid_to IS NULL`) sin `vendor_id`:
   - Crear vendor con `kind='other'` (o mapear por categoría: `utility|admin|maintenance|insurance`).
   - Setear `vendor.day_of_month`, `default_amount`, `start_year_month` desde el legacy.
   - Insertar `vendor_properties (vendor_id, property_id)` con `share_percent = 100`.
   - Setear `pre.vendor_id`.

2. Migración paso a paso (idempotente, una propiedad/categoría a la vez en transacción).

### Fase C — Doble lectura en código (semanas)

- Servicios `getRecurringExpenses(...)` leen de `vendors` cuando exista, sino caen al legacy.
- UI muestra una sola lista unificada.
- Bandera de feature flag para apagar el legacy en staging primero.

### Fase D — Retiro (migration_0XX posterior)

- Cuando 0 lecturas legacy en logs (1 mes mínimo) → DROP de columnas/tabla legacy.
- Mantener `recurring_expense_periods` apuntando ahora a `vendor_id` (rename FK + view).

## 4. Riesgos identificados

| Riesgo                                                      | Mitigación                                                  |
|-------------------------------------------------------------|-------------------------------------------------------------|
| Pérdida de historia SCD-2 (`valid_from/valid_to`)           | Conservar tabla legacy archivada (`_legacy_recurring`)      |
| Periodos pagados duplicados al cambiar FK                   | Migrar `recurring_expense_periods.recurring_id` → `vendor_id` con tabla puente temporal |
| Reportes financieros que joinean por `pre.id`               | Crear vista `v_recurring_unified` durante la transición     |
| `is_shared = true` + `vendor_properties` solapan            | Detectar y consolidar antes del backfill                    |

## 5. Checklist (no ejecutar aún)

- [ ] Backup `pg_dump` y staging fresco.
- [ ] Correr queries de Fase A y guardar resultados como CSV.
- [ ] Diseñar mapeo `category → vendor.kind` (admin / utility / insurance / maintenance / other).
- [ ] Escribir `migration_0XX_consolidate_recurring_phase_b.sql` con `BEGIN/ROLLBACK` test.
- [ ] Escribir tests `vitest` para servicios afectados ANTES de tocar código.
- [ ] Plan de rollback explícito (DROP de FKs nuevas, restore desde backup).

---

**Recomendación:** abordar este bloque sólo cuando el resto del roadmap esté ✅ y exista un staging real con datos representativos. No es una "quick win" — es un proyecto de 1-2 semanas de trabajo enfocado.
