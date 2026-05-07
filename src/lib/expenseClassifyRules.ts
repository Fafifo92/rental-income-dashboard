import type { Expense } from '@/types';
import type { ExpenseSection, ExpenseSubcategory } from '@/types/database';

/**
 * Strategy Pattern para clasificación de gastos.
 *
 * Cada regla declara:
 *   - `id`           → identificador estable (debug / logs).
 *   - `priority`     → orden de evaluación (menor = antes). Se respeta el orden de
 *                      registro como tie-breaker.
 *   - `match(e)`     → ¿aplica esta regla al gasto? (predicado puro).
 *   - `result(e)`    → tupla (section, subcategory) si match es true.
 *
 * El motor `classifyExpense` recorre las reglas en orden de prioridad y devuelve
 * la primera que matchea. Si ninguna matchea → fallback configurado.
 *
 * Ventajas vs. cadena de `if`:
 *   • Open/Closed: añadir una regla = agregar entrada al array, no modificar lógica.
 *   • Testeable por regla aislada.
 *   • Auditable: la regla que decidió la clasificación es identificable.
 */

export type ClassificationResult = {
  section: ExpenseSection;
  subcategory: ExpenseSubcategory | null;
};

export type ClassificationRule = {
  id: string;
  priority: number;
  match: (e: Expense) => boolean;
  result: (e: Expense) => ClassificationResult;
};

const matchSubcategory = (vals: ReadonlyArray<string>) =>
  (e: Expense) => vals.includes((e.subcategory ?? '').trim());

const matchCategoryRegex = (re: RegExp) =>
  (e: Expense) => re.test((e.category ?? '').toLowerCase());

const PROPERTY_SUBS: ReadonlyArray<ExpenseSubcategory> = [
  'utilities', 'administration', 'maintenance', 'stock',
];
const BOOKING_SUBS: ReadonlyArray<ExpenseSubcategory> = [
  'cleaning', 'damage', 'guest_amenities',
];

export const DEFAULT_FALLBACK: ClassificationResult = {
  section: 'property',
  subcategory: null,
};

/**
 * Reglas declarativas.
 * El orden numérico de `priority` controla la precedencia.
 * Insertar nuevas reglas no requiere tocar `classifyExpense`.
 */
export const CLASSIFICATION_RULES: ReadonlyArray<ClassificationRule> = [
  {
    id: 'synthetic-fine',
    priority: 10,
    match: e => Boolean(e.id?.startsWith('fine-')),
    result: () => ({ section: 'booking', subcategory: 'penalty' }),
  },
  {
    id: 'subcategory-property',
    priority: 20,
    match: matchSubcategory(PROPERTY_SUBS),
    result: e => ({
      section: 'property',
      subcategory: (e.subcategory as ExpenseSubcategory) ?? null,
    }),
  },
  {
    id: 'subcategory-booking',
    priority: 21,
    match: matchSubcategory(BOOKING_SUBS),
    result: e => ({
      section: 'booking',
      subcategory: (e.subcategory as ExpenseSubcategory) ?? null,
    }),
  },
  {
    id: 'category-text-penalty',
    priority: 30,
    match: matchCategoryRegex(/multa|penalidad|cancelaci[oó]n/),
    result: () => ({ section: 'booking', subcategory: 'penalty' }),
  },
  {
    id: 'category-text-damage',
    priority: 31,
    match: matchCategoryRegex(/da[ñn]o|reparaci[oó]n|reposici[oó]n.*invent/),
    result: () => ({ section: 'booking', subcategory: 'damage' }),
  },
  {
    id: 'category-text-cleaning',
    priority: 32,
    match: matchCategoryRegex(/insumos? de aseo|aseo$|^aseo|limpieza|lavander/),
    result: () => ({ section: 'booking', subcategory: 'cleaning' }),
  },
  {
    id: 'category-text-amenities',
    priority: 33,
    match: matchCategoryRegex(/welcome|kit|atenci/),
    result: () => ({ section: 'booking', subcategory: 'guest_amenities' }),
  },
  {
    id: 'link-adjustment',
    priority: 40,
    match: e => Boolean(e.adjustment_id),
    result: () => ({ section: 'booking', subcategory: 'damage' }),
  },
  {
    id: 'link-booking',
    priority: 41,
    match: e => Boolean(e.booking_id),
    result: () => ({ section: 'booking', subcategory: 'cleaning' }),
  },
  {
    id: 'category-text-stock',
    priority: 50,
    match: matchCategoryRegex(/toalla|utensil|decora|stock|inventario/),
    result: () => ({ section: 'property', subcategory: 'stock' }),
  },
  {
    id: 'category-text-utilities',
    priority: 51,
    match: matchCategoryRegex(/internet|luz|agua|gas|servicio|p[uú]blico/),
    result: () => ({ section: 'property', subcategory: 'utilities' }),
  },
  {
    id: 'category-text-maintenance',
    priority: 52,
    match: matchCategoryRegex(/manten/),
    result: () => ({ section: 'property', subcategory: 'maintenance' }),
  },
  {
    id: 'category-text-administration',
    priority: 53,
    match: matchCategoryRegex(/admin|predial|seguro|impuesto|valoriza/),
    result: () => ({ section: 'property', subcategory: 'administration' }),
  },
];

/**
 * Devuelve las reglas ya ordenadas por prioridad (estable).
 * Cacheado al primer uso.
 */
let _sortedCache: ReadonlyArray<ClassificationRule> | null = null;
export function sortedRules(): ReadonlyArray<ClassificationRule> {
  if (_sortedCache) return _sortedCache;
  const indexed = CLASSIFICATION_RULES.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => a.r.priority - b.r.priority || a.i - b.i);
  _sortedCache = indexed.map(x => x.r);
  return _sortedCache;
}

/**
 * Variante que también devuelve qué regla disparó la clasificación.
 * Útil para debugging / tests / auditoría.
 */
export function classifyExpenseTraced(e: Expense): ClassificationResult & { ruleId: string } {
  for (const rule of sortedRules()) {
    if (rule.match(e)) {
      return { ...rule.result(e), ruleId: rule.id };
    }
  }
  return { ...DEFAULT_FALLBACK, ruleId: 'fallback' };
}
