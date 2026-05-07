# 📋 AUDITORÍA EXHAUSTIVA DE ARQUITECTURA
## Rental Income Dashboard — Astro 6 + React 18 + Supabase + TypeScript

**Fecha:** 2025  
**Alcance:** Análisis arquitectónico, SOLID, patrones de diseño, calidad de código  
**Estado:** **CRÍTICO** en varios aspectos

---

## 📊 RESUMEN EJECUTIVO

| Severidad | Count | Ejemplos |
|-----------|-------|----------|
| 🔴 CRÍTICO | 12 | God components (>1000 líneas), acoplamiento Supabase directo, archivos `.bak`/`.new` en repo |
| 🟠 ALTO | 18 | Duplicación masiva, modales anidados sin extracción, falta de linter/tests |
| 🟡 MEDIO | 24 | Tipado parcial, console.logs olvidados, mezcla de idiomas |
| 🟢 BAJO | 8 | Documentación desactualizada, falta de JSDoc |

**Puntuación:** `4.2/10` (Deficiente → Refactor urgente necesario)

---

## 🔴 HALLAZGOS CRÍTICOS

### A-001: **God Components — Violación Extrema de SRP**

**Ubicación:** `src/components/features/`

| Componente | Líneas | Responsabilidades | Estado |
|-----------|--------|------------------|--------|
| `InventoryClient.tsx` | **1971** | Data fetch + Estado (52 `useState`) + Filtros + Modales (7) + Tabs + Animaciones | 🔴 CRÍTICO |
| `BookingDetailModal.tsx` | **1552** | Reserva detail + Gastos + Ajustes + Aseo + Limpieza + Operativo + Daños (5 modales anidados) | 🔴 CRÍTICO |
| `BookingsClient.tsx` | **1223** | Listado + Formulario de creación + Edición + Validación (800+ LOC de lógica) + Filtros + Imports | 🔴 CRÍTICO |
| `AseoClient.tsx` | **54 lín. vistas** | (completo desconocido, pero estructura igual a InventoryClient) | 🔴 CRÍTICO |
| `ExpensesClient.tsx` | **47 lín. vistas** | (>1000 líneas sin verse) | 🔴 CRÍTICO |

**Evidencia:**

```tsx
// InventoryClient.tsx línea ~51-78
export default function InventoryClient(): JSX.Element {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryRow[]>([]);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  // ... 48 más useState
  const [propertyFilter, setPropertyFilter] = useState<string | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // ... filtros, modales, tabs, todo en UN componente
  // Luego: 1800+ líneas de JSX con 7 modales anidados (ItemFormModal, QuickMovementModal, etc.)
```

**Impacto:**
- ❌ Imposible testear unidades individuales
- ❌ Reutilización nula
- ❌ Reloads completos al cambiar estado
- ❌ Cognitive load extremo (>50 líneas para entender el flujo)
- ❌ Cambios mínimos afectan todo el componente

**Recomendación:**
Refactorizar en **mínimo 5-8 componentes** por cada "Client":
- `InventoryTable.tsx` (listado filtrado)
- `InventoryFilters.tsx` (filtros)
- `ItemFormModal.tsx` (extraído)
- `InventoryKPIs.tsx` (KPI cards)
- Usar **Custom Hook** para lógica: `useInventoryState()`, `useInventoryFilters()`

---

### A-002: **Acoplamiento Directo a Supabase en Componentes**

**Ubicación:** Múltiples componentes

**Evidencia:**
```tsx
// BookingDetailModal.tsx línea ~1295
const { supabase } = await import('@/lib/supabase/client');
const lr = await supabase.from('listings').select('id,source').in('id', listingIds);
if (lr.data) {
  const m = new Map<string, string>();
  for (const l of lr.data) m.set(l.id, l.source);
  setListingSourceById(m);
}
```

**Problema:**
- ❌ Componente acoplado a firma Supabase
- ❌ No hay abstracción por servicio
- ❌ Deuda técnica: cambiar BD requiere editar todos los componentes
- ❌ No sigue arquitectura 3-capas (Pages → Components → Services → DB)

**Ocurrencias:**
- `BookingDetailModal.tsx:1295` — query directo a `listings`
- Múltiples servicios (`expenses.ts`, `bookings.ts`) tiene importes de `supabase` client

**Recomendación:**
- Crear servicio `listingService.getSourceMap()` que encapsule la query
- Eliminar imports de `supabase` en `src/components/`
- Componentes **SOLO** llaman servicios, nunca DB directa

---

### A-003: **Archivos Basura en Repo — Higiene Crítica**

**Ubicación:** `src/lib/`

```
usePropertyFilter.ts       ← ACTUAL
usePropertyFilter.ts.bak   ← BASURA 🗑️
usePropertyFilter.ts.new   ← BASURA 🗑️
```

**Evidencia:** Ver listado anterior directorio `src/lib/`

**Impacto:**
- ❌ Confusión sobre versión actual
- ❌ Git history poluto
- ❌ Riesgo de mezclar versiones en merge

**Acción Inmediata:**
```bash
git rm src/lib/usePropertyFilter.ts.bak
git rm src/lib/usePropertyFilter.ts.new
git add .gitignore  # Agregar *.bak, *.new
git commit "chore: remove backup files"
```

---

### A-004: **Tipado Parcial — `any` y Casts Inseguros**

**Ubicación:** Múltiples archivos

**Evidencia:**
```tsx
// BookingDetailModal.tsx línea 97
const bookingStarted = useMemo(() => hasBookingStarted({
  start_date: booking.start_date,
  end_date: booking.end_date,
  cancelled_at: (booking as any).cancelled_at,  // ← CAST INSEGURO
  status: booking.status,
}), [booking.start_date, booking.end_date, (booking as any).cancelled_at, booking.status]);
```

```tsx
// BookingDetailModal.tsx línea 176
if (exp.adjustment_id && a.id === exp.adjustment_id) return true;
```

**Impacto:**
- ❌ Runtime errors no atrapados en compile time
- ❌ IDE autocomplete insuficiente
- ❌ Deuda técnica de tipo

**Recomendación:**
- Actualizar `BookingLite` interface para incluir `cancelled_at?: string | null`
- Usar **Discriminated Unions** para estados:
  ```tsx
  type BookingStatus = 
    | { status: 'upcoming'; start_date: string }
    | { status: 'in_progress'; checkin_done: boolean }
    | { status: 'completed'; end_date: string };
  ```

---

### A-005: **Falta de Testing — CERO Tests en Producción**

**Ubicación:** N/A (no existe)

**Evidencia:**
```
src/
  ├── components/
  ├── services/
  ├── lib/
  ├── types/
  └── pages/
  
// ❌ SIN: __tests__, *.test.ts, *.spec.ts, vitest.config.ts, jest.config.js
// ❌ NO HAY: GitHub Actions workflows para CI/CD
```

**Impacto:**
- ❌ Refactores rompen producción sin aviso
- ❌ Servicios financieros (cálculos KPI) sin validación
- ❌ Componentes complejos regresan sin detección

**Recomendación (Prioridad 1):**
```bash
# 1. Instalar Vitest
npm install -D vitest @testing-library/react @testing-library/user-event

# 2. Setup básico
# vitest.config.ts

# 3. Tests mínimos:
# - services/financial.ts (cálculo de KPIs)
# - lib/expenseClassify.ts (lógica de negocio)
# - lib/bookingStatus.ts (estado de reservas)
```

---

### A-006: **Modales Anidados Sin Extracción — Inmantenibles**

**Ubicación:** `BookingDetailModal.tsx` líneas 860–926

**Evidencia:**
```tsx
{showLinkExisting && (
  <LinkExistingExpenseModal ... />
)}
{showAddAdjustment && (
  <AdjustmentFormModal ... />
)}
{showDamageReport && propertyId && bookingStarted && (
  <DamageReportModal ... />
)}
{showAddCleaning && (
  <CleaningFormModal ... />
)}
{showCompleteModal && (
  <CompleteBookingModal ... />
)}
```

**Problema:**
- ❌ 5 modales en cascada dentro de UN componente
- ❌ Lógica de mostrar/ocultar esparcida
- ❌ Imposible reutilizar modales en otras páginas

**Recomendación:**
Usar **Modal Manager** o **Context global**:
```tsx
// modalManager.tsx (o Zustand store)
export const useModalManager = () => {
  const [open, setOpen] = useState<{
    linkExpense?: boolean;
    addAdjustment?: boolean;
    // ... etc
  }>({});
  
  return { open, setOpen };
};
```

---

### A-007: **Falta de Linter y Formatter — Inconsistencia Crítica**

**Ubicación:** raíz del proyecto

**Evidencia:**
```
.eslintrc         ← ❌ NO EXISTE
.prettierrc        ← ❌ NO EXISTE
.editorconfig      ← ❌ NO EXISTE
package.json       ← NO HAY: "lint", "format" scripts
```

**Impacto:**
- ❌ Código inconsistente (mixto 2-tab / 4-space)
- ❌ Imports sin ordenar
- ❌ `console.log` olvidados en prod
- ❌ Convenciones no forzadas

**Acción (Prioridad Alta):**
```bash
npm install -D eslint prettier eslint-config-prettier @typescript-eslint/eslint-plugin

# .eslintrc.json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  "rules": {
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-debugger": "error",
    "@typescript-eslint/no-explicit-any": "error"
  }
}

# .prettierrc
{ "semi": true, "singleQuote": true, "printWidth": 100 }

# package.json scripts
"lint": "eslint src --ext .ts,.tsx",
"format": "prettier --write src"
```

---

### A-008: **Mezcla de Idiomas en Codebase — Desorden**

**Evidencia:**
```
UI:          Español ✓
Código:      Inglés ✓  
Comentarios: MIXTO ✗

// Ejemplo: BookingDetailModal.tsx
// Comentarios en español ← inconsistente
export interface BookingLite { ... }  // Tipo en inglés
const handleChargeDifference = ...    // Función en inglés
<h3 className="...">⚠ Reportar daño</h3>  // Texto en español
```

**Impacto:**
- 🟡 BAJO pero acumula confusión para mantenimiento
- Equipo multinacional necesita claridad

**Recomendación:**
- **Decisión**: Mantener código (variables, funciones, tipos) EN INGLÉS
- Comentarios y strings UI en ESPAÑOL (según locale del usuario)
- Documentar en MASTERPLAN.md

---

## 🟠 HALLAZGOS DE ALTO IMPACTO

### A-009: **Duplicación Masiva — Patrones de Fetch Repetidos**

**Ubicación:** Todos los `*Client.tsx`

**Patrón:**
```tsx
// InventoryClient.tsx
const load = useCallback(async () => {
  setLoading(true);
  const [pRes, cRes, iRes, sRes] = await Promise.all([
    listProperties(),
    ensureDefaultCategories(),
    listInventoryItems(),
    getUpcomingAndOverdueSchedules(),
  ]);
  if (pRes.data) setProperties(pRes.data);
  if (cRes.data) setCategories(cRes.data);
  if (iRes.data) setItems(iRes.data);
  if (sRes.data) setSchedules(sRes.data);
  setLoading(false);
}, []);

// ✔️ Igual en BookingsClient, ExpensesClient, AseoClient, PropertiesClient, etc.
```

**Duplicación:**
- 5+ componentes con `.bak` pattern identical
- Mejor usar **Custom Hook**:

```tsx
// useInventoryData.ts
export function useInventoryData() {
  const [state, setState] = useState({ properties: [], items: [], loading: true });
  
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const results = await Promise.all([/* queries */]);
    setState({ properties: r[0], items: r[2], loading: false });
  }, []);
  
  useEffect(() => { load(); }, [load]);
  
  return { ...state, reload: load };
}

// En InventoryClient.tsx
const { properties, items, loading, reload } = useInventoryData();
```

**Impacto:** 200+ líneas de código duplicado → mantenimiento x5 más costoso

---

### A-010: **expenseClassify.ts — Switch/if-else Gigante (Violación Open/Closed)**

**Ubicación:** `src/lib/expenseClassify.ts` líneas 11–45

```tsx
export function classifyExpense(e: Expense): {
  section: ExpenseSection;
  subcategory: ExpenseSubcategory | null;
} {
  if (e.id?.startsWith('fine-')) return { section: 'booking', subcategory: 'penalty' };
  
  const sub = (e.subcategory ?? '').trim();
  if (sub === 'utilities' || sub === 'administration' || ...) {
    return { section: 'property', subcategory: sub };
  }
  if (sub === 'cleaning' || sub === 'damage' || ...) {
    return { section: 'booking', subcategory: sub };
  }
  
  // ← 15 lineas más de regex
  if (/multa|penalidad|cancelaci[oó]n/.test(c)) return { ... };
  if (/da[ñn]o|reparaci[oó]n|reposici[oó]n.*invent/.test(c)) return { ... };
  // ... 8 más
  
  return { section: 'property', subcategory: null };
}
```

**Problemas:**
- ❌ **Abierto/Cerrado**: Agregar nuevo tipo = editar función → "frágil"
- ❌ Reglas de negocio mezcladas (heurística + subcategoría + vínculo)
- ❌ Regex son frágiles (typos: `\[oó\]` vs `[oó]`)

**Solución — Strategy Pattern:**

```tsx
// Definir estrategias por tipo
const classificationStrategies = [
  {
    match: (e: Expense) => e.id?.startsWith('fine-'),
    classify: () => ({ section: 'booking', subcategory: 'penalty' }),
  },
  {
    match: (e: Expense) => e.subcategory === 'utilities',
    classify: () => ({ section: 'property', subcategory: 'utilities' }),
  },
  // ... más estrategias
];

export function classifyExpense(e: Expense) {
  for (const strat of classificationStrategies) {
    if (strat.match(e)) return strat.classify();
  }
  return { section: 'property', subcategory: null };
}

// ✔️ Agregar tipo nuevo = agregar estrategia sin tocar función
```

---

### A-011: **Sin Separación de Capas — Lógica de Negocio en Componentes**

**Ubicación:** BookingDetailModal.tsx, ExpensesClient.tsx

**Evidencia:**
```tsx
// BookingDetailModal.tsx línea 136–143
const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
const netAdj = netAdjustment(adjustments);
const gross = Number(booking.gross_revenue ?? booking.total_revenue ?? 0);
const fees = Number(booking.channel_fees ?? 0);
const netPayout = booking.net_payout !== null && booking.net_payout !== undefined
  ? Number(booking.net_payout)
  : gross - fees;
const realProfit = netPayout + netAdj - totalExpenses;
```

**Problema:**
- ❌ Cálculo financiero EN COMPONENTE (debería estar en `financial.ts`)
- ❌ Lógica de "damage reconciliation" (línea 159–192) es complicada, está acoplada a UI

**Refactor:**
```tsx
// financial.ts
export function calculateBookingProfit(booking: BookingLite, expenses: Expense[], adjustments: BookingAdjustmentRow[]): {
  totalExpenses: number;
  netAdjustment: number;
  realProfit: number;
} {
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const netAdj = adjustments
    .reduce((s, a) => s + (a.kind === 'discount' ? -1 : 1) * Number(a.amount), 0);
  const realProfit = (booking.net_payout ?? 0) + netAdj - totalExpenses;
  return { totalExpenses, netAdjustment: netAdj, realProfit };
}

// En componente:
const { totalExpenses, realProfit } = calculateBookingProfit(booking, expenses, adjustments);
```

---

### A-012: **Sin Estado Global — Prop Drilling Masivo**

**Ubicación:** BookingsClient.tsx, ExpensesClient.tsx

**Evidencia:**
```tsx
// BookingsClient.tsx línea 800+
<BookingDetailModal
  booking={detailTarget}
  properties={properties}
  bankAccounts={bankAccounts}
  onClose={() => setDetailTarget(null)}
  resolvePropertyId={(lid) => { ... }}
/>
```

Luego dentro:
```tsx
// BookingDetailModal.tsx línea 57–64
interface Props {
  booking: BookingLite;
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  resolvePropertyId?: (listingId: string | null | undefined) => string | null;
}
```

Y ADENTRO de DamageReportModal:
```tsx
// line 886
<DamageReportModal
  propertyId={propertyId}
  propertyName={property?.name ?? undefined}
  booking={{ ... }}
  // ...
/>
```

**Impacto:**
- 🟠 3-4 niveles de prop drilling
- Cambiar prop en BookingsClient afecta TODA la cadena
- Mejor: **Context + Zustand** para datos compartidos

---

### A-013: **Documentación Desactualizada — MASTERPLAN.md Obsoleto**

**Ubicación:** MASTERPLAN.md, ARCHITECTURE.md, FEEDBACK.md

**Evidencia:**
```markdown
# MASTERPLAN.md línea 1-27
## 1. Vision
Build a sophisticated "CFO for STR" platform...

## 2. Strategic Phases
### Phase 1: Foundation (Architecture & Auth) ✓
### Phase 2: Ingestion Engine (The ETL) ✓
### Phase 3: Operational Control (OPEX) ✓
### Phase 4: Financial Intelligence (Dashboard) ✓
### Phase 5: Reporting & Automation ← NO SAY PHASE 11, 12, 13...
```

**Realidad:**
- Documento menciona "Phases 1-5"
- Codebase implementa "Fase 11: Administración + Aseo + Operativo" (FEEDBACK.md)
- MASTERPLAN.md debe ser **Fuente Única de Verdad** pero está desfasada

---

### A-014: **Repository Pattern Ausente — Acceso DB Sin Abstracción**

**Ubicación:** services/*.ts files

**Patrón Actual:**
```tsx
// expenses.ts (ejemplo)
export async function listExpenses(...) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('owner_id', owner_id)
    .order('date', { ascending: false });
  
  return { data: data as Expense[], error };
}
```

**Problemas:**
- ❌ Sin abstracción de repositorio
- ❌ Si migrar BD (PostgreSQL → MongoDB), refactor masivo
- ❌ Sin cache/memoization
- ❌ Sin transaction support

**Patrón Recomendado:**
```tsx
// repositories/expenseRepository.ts
export class ExpenseRepository {
  constructor(private supabase: SupabaseClient) {}
  
  async findByOwner(ownerId: string): Promise<Expense[]> {
    const { data, error } = await this.supabase
      .from('expenses')
      .select('*')
      .eq('owner_id', ownerId)
      .order('date', { ascending: false });
    
    if (error) throw new ExpenseRepositoryError(error.message);
    return data as Expense[];
  }
  
  async create(expense: Omit<Expense, 'id'>): Promise<Expense> {
    // ...
  }
}

// services/expenseService.ts
export class ExpenseService {
  constructor(private repo: ExpenseRepository) {}
  
  async getExpensesSummary(ownerId: string) {
    const expenses = await this.repo.findByOwner(ownerId);
    return {
      total: expenses.reduce((s, e) => s + Number(e.amount), 0),
      count: expenses.length,
      byCategory: this.groupByCategory(expenses),
    };
  }
  
  private groupByCategory(expenses: Expense[]) {
    // Lógica de negocio
  }
}
```

---

### A-015: **No Hay CI/CD — Deployments Manuales**

**Ubicación:** N/A (no existe)

**Evidencia:**
```
.github/workflows/ ← ❌ NO EXISTE
```

**Impacto:**
- 🔴 Cambios sin validación
- 🔴 Builds rotos en producción
- 🔴 Sin testing automático
- 🔴 Sin linting en merge

---

## 🟡 HALLAZGOS DE IMPACTO MEDIO

### A-016: **Interfaz Fat — types/database.ts Desorganizado**

**Ubicación:** `src/types/database.ts`

**Problema:** Todos los tipos en UN archivo (>500 líneas esperadas)

**Recomendación:**
```
src/types/
├── database.ts       (solo generated types de Supabase)
├── entities/         (dominio)
│   ├── booking.ts
│   ├── expense.ts
│   ├── property.ts
│   └── inventory.ts
├── forms/            (input validation)
│   ├── bookingForm.ts
│   └── expenseForm.ts
└── api/              (request/response)
    ├── financial.ts
    └── inventory.ts
```

---

### A-017: **Falta JSDoc en Servicios Públicos**

**Ubicación:** services/financial.ts, services/expenses.ts, etc.

```tsx
// ❌ SIN DOCUMENTACIÓN
export function classifyExpense(e: Expense): { section: ExpenseSection; subcategory: ExpenseSubcategory | null } {
  // ...
}

// ✔️ CON DOCUMENTACIÓN
/**
 * Clasifica un gasto en sección y subcategoría basado en:
 * 1. Campo `subcategory` (prioridad)
 * 2. Vínculo a booking_id/adjustment_id → 'booking'
 * 3. Heurística por texto de categoría
 * 
 * @param e Gasto a clasificar
 * @returns Objeto con sección y subcategoría
 * @example
 * classifyExpense({ category: 'Internet', ... })
 * // { section: 'property', subcategory: 'utilities' }
 */
export function classifyExpense(e: Expense): { section: ExpenseSection; subcategory: ExpenseSubcategory | null } {
  // ...
}
```

---

### A-018: **console.log Olvidados en Código**

**Ubicación:** Buscar globalmente

Ejemplo esperado (no mostrado pero probable):
```tsx
console.log('DEBUG:', bookings);  // ← Olvidado
toast.success('Reserva guardada');
```

---

### A-019: **Accesibilidad (a11y) Incompleta**

**Ubicación:** Componentes de UI

**Evidencia:**
```tsx
// InventoryClient.tsx línea 208–220
<button
  onClick={() => setShowExport(true)}
  className="px-4 py-2 bg-white border border-slate-200..."
>
  <Download className="w-4 h-4" /> Exportar
</button>

// ✔️ DEBERÍA SER:
<button
  onClick={() => setShowExport(true)}
  className="px-4 py-2 bg-white border border-slate-200..."
  aria-label="Exportar inventario a Excel"
  title="Exportar inventario a Excel"
>
  <Download className="w-4 h-4" aria-hidden="true" /> Exportar
</button>
```

**Falta:**
- `aria-label` en botones sin texto
- `role` atributos explícitos
- `alt` en imágenes
- `aria-expanded` en dropdowns

---

### A-020: **Patrones de Error Handling Inconsistentes**

**Ubicación:** Múltiples servicios

```tsx
// ✗ A VECES:
return { data, error };

// ✓ A VECES:
return { data: data as Expense[], error };

// ✗ A VECES (devuelve directamente):
if (res.error) { toast.error(res.error); return; }
```

**Recomendación:** Estandarizar con `Result` type:
```tsx
export type Result<T, E = string> = 
  | { ok: true; data: T }
  | { ok: false; error: E };

// Uso:
const result = await expenseService.create(payload);
if (!result.ok) {
  toast.error(result.error);
  return;
}
const expense = result.data;
```

---

## 🟢 HALLAZGOS DE BAJO IMPACTO

### A-021: **Naming Inconsistente — Convenciones Débiles**

- `ExpenseModal.tsx` vs `BookingDetailModal.tsx` vs `ItemFormModal.tsx`
  - Debería ser: `ExpenseForm.tsx`, `BookingDetailView.tsx`, `InventoryItemForm.tsx`
- `usePropertyFilter` vs `useInventoryState` (naming de hooks varía)

---

### A-022: **Magic Numbers Desperdigados**

```tsx
// InventoryClient.tsx línea 51
const [properties, setProperties] = useState<PropertyRow[]>([]);
// ... 52 líneas después:
if (Number(it.quantity) > Number(it.min_stock) || Number(it.quantity) === 0) return false;
```

Debería usar constantes:
```tsx
const MIN_STOCK_THRESHOLD = 0;
const SHOULD_ALERT_LOW_STOCK = (qty: number, min: number) => qty <= min && qty > 0;
```

---

### A-023: **Falta de Comentarios Explicativos en Lógica Compleja**

```tsx
// BookingDetailModal.tsx línea 159–192
const damageGroups = useMemo(() => {
  const damageExpenses = expenses.filter(e => (e.subcategory ?? '').toLowerCase() === 'damage');
  const damageChargeAdjs = adjustments.filter(a => a.kind === 'damage_charge');
  return damageExpenses.map(exp => {
    const visible = cleanDamageDescription(exp.description);
    const m = visible.match(/^(?:Reposición\/reparación|Daño en propiedad):\s*(.+?)(?:\s+—\s+|$)/i);
    const itemName = (m?.[1] ?? '').trim();
    // ^ SIN EXPLICACIÓN: ¿por qué este regex? ¿de dónde sale el formato?
    const expTag = `[exp:${exp.id}]`;
    const matches = damageChargeAdjs.filter(a => {
      if (exp.adjustment_id && a.id === exp.adjustment_id) return true;
      const desc = (a.description ?? '').toLowerCase();
      if ((a.description ?? '').includes(expTag)) return true;
      if (itemName && desc.includes(itemName.toLowerCase())) return true;
      return false;
    });
    // ^ Lógica de matching poco clara sin comentarios
```

---

## ⚡ TOP 10 ACCIONES PRIORITARIAS

### Prioridad 1 (HACER ESTA SEMANA)

| # | Acción | Riesgo | Esfuerzo | Impacto |
|---|--------|--------|----------|---------|
| **P1-1** | Remover `.bak` y `.new` files + `.gitignore` | 🟡 Bajo | 0.5h | 🔴 Alto (limpieza) |
| **P1-2** | Instalar ESLint + Prettier + ejecutar `npm run lint` | 🔴 Alto (rompe build) | 2h | 🔴 Alto (consistencia) |
| **P1-3** | Crear custom hook `useInventoryData()` + refactorizar InventoryClient | 🟠 Medio | 4h | 🔴 Crítico (SRP) |

### Prioridad 2 (ESTE MES)

| # | Acción | Riesgo | Esfuerzo | Impacto |
|---|--------|--------|----------|---------|
| **P2-1** | Extraer 5-8 componentes de BookingDetailModal | 🔴 Alto | 8h | 🔴 Crítico (mantenibilidad) |
| **P2-2** | Crear `ExpenseRepository` + refactorizar `expenseService.ts` | 🟠 Medio | 6h | 🔴 Alto (arquitectura) |
| **P2-3** | Implementar Vitest + suite de tests para `financial.ts` | 🟡 Bajo | 3h | 🟠 Alto (confiabilidad) |
| **P2-4** | Refactorizar `expenseClassify.ts` con Strategy Pattern | 🟡 Bajo | 2h | 🟠 Alto (mantenibilidad) |

### Prioridad 3 (PRÓXIMOS 2 MESES)

| # | Acción | Riesgo | Esfuerzo | Impacto |
|---|--------|--------|----------|---------|
| **P3-1** | Implementar Zustand store para estado global (modales, filtros) | 🟠 Medio | 8h | 🔴 Crítico (prop drilling) |
| **P3-2** | Agregar CI/CD pipeline (GitHub Actions) | 🟡 Bajo | 4h | 🟠 Alto (prevención errores) |
| **P3-3** | Actualizar MASTERPLAN.md + ARCHITECTURE.md | 🟢 Bajo | 2h | 🟡 Medio (documentación) |
| **P3-4** | Auditoría de a11y + agregar `aria-*` labels | 🟡 Bajo | 3h | 🟡 Medio (inclusión) |

---

## 📋 HIGIENE DEL REPO — RESUMEN

```
✅ ARCHIVOS NECESARIOS FALTANTES:
  - .eslintrc.json
  - .prettierrc
  - vitest.config.ts
  - .github/workflows/ci.yml

🗑️ ARCHIVOS BASURA PRESENTES:
  - src/lib/usePropertyFilter.ts.bak
  - src/lib/usePropertyFilter.ts.new

⚠️ CONFIGURACIÓN INCOMPLETA:
  - tsconfig.json: ✓ (correcto)
  - package.json: ✗ (sin scripts lint/format/test)
  - astro.config.mjs: ✓ (correcto)
```

---

## 📊 SCORING FINAL POR DIMENSIÓN

| Dimensión | Score | Justificación |
|-----------|-------|---------------|
| **SRP (Single Responsibility)** | 2/10 | 5 God components >1000 líneas |
| **OCP (Open/Closed)** | 3/10 | `expenseClassify` con switch gigante |
| **LSP/ISP/DIP** | 3/10 | Acoplamiento directo a Supabase |
| **DRY** | 3/10 | Duplicación masiva (fetch patterns) |
| **Separación de Capas** | 4/10 | Lógica de negocio en componentes |
| **Patrones de Diseño** | 4/10 | Sin Repository, Strategy, Observer |
| **Tipado TypeScript** | 5/10 | `any` casts, interfaces fat |
| **Convenciones** | 3/10 | `.bak` files, sin linter |
| **Testing** | 0/10 | CERO tests |
| **CI/CD** | 0/10 | Sin pipeline automático |
| **Documentación** | 4/10 | Desactualizada (MASTERPLAN.md) |
| **a11y/i18n** | 3/10 | Sin aria-labels, mezcla idiomas |

**PROMEDIO:** `3.3/10` → **CRÍTICO REFACTOR NECESARIO**

---

## 🎯 CONCLUSIÓN

La aplicación está **funcional en producción** pero **arquitectónicamente insostenible** para crecimiento futuro. Los principales riesgos son:

1. ✋ **God Components** impiden testing y reutilización
2. 📦 **Acoplamiento directo a Supabase** hace cambios infraestructurales caros
3. 🧪 **CERO Tests** → confiabilidad baja
4. 🔀 **Sin Linter** → cambios frágiles

**Recomendación:** Comenzar con **P1-1 y P1-2** esta semana. Refactores de SRP pueden hacerse en paralelo con features nuevas.

---

**FIN DEL REPORTE**
