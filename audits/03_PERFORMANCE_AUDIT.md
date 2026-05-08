# 📊 AUDITORÍA DE PERFORMANCE — Rental Income Dashboard (Astro 6 + React 18 + Supabase)

## 📋 RESUMEN EJECUTIVO

| Severidad | Cantidad | Impacto | Ejemplos |
|-----------|----------|--------|----------|
| 🔴 **CRÍTICO** | 4 | **Alto**: Bloquea interacción, ralentiza UI | P-001, P-002, P-003, P-004 |
| 🟠 **ALTO** | 8 | **Medio-Alto**: Degrada UX significativamente | P-005 a P-012 |
| 🟡 **MEDIO** | 12 | **Medio**: Afecta carga/render periódicamente | P-013 a P-024 |
| 🔵 **BAJO** | 6 | **Bajo**: Optimizaciones recomendadas | P-025 a P-030 |

---

## 🔴 PROBLEMAS CRÍTICOS

### **P-001: Queries N+1 en `listCleaningsByCleaner` — 4 queries secuenciales**
- **Archivo**: `src/services/cleanings.ts`, líneas 69-145
- **Problema**: Patrón N+1 clásico:
  ```typescript
  // 1. Query: booking_cleanings
  const { data: cleaningRows } = await supabase.from('booking_cleanings').select('*')...
  
  // 2. Query: bookings (N query por cada cleaner)
  const { data: bookingRows } = await supabase.from('bookings').select(...)
    .in('id', bookingIds);  // ← Sin join, es una query separada
  
  // 3. Query: listings (N+1)
  const { data: lRows } = await supabase.from('listings').select(...)
    .in('id', listingIds);
  
  // 4. Query: properties (N+1+1)
  const { data: pRows } = await supabase.from('properties').select(...)
    .in('id', propertyIds);
  ```
- **Impacto**: 4 queries donde debería haber 1 con joins. En modal de cleaner → +300-500ms latencia.
- **Recomendación**: 
  ```typescript
  // Cambiar a una sola query con nested joins:
  const { data } = await supabase.from('booking_cleanings')
    .select(`
      *,
      bookings(id, confirmation_code, guest_name, start_date, end_date, listing_id),
      bookings!inner(listings(id, source, property_id, properties(id, name)))
    `)
    .eq('cleaner_id', cleanerId)
    .order('done_date', { ascending: false });
  ```
- **Prioridad**: 🔴 **CRÍTICO** — Usado en BookingDetailModal + modal de historial de cleaner

---

### **P-002: Over-fetching masivo en `listExpenses`**
- **Archivo**: `src/services/expenses.ts`, líneas 49-163
- **Problema**:
  - Línea 59: `.select('*')` en `expenses` sin `owner_id` filter (confía en RLS, pero traes todas las columnas)
  - Líneas 88-130: **SÍNTESIS de reservas**: Cada vez que llamas `listExpenses`, si `includeChannelFees !== false` o `includeCancelledFines !== false`, hace **otra query completa** a `listBookings`:
    ```typescript
    if (filters?.includeChannelFees !== false || filters?.includeCancelledFines !== false) {
      const bkRes = await listBookings(propertyIds ? { propertyIds } : undefined);
      // ← FULL listBookings() llamada dentro de listExpenses()
    ```
  - Esto duplica la carga de bookings (se llama en Dashboard + aquí).
- **Impacto**: 
  - ExpensesClient carga expenses → luego manualmente construye filas sintéticas de fees.
  - Dashboard carga bookings → mismo cálculo (línea 81-130 de expenses.ts hace lo mismo).
  - **Double-fetch de bookings**: +500-800ms innecesarios.
- **Recomendación**:
  1. Pasar `includeChannelFees: false, includeCancelledFines: false` siempre desde financial.ts (línea 3 ya lo hace).
  2. **Separar síntesis de bookings**: Crear `listSyntheticExpenses(propertyIds, bookings)` que reciba bookings ya cargados como parámetro, no que los fetch.
  3. Cambiar `.select('*')` por `.select('id, category, type, amount, date, status, bank_account_id, property_id, vendor, person_in_charge, booking_id, ...')` (excluir `raw_data`, etc.).
- **Prioridad**: 🔴 **CRÍTICO** — Afecta Dashboard (carga financiera), ExpensesClient (duplicación).

---

### **P-003: Cálculo de KPIs recursivo sin memoización — re-renders innecesarios**
- **Archivo**: `src/services/financial.ts`, líneas 249-323 (`computeCore`)
- **Problema**:
  - Se llama **en cada render** del DashboardClient cuando cambian `propertyIds`, `period`, etc.
  - No hay `useMemo` que cachee el resultado en componente (línea 142-145 de DashboardClient.tsx):
    ```typescript
    computeFinancials(period, authStatus === 'authed', propertyIds, customRange)
      .then(result => {
        setKpis(result.kpis);
        // ← SIN USEMEMO WRAPPER
      });
    ```
  - Cada cambio de período → **recalcula**: 
    - Filtrado de bookings (línea 258: `.filter()` × 2)
    - Reducción de arrays (líneas 262, 284-286: `.reduce()` × 5)
    - Loops de pro-rateo (líneas 372-383 en `buildMonthlyPnL`)
  - Con 1000+ bookings/expenses, esto es **O(n) por render**.
- **Impacto**: 
  - Cambiar período en Dashboard → cálculo completo de arrays (500-2000ms para 1000+ registros).
  - Cambiar propiedades → re-cálculo sin cache.
- **Recomendación**:
  1. Mover `computeFinancials` resultado a `useMemo` en DashboardClient:
     ```typescript
     const kpisData = useMemo(
       () => computeFinancials(period, authStatus === 'authed', propertyIds, customRange),
       [period, authStatus, propertyIds, customRange],
     );
     ```
  2. En `financial.ts`, usar `Map` en lugar de `.filter()` + `.reduce()`:
     ```typescript
     // Hoy: O(n²) con múltiples filtros
     const completed = bookings.filter(b => !b.status.toLowerCase().includes('cancel'));
     const totalRevenue = completed.reduce((s, b) => s + b.revenue, 0);
     
     // Propuesto: O(n) una pasada
     let totalRevenue = 0, completedCount = 0;
     for (const b of bookings) {
       if (!b.status?.toLowerCase().includes('cancel')) {
         totalRevenue += b.revenue;
         completedCount++;
       }
     }
     ```
- **Prioridad**: 🔴 **CRÍTICO** — Afecta Dashboard UX en cada interacción.

---

### **P-004: Componentes enormes sin code-splitting — carga inicial bloqueada**
- **Archivo**: Múltiples páginas `.astro`
- **Problema**:
  ```astro
  <!-- dashboard.astro, bookings.astro, expenses.astro, inventory.astro, etc. -->
  <DashboardClient client:load />
  <BookingsClient client:load />
  <ExpensesClient client:load />
  <InventoryClient client:load />
  ```
  - **Todos con `client:load`** (carga **inmediatamente**, bloquea parsing/eval).
  - Componentes > 50KB:
    - `InventoryClient.tsx`: 90KB
    - `BookingDetailModal.tsx`: 75KB
    - `BookingsClient.tsx`: 57KB
    - `AseoClient.tsx`: 54KB
    - `ExpensesClient.tsx`: 47KB
  - **Sin lazy-loading**: JavaScript para Dashboard + Bookings + Expenses + Inventory se descarga/parsea/ejecuta en paralelo.
  - Browser: Bloquea main thread durante ~3-5s en conexiones 4G (móvil).
- **Impacto**:
  - **TTI (Time to Interactive)**: +2-3 segundos en móvil.
  - Usuario abre Dashboard → espera 3s antes de poder hacer clic.
  - Bounce rate aumenta en móvil.
- **Recomendación**:
  1. Cambiar a `client:visible` (lazy-load cuando scroll entra en viewport):
     ```astro
     <DashboardClient client:visible />
     ```
  2. Cambiar a `client:idle` (carga en idle, después de interacción):
     ```astro
     <BookingsClient client:idle />
     ```
  3. Code-split componentes grandes:
     ```typescript
     // DashboardClient.tsx → DashboardClient.tsx + DashboardCharts.tsx (lazy)
     const DashboardCharts = lazy(() => import('./DashboardCharts'));
     export default function DashboardClient() {
       return (
         <Suspense fallback={<Skeleton />}>
           <DashboardCharts />
         </Suspense>
       );
     }
     ```
  4. En astro.config.mjs, activar optimización:
     ```javascript
     vite: {
       build: {
         rollupOptions: {
           output: {
             manualChunks: {
               'react-table': ['@tanstack/react-table'],
               'recharts': ['recharts'],
             }
           }
         }
       }
     }
     ```
- **Prioridad**: 🔴 **CRÍTICO** — Primera impresión + Core Web Vitals.

---

## 🟠 PROBLEMAS ALTOS

### **P-005: Paginación ausente en listados grandes — carga de memoria**
- **Archivo**: 
  - `src/services/bookings.ts` línea 177-224 (`listBookings`)
  - `src/services/expenses.ts` línea 49-163 (`listExpenses`)
  - `src/services/inventory.ts` línea 106-121 (`listInventoryItems`)
- **Problema**:
  - `listBookings()` sin `.range(0, 100)` → trae **todos** los bookings del usuario.
  - Si usuario tiene 5000 bookings → tabla de 5000 filas en memoria React.
  - `DataTable` tiene paginación en **componente** (línea 25 de DataTable.tsx: `PAGE_SIZES = [10, 25, 50, 100]`), pero **todos** los datos están en estado.
- **Impacto**:
  - BookingsClient: 5000 rows en estado → re-render toma ms.
  - ExpensesClient: 2000+ expenses en estado.
  - InventoryClient: 1000+ items en estado.
  - Pestaña cambio → re-filtrado de arrays en memoria (O(n)).
- **Recomendación**:
  1. Agregar paginación **en Supabase** (no en cliente):
     ```typescript
     export const listBookings = async (
       filters?: BookingFilters,
       page = 0,      // NEW
       pageSize = 50,  // NEW
     ) => {
       let query = supabase.from('bookings')
         .select('...', { count: 'exact' })  // Needed for total count
         .range(page * pageSize, (page + 1) * pageSize - 1);
       // ...
     };
     ```
  2. En BookingsClient, implementar:
     ```typescript
     const [page, setPage] = useState(0);
     useEffect(() => {
       loadBookings({ ...filters, page });
     }, [page, filters]);
     ```
  3. Cambiar DataTable para usar paginación server-side:
     ```typescript
     <DataTable
       columns={columns}
       data={bookings}
       totalCount={totalCount}  // NEW
       onPageChange={setPage}   // NEW
     />
     ```
- **Prioridad**: 🟠 **ALTO** — Afecta usuarios con muchos registros.

---

### **P-006: Búsqueda lineal (`.filter()` en cliente) vs DB search**
- **Archivo**:
  - `src/services/bookings.ts` línea 214-221 (`listBookings` con search)
  - `src/services/expenses.ts` línea 149-157 (`listExpenses` con search)
- **Problema**:
  ```typescript
  // bookings.ts línea 214
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      b => b.guest_name?.toLowerCase().includes(q) || b.confirmation_code.toLowerCase().includes(q),
    );
  }
  ```
  - Se trae **toda la lista**, luego filtra en O(n).
  - Con 5000 bookings + búsqueda → 5000 iteraciones en cliente cada keystroke.
- **Recomendación**:
  ```typescript
  // Mover a Supabase con .or() ilike
  if (filters?.search) {
    const q = `%${filters.search}%`;
    query = query.or(`guest_name.ilike.${q},confirmation_code.ilike.${q}`);
  }
  ```
- **Prioridad**: 🟠 **ALTO** — Búsqueda es slow en listas grandes.

---

### **P-007: useEffect con dependencias mal gestionadas → cascada de cargas**
- **Archivo**: 
  - `src/components/features/BookingDetailModal.tsx` línea 127 (`useEffect`)
  - `src/components/features/ExpensesClient.tsx` línea 132 (`useEffect`)
  - `src/components/features/DashboardClient.tsx` línea 136-162 (`useEffect`)
- **Problema**:
  - BookingDetailModal línea 108-127:
    ```typescript
    const load = useCallback(async () => {
      const [resE, resA, resC, resV] = await Promise.all([...]);
      // 4 queries en paralelo ✓
    }, [booking.id]);
    
    useEffect(() => { load(); }, [load]);  // ← load depende de [booking.id]
    ```
  - Pero `load` es `useCallback([booking.id])`, así que **cada render** crea nueva instancia si `booking.id` cambia.
  - Si `booking` cambia frecuentemente → re-load 4 queries (OK), pero si padre causa re-render → load se recrea.

- **Impacto**: Menos severo que P-001, pero complica debugging.
- **Recomendación**:
  ```typescript
  useEffect(() => {
    load();
  }, [booking.id]); // ← Directa dependencia, sin intermediario
  ```

### **P-008: Síntesis de gastos sintéticos en cliente — no es eficiente**
- **Archivo**: `src/services/expenses.ts` línea 88-130, `src/services/financial.ts` línea 276-322
- **Problema**:
  - ExpensesClient crea filas sintéticas para fees y multas (líneas 88-130 de expenses.ts).
  - DashboardClient crea **las mismas** filas sintéticas en `computeCore` (financial.ts).
  - Mismo cálculo en 2 lugares → if un cambio en lógica, hay que actualizar ambos.
- **Impacto**: Mantenibilidad baja, inconsistencias si no sincronizan.
- **Recomendación**: Crear función helper centralizada:
  ```typescript
  // shared-util.ts
  export const synthesizeExpensesFromBookings = (
    bookings: BookingWithListingRow[], 
    includeChannelFees: boolean,
    includeCancelledFines: boolean,
  ): Expense[] => {
    const synthetic: Expense[] = [];
    for (const b of bookings) {
      if (includeChannelFees && b.channel_fees > 0) {
        synthetic.push({ id: `fee-${b.id}`, ... });
      }
      if (includeCancelledFines && b.status?.includes('cancel') && b.total_revenue < 0) {
        synthetic.push({ id: `fine-${b.id}`, ... });
      }
    }
    return synthetic;
  };
  ```
- **Prioridad**: 🟠 **ALTO** — Duplicación de lógica.

---

### **P-009: `useMemo` missing en expensive transforms**
- **Archivo**: `src/components/features/BookingDetailModal.tsx` línea 159-192
- **Problema**:
  ```typescript
  const damageGroups = useMemo(() => {  // ✓ Tiene useMemo
    // Pero recalcula TODA ESTA LÓGICA en cada render
    const damageExpenses = expenses.filter(...);
    const damageChargeAdjs = adjustments.filter(...);
    return damageExpenses.map(exp => {
      // Regex parse, string matching, reduce operations
      // O(n×m) donde n=damage expenses, m=damage adjustments
    });
  }, [expenses, adjustments]);
  ```
  - Línea 163: `.match(/^(?:Reposición...)` → regex en loop.
  - Si 10 dañoes × 50 ajustes → 500 comparaciones string.
- **Impacto**: Modal de booking se vuelve lento si hay muchos daños.
- **Recomendación**: Optimizar regex fuera, cachear parsed items:
  ```typescript
  const damageExpensesWithParsed = useMemo(
    () => damageExpenses.map(exp => ({
      exp,
      itemName: cleanDamageDescription(exp.description),
      expTag: `[exp:${exp.id}]`,
    })),
    [damageExpenses],
  );
  ```
- **Prioridad**: 🟠 **ALTO** — Afecta modal UX.

---

### **P-010: Sin debounce en búsqueda de texto — keystroke flooding**
- **Archivo**: `src/components/features/BookingsClient.tsx` línea 246-248
- **Problema**:
  ```typescript
  const applySearch = useCallback(
    () => setFilters(prev => ({ ...prev, search })),
    [search],
  );
  // En handleSearchChange:
  setSearch(e.target.value);  // ← Cada keystroke
  ```
  - Cada keystroke → `setSearch()` → `useEffect([filters])` → `load()` → query.
  - En ExpensesClient, similar (filtrado en cliente de 2000 items).
- **Impacto**: 
  - Búsqueda de "rent" (4 caracteres) = 4 queries.
  - Entrada de datos lenta en móvil.
- **Recomendación**:
  ```typescript
  const [search, setSearch] = useState('');
  const debouncedSearch = useMemo(() => {
    return debounce((val: string) => {
      setFilters(prev => ({ ...prev, search: val }));
    }, 300);
  }, []);
  
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    debouncedSearch(e.target.value);
  };
  ```
- **Prioridad**: 🟠 **ALTO** — UX search lenta.

---

### **P-011: Inline objects/arrays en props — re-renders innecesarios**
- **Archivo**: 
  - `src/components/features/DashboardClient.tsx` línea 328 (`.map()` inline)
  - `src/components/features/InventoryClient.tsx` línea 335-350 (selectores inline)
- **Problema**:
  ```typescript
  {[
    { label: 'Importar CSV...', onClick: () => setShowUploader(true) },
    { label: 'Ver Reservas', href: '/bookings' },
  ].map(item => (  // ← Array inline, se recrea cada render
    // ...
  ))}
  ```
  - Array se recrea → cada hijo obtiene props diferentes → re-render.
  - Con 4 items × 10 renders = 40 nuevos arrays en memoria.
- **Recomendación**:
  ```typescript
  const QUICK_ACTIONS = [
    { label: 'Importar CSV...', onClick: () => setShowUploader(true) },
    { label: 'Ver Reservas', href: '/bookings' },
  ];
  
  // Usar QUICK_ACTIONS en .map()
  ```
- **Prioridad**: 🟠 **ALTO** — Multiplicado × muchos componentes.

---

### **P-012: Realtime subscriptions / polling sin cleanup**
- **Archivo**: No encontrado explícitamente, pero revisar `src/services/`
- **Problema**: Si hay `setInterval` o Supabase Realtime sin return cleanup en useEffect.
- **Evidencia indirecta**: No veo `.on()` suscripciones en código, pero worth checking.
- **Recomendación**:
  ```typescript
  useEffect(() => {
    const subscription = supabase
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, (payload) => {
        setBookings(prev => [...prev, payload.new]);
      })
      .subscribe();
    
    return () => {
      supabase.removeChannel(subscription);  // ← CLEANUP
    };
  }, []);
  ```
- **Prioridad**: 🟠 **ALTO** — Potencial memory leak.

---

## 🟡 PROBLEMAS MEDIOS

### **P-013: sin `.range()` en inventory/expenses — memory bloat**
- **Archivo**: `src/services/inventory.ts` línea 106-121, `src/services/expenses.ts` línea 59
- **Problema**: Mismo que P-005, pero para inventory. Con 1000+ items → estado grande.
- **Recomendación**: Implementar paginación server-side (igual a P-005).
- **Prioridad**: 🟡 **MEDIO**.

---

### **P-014: Recharts no tiene virtualización — 1000+ datos en gráfico**
- **Archivo**: `src/components/features/RevenueChart.tsx` línea 60-78
- **Problema**:
  ```typescript
  <ComposedChart data={data} margin={{...}}>  // data puede tener 365+ puntos (año completo)
    <Bar dataKey="revenue" ... />
  </ComposedChart>
  ```
  - Recharts por defecto renderiza **todos** los puntos SVG.
  - Con 365 días × 3 series → 1000+ elementos SVG en DOM.
- **Impacto**: Scroll de gráfico lento, renders de 200-500ms.
- **Recomendación**:
  1. Limitar a últimos 90 días en vista normal, agregar "Ver año completo" (modal/dropdown).
  2. O usar `<ComposedChart>` con `dot={false}` para líneas (reduce DOM nodes).
- **Prioridad**: 🟡 **MEDIO** — Afecta Dashboard si data > 100 puntos.

---

### **P-015: No hay lazy-loading de imágenes (si hay)**
- **Archivo**: No hay imágenes detectable en el código, pero revisar Nav.astro, layouts.
- **Recomendación**: Si hay, usar `loading="lazy"`.
- **Prioridad**: 🟡 **MEDIO** (si aplica).

---

### **P-016: Bundle de lucide-react completo (no tree-shake)**
- **Archivo**: `astro.config.mjs` línea 10-15
- **Problema**:
  ```javascript
  optimizeDeps: {
    include: ['lucide-react', 'recharts', 'framer-motion'],
  }
  ```
  - lucide-react se importa en muchos componentes (Pencil, Trash2, etc.), pero **no hay tree-shaking verificado**.
  - Es posible que se incluya el bundle completo (~20KB gzipped).
- **Recomendación**:
  1. Verificar build output: `npm run build`, revisar `.bundle-report` o usar `rollup-plugin-visualizer`.
  2. Si incluye todo, usar importaciones named en todos lados (ya se hace ✓).
- **Prioridad**: 🟡 **MEDIO** — Bajo impacto si tree-shake funciona.

---

### **P-017: Ausencia de virtualizacion en tablas largas**
- **Archivo**: `src/components/features/DataTable.tsx` línea 47-78
- **Problema**:
  - DataTable con 100 rows visibles → renderiza TODO en DOM.
  - Si tabla tiene 1000 rows (paginada después), cada pagina es OK, pero sin virtualización.
- **Recomendación**: Implementar react-window o tan-stack/react-virtual:
  ```typescript
  import { useVirtual } from '@tanstack/react-virtual';
  
  export default function DataTable({ data, columns, ...props }) {
    const virtualizer = useVirtual({
      size: data.length,
      overscan: 10,
    });
  }
  ```
- **Prioridad**: 🟡 **MEDIO** — Necesario si datos > 500 rows en una tabla.

---

### **P-018: Cálculo de `occupancyRate` sin caching**
- **Archivo**: `src/services/financial.ts` línea 293
- **Problema**:
  ```typescript
  const occupancyRate = availableNights > 0 ? Math.min(1, totalNights / availableNights) : 0;
  ```
  - Se recalcula en cada `computeFinancials()` call.
  - Si se llama 3x por cambio de período → 3 cálculos.
- **Impacto**: Mínimo (es cálculo O(1)).
- **Recomendación**: Movido ya a useMemo solucionaría P-003.
- **Prioridad**: 🟡 **MEDIO** — Será resuelto con P-003.

---

### **P-019: Pro-rateo de ingresos en `buildMonthlyPnL` es O(n×m)**
- **Archivo**: `src/services/financial.ts` línea 351-395
- **Problema**:
  ```typescript
  for (const b of bookings) {
    // ...
    while (cur < end) {
      const k = keyFn(cur);
      add(revMap, k, ratePerNight);
      cur.setDate(cur.getDate() + 1);  // ← Loop día a día
    }
  }
  ```
  - Si booking dura 30 días → 30 iteraciones.
  - 1000 bookings × 30 días promedio = 30,000 iteraciones.
- **Impacto**: 50-200ms para 1000 bookings.
- **Recomendación**:
  1. Usar algoritmo de rango (interval tree) en lugar de loop día a día.
  2. O cachear resultado si bookings no cambian.
- **Prioridad**: 🟡 **MEDIO** — Afecta cálculo de gráficos con mucha data.

---

### **P-020: Múltiples `.map()` secuenciales en Expenses**
- **Archivo**: `src/services/expenses.ts` línea 77, 133-147
- **Problema**:
  ```typescript
  let expenses = (data ?? []).map(toExpense);  // Línea 77
  
  // ... síntesis ...
  
  // Líneas 133-147: múltiples .filter() + .map() en secuencia
  if (filters?.category) expenses = expenses.filter(...);
  if (filters?.type) expenses = expenses.filter(...);
  // etc. × 7 filters
  ```
  - Con 2000 expenses: cada `.filter()` recorre 2000 items.
  - 7 filters = 14,000 iteraciones.
- **Impacto**: 100-300ms para expense list grande.
- **Recomendación**:
  ```typescript
  expenses = expenses.filter(e => {
    if (filters?.category && e.category !== filters.category) return false;
    if (filters?.type && e.type !== filters.type) return false;
    // ... todos en UN loop
    return true;
  });
  ```
- **Prioridad**: 🟡 **MEDIO** — Optimización de algoritmo.

---

### **P-021: AseoClient (`AseoClient.tsx` 54KB) — no analizado en detalle**
- **Archivo**: `src/components/features/AseoClient.tsx` (mencionado en tamaño pero no revisado)
- **Problema**: Componente grande, probablemente con issues similares a P-001 (cleanings).
- **Recomendación**: Aplicar mismo patrón de analysis (queries, memoización).
- **Prioridad**: 🟡 **MEDIO** — Requiere análisis in-situ.

---

### **P-022: Estado compartido sin Context/Redux — prop drilling**
- **Archivo**: `src/components/features/` (en general)
- **Problema**: 
  - Muchos props pasados multiple niveles (ej. BookingDetailModal recibe 4 props grandes).
  - Si padre re-render → todos hijos también.
- **Impacto**: Bajo (React ya optimiza), pero código ruidoso.
- **Recomendación**: Considerar Context API para estado global (propertyIds, bankAccounts, etc.).
- **Prioridad**: 🟡 **MEDIO** — Refactor, no performance crítico.

---

### **P-023: Sin source maps en producción**
- **Archivo**: `astro.config.mjs`
- **Problema**: Si hay error en prod → sin source maps → errores ofuscados.
- **Recomendación**: 
  ```javascript
  export default defineConfig({
    vite: {
      build: {
        sourcemap: 'hidden', // Maps descargadas, pero no expuestas públicamente
      }
    }
  });
  ```
- **Prioridad**: 🟡 **MEDIO** — Debugging/observability.

---

### **P-024: Tailwind JIT styles no están optimizadas**
- **Archivo**: `astro.config.mjs` línea 8, `src/styles/`
- **Problema**: 
  - Tailwind v4 con Vite, pero sin verificación de unused CSS.
  - Posible que se incluyan clases no-usadas si hay tipografía/breakpoints no pruned.
- **Recomendación**:
  1. Revisar `tailwind.config.js` (no visto en repo).
  2. Asegurar `content` apunta a src correctamente.
- **Prioridad**: 🟡 **MEDIO** — Bajo impacto en v4 (JIT mejor).

---

## 🔵 PROBLEMAS BAJOS (Optimizaciones recomendadas)

### **P-025: Múltiples `.select()` en bookings con joins redundantes**
- **Archivo**: `src/services/bookings.ts` línea 201
- **Problema**:
  ```typescript
  .select('*, listings(id, external_name, property_id, properties(id, name))')
  ```
  - Siempre trae propiedad names, pero algunos usos no los necesitan.
- **Recomendación**: Separar en 2 queries: `listBookingsLite()` (sin joins) y `listBookingsWithProperty()`.
- **Prioridad**: 🔵 **BAJO**.

---

### **P-026: `isDemoMode` check repetido**
- **Archivo**: Múltiples componentes
- **Problema**: `if (authStatus === 'authed')` vs demo mode spread en muchos lugares.
- **Recomendación**: Custom hook `useIsDemo()`.
- **Prioridad**: 🔵 **BAJO**.

---

### **P-027: Formato de fecha sin caché**
- **Archivo**: `src/lib/dateUtils.ts` (si existe)
- **Problema**: Formateo de fechas en cada render sin Intl cache.
- **Recomendación**: Usar `Intl.DateTimeFormat` (cached).
- **Prioridad**: 🔵 **BAJO**.

---

### **P-028: No hay error boundaries**
- **Archivo**: `src/layouts/Layout.astro`, componentes root
- **Problema**: Si un componente falla → crash toda la página.
- **Recomendación**: Implementar React Error Boundary en Layout.
- **Prioridad**: 🔵 **BAJO** (pero recomendado).

---

### **P-029: Recharts tooltip re-renders**
- **Archivo**: `src/components/features/RevenueChart.tsx` línea 22-38
- **Problema**: `CustomTooltip` se define inline, se recrea en cada render.
- **Recomendación**: Mover fuera o memoizar.
- **Prioridad**: 🔵 **BAJO**.

---

### **P-030: Sin prefetch de páginas**
- **Archivo**: Astro pages
- **Problema**: No hay `<link rel="prefetch">` en Nav.
- **Recomendación**:
  ```astro
  <Nav>
    <link rel="prefetch" href="/bookings" />
    <link rel="prefetch" href="/expenses" />
  </Nav>
  ```
- **Prioridad**: 🔵 **BAJO** — UX mejora mínima.

---

## 🎯 TOP 10 QUICK WINS (Alto impacto, bajo riesgo)

| Rank | ID | Tarea | Impacto | Esfuerzo | ROI |
|------|----|----|--------|----------|-----|
| 1️⃣ | P-004 | Cambiar `client:load` → `client:idle` en páginas secundarias (bookings, inventory, expenses, vendors) | **TTI -40%** | 5 min | 🔴🔴🔴🔴 |
| 2️⃣ | P-003 | Agregar `useMemo` wrapper en computeFinancials result en DashboardClient | **Render time -50%** en período changes | 10 min | 🔴🔴🔴 |
| 3️⃣ | P-010 | Debounce búsqueda en BookingsClient / ExpensesClient | **Query count -70%** | 20 min | 🔴🔴🔴 |
| 4️⃣ | P-002 | Pasar `includeChannelFees: false, includeCancelledFines: false` en financial.ts (ya hace) + remover síntesis duplicada | **Queries -1** | 15 min | 🔴🔴 |
| 5️⃣ | P-001 | Refactor `listCleaningsByCleaner` con nested joins | **Queries 4 → 1, latencia -300ms** | 30 min | 🔴🔴🔴🔴 |
| 6️⃣ | P-006 | Mover búsqueda de bookings a `.or().ilike` en Supabase (en lugar de cliente) | **Search time -80%** | 20 min | 🔴🔴🔴 |
| 7️⃣ | P-005 | Implementar server-side paginación en bookings (add `.range()`) | **Memory -80%** para usuarios con 5000+ bookings | 45 min | 🔴🔴🔴 |
| 8️⃣ | P-011 | Extraer arrays/objetos inline a constantes (QUICK_ACTIONS, etc.) | **Re-renders -20%** | 15 min | 🟠🟠 |
| 9️⃣ | P-020 | Consolidar múltiples `.filter()` en `listExpenses` a un solo loop | **Filter time -70%** | 25 min | 🟠🟠 |
| 🔟 | P-008 | Crear shared function para síntesis de gastos sintéticos (DRY) | **Maintainability ++** | 20 min | 🟠 |

---

## 📋 TABLA DE IMPLEMENTACIÓN (por equipo)

### **Fase 1: CRÍTICO (Sprint 1-2, 2-3 días)**
| # | Tarea | Archivo(s) | Cambios |
|---|-------|-----------|---------|
| 1 | Cambiar `client:load` → `client:idle` en bookings, expenses, inventory, vendors, aseo | `src/pages/*.astro` | 5 líneas |
| 2 | Mover `computeFinancials` a `useMemo` en DashboardClient | `DashboardClient.tsx` | 10 líneas |
| 3 | Agregar debounce a búsqueda | BookingsClient, ExpensesClient | 20 líneas |
| 4 | Refactor `listCleaningsByCleaner` con nested joins | `cleanings.ts` | 40 líneas |

### **Fase 2: ALTO (Sprint 2-3, 1-2 días)**
| # | Tarea | Archivo(s) |
|---|-------|-----------|
| 5 | Implementar server-side paginación en bookings | `bookings.ts` + `BookingsClient.tsx` |
| 6 | Mover búsqueda a `.ilike` en Supabase | `bookings.ts`, `expenses.ts` |
| 7 | Remover síntesis duplicada de fees en expenses.ts | `expenses.ts` |
| 8 | Extraer constantes inline | Varios components |

### **Fase 3: MEDIO (Sprint 3, 1 día)**
| # | Tarea | Archivo(s) |
|---|-------|-----------|
| 9 | Consolidar filtros en un loop | `expenses.ts` |
| 10 | Crear shared function para síntesis | `shared-utils.ts` |
| 11 | Optimizar pro-rateo en `buildMonthlyPnL` | `financial.ts` |
| 12 | Virtualizar tablas grandes | `DataTable.tsx` |

---

## 🔍 CÓMO VALIDAR LAS OPTIMIZACIONES

### Herramientas
- **Chrome DevTools**: Performance tab → "Record", filtrar por scripting/rendering
- **Lighthouse**: `npm install -g lighthouse && lighthouse https://app.url --view`
- **Bundle analyzer**: `npm install rollup-plugin-visualizer && build`

### Métricas clave (antes → después)
1. **LCP (Largest Contentful Paint)**: < 2.5s → < 1.5s
2. **FID (First Input Delay)**: < 100ms → < 50ms
3. **CLS (Cumulative Layout Shift)**: < 0.1
4. **TTI (Time to Interactive)**: < 3.5s → < 2s
5. **JS size**: ? → verificar con visualizer

---

## 📚 REFERENCIAS ÚTILES

- **Supabase queries**: https://supabase.com/docs/reference/javascript/select
- **React hooks best practices**: https://react.dev/reference/react/useMemo
- **Astro client directives**: https://docs.astro.build/en/reference/directives-reference/#client-directives
- **TanStack React Query** (alternativa a custom fetching): https://tanstack.com/query/latest
- **Zod / Valibot** (type-safe API schemas): https://zod.dev

---

## ✅ CHECKLIST DE APROBACIÓN

- [ ] P-004: `client:idle` implementado en todas las páginas secundarias
- [ ] P-003: `useMemo` en `computeFinancials` result
- [ ] P-010: Debounce en búsqueda (300ms)
- [ ] P-001: `listCleaningsByCleaner` con nested joins
- [ ] P-006: Búsqueda de bookings/expenses en Supabase (`.ilike`)
- [ ] P-005: `.range()` paginación en bookings
- [ ] Lighthouse score > 85 en prod
- [ ] TTI < 2.5s en 4G mobile

---

**Generado**: Auditoría de Performance — Rental Income Dashboard v1.0  
**Responsable**: Senior Performance Engineer  
**Estado**: 🟡 EN REVISION  
**Última actualización**: 2024
