> ⚠️ **ARCHIVO OBSOLETO** — Implementado. Ver `audits/05_REMEDIATION_ROADMAP.md` y `src/components/features/expenses/`. No actualizar.

# Plan – Refactor del registro de gastos por tipo

## Contexto

La plataforma administra rentas cortas: ingresos por reservas, gastos sobre propiedad,
gastos sobre reserva, daños, aseo, proveedores. El modal único de gastos
(`ExpenseModal.tsx`) hoy mete toda la lógica en un solo formulario y se vuelve
confuso para el usuario:

- Cuando seleccionas "daños del huésped" no carga inventario ni vincula el ítem.
- Cuando seleccionas "aseo" no diferencia liquidación vs gasto suelto vs insumos.
- Si seleccionas reserva, la propiedad no se autocompleta.
- "Reparación inventario" caía dentro del filtro Aseo y lavandería (clasificador legacy).
- "cleaning" en minúscula inglesa aparecía como categoría de la liquidación.

## Bugs corregidos en esta sesión

- [x] **Clasificador**: `expenseClassify.ts` ahora prioriza el texto de `category`
      antes del fallback por `booking_id`, evitando que un daño con `subcategory=null`
      caiga a `cleaning`.
- [x] **Liquidación**: `cleanings.ts` ahora guarda `category: 'Aseo'` y
      `category: 'Insumos de aseo'` (separados, en español).

## Fase 1 — Selector de tipo de gasto (ExpenseTypeChooser)

- [x] Crear `ExpenseTypeChooser.tsx` con 5 opciones (propiedad, liquidación,
      insumos, daño, proveedor).
- [x] El botón "Registrar gasto" en `ExpensesClient.tsx` abre el chooser.
- [x] `ExpenseModal` legacy se conserva para edición (botón ✏️ en cada fila).

## Fase 2 — Formularios especializados (uno por tipo)

Cada uno vive en `components/features/expense-forms/`. Todos pequeños,
una sola responsabilidad, sin lógica condicional cruzada.

- [x] **`PropertyExpenseForm.tsx`** – Sobre propiedad.
  - Chips de subcategoría (utilities | administration | maintenance | stock),
    selector de detalle dependiente, propiedad, monto, fecha, vendor opcional,
    cuenta bancaria, estado.
  - Sin `booking_id`. Sin `cleaner_id`.
- [x] **Atajo de Liquidación** – El chooser redirige directo a `/aseo`.
- [x] **`CleaningSuppliesForm.tsx`** – Compra puntual de insumos.
  - Toggle "¿Quién compró?" (yo / personal de aseo). Si es cleaner, se guarda
    con `vendor_id=cleanerId` para que aparezca en su historial; si queda
    pendiente se acumula a la próxima liquidación.
  - Fija `subcategory='cleaning'`, `category='Insumos de aseo'`, sin booking.
- [x] **`DamageReportFlow`** (alias `DamageFromExpensesFlow.tsx`) – Daño durante reserva.
  - Wrapper con paso 1 = elegir reserva, paso 2 = `DamageReportModal` con la
    propiedad derivada del booking. Nunca crea daños huérfanos.
- [x] **`VendorExpenseForm.tsx`** – Pago a proveedor.
  - Vendor (kind != cleaner) obligatorio, propiedad obligatoria, monto sugerido
    desde `default_amount`, categoría sugerida desde el vendor.

## Fase 3 — UX cruzado: propiedad ↔ reserva

- [ ] En cualquier formulario que tenga campo de reserva: al elegir reserva,
      autocompletar `property_id` (resolviendo via `bookings.listing_id → listings.property_id`).
- [ ] Si la propiedad ya estaba seleccionada y se elige una reserva de otra
      propiedad, advertir y reemplazar.
- [ ] Helper compartido `useBookingProperty(bookingId)` para cargar la propiedad
      derivada y reusarlo en BookingDetailModal, DamageReportModal y los nuevos forms.

## Fase 4 — Limpieza del modal genérico

- [ ] Marcar `ExpenseModal` como **modo edición** (props `mode: 'create' | 'edit'`).
      En modo edición, mantiene la flexibilidad actual.
- [ ] En modo `create` (legacy / fallback), agregar banner "¿Buscas registrar
      un gasto? Usa el selector de tipo".
- [ ] Eliminar la opción `damage` del select de subcategoría en modo `create`
      (forzar el flujo dedicado).

## Fase 5 — Datos limpios y migraciones

- [ ] **One-shot script** (en `supabase/scripts/` si existe folder) para
      backfill: cualquier expense con `category in ('cleaning')` y
      `subcategory='cleaning'` → renombrar `category` a `'Aseo'`.
- [ ] Validar que no queden expenses con `subcategory=null` y `booking_id` no
      nulo: si los hay, derivar subcategoría desde el texto.

## Pendiente / próximo

- [ ] Mostrar los gastos sueltos de insumos con `vendor_id=cleaner` dentro del
      modal de historial del cleaner (`AseoClient.tsx`, sección historial).
- [ ] Cuando se hace `payoutCleanerConsolidated`, incluir también esos gastos
      sueltos pendientes (subcategory='cleaning', vendor_id=cleaner, status='pending')
      como insumos a reembolsar y marcarlos como paid en la misma transacción.
- [ ] Banner en `ExpenseModal` modo create: "Mejor usa el selector ➜".

## Fase 2.1 — Gasto compartido y período cubierto (factura única, varias propiedades)

- [x] `PropertyExpenseForm` permite marcar **"Esta factura se comparte entre
      varias propiedades"** y elegir 2+ propiedades.
- [x] Split: **equitativo** (con `splitMoney` para evitar centavos perdidos) o
      **manual por propiedad** con validación "suma = total".
- [x] Cuando el tipo es **fijo**, aparece bloque "Período que cubre este pago"
      con fecha desde/hasta. Se persiste como prefijo legible
      `[Período: YYYY-MM-DD → YYYY-MM-DD]` en la descripción y se mantiene
      editable después.
- [x] Nuevo servicio `updateExpenseGroup(groupId, patch)` que actualiza estado,
      banco y fecha de pago de **todas** las filas hermanas en una sola query.
- [x] Al editar una fila que tiene `expense_group_id`, `ExpenseModal` muestra
      banner morado **"Aplicar a las N propiedades del grupo"** (activo por
      defecto). Cambios de status/banco/date se replican; descripción/monto/
      vendor siguen siendo per-fila. La data table sigue mostrando una fila
      por propiedad (no se cambia el visual existente).

## Fase 6 — QA / verificación

- [ ] Crear gasto de cada tipo y verificar que aparece en el filtro/sección correctos.
- [ ] Editar un gasto creado por flow y confirmar que el modal genérico
      mantiene la integridad.
- [ ] `npx astro check` sin errores.

## Notas de diseño

- Los flows nuevos usan los mismos services existentes (`createExpense`,
  `payoutCleanerConsolidated`, `reportDamage`, …) — no duplicar lógica de
  persistencia.
- Cada flow valida que no se creen daños huérfanos (sin booking) ni gastos
  sobre propiedad con booking_id incoherente.
- Misma sensación visual: usar `motion.div` con backdrop, mismas paletas que
  ExpenseModal.

## Orden sugerido de ejecución

1. Bugs corregidos (✅ ya hecho)
2. ExpenseTypeChooser + wiring del botón principal (Fase 1)
3. PropertyExpenseForm + VendorExpenseForm (Fase 2 a/e)
4. DamageReportFlow + CleaningSuppliesForm + atajo de Liquidación (Fase 2 b/c/d)
5. UX cruzado (Fase 3)
6. Limpieza modal + datos (Fases 4 y 5)
7. QA (Fase 6)
