# 🛣️ ROADMAP CONSOLIDADO DE REMEDIACIÓN

Plan único, priorizado y secuenciado a partir de los 4 reportes de auditoría. **No ejecutes nada sin antes leer la columna "Riesgo / Pre-requisitos"** y sin tener backup vigente.

Convención:
- **Riesgo de aplicar:** 🟢 Bajo · 🟡 Medio · 🔴 Alto
- **Esfuerzo:** S (≤½ día) · M (1-3 días) · L (1-2 semanas) · XL (>2 semanas)
- **Origen:** ID del hallazgo en el reporte correspondiente (S-xxx seguridad · D-xxx DB · P-xxx performance · A-xxx arquitectura).

---

## 🚨 BLOQUE 0 — Pre-requisitos OBLIGATORIOS (antes de cualquier cambio)

| # | Acción | Riesgo | Esfuerzo |
|---|--------|:------:|:--------:|
| 0.1 | `pg_dump` completo + snapshot Supabase fuera del repo | 🟢 | S |
| 0.2 | Crear branch `audit/remediation` y proteger `main` | 🟢 | S |
| 0.3 | Verificar `.env` no esté trackeado y rotar la `anon key` si alguna vez se filtró | 🟢 | S |
| 0.4 | Crear staging con copia de prod (si aún no existe) | 🟡 | M |

---

## 🟥 BLOQUE 1 — Críticos de Seguridad y DB (aplicar primero, alto valor / bajo riesgo)

| # | Acción | Origen | Riesgo | Esfuerzo |
|---|--------|--------|:------:|:--------:|
| 1.1 | Resolver el hallazgo **Crítico** de seguridad (ver `01_SECURITY_AUDIT.md` § "Plan de Acción Prioritario") | S-Crítico | 🟢 | S |
| 1.2 | Agregar FK faltante `listings.property_id → properties(id)` | D-007 | 🟡 | S |
| 1.3 | Agregar índices faltantes en columnas FK críticas (`bank_accounts.owner_id` y otros listados en D-010, D-012) | D-010/012 | 🟢 | S |
| 1.4 | Revisar políticas RLS marcadas con riesgo en `01_SECURITY_AUDIT.md` y ajustar las que filtran sólo por join sin verificar `owner_id` directo donde corresponda | S-Alto | 🟡 | M |
| 1.5 | Eliminar archivos basura del repo: `src/lib/usePropertyFilter.ts.bak`, `src/lib/usePropertyFilter.ts.new` | A-Crítico (higiene) | 🟢 | S |

---

## 🧹 BLOQUE 2 — Limpieza de bookings en producción (cuando el usuario lo decida)

> **Procedimiento detallado:** `02_DATABASE_AUDIT.md` § "PLAN DE PRESERVACIÓN DE DATOS".

| # | Acción | Riesgo | Esfuerzo |
|---|--------|:------:|:--------:|
| 2.1 | Construir y revisar `cleanup_bookings_only.sql` siguiendo el orden seguro de DELETE | 🟡 | S |
| 2.2 | Probar en staging y validar conteos pre/post de cada tabla preservada (`properties`, `inventory_items`, `vendors`, `cleaners`, `property_groups`, `property_tags`) | 🟡 | M |
| 2.3 | Ejecutar en prod dentro de una transacción explícita con `BEGIN; ... COMMIT;` y backup del día | 🔴 | S |
| 2.4 | Verificar que la app sigue funcional en todas las pantallas afectadas (Bookings, Dashboard, Expenses, Inventory) | 🟢 | S |

---

## ⚡ BLOQUE 3 — Performance Quick Wins (alto impacto, bajo riesgo)

> Detalle: `03_PERFORMANCE_AUDIT.md` § "TOP 10 QUICK WINS".

| # | Acción | Origen | Riesgo | Esfuerzo |
|---|--------|--------|:------:|:--------:|
| 3.1 | Reemplazar `.select('*')` por listas de columnas explícitas en servicios más usados | P-Crítico | 🟢 | M |
| 3.2 | Añadir `.range()` / `.limit()` y paginación server-side a `bookings`, `expenses`, `transactions` | P-Crítico | 🟡 | M |
| 3.3 | Cambiar directivas `client:load` por `client:idle` / `client:visible` donde aplique en páginas Astro | P-Alto | 🟢 | S |
| 3.4 | Lazy-load de Recharts y modales pesados (`BookingDetailModal`, `ExpenseModal`) | P-Alto | 🟢 | S |
| 3.5 | Añadir `useMemo`/`useCallback` en componentes Client grandes (focalizado por hallazgo) | P-Alto | 🟢 | M |
| 3.6 | Cerrar canales Realtime y limpiar `setInterval` en `useEffect` sin cleanup | P-Medio | 🟢 | S |

---

## 🧱 BLOQUE 4 — Calidad de código y herramientas (base para todo refactor futuro)

| # | Acción | Origen | Riesgo | Esfuerzo |
|---|--------|--------|:------:|:--------:|
| 4.1 | Configurar ESLint + Prettier + `tsc --noEmit` en CI | A-Alto | 🟢 | M |
| 4.2 | Añadir Vitest + React Testing Library con 3-5 tests "smoke" iniciales | A-Alto | 🟢 | M |
| 4.3 | Eliminar `console.log` y `// TODO/FIXME` huérfanos | A-Medio | 🟢 | S |
| 4.4 | Generar tipos de Supabase (`supabase gen types typescript`) y reemplazar `any` en `database.ts` | A-Crítico | 🟢 | S |
| 4.5 | Marcar como obsoletos (o eliminar) los `.md` antiguos de la raíz tras consolidar lo vigente | A-Bajo | 🟢 | S |

---

## 🏗️ BLOQUE 5 — Refactor arquitectónico (por componente "God", uno a la vez)

> **NUNCA refactorizar más de un componente God por sprint.** Cada uno necesita pruebas manuales completas.

| # | Acción | Origen | Riesgo | Esfuerzo |
|---|--------|--------|:------:|:--------:|
| 5.1 | Extraer hooks de data-fetching de `*Client.tsx` hacia `src/lib/hooks/` (`useBookingsList`, `useExpensesList`, `useDashboardData`, `useReferenceData`) | A-Crítico | 🟢 | L | ✅ |
| 5.2 | Romper `InventoryClient.tsx` (90 KB) en sub-componentes + hooks | A-Crítico | 🔴 | L | ✅ (checkpoint 003) |
| 5.3 | Romper `BookingDetailModal.tsx` (75 KB) en steps/secciones independientes | A-Crítico | 🔴 | L | ✅ (1551→929 + 7 sub-archivos) |
| 5.4 | Romper `BookingsClient.tsx`, `AseoClient.tsx`, `ExpensesClient.tsx`, `PropertiesClient.tsx`, `VendorsClient.tsx` (uno por sprint) | A-Crítico | 🔴 | XL | 🟡 BookingsClient ✅ · ExpensesClient ✅ (993→530) · faltan AseoClient (1197), PropertiesClient (1113), VendorsClient (869) |
| 5.5 | Mover acceso directo a `supabase.from(...)` desde componentes a la capa `services/` (DIP) | A-Crítico | 🟡 | L | ✅ |
| 5.6 | Aplicar Strategy Pattern a clasificación de gastos / tipos de booking (eliminar switch gigantes) | A-Alto | 🟡 | M | ✅ `expenseClassifyRules.ts` + refactor de `expenseClassify.ts` |

---

## 🗄️ BLOQUE 6 — Mejoras estructurales de DB (mediano plazo)

| # | Acción | Origen | Riesgo | Esfuerzo | Estado |
|---|--------|--------|:------:|:--------:|:------:|
| 6.1 | Backfill `expenses.vendor_id` y deprecar columna `vendor` TEXT | D-001 | 🔴 | M | ⏳ |
| 6.2 | Triggers `updated_at` consistentes en todas las tablas | D-024 | 🟢 | S | ✅ migration_035 |
| 6.3 | Índices compuestos de performance (bookings, expenses, cleanings, adjustments, maintenance) | D-012 | 🟢 | S | ✅ migration_037 |
| 6.4 | Generar `schema_consolidated.sql` a partir de la DB actual (snapshot canónico) | D-008 | 🟢 | M | ⏳ |
| 6.5 | Consolidar `property_recurring_expenses` (legacy) hacia `vendors` + recurrentes nuevos | D-002 | 🔴 | L | ⏳ |
| 6.6 | Decidir naming consistente (snake_case, plural, prefijos por dominio) y aplicar via migration de rename | D-Bajo | 🟡 | M | ⏳ |

---

## 🛡️ BLOQUE 7 — Seguridad de profundidad (largo plazo)

| # | Acción | Origen | Riesgo | Esfuerzo | Estado |
|---|--------|--------|:------:|:--------:|:------:|
| 7.1 | Auditoría exhaustiva RLS + funciones `SECURITY DEFINER` filtran por owner | S-Medio | 🟡 | M | ✅ `audits/06_RLS_AUDIT.md` + `migration_038_rls_hardening.sql` |
| 7.2 | Auditar Edge Functions (CORS, auth, rate limit) | S-Medio | 🟡 | M | 🟢 N/A — no hay Edge Functions custom en `supabase/functions/`. Re-evaluar si se introducen |
| 7.3 | Implementar logging de auditoría centralizado (tabla `audit_log`) | S-Bajo | 🟡 | L | ⏳ |
| 7.4 | Política de rotación de claves Supabase y secretos | S-Info | 🟢 | S | ⏳ |

---

## 📋 Cómo trabajar este roadmap

1. **Aprobación bloque por bloque.** No abras todo a la vez.
2. **Una PR pequeña por hallazgo.** Facilita revisión y rollback.
3. **Validar en staging antes de prod**, especialmente Bloques 2, 5 y 6.
4. **Re-correr la auditoría cada N sprints** (puedo regenerarla cuando quieras) para medir avance.
5. Mantén este archivo como fuente de verdad del progreso: marca cada acción como `✅ Hecho · YYYY-MM-DD · PR #123` cuando se complete.

---

## 📈 Definición de "auditoría completada"

- [ ] Bloque 0 completado.
- [ ] Bloque 1 completado y desplegado en prod.
- [ ] Bloque 2 ejecutado (si el usuario decidió limpiar bookings).
- [ ] Bloque 3 desplegado en prod sin regresiones.
- [ ] Bloque 4 establecido como CI obligatorio en `main`.
- [ ] Bloque 5 al menos al 50% (3 de 6 acciones).
- [ ] Bloque 6 al menos al 50%.
- [ ] Re-auditoría confirma que críticos quedaron en 0 y altos en ≤5.
