import { useState, useEffect, useCallback } from 'react';
import { listExpenses, type ExpenseFilters } from '@/services/expenses';
import type { Expense } from '@/types';

interface UseExpensesListOptions {
  filters: ExpenseFilters;
  propertyIds?: string[];
  /** Devuelve gastos demo ya filtrados (se usa cuando listExpenses falla / modo demo). */
  demoFallback: (filters: ExpenseFilters) => Expense[];
  enabled?: boolean;
}

/**
 * Carga de gastos con fallback demo. Expone setExpenses para updates optimistas
 * (insert / update / delete) sin recargar.
 */
export function useExpensesList({ filters, propertyIds, demoFallback, enabled = true }: UseExpensesListOptions) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState(false);

  const load = useCallback(async (f: ExpenseFilters, propIds?: string[]) => {
    setLoading(true);
    const result = await listExpenses(propIds, f);
    if (result.error) {
      setExpenses(demoFallback(f));
      setDbConnected(false);
    } else {
      setExpenses(result.data ?? []);
      setDbConnected(true);
    }
    setLoading(false);
  }, [demoFallback]);

  useEffect(() => {
    if (!enabled) return;
    load(filters, propertyIds);
  }, [filters, propertyIds, load, enabled]);

  const reload = useCallback(() => load(filters, propertyIds), [load, filters, propertyIds]);

  return { expenses, setExpenses, loading, dbConnected, reload };
}
