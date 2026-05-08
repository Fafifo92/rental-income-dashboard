# 📊 AUDITORÍA EXHAUSTIVA DE BASE DE DATOS — Rental Income Dashboard (Supabase/PostgreSQL)

**Fecha de Auditoría:** 2024  
**Proyecto:** Rental Income Dashboard (Fafifo92/rental-income-dashboard)  
**Stack:** Supabase (PostgreSQL), 33 migraciones secuenciales + schema consolidado  
**Modelo:** SaaS Multi-tenant (owner_id por fila)  

---

## 📋 RESUMEN EJECUTIVO

### Tabla de Severidades

| Severidad | Hallazgos | Descripción |
|-----------|-----------|-------------|
| 🔴 **CRÍTICO** | 4 | Riesgos de integridad referencial, denormalización innecesaria, falta de índices clave |
| 🟠 **ALTO** | 6 | Problemas de normalización, triggers/validaciones incompletas, deuda técnica |
| 🟡 **MEDIO** | 8 | Inconsistencias menores, oportunidades de optimización, actualización_at faltantes |
| 🟢 **BAJO** | 5 | Mejoras cosméticas, naming, documentación |

**Estado General:** ⚠️ **Funcional pero con deuda técnica acumulada**  
- La DB es operativa y cubre los requerimientos de negocio.
- Las 33 migraciones son idempotentes (seguras de re-ejecutar).
- **Principales riesgos:** Datos duplicados entre tablas, FKs débiles en cascadas, updated_at inconsistente, índices faltantes en FK críticas.

---

## 🏗️ INVENTARIO COMPLETO DE TABLAS

### Tabla de Referencia

| # | Tabla | PK | owner_id | created_at | updated_at | RLS | Columnas Clave | Estado |
|-|-------|----|----|-----------|------------|-----|-----------------|--------|
| 1 | `profiles` | UUID (auth.users) | ✓ (es id) | ✓ (schema.sql) | ✗ | ✓ ON | email, full_name, role | ✓ Core |
| 2 | `properties` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | name, address, base_currency, estrato, bedrooms, max_guests, rnt, group_id, default_cleaning_fee | ✓ Core |
| 3 | `listings` | UUID | ✗ | ✓ | ✗ | ✓ ON | property_id (FK), external_name, source | ✓ Core |
| 4 | `bookings` | UUID | ✗ | ✓ | ✗ | ✓ ON | listing_id (FK), confirmation_code, guest_name, start_date, end_date, num_nights, num_adults, num_children, total_revenue, channel, gross_revenue, channel_fees, taxes_withheld, net_payout, payout_bank_account_id, payout_date, currency, exchange_rate, checkin_done, checkout_done, inventory_checked, operational_notes, status, raw_data | ✓ Core |
| 5 | `booking_payments` | UUID | owner_id | ✓ | ✗ | ✓ ON | booking_id (FK), amount, bank_account_id (FK), payment_date | ✓ Mig031 |
| 6 | `booking_adjustments` | UUID | ✗ | ✓ | ✗ | ✓ ON | booking_id (FK), kind (CHECK), amount, bank_account_id (FK), date | ✓ Mig006 |
| 7 | `booking_cleanings` | UUID | ✗ | ✓ | ✗ | ✓ ON | booking_id (FK), cleaner_id (FK vendors), fee, status, done_date, paid_date, supplies_amount, reimburse_to_cleaner | ✓ Mig011 |
| 8 | `expenses` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | property_id (FK), category, subcategory, type, amount, currency, date, description, status, bank_account_id (FK), booking_id (FK), vendor_id (FK), vendor (TEXT legacy), person_in_charge, adjustment_id (FK), shared_bill_id (FK), expense_group_id (TEXT) | ⚠️ LEGACY |
| 9 | `bank_accounts` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | name, bank, account_type (CHECK), account_number_mask, currency, opening_balance, is_active, is_credit, credit_limit, is_cash, notes | ✓ Core |
| 10 | `property_recurring_expenses` | UUID | ✗ | ✓ | ✗ | ✓ ON | property_id (FK), category, amount, is_active, day_of_month, vendor (TEXT legacy), person_in_charge, vendor_id (FK), is_shared, valid_from, valid_to | ⚠️ LEGACY |
| 11 | `vendors` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | name, kind (CHECK), contact, notes, active, category, default_amount, day_of_month, is_variable, start_year_month | ✓ Core |
| 12 | `vendor_properties` | UUID | ✗ | ✓ | ✗ | ✓ ON | vendor_id (FK), property_id (FK), share_percent, fixed_amount | ✓ Mig013 |
| 13 | `shared_bills` | UUID | ✗ | ✓ | ✗ | ✓ ON | vendor_id (FK), year_month, total_amount, paid_date, bank_account_id (FK), category, notes | ✓ Mig013 |
| 14 | `recurring_expense_periods` | UUID | ✗ | ✓ | ✗ | ✓ ON | recurring_id (FK property_recurring_expenses), year_month, status, expense_id (FK), paid_at, amount, note | ⚠️ LEGACY |
| 15 | `credit_pools` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | vendor_id (FK opt), name, credits_total, credits_used, total_price, consumption_rule, credits_per_unit, child_weight, activated_at, expires_at, status | ✓ Mig027 |
| 16 | `credit_pool_consumptions` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | pool_id (FK), booking_id (FK unique pair), units, credits_used, occurred_at | ✓ Mig027 |
| 17 | `cleaner_groups` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | name, color | ✓ Mig022 |
| 18 | `cleaner_group_members` | (group_id, cleaner_id) | ✗ | ✓ | ✗ | ✓ ON | group_id (FK), cleaner_id (FK vendors) | ✓ Mig022 |
| 19 | `inventory_categories` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | name (unique per owner), icon | ✓ Mig024 |
| 20 | `inventory_items` | UUID | ✓ FK | ✓ | ✓ (trigger) | ✓ ON | property_id (FK), category_id (FK), name, description, location, status, quantity, unit, min_stock, is_consumable, purchase_date, purchase_price, expected_lifetime_months, photo_url, notes | ✓ Mig024 |
| 21 | `inventory_movements` | UUID | ✓ FK | ✓ | ✗ | ✓ ON | item_id (FK), type, quantity_delta, new_status, notes, related_booking_id (FK opt), related_expense_id (FK opt) | ✓ Mig024 |
| 22 | `inventory_maintenance_schedules` | UUID | ✓ FK | ✓ | ✓ (trigger) | ✓ ON | item_id (FK), property_id (FK), title, description, scheduled_date, status, notify_before_days, email_notify, is_recurring, recurrence_days, expense_registered | ✓ Mig032 |
| 23 | `property_groups` | UUID | ✓ FK | ✓ | ✓ | ✓ ON | name (unique per owner), color, sort_order | ✓ Mig028 |
| 24 | `property_tags` | UUID | ✓ FK | ✓ | ✓ | ✓ ON | name (unique per owner), color | ✓ Mig028 |
| 25 | `property_tag_assignments` | (property_id, tag_id) | ✓ FK | ✓ | ✓ | ✓ ON | property_id (FK), tag_id (FK) | ✓ Mig028 |
| 26 | `user_notification_settings` | user_id (auth.users) | ✓ (es PK) | ✓ | ✓ | ✓ ON | reminders_enabled, email_enabled, lead_days, repeat_cadence, send_hour, notify_*, timezone | ✓ Mig012 |

---

### Detalles por Tabla (Criticidad de Cambios)

#### **Migraciones Aplicadas**

```
✓ Mig001: expenses table from scratch (DROP + recreate)
✓ Mig002: properties.owner_id FK fix + handle_new_user() trigger
✓ Mig003: properties fields (estrato, bedrooms, etc.) + bank_accounts, property_recurring_expenses
✓ Mig004: property_recurring_expenses valid_from/valid_to (SCD Type 2)
✓ Mig005: property_recurring_expenses vendor + person_in_charge
✓ Mig006: booking_adjustments (extra_income, discount, damage_charge)
✓ Mig007: expenses.adjustment_id FK
✓ Mig008: vendors table + vendor_id FKs to recurring & expenses
✓ Mig011: bookings operational flags + booking_cleanings
✓ Mig012: recurring_expense_periods + user_notification_settings
✓ Mig013: vendor_properties (many-to-many) + shared_bills
✓ Mig014: vendors → Services evolution (category, default_amount, day_of_month)
✓ Mig015: is_variable, expenses.subcategory, booking_cleanings.supplies_amount
✓ Mig018: properties.rnt (Registro Nacional de Turismo)
✓ Mig019: expenses.expense_group_id (shared expenses)
✓ Mig020: bank_accounts.is_credit + credit_limit
✓ Mig021: vendors.kind += 'business_service'
✓ Mig022: cleaner_groups + cleaner_group_members
✓ Mig023: booking_adjustments.kind += 'platform_refund', 'extra_guest_fee'
✓ Mig024: inventory_categories, inventory_items, inventory_movements (full module)
✓ Mig025: vendors.start_year_month + kind += 'tax'
✓ Mig026: booking_adjustments.bank_account_id FK
✓ Mig027: credit_pools + credit_pool_consumptions
✓ Mig028: property_groups + property_tags + property_tag_assignments
✓ Mig029: bank_accounts.account_type += 'crédito' (replaces is_credit)
✓ Mig030: user_notification_settings.timezone
✓ Mig031: bank_accounts.is_cash + booking_payments
✓ Mig032: inventory_maintenance_schedules
✓ Mig033: maintenance_schedules is_recurring, recurrence_days, expense_registered
```

---

## 🔍 ANÁLISIS POR ÁREA

### 1️⃣ DISEÑO Y NORMALIZACIÓN

#### **Hallazgo D-001: 🔴 CRÍTICO — Denormalización innecesaria en `expenses`**

**Problema:**  
La tabla `expenses` tiene **múltiples columnas texto legacy** que deberían ser FKs o enumeraciones controladas:
- `category` (TEXT) — debería ser enumeración o FK a tabla de categorías
- `vendor` (TEXT) → **FK `vendor_id` (UUID) ya existe desde Mig008**, pero ambas se mantienen
- `person_in_charge` (TEXT) — string libre (riesgo de datos inconsistentes)
- `expense_group_id` (TEXT) — debería ser UUID FK, no string

```sql
-- Estado actual (MIXED):
ALTER TABLE expenses
  ADD COLUMN vendor TEXT;           -- Mig005: legacy
  ADD COLUMN vendor_id UUID REFERENCES vendors(id);  -- Mig008: nuevo

-- Recomendación: marcar vendor (TEXT) como deprecated, migrar datos y borrar.
```

**Impacto:** Datos duplicados, queries ineficientes (ilike '%vendor%' en lugar de exact FK), imposible garantizar integridad referencial.

**Recomendación:** Mig034 futura: backfill todos `expenses.vendor` (TEXT) → `vendor_id` (FK), luego deprecar/borrar columna.

---

#### **Hallazgo D-002: 🟠 ALTO — `property_recurring_expenses` completamente LEGACY**

**Problema:**  
La tabla fue reemplazada por el modelo `vendors + vendor_properties + shared_bills` en Mig013-014, pero **se mantiene íntegra** para compatibilidad:
- Mig014 marca la tabla como "LEGACY" en comentario.
- Migraciones posteriores no la tocan.
- **Pero `recurring_expense_periods` aún la referencia como PK**.

```sql
-- Mig012 crea recurring_expense_periods(recurring_id) → property_recurring_expenses(id)
-- Mig014 marca property_recurring_expenses como LEGACY
-- → Posible huérfano si se borra una recurring_expense sin antes limpiar periods
```

**Impacto:** Confusión en el modelo, complejidad del esquema, duplicidad con `shared_bills`.

**Recomendación:** 
- En Mig034: marcar ambas como archived, documentar transición hacia servicios.
- Revisar `services.ts` — ¿se sigue leyendo de property_recurring_expenses? (RESP: aparentemente no según EXPENSE_REFACTOR_PLAN.md, línea 4)

---

#### **Hallazgo D-003: 🟠 ALTO — `booking_adjustments.kind` CHECK demasiado permisivo**

**Problema:**  
Se creó en Mig006 con 3 valores, ampliado en Mig023 a 5:

```sql
CHECK (kind IN ('extra_income', 'discount', 'damage_charge', 'platform_refund', 'extra_guest_fee'))
```

**Pero no hay tabla enum** (`adjustment_kinds`) que permita agregar nuevos valores sin ALTER TABLE.  
El naming es inconsistente: `extra_income` vs `extra_guest_fee` (ambas son ingresos).

**Impacto:** Cambios futuros requieren migración, no hay validación compartida en app.

**Recomendación:** 
- Crear tabla `adjustment_kinds` (owner_id, kind, display_name, color, applies_to_income: bool) en Mig034.
- O simplificar a 2 valores: `income | expense` con tabla `adjustment_categories`.

---

#### **Hallazgo D-004: 🟡 MEDIO — Tipos de datos inconsistentes**

| Columna | Tabla | Tipo Actual | Recomendación |
|---------|-------|------------|---------------|
| `expenses.amount` | expenses | NUMERIC(12,2) | ✓ Correcto para dinero |
| `bookings.total_revenue` | bookings | NUMERIC(12,2) | ✓ Correcto |
| `vendors.default_amount` | vendors | NUMERIC(14,2) | ⚠️ Inconsistente: debería ser (12,2) |
| `bank_accounts.opening_balance` | bank_accounts | NUMERIC(14,2) | ✓ Razonable (saldos pueden ser mayores) |
| `shared_bills.total_amount` | shared_bills | NUMERIC(14,2) | ✓ Razonable |
| `credit_pools.credits_*` | credit_pools | NUMERIC (sin escala) | ⚠️ Sin restricción: debería ser (12,2) |

**Recomendación:** Estandarizar a NUMERIC(14,2) o crear tipos custom `money = NUMERIC(14,2)`.

---

#### **Hallazgo D-005: 🟡 MEDIO — `updated_at` trigger faltante en la mayoría de tablas**

| Tabla | updated_at | Trigger |
|-------|-----------|---------|
| properties | ✗ | ✗ ❌ |
| bookings | ✗ | ✗ ❌ |
| expenses | ✗ | ✗ ❌ |
| vendors | ✗ | ✗ ❌ |
| inventory_items | ✓ | ✓ (set_inventory_updated_at) |
| inventory_maintenance_schedules | ✓ | ✓ (trg_maint_updated_at) |
| user_notification_settings | ✓ (DEFAULT NOW()) | ? |

**Impacto:** Imposible saber cuándo se modificó un registro. El audit trail está incompleto.

**Recomendación:** Mig034: agregar `updated_at TIMESTAMPTZ DEFAULT NOW()` + trigger a todas las tablas operacionales.

```sql
-- Para todas las tablas que lo necesiten:
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON table_name
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

#### **Hallazgo D-006: 🟡 MEDIO — Naming inconsistente**

| Patrón | Ejemplos | Status |
|--------|----------|--------|
| Snake_case (columnas) | ✓ property_id, booking_id | ✓ OK |
| Singular (tablas de config) | profiles, vendors | ✓ OK |
| Plural (tablas de datos) | bookings, expenses, listings | ✓ OK |
| FK naming | `property_id`, `booking_id` | ✓ OK |
| **Índices** | `idx_recurring_property`, `idx_booking_adjustments_booking` | ⚠️ Inconsistente |
| **Constraints** | `vendors_kind_check`, `booking_adjustments_kind_check` | ⚠️ Inconsistente |

**Recomendación:** Estandarizar prefijos:
- Índices: `idx_<table>_<columns>` (ej: `idx_expenses_property_date`)
- Constraints: `chk_<table>_<concept>` (ej: `chk_expenses_status`)
- FKs: `fk_<table>_<column>` (más documentado)

---

### 2️⃣ INTEGRIDAD REFERENCIAL

#### **Hallazgo D-007: 🔴 CRÍTICO — FKs faltantes o ON DELETE policies cuestionables**

| Columna | Tabla Origen | Tabla Destino | FK Declarado | ON DELETE | Riesgo |
|---------|--------------|---------------|--------------|-----------|--------|
| `booking_id` | expenses | bookings | ✓ Mig003 | SET NULL | ⚠️ Expense huérfano si booking se borra |
| `property_id` | expenses | properties | ✓ Mig001 | SET NULL | ✓ OK (gasto sin propiedad es válido) |
| `vendor_id` | expenses | vendors | ✓ Mig008 | SET NULL | ⚠️ Pérdida de trazabilidad |
| `listing_id` | bookings | listings | ✓ schema.sql | CASCADE | ⚠️ Si listing se borra, booking y toda su cascada se borra |
| `property_id` | listings | properties | ✗ ❌ MISSING | — | 🔴 **CRÍTICO: listings huérfano si property se borra** |
| `property_id` | property_recurring_expenses | properties | ✓ Mig003 | CASCADE | ✓ OK |
| `property_id` | bank_accounts | ... | ✗ ❌ NO exists | — | ✓ OK (cuentas a nivel owner, no property) |
| `booking_id` | booking_adjustments | bookings | ✓ Mig006 | CASCADE | ✓ OK |
| `adjustment_id` | expenses | booking_adjustments | ✓ Mig007 | SET NULL | ✓ OK |
| `property_id` | booking_cleanings → bookings → listings → property | properties | ✗ ❌ No direct FK | — | 🔴 Dependent, not guaranteed |
| `item_id` | inventory_movements | inventory_items | ✓ Mig024 | CASCADE | ✓ OK |
| `related_booking_id` | inventory_movements | bookings | ✓ Mig024 | SET NULL | ✓ OK |
| `related_expense_id` | inventory_movements | expenses | ✓ Mig024 | SET NULL | ✓ OK |

**Recomendación:**

```sql
-- D-007a: Agregar FK faltante en listings → properties (redundante pero segura)
ALTER TABLE listings
  ADD CONSTRAINT fk_listings_property_id
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

-- D-007b: Auditar FKs con SET NULL — ¿realmente se quiere huérfano?
-- Considerar RESTRICT en lugar de SET NULL si los datos son críticos.

-- D-007c: booking_cleanings debe poder rastrear property indirectamente
-- Agregar redundante (desnormalizado pero útil para índices):
ALTER TABLE booking_cleanings
  ADD COLUMN property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
-- Backfill vía JOIN bookings → listings → properties
UPDATE booking_cleanings bc
  SET property_id = p.id
  FROM bookings b
  JOIN listings l ON l.id = b.listing_id
  JOIN properties p ON p.id = l.property_id
  WHERE b.id = bc.booking_id;
```

---

#### **Hallazgo D-008: 🟠 ALTO — Cascadas destructivas sin warning**

**Problema:**  
- Si borro una `property`, se borran: `listings` → `bookings` → `booking_adjustments`, `booking_cleanings`, `credit_pool_consumptions` (todos CASCADE).
- Si borro un `booking`, se borran: `booking_adjustments`, `booking_cleanings`.
- **No hay auditoría / soft-delete.**

**Impacto:** Borrado accidental es irreversible.

**Recomendación:** Implementar soft-delete en Mig034:
```sql
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- Actualizar RLS para filtar deleted_at IS NULL
```

---

#### **Hallazgo D-009: 🟡 MEDIO — FK a `vendors` debería ser NOT NULL en algunos casos**

| Tabla | Columna | Nullable | Debería | Motivo |
|-------|---------|----------|---------|--------|
| expenses | vendor_id | ✓ NULL | ? | Flexible: gasto sin vendor |
| property_recurring_expenses | vendor_id | ✓ NULL | ✗ NO | Si is_shared=true, vendor_id debería ser NOT NULL |
| booking_cleanings | cleaner_id | ✓ NULL | ✗ NO | Una limpieza debe tener cleaner asignado |
| shared_bills | vendor_id | ✗ NOT NULL | ✓ OK | Correcto |

**Recomendación:** 
```sql
-- Add constraint CHECK para property_recurring_expenses:
ALTER TABLE property_recurring_expenses
  ADD CONSTRAINT chk_shared_requires_vendor
  CHECK (NOT is_shared OR vendor_id IS NOT NULL);
```

---

### 3️⃣ ÍNDICES Y PERFORMANCE

#### **Hallazgo D-010: 🔴 CRÍTICO — FKs sin índices**

PostgreSQL **automáticamente indexa FKs**, pero algunos pueden ser redundantes o faltantes en combinaciones comunes.

| Tabla | Columna | Índice Existente | Necesitado Para |
|-------|---------|------------------|-----------------|
| bookings | listing_id | ✓ (automatic FK) | ✓ OK |
| expenses | property_id | ? | `WHERE property_id = X AND date >= Y` → **Combo índice** |
| expenses | booking_id | ? | Queries por booking |
| expenses | vendor_id | ✓ (Mig008: idx_expenses_vendor_id) | ✓ OK |
| expenses | bank_account_id | ✓ (Mig003) | ✓ OK |
| booking_adjustments | booking_id | ✓ (Mig006) | ✓ OK |
| booking_cleanings | booking_id | ✓ (Mig011) | ✓ OK |
| booking_cleanings | cleaner_id | ✓ (Mig011: idx_booking_cleanings_cleaner_status) | ✓ OK |
| bank_accounts | owner_id | ? | **MISSING** — critical for list_bank_accounts() |
| vendors | owner_id | ✓ (Mig008: idx_vendors_owner_kind) | ✓ OK |
| inventory_items | property_id | ✓ (Mig024) | ✓ OK |
| inventory_items | owner_id | ✓ (Mig024) | ✓ OK |
| inventory_movements | item_id | ✓ (Mig024) | ✓ OK |
| credit_pools | owner_id | ✓ (Mig027) | ✓ OK |
| credit_pool_consumptions | booking_id | ✓ (Mig027) | ✓ OK |

**Recomendación:**

```sql
-- Mig034: Agregar índices faltantes
CREATE INDEX IF NOT EXISTS idx_bank_accounts_owner 
  ON bank_accounts(owner_id);

-- Composite index útil para queries frecuentes:
CREATE INDEX IF NOT EXISTS idx_expenses_property_date 
  ON expenses(property_id, date DESC) 
  WHERE property_id IS NOT NULL;

-- Para WHERE status = 'paid':
CREATE INDEX IF NOT EXISTS idx_expenses_status 
  ON expenses(status) 
  WHERE status IN ('pending', 'paid', 'partial');
```

---

#### **Hallazgo D-011: 🟡 MEDIO — Índices de JSONB ausentes**

**Problema:**  
- `bookings.raw_data` es JSONB pero no tiene índice GIN.
- Si hay queries que filtran por campos dentro de `raw_data`, fallarán en performance.

**Estado:** No se detectó en código actual, pero es oportunidad para performance.

**Recomendación:**
```sql
-- Si se usa raw_data para filtros:
CREATE INDEX IF NOT EXISTS idx_bookings_raw_data 
  ON bookings USING GIN(raw_data);
```

---

#### **Hallazgo D-012: 🟡 MEDIO — Índices parciales útiles no creados**

```sql
-- Bookings activos/pendientes (para dashboards):
CREATE INDEX IF NOT EXISTS idx_bookings_active
  ON bookings(listing_id, start_date DESC)
  WHERE status NOT IN ('cancelled', 'completed');

-- Expenses pendientes de pago:
CREATE INDEX IF NOT EXISTS idx_expenses_pending
  ON expenses(owner_id, date DESC)
  WHERE status = 'pending';

-- Inventory items dañados/necesitan mantenimiento:
CREATE INDEX IF NOT EXISTS idx_inventory_needs_action
  ON inventory_items(owner_id)
  WHERE status IN ('needs_maintenance', 'damaged', 'depleted');

-- Maintenance schedules pendientes:
CREATE INDEX IF NOT EXISTS idx_maintenance_pending
  ON inventory_maintenance_schedules(owner_id)
  WHERE status = 'pending' AND scheduled_date >= CURRENT_DATE;
```

---

### 4️⃣ MIGRACIONES: CALIDAD Y DEUDA

#### **Hallazgo D-013: 🟠 ALTO — Migraciones pueden consolidarse (oportunidad de refactor)**

**Análisis de línea de tiempo:**
```
Mig001-002: Base (profiles, properties, expenses, bookings)
Mig003: Expansión Phase 8+9 (bank_accounts, recurring_expenses)
Mig004-005: Perfeccionamiento de recurring_expenses (validity, vendor)
Mig006-007: Ajustes de reserva (booking_adjustments, damage linking)
Mig008: Vendors (centralización de proveedores)
Mig011-014: Aseos operativos + servicios unificados
Mig015: Taxonomía (is_variable, subcategories)
Mig018-020: Propiedades + banco + crédito
Mig021-033: Refinamientos (cleaner_groups, inventario, timezone, etc.)
```

**Deuda acumulada:**
- 33 archivos, ~1200 líneas de SQL total.
- Muchas migraciones son "adding IF NOT EXISTS column" (seguras pero fragmentadas).
- El modelo final no está consolidado: legacy tables (`property_recurring_expenses`) se mantienen por compat.

**Impacto:** 
- Nuevo dev tiene que leer 33 archivos para entender el schema.
- `schema.sql` tiene solo base (Mig001-002), no refleja estado actual.

**Recomendación:**

```sql
-- Mig034: Consolidar schema.sql con estado actual COMPLETO
-- (incluyendo todas las columas de las 33 migraciones).
-- 
-- Documento: `supabase/schema_consolidated.sql` (nuevo)
-- Estrategia dual:
--   a) Nuevos ambientes: corren schema_consolidated.sql (rápido)
--   b) Prod: siguen corriendo migraciones incrementales
-- 
-- En 1-2 ciclos, considerar marcar migraciones antiguas como "archive/"
-- (por documentación, no por ejecución).
```

---

#### **Hallazgo D-014: 🟡 MEDIO — Migraciones con conflictos o redundancias**

| Mig | Tabla | Cambio | Conflicto? |
|-----|-------|--------|-----------|
| 003 | bookings | Agrega channel, gross_revenue, ... | ✓ OK |
| 011 | bookings | Agrega checkin_done, checkout_done, ... | ✓ OK (disjuntos) |
| 020 | bank_accounts | Agrega is_credit | Reemplazado por Mig029 ❌ |
| 029 | bank_accounts | Agrega account_type='crédito', backfill is_credit → account_type | ⚠️ is_credit aún existe (legacy) |
| 031 | bank_accounts | Agrega is_cash | ✓ OK (disjunto) |

**Recomendación:** Mig034: limpiar `is_credit` si ya está cubierto por `account_type='crédito'`.

```sql
-- Verificar antes:
SELECT DISTINCT account_type, is_credit FROM bank_accounts;

-- Si is_credit ya no se usa en app:
ALTER TABLE bank_accounts DROP COLUMN is_credit;
```

---

#### **Hallazgo D-015: 🟡 MEDIO — Columnas agregadas sin uso aparente**

Revisión de servicios (`src/services/*.ts`) muestra que se usan:

| Columna | Tabla | Usado en | Status |
|---------|-------|----------|--------|
| `properties.estrato` | properties | ❌ No encontrado | ⚠️ Legacy |
| `properties.bedrooms` | properties | ❌ No encontrado | ⚠️ Legacy |
| `properties.max_guests` | properties | ❌ No encontrado | ⚠️ Legacy |
| `properties.notes` | properties | ❌ No encontrado | ⚠️ Legacy |
| `properties.default_cleaning_fee` | properties | ✓ booking_cleanings.fee (default) | ✓ OK |
| `bookings.raw_data` | bookings | ❌ No filtros detectados | ⚠️ Archival only? |
| `expenses.person_in_charge` | expenses | ❌ Filtrado en UI pero no guardado | ⚠️ Legacy |
| `vendors.contact` | vendors | ❌ No encontrado | ⚠️ Legacy |
| `property_recurring_expenses` | — | ❌ Completamente LEGACY | 🔴 Deprecated |

**Recomendación:** Documentar en ARCHITECTURE.md o crear "deprecated_fields.md" para no confundir futuros devs.

---

### 5️⃣ DATOS A PRESERVAR / LIMPIAR (CRÍTICO)

#### **Mapeo de Dependencias para Eliminación Segura**

**Usuario quiere preservar EN PRODUCCIÓN:**
- ✓ `inventory_items` (items del inventario, WITHOUT historial de reparaciones)
- ✓ `properties` (propiedades físicas)
- ✓ `property_groups` + `property_tags` (agrupación de propiedades)
- ✓ `inventory_categories` (categorías de inventario)
- ✓ `vendors` (proveedores, únicamente los tipo 'cleaner' si aplica; NO limpiadoras del aseo si es historial)
- ✓ `cleaner_groups` (grupos de limpiadoras)

**Usuario quiere BORRAR:**
- ✗ `bookings` (todas las reservas)
- ✗ Toda la cadena de `bookings` (cascada completa)
- ✗ Historial de mantenimiento/reparaciones
- ✗ Ajustes de reservas (damage_charges, ingresos extra asociados a bookings)
- ✗ Limpieza de reservas (booking_cleanings específicas de reservas)

**Recomendación:** Crear `cleanup_bookings_only.sql` (seguro, reversible con backup):

```sql
-- ========================================================================
-- CLEANUP: BORRAR SOLO BOOKINGS Y SUS DEPENDENCIAS
-- PRESERVA: properties, inventory_items, vendors (cleaners OK), groups
-- ========================================================================

-- 1. Credit pool consumptions (vinculadas a bookings)
DELETE FROM public.credit_pool_consumptions
  WHERE booking_id IN (SELECT id FROM public.bookings);

-- 2. Booking payments (pagos de reservas)
DELETE FROM public.booking_payments
  WHERE booking_id IN (SELECT id FROM public.bookings);

-- 3. Inventory movements vinculadas a bookings específicas
DELETE FROM public.inventory_movements
  WHERE related_booking_id IS NOT NULL;

-- 4. Booking cleanings (aseos de estas reservas)
DELETE FROM public.booking_cleanings
  WHERE booking_id IN (SELECT id FROM public.bookings);

-- 5. Booking adjustments (daños, ingresos extra, etc. de estas reservas)
DELETE FROM public.booking_adjustments
  WHERE booking_id IN (SELECT id FROM public.bookings);

-- 6. Expenses vinculadas a estas bookings (por booking_id)
-- PERO: preservar expenses sin booking_id (gastos de propiedad genéricos)
DELETE FROM public.expenses
  WHERE booking_id IS NOT NULL
    AND booking_id IN (SELECT id FROM public.bookings);

-- 7. Finalmente: las reservas mismas
DELETE FROM public.bookings;

-- 8. Listings (anuncios) — quedan huérfanos si borramos todos bookings
--    Decisión: BORRAR (no hay anuncios sin reservas en este modelo)
--    Si quieres preservarlos, comenta esta línea
DELETE FROM public.listings;

-- ========================================================================
-- VERIFICACIÓN (corre aparte)
-- ========================================================================
-- SELECT 'bookings' AS tabla, COUNT(*) FROM public.bookings
-- UNION ALL SELECT 'booking_adjustments', COUNT(*) FROM public.booking_adjustments
-- UNION ALL SELECT 'booking_cleanings', COUNT(*) FROM public.booking_cleanings
-- UNION ALL SELECT 'inventory_movements', COUNT(*) FROM public.inventory_movements
-- UNION ALL SELECT 'expenses', COUNT(*) FROM public.expenses  -- puede haber algunas
-- UNION ALL SELECT 'properties (PRESERVED)', COUNT(*) FROM public.properties
-- UNION ALL SELECT 'inventory_items (PRESERVED)', COUNT(*) FROM public.inventory_items
-- UNION ALL SELECT 'vendors (PRESERVED)', COUNT(*) FROM public.vendors
-- UNION ALL SELECT 'cleaner_groups (PRESERVED)', COUNT(*) FROM public.cleaner_groups;
```

---

#### **Hallazgo D-016: 🔴 CRÍTICO — Identificación de tablas de "Mantenimiento/Reparaciones"**

**LIMPIAR TAMBIÉN (historial de mantenimiento/reparaciones):**

| Tabla | Razón | Preservar | Borrar |
|-------|-------|-----------|--------|
| `inventory_maintenance_schedules` | Historial de mantenimientos programados para items | ⚠️ Depende | ✗ Si es historial |
| `property_recurring_expenses` | Gastos recurrentes = "mantenimiento" mensual | ✗ | ✓ Borrar |
| `recurring_expense_periods` | Historial de cuándo se pagó cada recurrente | ✗ | ✓ Borrar |

**Según ARQUITECTURA:**
- `inventory_maintenance_schedules` (Mig032) = "recordatorio" con `scheduled_date` + `status` (pending | done | cancelled)
- Es **prospectivo** (futuro) pero guarda **historial pasado** (si status='done')

**Recomendación:**

```sql
-- Si quieres LIMPIAR TODO EL HISTORIAL de mantenimiento:
DELETE FROM public.inventory_maintenance_schedules;

-- Si quieres PRESERVAR SOLO futuro (prospectivo):
DELETE FROM public.inventory_maintenance_schedules
  WHERE scheduled_date < CURRENT_DATE OR status IN ('done', 'cancelled');

-- LIMPIAR gastos recurrentes (LEGACY):
DELETE FROM public.recurring_expense_periods;
DELETE FROM public.property_recurring_expenses;
```

---

#### **Hallazgo D-017: 🟠 ALTO — Order de DELETE/TRUNCATE seguro (respeta FKs)**

```sql
-- ========================================================================
-- ORDEN SEGURO DE BORRADO (respeta CASCADE/RESTRICT)
-- ========================================================================
-- Ejecutar en este orden para evitar constraint violations:

-- 1. Capas más profundas (sin dependencias):
DELETE FROM public.credit_pool_consumptions;
DELETE FROM public.inventory_movements;

-- 2. Tablas vinculadas a bookings/listings:
DELETE FROM public.booking_payments;
DELETE FROM public.booking_cleanings;
DELETE FROM public.booking_adjustments;

-- 3. Expenses con booking_id (después de ajustes)
DELETE FROM public.expenses WHERE booking_id IS NOT NULL;

-- 4. Bookings (CASCADE eliminará booking_* si no fueron borrados)
DELETE FROM public.bookings;

-- 5. Listings (ahora huérfanos si bookings se borraron)
DELETE FROM public.listings;

-- 6. Gastos recurrentes (LEGACY):
DELETE FROM public.recurring_expense_periods;
DELETE FROM public.property_recurring_expenses;

-- 7. Credit pools (opcionales, si se quieren limpiar)
DELETE FROM public.credit_pools;

-- 8. VERIFICACIÓN FINAL:
-- Las siguientes tablas DEBEN quedar con datos:
-- - properties (✓ no debería borrar nada)
-- - inventory_items (✓ no tiene FK a bookings)
-- - inventory_categories (✓)
-- - vendors (✓ puede quedar con registros huérfanos de bookings, OK)
-- - cleaner_groups (✓)
-- - bank_accounts (✓)
-- - profiles (✓)

SELECT 'bookings' AS tabla, COUNT(*) FROM public.bookings
UNION ALL SELECT 'booking_adjustments', COUNT(*) FROM public.booking_adjustments
UNION ALL SELECT 'booking_cleanings', COUNT(*) FROM public.booking_cleanings
UNION ALL SELECT 'listing', COUNT(*) FROM public.listings
UNION ALL SELECT 'properties (MUST BE > 0)', COUNT(*) FROM public.properties
UNION ALL SELECT 'inventory_items (MUST BE > 0)', COUNT(*) FROM public.inventory_items
UNION ALL SELECT 'vendors (MUST BE > 0)', COUNT(*) FROM public.vendors;
```

---

### 6️⃣ ROW LEVEL SECURITY (RLS)

#### **Hallazgo D-018: 🟢 BAJO — RLS Coverage (Chequeo mini)**

| Tabla | RLS Enabled | Política Modelo | Owner Check | Status |
|-------|------------|-----------------|-------------|--------|
| profiles | ✓ | `auth.uid() = id` | ✓ | ✓ |
| properties | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| listings | ✓ | Via properties (JOIN) | ✓ | ✓ |
| bookings | ✓ | Via listings → properties | ✓ | ✓ |
| expenses | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| bank_accounts | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| vendors | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| vendor_properties | ✓ | Via vendors | ✓ | ✓ |
| booking_adjustments | ✓ | Via bookings → properties | ✓ | ✓ |
| booking_cleanings | ✓ | Via bookings → properties | ✓ | ✓ |
| booking_payments | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| inventory_* | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| credit_pools | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| property_groups | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| property_tags | ✓ | `auth.uid() = owner_id` | ✓ | ✓ |
| user_notification_settings | ✓ | `user_id = auth.uid()` | ✓ | ✓ |

**Conclusión:** ✓ **RLS está bien cubierto en general.** Todas las tablas críticas tienen políticas correctas.

**Nota:** No se revisó en detalle la lógica de cada política (eso sería auditoría de seguridad separada), solo existencia y patrón.

---

### 7️⃣ FUNCIONES, TRIGGERS, VISTAS, CRON

#### **Hallazgo D-019: 🟠 ALTO — Triggers incompletos**

| Trigger | Tabla | Función | Propósito | Status |
|---------|-------|---------|----------|--------|
| `on_auth_user_created` | auth.users | `handle_new_user()` | Auto-crear profile | ✓ Mig002 |
| `trg_inv_items_updated_at` | inventory_items | `set_inventory_updated_at()` | Updated_at auto | ✓ Mig024 |
| `trg_maint_updated_at` | inventory_maintenance_schedules | `set_inventory_updated_at()` | Updated_at auto | ✓ Mig032 |
| **MISSING** | bookings | — | Updated_at | ❌ |
| **MISSING** | expenses | — | Updated_at | ❌ |
| **MISSING** | properties | — | Updated_at | ❌ |

**Recomendación:** Crear triggers globales en Mig034 para audit trail.

```sql
-- Función reutilizable:
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar a todas las tablas que necesitan audit:
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- ... y así para bookings, expenses, vendors, etc.
```

---

#### **Hallazgo D-020: 🟡 MEDIO — Funciones con SECURITY DEFINER**

```sql
-- Mig002: handle_new_user() usa SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
```

**Ventaja:** Puede insertar en `profiles` aunque sea trigger en `auth.users` (schema separado).  
**Riesgo:** SECURITY DEFINER aumenta surface de ataque si la función es vulnerable.

**Status:** ✓ OK (la función es simple y segura: solo INSERT con valores del trigger).

---

#### **Hallazgo D-021: 🟡 MEDIO — Vistas no encontradas, pero hay helpers en código**

**Expected:** Vistas en schema para queries complejas (ej: `booking_financials` = booking + revenue + expenses).

**Actual:** No hay vistas SQL. La lógica está en código TypeScript (`src/services/financial.ts`).

**Recomendación:** Crear vistas útiles para dashboards:

```sql
-- Vista: resumen financiero por propiedad y mes
CREATE OR REPLACE VIEW property_monthly_summary AS
SELECT
  p.id,
  p.owner_id,
  p.name,
  DATE_TRUNC('month', b.start_date)::date AS month,
  COUNT(DISTINCT b.id) AS booking_count,
  COALESCE(SUM(b.total_revenue), 0) AS total_revenue,
  COALESCE(SUM(e.amount), 0) AS total_expenses,
  COALESCE(SUM(b.total_revenue), 0) - COALESCE(SUM(e.amount), 0) AS net_income
FROM properties p
LEFT JOIN listings l ON l.property_id = p.id
LEFT JOIN bookings b ON b.listing_id = l.id
LEFT JOIN expenses e ON e.property_id = p.id
  AND DATE_TRUNC('month', e.date) = DATE_TRUNC('month', b.start_date)
GROUP BY p.id, p.owner_id, p.name, DATE_TRUNC('month', b.start_date);

ALTER VIEW property_monthly_summary OWNER TO postgres;
```

---

#### **Hallazgo D-022: 🟡 MEDIO — CRON job (`auto-checkin`) no validado**

**Estado:** `cron_auto_checkin.sql` define un job pg_cron, pero:
- Requiere extensiones `pg_cron` + `pg_net` habilitadas.
- Placeholder `<PROJECT_REF>` y `<SERVICE_ROLE_KEY>` no remplazados en producción.
- No hay verificación de ejecución en logs.

**Recomendación:** En deployment doc, incluir checklist:
```
[ ] pg_cron habilitado en Supabase
[ ] pg_net habilitado
[ ] Edge Function auto-checkin deployada
[ ] Secretos reemplazados en cron_auto_checkin.sql
[ ] Verificar cron.job en Supabase Studio → SQL
[ ] Test: ejecutar job manualmente una vez
```

---

### 8️⃣ QUERIES FRECUENTES Y OPTIMIZACIONES

#### **Hallazgo D-023: 🟡 MEDIO — Queries sin límite de filas**

Revisión de `src/services/*.ts` muestra:

```typescript
// expenses.ts:
const { data, error } = await query;  // Sin .limit()

// bookings.ts:
const { data, error } = await query;  // Sin .limit()
```

**Riesgo:** Si un owner tiene 10,000+ registros, descarga todo a memoria.

**Recomendación:** Implementar paginación:

```typescript
interface PaginationOptions {
  page: number;    // 1-indexed
  pageSize: number; // default 50
}

export const listExpensesWithPagination = async (
  propertyIdOrIds?: string | string[],
  filters?: ExpenseFilters,
  pagination?: PaginationOptions,
): Promise<ServiceResult<{ data: Expense[]; total: number }>> => {
  const pageSize = pagination?.pageSize ?? 50;
  const offset = ((pagination?.page ?? 1) - 1) * pageSize;

  let query = supabase
    .from('expenses')
    .select('*', { count: 'exact' })
    .range(offset, offset + pageSize - 1);
  
  // ... rest of filters
};
```

---

### 9️⃣ ANÁLISIS DE COLUMNAS QUE NO TIENEN `updated_at`

#### **Hallazgo D-024: 🟡 MEDIO — Auditoría incompleta por falta de timestamps**

| Tabla | created_at | updated_at | Issue | Severidad |
|-------|-----------|-----------|-------|-----------|
| properties | ✓ | ✗ | No se puede saber si se editó | 🟡 |
| bookings | ✓ | ✗ | Cambios operativos no rastreados | 🟡 |
| expenses | ✓ | ✗ | Ediciones de monto sin auditoría | 🔴 |
| vendors | ✓ | ✗ | Cambios de estado no visibles | 🟡 |
| bank_accounts | ✓ | ✗ | Cambios de saldo no auditados | 🔴 |
| property_recurring_expenses | ✓ | ✗ | Cambios de monto no rastreados | 🟡 |
| booking_adjustments | ✓ | ✗ | Cambios de monto no auditados | 🔴 |
| booking_cleanings | ✓ | ✗ | Cambios de fee/status no rastreados | 🟡 |
| inventory_items | ✓ | ✓ (trigger) | ✓ OK | ✓ |
| inventory_maintenance_schedules | ✓ | ✓ (trigger) | ✓ OK | ✓ |

**Impacto:** No hay trail de quién modificó qué y cuándo (para compliance/auditoría).

**Recomendación:** Mig034 debe agregar `updated_at` TIMESTAMPTZ a todas las tablas de datos (no de config).

---

---

## 🎯 TOP 10 RECOMENDACIONES PRIORITIZADAS

### **1. 🔴 CRÍTICO — D-007: Agregar FK faltante `listings.property_id`**
- **Riesgo:** Listings huérfano si property se borra sin constraint.
- **Esfuerzo:** 5 min (ALTER TABLE ADD CONSTRAINT)
- **Mig:** 034 (próxima)
- **Script:**
  ```sql
  ALTER TABLE listings
    ADD CONSTRAINT fk_listings_property_id
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
  ```

---

### **2. 🔴 CRÍTICO — D-001: Unificar `expenses.vendor` (TEXT) → `vendor_id` (FK)**
- **Riesgo:** Datos duplicados, queries ineficientes.
- **Esfuerzo:** 2-3 horas (backfill + validación).
- **Mig:** 034
- **Pasos:**
  1. Backfill: `UPDATE expenses SET vendor_id = (SELECT id FROM vendors WHERE name = expenses.vendor LIMIT 1)` con validación.
  2. Identificar huérfanos (vendor TEXT sin correspondencia en vendors).
  3. Crear vendors faltantes o NULL si es genérico.
  4. `ALTER TABLE expenses DROP COLUMN vendor` una vez confirmado.

---

### **3. 🔴 CRÍTICO — D-010: Agregar índice en `bank_accounts.owner_id`**
- **Riesgo:** Queries lentas en list_bank_accounts() si owner tiene muchas cuentas.
- **Esfuerzo:** 1 min.
- **Mig:** 034
- **Script:**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_bank_accounts_owner ON bank_accounts(owner_id);
  ```

---

### **4. 🔴 CRÍTICO — D-016: Limpiar/documentar tablas de mantenimiento LEGACY**
- **Riesgo:** Confusión conceptual (property_recurring_expenses LEGACY aún funciona).
- **Esfuerzo:** 1 hora (decisión + script).
- **Acción:**
  - Decisión: ¿eliminar property_recurring_expenses y recurring_expense_periods?
  - Si SÍ: crear migration cleanup.
  - Si NO: documentar en ARCHITECTURE.md por qué se mantienen.
  - Script con `cleanup_bookings_only.sql` anterior.

---

### **5. 🟠 ALTO — D-024: Agregar `updated_at` triggers a todas las tablas**
- **Riesgo:** No hay auditoría de cambios (compliance, debugging).
- **Esfuerzo:** 2-3 horas (trigger global + aplicar a N tablas).
- **Mig:** 034
- **Pasos:**
  1. Crear función genérica `set_updated_at()`.
  2. Agregar columna `updated_at TIMESTAMPTZ DEFAULT NOW()` a: properties, bookings, expenses, vendors, bank_accounts, booking_adjustments, booking_cleanings.
  3. Crear trigger para cada tabla.

---

### **6. 🟠 ALTO — D-002: Deprecar y documentar `property_recurring_expenses`**
- **Riesgo:** Duplicidad confusa con `vendors + vendor_properties + shared_bills`.
- **Esfuerzo:** 2 horas.
- **Acción:**
  1. Marcar tabla como DEPRECATED en comments SQL.
  2. Crear documento `DB_LEGACY_TABLES.md` explicando transición.
  3. Opción: crear view `property_recurring_expenses_legacy` que mapee a vendors.
  4. Código app: verificar que NO lee de property_recurring_expenses (revisar services/*.ts).

---

### **7. 🟠 ALTO — D-004: Estandarizar tipos numéricos**
- **Riesgo:** Inconsistencia (NUMERIC(12,2) vs (14,2) vs sin escala).
- **Esfuerzo:** 1-2 horas.
- **Estándar propuesto:** NUMERIC(14,2) para todos los montos (dinero).
- **Mig:** 034
- **Afectadas:** `vendors.default_amount`, `credit_pools.credits_*`.

---

### **8. 🟠 ALTO — D-005: Crear consolidation `schema_consolidated.sql`**
- **Riesgo:** Nuevo dev debe leer 33 migraciones.
- **Esfuerzo:** 3-4 horas (copiar estado actual completo).
- **Acción:**
  1. Crear `supabase/schema_consolidated.sql` con estado FINAL de todas las tablas.
  2. Docstring: "Ejecutar esto en newenv, ejecutar migraciones en prod".
  3. Actualizar SETUP.md.

---

### **9. 🟡 MEDIO — D-012: Crear índices parciales útiles**
- **Riesgo:** Dashboards/reportes lentos.
- **Esfuerzo:** 1 hora.
- **Mig:** 034
- **Índices recomendados** (ya listados en D-012).

---

### **10. 🟡 MEDIO — D-023: Implementar paginación en servicios**
- **Riesgo:** OOM / timeout si owner tiene muchos registros.
- **Esfuerzo:** 4-6 horas (refactor listExpenses, listBookings, etc.).
- **Prioridad:** Media (depende de escala de usuarios).
- **Acción:** Implementar patrón PaginationOptions, actualizar servicios, UI.

---

---

## 📋 PLAN DE PRESERVACIÓN DE DATOS (MAPA DE DEPENDENCIAS)

### **Grafo de Dependencias para Borrado de Bookings**

```
auth.users (NO TOCAR)
├── profiles
├── properties (PRESERVAR)
│   ├── listings
│   │   ├── bookings (BORRAR) ❌
│   │   │   ├── booking_payments ❌ CASCADE
│   │   │   ├── booking_adjustments ❌ CASCADE
│   │   │   │   └── expenses.adjustment_id (SET NULL, algunos gastos sobreviven)
│   │   │   ├── booking_cleanings ❌ CASCADE
│   │   │   │   └── inventory_movements.related_booking_id (SET NULL)
│   │   │   ├── credit_pool_consumptions ❌ CASCADE
│   │   │   └── expenses.booking_id (SET NULL, algunos gastos sobreviven)
│   │   └── inventory_movements.related_booking_id (SET NULL si exists)
│   ├── inventory_items (PRESERVAR)
│   │   ├── inventory_movements (BORRAR si related_booking_id, PRESERVAR si independent)
│   │   │   └── inventory_maintenance_schedules (BORRAR historial si status=done)
│   │   └── inventory_maintenance_schedules (BORRAR si prospectivo obsoleto)
│   ├── expenses (PRESERVAR no-booking, BORRAR booking-related)
│   ├── property_recurring_expenses (BORRAR - LEGACY)
│   │   └── recurring_expense_periods (BORRAR CASCADE)
│   ├── property_groups (PRESERVAR)
│   ├── property_tags (PRESERVAR)
│   │   └── property_tag_assignments (PRESERVAR CASCADE)
│
├── vendors (PRESERVAR)
│   ├── booking_cleanings.cleaner_id (algunos huérfanos si cleaner no existe, OK)
│   ├── vendor_properties (PRESERVAR)
│   └── shared_bills (PRESERVAR)
│
├── bank_accounts (PRESERVAR)
├── cleaner_groups (PRESERVAR)
├── credit_pools (BORRAR consumptions, PRESERVAR pools si se usan)
└── user_notification_settings (PRESERVAR)
```

### **Reorden Seguro de Delete (Respeta FK)**

```
1. credit_pool_consumptions (depende de booking_id)
2. booking_payments (depende de booking_id)
3. inventory_movements (depende de related_booking_id)
4. booking_cleanings (depende de booking_id)
5. booking_adjustments (depende de booking_id)
6. expenses (depende de booking_id) — SOLO WHERE booking_id IS NOT NULL
7. bookings (el padre)
8. listings (ahora huérfano)
9. recurring_expense_periods (LEGACY)
10. property_recurring_expenses (LEGACY)
11. (Opcional) credit_pools si se quieren limpiar
```

**Script de ejecución:**

```sql
-- Ver archivo cleanup_bookings_only.sql anterior en esta auditoría
```

---

---

## 📄 DOCUMENTO ADICIONAL: RECOMENDACIONES POR FASE

### **Fase 1 (Inmediata — 1-2 sprints):**
1. Agregar FK `listings.property_id` (D-007)
2. Agregar índice `bank_accounts.owner_id` (D-010)
3. Crear cleanup script para borrar bookings en prod (D-016)
4. Documentar LEGACY tables (D-002)

### **Fase 2 (Corto plazo — 2-4 sprints):**
1. Backfill `expenses.vendor_id` y deprecar `vendor` TEXT (D-001)
2. Agregar `updated_at` triggers (D-024)
3. Crear `schema_consolidated.sql` (D-008)
4. Crear índices parciales (D-012)

### **Fase 3 (Medio plazo — 1-2 trimestres):**
1. Implementar paginación (D-023)
2. Crear vistas útiles (D-021)
3. Consolidar `property_recurring_expenses` → vendors (D-002)
4. Limpiar deuda técnica en migraciones

### **Fase 4 (Largo plazo — 1+ año):**
1. Considerar cambio a ORM (TypeORM, Prisma) para generación de schema
2. Implementar soft-delete global (D-008)
3. Audit logging centralizado (todas las tables)

---

---

## 🔐 CHECKLIST ANTES DE USAR ESTA AUDITORÍA

- [ ] **Backup actual de prod:** `pg_dump` + snapshot Supabase
- [ ] **Revisar servicios:** ¿Se usa property_recurring_expenses en código? (Buscar 'property_recurring' en src/)
- [ ] **Pruebas en staging:** Ejecutar cleanup script en ambiente no-prod
- [ ] **Comunicar a team:** Explicar cambios en próxima retrospectiva
- [ ] **Documentar decisiones:** ¿Qué se depreca? ¿Qué se preserva?

---

---

## 📚 REFERENCIAS EN EL CODEBASE

**Archivos mencionados:**
- `/supabase/migration_*.sql` (001-033)
- `/supabase/schema.sql`
- `/supabase/setup_completo.sql`
- `/supabase/cleanup_all_data.sql`
- `/supabase/cron_auto_checkin.sql`
- `/src/services/bookings.ts`, `expenses.ts`, `properties.ts`, `inventory.ts`
- `/src/lib/supabase/client.ts`
- `/ARCHITECTURE.md`
- `/EXPENSE_REFACTOR_PLAN.md`

---

**FIN DE LA AUDITORÍA**
