> ⚠️ **ARCHIVO OBSOLETO** — Supersedido por `audits/`. No actualizar.

# FEEDBACK & ROADMAP — STR Management Pro

> Bitácora viva de feedback del usuario, estado de implementación y guía de pruebas.

---

## 📌 Última iteración — Fase 11: Administración + Aseo + Operativo

### 🧠 Alcance
Reestructurar el nav y entregar la base técnica (tabla `vendors` + aseo) que desbloquea las fases 12-16.

### ✅ Hecho

**Migraciones (ya corridas en Supabase ✓)**
- `migration_008_vendors.sql` — tabla `vendors` (utility/admin/maintenance/cleaner/insurance/other) + `vendor_id` opcional en `expenses` y `property_recurring_expenses`.
- `migration_011_cleanings_operational.sql` — `bookings.checkin_done/checkout_done/inventory_checked/operational_notes`, `properties.default_cleaning_fee`, tabla `booking_cleanings`.

**Tipos y servicios**
- `types/database.ts`: `VendorRow`, `VendorKind`, `BookingCleaningRow`, `CleaningStatus` + campos operativos en Booking/Property.
- `services/vendors.ts`: CRUD completo + auth.
- `services/cleanings.ts`: CRUD por booking + `computeCleanerBalances()` + `updateBookingOperational()`.

**Nav reestructurado**
- Dropdown **Administración** con submenús Propiedades / Cuentas bancarias / Proveedores / Aseo.
- El ítem raíz "Propiedades" y "Cuentas" desaparecen del top-nav.

**Nuevas páginas**
- `/vendors` — CRUD de proveedores con filtros por tipo (6 categorías con iconos).
- `/aseo` — listado de personal de aseo con saldos adeudados (pendiente / hecho sin pagar / total), modal detalle con historial y botón "Marcar pagado".

**BookingDetailModal — tab Operativo**
- 3 toggles visuales (check-in hecho / check-out hecho / inventario revisado), persistencia directa a DB.
- Sección 🧹 Aseo: asignar limpiadora (prellenado con `default_cleaning_fee` de la propiedad), marcar hecho → pagar → eliminar, sub-modal con selector de estado.

**Otros fixes**
- Bug fechas check-in/out off-by-one en preview del modal (se parseaba como UTC → mostraba día anterior en Bogotá). Arreglado con `'T00:00:00'` local.
- Configurar `default_cleaning_fee` desde la tab "Configuración" en PropertyDetailClient.

### 🧪 Cómo probarlo

1. **Proveedores**: navbar → Administración → Proveedores. Crea uno de tipo "Servicio público" (Claro, EPM). Edita, elimina.
2. **Aseo**:
   - Administración → Aseo → + Nueva persona (Juanita, 300123456).
   - En una propiedad (menú Propiedades → detalle), tab Configuración → pon tarifa de aseo por defecto (ej. 60000) y guarda.
   - Abre una reserva → sección Operativo → Asignar aseo → selecciona Juanita, tarifa pre-llenada, estado "Hecho" → Guardar.
   - Verifica que en `/aseo` aparece el saldo adeudado de Juanita.
   - "Marcar pagado" desde la fila en el modal → saldo baja.
3. **Operativo**: toggles check-in/out/inv en una reserva → refresca → persisten.
4. **Fechas**: en `/bookings` → Nuevo. Selecciona 20 abril + 3 noches → preview debe decir "20 de abril → 23 de abril" (antes mostraba 19).

### ⚠️ Pendiente
- `npm run dev` — verificar visualmente. Yo no pude correr `astro check` por falta de pwsh en mi entorno; hice auditoría manual de tipos.
- Booking_cleanings no aparece aún en reportes financieros (Fase 16/17 lo integrará al cashflow).
- Email recordatorios aún no implementado (Fase 12 lo incluirá).

### 🔜 Siguiente
**Fase 12** — Recurring mensualizado + notificaciones configurables + email Resend. Desbloquea recordatorios.

---

## 📚 Historial

### Resolver/Descartar gasto pendiente por daño (Fase 10 cierre)

### 🧠 El problema

Al registrar un ajuste "Cobro por daño" el sistema auto-creaba un gasto pendiente, pero ese gasto sólo aparecía como un item inerte en la banda "Cuentas por Pagar". Faltaba el flujo completo:

1. Poder **completar** el gasto (monto real, proveedor, banco) → marcar como Pagado → sale de pendientes.
2. Poder **descartar** el gasto si la reparación no va → y con ello eliminar **atómicamente** el ajuste `damage_charge` vinculado (para no dejar ingresos fantasma en la reserva).
3. Poder **dejarlo pendiente** para completarlo después.

### ✅ Hecho

**Vínculo fuerte gasto ↔ ajuste**
| # | Cambio | Dónde |
|---|--------|-------|
| R1 | **Migración 007**: `expenses.adjustment_id` FK `→ booking_adjustments(id) ON DELETE SET NULL` + índice | `supabase/migration_007_expense_adjustment_link.sql` |
| R2 | `ExpenseRow` + `Expense` (types) + `toExpense` + `createExpense` mapean `adjustment_id` | `types/database.ts`, `types/index.ts`, `services/expenses.ts` |
| R3 | `handleCreateAdjustment` en BookingDetailModal: crea ajuste → obtiene `id` → crea gasto con `adjustment_id = adj.id` (antes la relación era implícita por convención textual) | `BookingDetailModal.tsx` |

**UX "Cuentas por Pagar" resolvible**
| # | Cambio | Dónde |
|---|--------|-------|
| R4 | Tarjetas ahora son `<button>` clickeables (hover + ring) → abren `ExpenseModal` en modo edición | `ExpensesClient.tsx` |
| R5 | Tarjeta muestra **descripción** (2 líneas clamp) + chip rojo `🔗 DAÑO` si `adjustment_id` presente + hint "Clic para resolver →" | `ExpensesClient.tsx` |
| R6 | `ExpenseModal` acepta prop `onDiscardLinked` (sólo se pasa si `editing.adjustment_id` existe) | `ExpenseModal.tsx` |
| R7 | Banner ámbar en `ExpenseModal` cuando `adjustment_id` presente: explica origen + qué hacer | `ExpenseModal.tsx` |
| R8 | Botón "🗑 Descartar este gasto y su ajuste por daño" → confirm panel rojo que lista los 2 registros afectados → "Sí, descartar ambos" / "No, dejar como está" | `ExpenseModal.tsx` |
| R9 | Categorías del dropdown de ExpenseModal ahora incluyen **Reparación daño** y **Reposición inventario** (consistencia con el selector del AdjustmentFormModal) | `ExpenseModal.tsx` |
| R10 | `handleDiscardWithAdjustment` en ExpensesClient: borra adjustment primero, luego expense (atómico desde perspectiva del usuario). ON DELETE SET NULL en FK protege contra huérfanos | `ExpensesClient.tsx` |

### 🎯 Los 3 caminos del usuario

Al hacer clic en una tarjeta de "Reparación daño" pendiente:

| Acción | Qué pasa |
|--------|----------|
| **Completar y pagar** | Edita monto (si difiere del cobrado), añade proveedor/banco, cambia status a `Pagado` → Guardar. Sale de "Cuentas por Pagar". El ajuste `damage_charge` sigue intacto. Ganancia real = cobrado − costo real. |
| **Dejar pendiente** | Cerrar modal. Sigue apareciendo ahí para completar luego. |
| **Descartar ambos** | Botón rojo → confirm → elimina gasto + ajuste. Reserva vuelve a su estado previo al damage_charge. |

### 🗄️ Migración a correr

```sql
-- migration_007_expense_adjustment_link.sql  (nueva, CORRER AHORA)
```
Idempotente (`ADD COLUMN IF NOT EXISTS`). Sin correrla, guardar un damage_charge con checkbox activo fallará al insertar el gasto (columna inexistente).

### 🧪 Cómo probar

1. Correr migration 007 en Supabase SQL editor.
2. `/bookings` → 👁 reserva → "+ Nuevo ajuste" → Cobro por daño → monto `900.000` → descripción "Se rompió TV sala" → Guardar. (Checkbox "Crear gasto pendiente" activado por default → usa categoría "Reparación daño".)
3. `/expenses` → en la banda amarilla "Cuentas por Pagar" aparece tarjeta con:
   - `Reparación daño` + chip rojo `🔗 DAÑO`
   - Fecha
   - Descripción `[Daño reserva XXX] Se rompió TV sala`
   - Monto `$ 900.000`
   - Hint "Clic para resolver →"
4. **Camino feliz (completar y pagar):**
   - Clic → se abre ExpenseModal con banner ámbar explicativo.
   - Cambia monto a `750.000` (costo real), proveedor "HomeCenter", banco "Bancolombia", status = Pagado → Guardar.
   - Tarjeta desaparece de Cuentas por Pagar. El gasto queda en la tabla con estado `Pagado`.
   - Vuelve a /bookings → la reserva muestra "Ganancia real" +150k más alta (900 cobrado − 750 real).
5. **Camino descarte:**
   - Crea otro damage_charge, luego clic en la tarjeta pendiente.
   - Clic en "🗑 Descartar este gasto y su ajuste por daño" → confirm panel rojo.
   - Clic "Sí, descartar ambos" → tarjeta desaparece y en /bookings ya no hay el ajuste damage_charge.
6. **Camino "dejar pendiente":** simplemente clic Cancelar / ✕ → sigue en Cuentas por Pagar.

---



## ✅ Historial — Refinamiento C + D (iteración previa)

**Refinamiento C — Cobro por daño ahora crea gasto pendiente vinculado**
- `AdjustmentFormModal`: checkbox "Crear gasto pendiente de reparación" + selector de categoría.
- `handleCreateAdjustment`: si el flag está activo, crea un `expense` con `status=pending`, `booking_id`, monto y fecha del ajuste.
- Neto real del daño: `damage_charge − expense real`.

**Refinamiento D — Selector de reserva siempre visible**
- Campo "Vincular a reserva (opcional)" siempre visible (incluso sin reservas, con estado vacío).
- Helper text actualizado.

---

## 🧭 Evaluación de las fases 11-14 a la luz del modelo actual

El trabajo de Fase 10 dejó la data interconectada. Esto es lo que cambia en cada fase futura:

### 🏦 Fase 11 — Cashflow bancario
**Base ya existente:**
- `bank_accounts` creada (migración 003), con `opening_balance`, `currency`, `is_active`.
- `expenses.bank_account_id` y `bookings.payout_bank_account_id` ya referencian la cuenta.
- `payout_date` en bookings → saldo por fecha computable.
- Ajustes tienen `date` → también entran en cashflow.

**Qué falta:**
- Tabla `bank_movements` (o vista derivada): consolida payouts + expenses + adjustments (cuando impliquen caja) en una línea temporal por cuenta.
- UI "Conciliación": marcar movimientos como `reconciled` vs `pending_match`.
- Widget "Saldo por cuenta hoy" = `opening_balance + sum(entradas) − sum(salidas)` con fecha-cut.

**Decisión de diseño:** mejor **vista SQL derivada** que tabla nueva — evita duplicación. Los "movimientos" son computados en runtime desde payouts+expenses.

### 📊 Fase 12 — Proyecciones & budget
**Base ya existente:**
- SCD2 de gastos recurrentes (migration 004) → se puede proyectar cualquier mes futuro consultando `property_recurring_expenses` con `valid_from <= mes AND (valid_to IS NULL OR valid_to > mes)`.
- Booking adjustments históricos → tasa de ajuste promedio por reserva.

**Qué falta:**
- Tabla `property_budget` (property_id, month, category, amount, notes). Un registro por categoría-mes.
- Motor de forecast simple: promedio de últimos N meses con factor de estacionalidad.
- Comparador visual budget vs real vs forecast (3 series).

### 💱 Fase 13 — Multi-moneda
**Base ya existente:**
- `bookings.currency`, `bookings.exchange_rate` ya existen (migración 003).
- `bank_accounts.currency` también.

**Qué falta:**
- Tabla `exchange_rates` (date, from_currency, to_currency, rate) — TRM histórica diaria.
- Helper `toCOP(amount, currency, date)` para normalizar reportes.
- Columnas opcionales en expenses: `currency`, `exchange_rate` (espejo del patrón de bookings).

**Nota:** Fase 11 debería usar la misma normalización (saldo por cuenta se muestra en su moneda, totales consolidados en COP).

### 📑 Fase 14 — Reportes contables DIAN-friendly
**Base ya existente:**
- `vendor` + `person_in_charge` en expenses y recurrentes → trazabilidad proveedor.
- `booking_id` en expenses → imputación a ingreso específico (importante para ICA y causación).
- Adjustments separados de revenue base → facilita distinguir ingreso gravable de compensación.

**Qué falta:**
- Tabla `tax_rates` (categoría, porcentaje IVA, retefuente, ICA).
- Columnas `invoice_number`, `nit_vendor`, `tax_amount` en expenses.
- Exportador CSV formato DIAN (libro de ingresos y egresos).

### 📦 Módulo de inventario (transversal, antes de Fase 14)
**Detectado en esta iteración:** cuando se crea un gasto "Reposición inventario" desde un damage_charge, ese gasto debería:
1. (Futuro) Decrementar stock del ítem dañado en `inventory_items`.
2. (Futuro) Incrementar stock cuando se paga la reposición.
3. Mientras tanto: la convención `[Daño reserva XXX]` en description + `booking_id` + categoría ayudan a que el módulo de inventario, cuando llegue, pueda **backfill**earse parseando los gastos existentes.

Recomendación: crear tabla `inventory_items(property_id, name, sku, unit, current_stock)` + `inventory_movements(item_id, expense_id, delta, reason, date)` en Fase 11.5 (entre cashflow y budget) — el resto de funcionalidad depende de ella.

---

## 🟢 Fase 10 — ESTADO: COMPLETA

Todo el roadmap de la fase ha sido entregado:
- ✅ Gastos recurrentes con proveedor + persona + historial SCD2
- ✅ Detalle de reserva con gastos vinculados (crear + vincular existente + desvincular)
- ✅ Ajustes de reserva (ingresos extra / descuentos / daños) con auto-gasto pendiente por daño
- ✅ Cross-link bidireccional `/expenses` ↔ `/bookings`
- ✅ Selector de reserva siempre visible en ExpenseModal

## 🔵 Fases futuras
| Fase | Descripción | Prioridad |
|------|-------------|-----------|
| **11** | Cashflow bancario — movimientos reales, conciliación, saldo por cuenta | Alta |
| **12** | Proyecciones & budget — presupuesto mensual vs real, forecast | Media |
| **13** | Multi-moneda (USD/COP histórica) | Baja |
| **14** | Reportes contables DIAN-friendly (IVA, retefuente, ICA) | Media |

---

## ✅ Historial

### Iteración anterior — Bloques C + D (Fase 10 parte 2)

**Bloque C — Ajustes de reserva + vincular gastos existentes**
- Migración 006 (`booking_adjustments` con `kind ∈ {extra_income, discount, damage_charge}`)
- Sub-modal `AdjustmentFormModal` + servicio `bookingAdjustments.ts` con `netAdjustment()`
- **Vincular gasto existente** (`LinkExistingExpenseModal`) además de crear nuevo
- Trash → "desvincular" (no destructivo)
- Resumen financiero 5 col: Bruto · Fees · Ajustes · Gastos · Ganancia real

**Bloque D — Cross-link /expenses ↔ /bookings**
- Chip `🔗 Reserva` en filas de `ExpensesList`
- Botón "Ver reserva →" en `ExpenseDetailModal` (prop `onViewBooking`)
- `ExpensesClient` abre `BookingDetailModal` resolviendo booking por id

### Iteración previa — Bloques A + B (Fase 10 parte 1)
- Migration 005 (vendor + person_in_charge recurrentes)
- BookingDetailModal inicial con métricas y "Vincular gasto" (crear nuevo)

### Más atrás
- Filtros avanzados + Phase 10 groundwork (FilterBar, booking_id en Expense)
- Detalle de gasto + edit/delete con confirmación
- SCD Type 2 (migration 004)
- UX polish (ESC, modal no cierra por clic fuera, fix Mar 98)
- Fases 1-9 completas

---

## 🗄️ Migraciones SQL

| # | Estado | Qué agrega |
|---|--------|------------|
| 001 | ✅ | Schema base |
| 002 | ✅ | Listings, OPEX |
| 003 | ✅ | Config propiedad, recurring, bank accounts, payout |
| 004 | ✅ | SCD Type 2 (valid_from/valid_to) |
| 005 | ✅ | `vendor` + `person_in_charge` en recurring |
| 006 | ✅ | `booking_adjustments` |
| **007** | ⏳ **CORRER AHORA** | `expenses.adjustment_id` (vínculo gasto↔ajuste) |

---

## 🧭 Próximo paso

1. **Tú**: corre migración 007 + prueba los 3 caminos (completar / dejar pendiente / descartar ambos).
2. **Yo en siguiente iteración**: arrancar **Fase 11 (Cashflow bancario)** — vista de movimientos por cuenta + conciliación. Ver análisis arriba para cómo encajan los datos ya existentes.

