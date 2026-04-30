# 🛠️ Plan de Mejoras Iterativo — STR Management Pro

> Bitácora viva de los cambios solicitados en la iteración del 2026-04-29.
> Cada bloque es independiente y se puede ejecutar por separado. Marcar `[x]` al terminar.
> Antes de iniciar un bloque nuevo, releer este archivo para no perder contexto.

---

## 📐 Convenciones para todos los bloques

### Reglas de dinero (CRÍTICO — afecta toda la plataforma)
- Toda cantidad monetaria se guarda en DB como `numeric(14,2)` (ya está así casi siempre).
- En UI: **input acepta coma `,` como separador decimal** (centavos), y **punto `.` como separador de miles** automático mientras el usuario escribe.
- **No permitir** introducir `.` manualmente en el input (se inserta automático cada 3 dígitos desde la derecha).
- Para evitar errores de coma flotante de JavaScript: **toda operación matemática se hace en centavos (enteros)** internamente. Conversión:
  - `parseMoney("1.234,56")` → `123456` (centavos)
  - `formatMoney(123456)` → `"1.234,56"`
- Crear `src/lib/money.ts` con: `parseMoney`, `formatMoney`, `addMoney`, `subMoney`, `mulMoney`, `divMoney`, `splitMoney(total, parts)` (reparte centavos sobrantes al primero).
- Reemplazar TODOS los `Number(x)`, `parseFloat(x)`, `x + y` sobre dinero por las funciones de `money.ts`.
- Componente reutilizable `<MoneyInput value onChange currency />` con la máscara.

### Estado del proyecto
- Phase 11 (Cashflow bancario) sigue pendiente — algunos puntos de abajo lo desbloquean parcialmente.
- Phase 11.5 nueva: **Inventario** (módulo transversal nuevo).

---

## BLOQUE 1 — Propiedades: campo RNT  🟢 simple ✅ COMPLETADO

- [x] Migración SQL: `ALTER TABLE properties ADD COLUMN IF NOT EXISTS rnt text;` → `supabase/migration_018_property_rnt.sql`
- [x] `types/database.ts`: añadir `rnt: string | null` en `PropertyRow`.
- [x] `types/index.ts`: idem en `Property`.
- [x] `services/properties.ts`: incluir `rnt` en mappers.
- [x] `PropertiesClient.tsx` form: input "RNT (Registro Nacional de Turismo)" opcional.
- [x] `PropertyDetailClient.tsx` tab Configuración: mostrar/editar RNT.
- [x] Mostrar RNT en cabecera de detalle de propiedad y en reportes/export.

---

## BLOQUE 2 — Personal de aseo: agrupación por región/grupo dinámico  ✅ COMPLETADO

**Modelo:** un grupo = etiqueta libre creada por el usuario (ej. "Norte", "Sur", "Equipo Juanita"). Una limpiadora pertenece a 1..N grupos (M:N).

- [ ] Migración SQL:
  - `CREATE TABLE cleaner_groups (id uuid pk, owner_id uuid, name text not null, color text, created_at timestamptz)`
  - `CREATE TABLE cleaner_group_members (group_id uuid fk, cleaner_id uuid fk, primary key (group_id, cleaner_id))`
  - RLS por `owner_id`.
- [ ] `services/cleanerGroups.ts`: CRUD grupos + add/remove member.
- [ ] `AseoClient.tsx`:
  - Sidebar/tab con lista de grupos (chips). Al crear limpiadora se puede seleccionar grupos existentes o crear uno nuevo inline ("+ Nuevo grupo").
  - Filtro por grupo en la lista.
  - Vista "Saldos por grupo" (suma adeudada).
- [ ] En el sub-modal de asignación de aseo dentro de BookingDetailModal: mostrar el/los grupos junto al nombre.

---

## BLOQUE 3 — Ajustes de reserva: solo ajustes, no servicios  ✅ COMPLETADO

**Decisión de experto:** los ajustes de reserva (`booking_adjustments`) deben representar **únicamente flujos de dinero originados por la plataforma o el huésped vinculados a esa reserva específica**. Servicios públicos NO van aquí porque no están atados a una reserva (revisión correcta).

Tipos válidos para ajustes:
- `extra_income` — pago por persona adicional, late checkout, etc.
- `discount` — descuento manual otorgado.
- `damage_charge` — Airbnb/plataforma me reembolsa por daño (entra dinero) → genera gasto pendiente de reposición.
- `platform_refund` (NUEVO) — la plataforma me devuelve algo (resolution center, taxes refund).
- `extra_guest_fee` (NUEVO) — cobro por huésped extra.

NO van como ajustes (eliminar si están):
- Servicios públicos (luz/agua/gas/internet) → siempre `expenses` con multi-propiedad (ver Bloque 6).
- Pagos a aseo → `booking_cleanings` + `expenses` al liquidar (Bloque 9).

- [ ] Revisar `AdjustmentFormModal.tsx`: dejar solo los kinds anteriores. Eliminar opciones que mezclen servicios.
- [ ] Actualizar copy/help text del modal explicando que es SOLO dinero ligado a la reserva.
- [ ] Revisar `bookingAdjustments.ts` (servicio) y migración 006: si hace falta añadir nuevos kinds → `migration_016_adjustment_kinds.sql`.
- [ ] Documentar la separación en CONVENTIONS.md.

---

## BLOQUE 4 — Cuentas bancarias: débito vs crédito + alertas de saldo sin asignar  ✅ COMPLETADO

### 4A. Tipo de cuenta (débito/crédito)
- [x] Migración `migration_020_bank_account_credit.sql`: añade `is_credit boolean default false` y `credit_limit numeric(14,2)`.
- [x] `BankAccountsClient.tsx`: checkbox "Es cuenta de crédito" + input cupo total cuando aplica.
- [x] Validación en backend (`validateAccountSpend` en `services/bankAccounts.ts`):
  - Cuenta no-crédito: bloquea registro de gasto pagado si `currentBalance - amount < 0`.
  - Cuenta crédito: siempre permite (queda como deuda).
  - Se invoca desde `createExpense` y `updateExpense`.
- [x] Indicador visual en card: chip "CRÉDITO" rojo / "DÉBITO" verde + cupo disponible si hay `credit_limit`.

### 4B. Plata "volando" (gasto/ingreso sin cuenta asignada)
- [x] `listUnassignedMoney()` en `services/bankAccounts.ts`: payouts y gastos pagados sin cuenta.
- [x] Banner "💸 Dinero sin asignar a cuenta" en `/accounts` con listas + totales + links a /bookings y /expenses.
- [ ] (Mejora futura) Banner duplicado en Dashboard.
- [ ] (Mejora futura) Aviso en `BookingPayoutModal` cuando no se selecciona cuenta.

---

## BLOQUE 5 — Inputs numéricos: centavos + separador de miles (TRANSVERSAL) ✅ COMPLETADO

- [x] Crear `src/lib/money.ts` (toCents/fromCents/addMoney/subMoney/mulMoney/divMoney/splitMoney/parseMoney/formatMoney/formatCOP/maskMoneyInput).
- [x] Crear `src/components/MoneyInput.tsx` controlado, con máscara `1.234,56` (es-CO).
- [x] Reemplazar `<input type="number">` o `type="text"` para dinero en:
  - [x] `ExpenseModal.tsx`
  - [x] `BookingPayoutModal.tsx` (con sync bidireccional gross↔fees↔net usando `subMoney`)
  - [x] `BookingDetailModal.tsx` (ajuste, tarifa aseo, supplies)
  - [x] `BankAccountsClient.tsx` (opening_balance, allowNegative)
  - [x] `PropertyDetailClient.tsx` (default_cleaning_fee)
  - [x] `SharedBillPayModal.tsx` (total + per-property con `addMoney`)
  - [x] `MarkPaidModal.tsx`
  - [x] `BookingsClient.tsx` (total_revenue)
  - [x] `VendorsClient.tsx` (defaultAmount, fixedAmount per propiedad)
- [x] Operaciones aritméticas críticas migradas a `addMoney`/`subMoney`.
- [ ] Tests automatizados (no hay framework instalado — pendiente para fase futura).
- [ ] **PENDIENTE: Validar `npm run build` y correr migración 018 en Supabase**.

---

## BLOQUE 6 — Servicios públicos: gasto multi-propiedad con split por propiedad  ✅ COMPLETADO

Caso de uso: cuenta de luz $300.000 que cubre 3 propiedades — Prop A consumió más que B y C. Quiero registrar el split exacto.

**Diseño implementado:** N filas en `expenses` con mismo `expense_group_id` (UUID). Esto reusa toda la infraestructura existente (RLS, filtros, dashboard) — al filtrar por propiedad A, sólo aparece la fila de A naturalmente.

- [x] Migración `migration_019_expense_group.sql`: añade `expense_group_id text` + índice.
- [x] `services/expenses.ts`: `createSharedExpense(rows, groupId?)` inserta N filas con mismo group_id.
- [x] `ExpenseModal.tsx`: checkbox "Compartir entre varias propiedades" + grid de propiedades + toggle equal/manual (`splitMoney` para repartir centavos exactos) + validación suma = total.
- [x] `ExpensesList.tsx`: chip violeta "⇄ Compartido" cuando `expense_group_id` está presente.
- [x] **Filtros por propiedad**: ya funciona automáticamente — al filtrar por Prop A, sólo se muestra la fila correspondiente con su porción.
- [ ] (Mejora futura) Edición/borrado de gasto compartido como grupo completo.

---

## BLOQUE 7 — Filtro de propiedades multi-select (transversal)  ✅ COMPLETADO

- [x] Componente `src/components/PropertyMultiSelect.tsx` reutilizable (popover, búsqueda, "Seleccionar todas" / "Limpiar").
- [x] `usePropertyFilter` refactorizado: `propertyIds: string[]`, persistencia en localStorage como JSON, back-compat con key legacy.
- [x] Servicios aceptan `propertyIds: string[]` y usan `.in()`:
  - [x] `services/bookings.ts` (BookingFilters.propertyIds)
  - [x] `services/expenses.ts` (`listExpenses` acepta `string | string[] | undefined`)
  - [x] `services/financial.ts` (`computeFinancials` igual)
- [x] Aplicado en:
  - [x] `/dashboard` (DashboardClient)
  - [x] `/expenses` (ExpensesClient)
  - [x] `/bookings` (BookingsClient)
- [ ] (Mejora futura) Persistir selección en URL (`?properties=id1,id2`) para deep-linking.
- [ ] (Mejora futura) `/report`.

---

## BLOQUE 8 — Iconos de acciones más acordes (Gastos y Reservas)  ✅ COMPLETADO

Mapeo recomendado (Lucide):
| Acción actual | Icono actual | Mejor icono |
|---|---|---|
| Ver detalle gasto | 👁 ojo | 📄 `FileText` (es un comprobante/factura) |
| Editar gasto | ✏️ | `Pencil` (mantener) |
| Eliminar | 🗑 | `Trash2` (mantener) |
| Marcar pagado | ✓ | `BadgeDollarSign` o `Wallet` |
| Ver reserva | 👁 | `BookOpen` o `CalendarCheck` |
| Hacer payout reserva | ✏️ | `Banknote` o `HandCoins` |
| Ajustes reserva | + | `SlidersHorizontal` |
| Operativo / aseo | 🧹 | `Sparkles` (mantener) |

- [ ] `ExpensesList.tsx` — actualizar iconos y tooltips.
- [ ] `BookingsClient.tsx` — actualizar iconos y tooltips.
- [ ] Asegurar accesibilidad: `aria-label` en cada botón.

---

## BLOQUE 9 — Aseo: gasto solo al liquidar (no al asignar)  ✅ COMPLETADO

**Lógica correcta confirmada:**
1. Asignar limpiadora a una reserva → `booking_cleanings` queda en `pending`/`done`. **NO crea expense.**
2. Click "💸 Liquidar" en /aseo → llama `payoutCleanerConsolidated()` que crea **un expense consolidado** + marca todos los cleanings incluidos como `paid` con `paid_date`.
3. Hasta entonces, el monto aparece como "adeudado" en /aseo pero no como gasto en /expenses ni P&L.

- [x] `payoutCleanerConsolidated` (cleanings.ts) crea expense con `category='cleaning'`, `subcategory='cleaning'`, `vendor_id`, status `paid`.
- [x] **Eliminado el botón "Marcar pagado" individual** en `DetailModal` (rompía el invariante: marcaba `paid` sin crear expense). Ahora muestra "Pendiente liquidar" para forzar uso del flujo correcto.
- [x] Banner informativo en /aseo explicando el flujo Pendiente → Hecho → Liquidado.
- [x] KPIs ya separan "Hechos sin pagar" vs "Total adeudado" claramente.
- [ ] (Mejora futura) Backfill: si hay registros antiguos `paid` sin expense vinculado → script SQL para crear los expenses retroactivos.

---

## BLOQUE 10 — Payout de reservas futuras bloqueado (excepto directas)  ✅ COMPLETADO

- [x] `BookingPayoutModal.tsx`: validación al guardar — si `channel !== 'direct'` AND `start_date > today` AND `!checkin_done` → bloquea con mensaje claro.
- [x] `PayoutTarget` extendido con `channel`, `start_date`, `checkin_done`. BookingsClient los pasa.
- [x] Aviso amarillo "Sin cuenta: el dinero quedará volando" cuando el usuario no asigna cuenta bancaria al payout.

---

## BLOQUE 11 — Estado de reservas mejorado (especialmente importadas por Excel)  ✅ COMPLETADO

Estados derivados (helper puro, sin nuevas columnas):

| Condición | Estado |
|---|---|
| `cancelled_at not null` o status incluye "cancel" | `cancelled` |
| `start_date > today` | `upcoming` |
| `start_date <= today < end_date` | `in_progress` |
| `end_date <= today` AND `checkin_done` AND `checkout_done` | `completed` |
| resto (pasadas sin flags) | `past_unverified` |

- [x] `src/lib/bookingStatus.ts` — helper `getBookingStatus`, `statusUI` (label + emoji + tailwind), `inferOperationalFlags`.
- [x] Al importar Excel/CSV: `services/bookings.ts upsertBookings` invoca `inferOperationalFlags(start_date, end_date)`. Pasadas → ambos `true`. Futuras → ambos `false`. En curso → checkin=true, checkout=false.
- [x] `BookingsClient.tsx` — chip de estado con color y emoji usando `getBookingStatus`. Reemplaza el viejo `statusColor`.
- [ ] (Mejora futura) Filtro por estado en FilterBar.

---

## BLOQUE 12 — Servicios y proveedores = gastos del NEGOCIO, no servicios públicos  ✅ COMPLETADO

**Aclaración semántica:** "Servicios" en el sentido administrativo del negocio (Cámara de Comercio, software de administración, contador, asesor legal, plataformas SaaS), NO servicios públicos.

- [ ] Renombrar / reorganizar en `VendorsClient.tsx` los `vendor_kind`:
  - `utility` → seguir existiendo pero etiquetar "Servicio público (luz/agua/gas/internet)".
  - `admin` → "Servicios del negocio (Cámara de Comercio, SaaS, contador, legal)".
  - Posiblemente añadir `business_service` como kind nuevo separado de `admin` si la distinción importa.
- [ ] Revisar copy en UI para que quede claro.
- [ ] En el módulo de "Servicios" (si existe como página separada) — solo gastos del negocio, no de operación.

---

## BLOQUE 13 — Módulo de Inventario (NUEVO — Phase 11.5)  ✅ COMPLETADO + UX refinada

Nueva página `/inventory` por propiedad. Cada propiedad tiene:
- Items (utensilios, muebles, electrodomésticos, decoración).
- Insumos (productos de aseo, amenities, papel, jabones).
- Estado de cada item: `good | damaged | needs_maintenance | depleted | lost`.

### 13A. Modelo de datos ✅
- [x] Migración `migration_024_inventory.sql` aplicada (3 tablas + RLS + trigger).

### 13B. Páginas y UI ✅
- [x] `/inventory` listado global (todas las propiedades).
- [x] **Vista categorizada**: secciones colapsables Propiedad → Categoría → filas de items (refactor post-feedback usuario).
- [x] Acciones por item: añadir, editar, reportar daño, reponer/usar (consumibles), historial, eliminar.
- [x] KPIs: total, dañados, mantenimiento, stock bajo, agotados, valor estimado.
- [x] Filtros: propiedad, categoría, estado (incl. "Stock bajo"), búsqueda.

### 13C. Integraciones ✅ (flujo simplificado end-to-end)
- [x] **Daño → Gasto pendiente + Ajuste de reserva**: `reportItemDamage()` en `services/inventory.ts` orquesta atómicamente:
  1. (Opcional) `booking_adjustments` `kind='damage_charge'` si el usuario marca "Cobrar al huésped".
  2. `expenses` `status='pending'` categoría "Reparación inventario", vinculado a `property_id`, `booking_id`, `adjustment_id`.
  3. `inventory_movements` `type='damaged'` + `inventory_items.status='damaged'`, vinculado a `related_booking_id` y `related_expense_id`.
- [x] El `DamageReportModal` carga reservas de la propiedad del item (activas primero) para que el usuario las atribuya.
- [ ] _Pendiente menor_: en `BookingDetailModal` mostrar sección "🔧 Daños del inventario" listando los `inventory_movements` con `related_booking_id = booking.id` (UI consumer; el dato ya está enlazado).
- [ ] _Pendiente menor_: cuando el `expense` pendiente se marca `paid`, registrar movimiento `repaired` y volver item a `good` (botón opcional en detalle del expense).
- [ ] _Pendiente menor_: Dashboard widget "Items con problemas" (damaged + needs_maintenance + low_stock).

### 13D. Aseo ↔ Inventario (futuro)
- En el sub-modal de aseo de la reserva, sección opcional "Reporte de inventario":
  - Checklist rápido de items críticos por propiedad (configurable).
  - Si la limpiadora marca un item como dañado / faltante → reusar `reportItemDamage()` desde aseo.
  - Convierte el aseo también en una **inspección de inventario**.
- Consumo de insumos durante aseo → decremento automático de `quantity` del item consumible vinculado al item de aseo.

### 13E. Pasos a/b/c pulidos
- (a) **Damage → Reserva → Gasto**: ✅ implementado en `reportItemDamage` (servicio) + `DamageReportModal` (UI).
- (b) **Aseo consume insumos**: pendiente — extender `liquidateCleaning` para descontar `quantity` de items consumibles seleccionados, con `inventory_movements type='used'`.
- (c) **Limpieza de warnings residuales**: `await onSave` (callbacks sync) en BookingDetailModal, `Cell` deprecated en OccupancyChart, `propertyId` deprecated back-compat en bookings.ts (intencional). Quedan como deuda técnica; no bloquean build.

---

## 🎯 Orden recomendado de ejecución

1. **Bloque 5** (Money/centavos) — afecta UI de muchos otros bloques, hacerlo primero.
2. **Bloque 1** (RNT) — quick win.
3. **Bloque 7** (multiselect propiedades) — necesario para Bloque 6.
4. **Bloque 6** (gastos compartidos) — depende de 5 y 7.
5. **Bloque 4** (tipo cuenta + dinero sin asignar).
6. **Bloque 11** (estado de reservas) y **Bloque 10** (payout futuro bloqueado) juntos.
7. **Bloque 9** (aseo: gasto al liquidar).
8. **Bloque 2** (grupos de aseo).
9. **Bloque 3** (limpiar ajustes) y **Bloque 12** (semántica servicios) juntos.
10. **Bloque 8** (iconos) — cosmético, al final.
11. **Bloque 13** (Inventario) — módulo nuevo grande, último.

---

## 📋 Fases del proyecto — recordatorio

| Fase | Estado | Notas |
|------|--------|-------|
| 1-9 | ✅ | Auth, ETL, OPEX base, dashboard básico |
| 10 | ✅ | Recurring + ajustes + cross-link |
| 11 | 🟡 Parcial | Cashflow bancario — Bloque 4B avanza esto |
| 11.5 | ⏳ NUEVA | **Inventario** (Bloque 13) |
| 12 | ⏳ | Proyecciones & budget |
| 13 | ⏳ | Multi-moneda |
| 14 | ⏳ | Reportes contables DIAN |
| 15+ | ⏳ | Reportes/automatización/email |

---

## 🧪 Cómo trabajaremos

1. Tú me dices: "Hagamos el Bloque X" (o varios).
2. Yo releo este archivo + los archivos del bloque, implemento con calidad senior, y marco los `[x]` al terminar.
3. Te dejo notas de qué probar al final de cada bloque.
4. Si encuentro algo nuevo durante un bloque, lo añado a este archivo en una sección "Hallazgos" del bloque.

> **No empezaré a implementar hasta que confirmes por dónde quieres arrancar.**
