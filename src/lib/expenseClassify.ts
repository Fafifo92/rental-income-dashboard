import type { Expense } from '@/types';
import type { ExpenseSection, ExpenseSubcategory } from '@/types/database';
import { sortedRules, DEFAULT_FALLBACK, type ClassificationResult } from './expenseClassifyRules';

/**
 * Clasifica un gasto en (sección, subcategoría) usando un Strategy Pattern.
 *
 * Las reglas están declaradas en `expenseClassifyRules.ts` como un registry
 * ordenado por prioridad. Esta función solo recorre y aplica la primera que
 * matchee, manteniendo Open/Closed: agregar reglas nuevas no requiere tocar
 * este archivo.
 *
 * Para debugging / tests, usa `classifyExpenseTraced` desde
 * `expenseClassifyRules.ts` que también devuelve `ruleId`.
 */
export function classifyExpense(e: Expense): ClassificationResult {
  for (const rule of sortedRules()) {
    if (rule.match(e)) return rule.result(e);
  }
  return DEFAULT_FALLBACK;
}

export type { ClassificationResult };
export type { ExpenseSection, ExpenseSubcategory };
