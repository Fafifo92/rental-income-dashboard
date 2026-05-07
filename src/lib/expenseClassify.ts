import type { Expense } from '@/types';
import type { ExpenseSection, ExpenseSubcategory } from '@/types/database';

/**
 * Clasifica un gasto en (sección, subcategoría).
 * Prioridad:
 *   1. Campo `subcategory` (id estable).
 *   2. Inferencia por booking_id/adjustment_id → sección 'booking'.
 *   3. Heurística por texto de category (legacy).
 */
export function classifyExpense(e: Expense): {
  section: ExpenseSection;
  subcategory: ExpenseSubcategory | null;
} {
  // Synthetic fine entries (from cancellation penalties)
  if (e.id?.startsWith('fine-')) return { section: 'booking', subcategory: 'penalty' };

  const sub = (e.subcategory ?? '').trim();
  if (sub === 'utilities' || sub === 'administration' || sub === 'maintenance' || sub === 'stock') {
    return { section: 'property', subcategory: sub };
  }
  if (sub === 'cleaning' || sub === 'damage' || sub === 'guest_amenities') {
    return { section: 'booking', subcategory: sub };
  }

  // Heurística sobre el texto de category (ANTES del fallback por booking_id,
  // para que un daño legacy sin subcategory no quede clasificado como cleaning).
  const c = (e.category ?? '').toLowerCase();
  if (/multa|penalidad|cancelaci[oó]n/.test(c))                 return { section: 'booking', subcategory: 'penalty' };
  if (/da[ñn]o|reparaci[oó]n|reposici[oó]n.*invent/.test(c))   return { section: 'booking', subcategory: 'damage' };
  if (/insumos? de aseo|aseo$|^aseo|limpieza|lavander/.test(c))  return { section: 'booking', subcategory: 'cleaning' };
  if (/welcome|kit|atenci/.test(c))                              return { section: 'booking', subcategory: 'guest_amenities' };

  // Inferencia por vínculo (sólo si no hubo match textual)
  if (e.adjustment_id) return { section: 'booking', subcategory: 'damage' };
  if (e.booking_id)    return { section: 'booking', subcategory: 'cleaning' };

  // Heurística restante (propiedad)
  if (/toalla|utensil|decora|stock|inventario/.test(c))          return { section: 'property', subcategory: 'stock' };
  if (/internet|luz|agua|gas|servicio|p[uú]blico/.test(c))       return { section: 'property', subcategory: 'utilities' };
  if (/manten/.test(c))                                          return { section: 'property', subcategory: 'maintenance' };
  if (/admin|predial|seguro|impuesto|valoriza/.test(c))          return { section: 'property', subcategory: 'administration' };

  return { section: 'property', subcategory: null };
}
