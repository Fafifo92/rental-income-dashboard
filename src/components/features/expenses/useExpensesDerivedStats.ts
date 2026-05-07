import { useMemo, useCallback } from 'react';
import type { Expense } from '@/types';
import type { ExpenseSection, ExpenseSubcategory, MaintenanceScheduleRow } from '@/types/database';
import { classifyExpense } from '@/lib/expenseClassify';
import { formatCurrency } from '@/lib/utils';
import { isFee, isFine } from './constants';

type Tab = 'all' | ExpenseSection | 'others';

interface Options {
  expenses: Expense[];
  tab: Tab;
  subFilter: ExpenseSubcategory | null;
  maintenanceSchedules: MaintenanceScheduleRow[];
}

/**
 * Centraliza todas las derivaciones (memoizadas) sobre la lista de gastos:
 * clasificación, gastos visibles según pestaña, KPIs, mantenimientos próximos/vencidos
 * y conteos por subcategoría. Mantener todo en un único hook evita recomputar en
 * cascadas y facilita testear la lógica pura.
 */
export function useExpensesDerivedStats({ expenses, tab, subFilter, maintenanceSchedules }: Options) {
  const classified = useMemo(
    () => expenses.map(e => ({ exp: e, ...classifyExpense(e) })),
    [expenses],
  );

  const visibleExpenses = useMemo(() => {
    if (tab === 'all') return expenses;
    if (tab === 'others') {
      return classified
        .filter(c => c.exp.id.startsWith('fee-') || c.section === null)
        .map(c => c.exp);
    }
    return classified
      .filter(c => !c.exp.id.startsWith('fee-') && c.section === tab && (subFilter ? c.subcategory === subFilter : true))
      .map(c => c.exp);
  }, [tab, subFilter, expenses, classified]);

  const expenseStats = useMemo(() => {
    const realExpenses    = expenses.filter(e => !isFee(e));
    const totalFixed      = realExpenses.filter(e => e.type === 'fixed').reduce((s, e) => s + e.amount, 0);
    const totalVariable   = realExpenses.filter(e => e.type === 'variable').reduce((s, e) => s + e.amount, 0);
    const pendingExpenses = realExpenses.filter(e => e.status === 'pending' && !isFine(e));
    const totalPending    = pendingExpenses.reduce((s, e) => s + e.amount, 0);
    const totalChannelFees = expenses.filter(e => isFee(e)).reduce((s, e) => s + e.amount, 0);
    const kpis: Array<{ label: string; value: string; color: string; bg: string; sub?: string }> = [
      { label: 'Gastos Fijos',     value: formatCurrency(totalFixed),    color: 'text-blue-600',   bg: 'bg-blue-50' },
      {
        label: 'Gastos Variables',
        value: formatCurrency(totalVariable),
        color: 'text-orange-600',
        bg: 'bg-orange-50',
        sub: totalChannelFees > 0 ? `Fees de canal: ${formatCurrency(totalChannelFees)} (informativo)` : undefined,
      },
      { label: 'Pendiente de Pago', value: formatCurrency(totalPending), color: 'text-red-600', bg: 'bg-red-50' },
    ];
    return { pendingExpenses, totalPending, kpis };
  }, [expenses]);

  const maintenanceStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const overdueMaintenance = maintenanceSchedules.filter(s => s.scheduled_date <= today);
    const upcomingMaintenance = maintenanceSchedules.filter(s => {
      if (s.scheduled_date <= today) return false;
      const notifyFrom = new Date(s.scheduled_date);
      notifyFrom.setDate(notifyFrom.getDate() - s.notify_before_days);
      return today >= notifyFrom.toISOString().slice(0, 10);
    });
    return { today, overdueMaintenance, upcomingMaintenance };
  }, [maintenanceSchedules]);

  const tabStats = useMemo(() => {
    const tabCounts = {
      all:      expenses.length,
      property: classified.filter(c => !isFee(c.exp) && !isFine(c.exp) && c.section === 'property').length,
      booking:  classified.filter(c => !isFee(c.exp) && c.section === 'booking').length,
      others:   classified.filter(c => isFee(c.exp) || (!isFine(c.exp) && c.section === null)).length,
    };
    const visibleTotal = visibleExpenses.filter(e => !isFee(e)).reduce((s, e) => s + e.amount, 0);
    const visibleFees  = visibleExpenses.filter(e =>  isFee(e)).reduce((s, e) => s + e.amount, 0);
    return { tabCounts, visibleTotal, visibleFees };
  }, [expenses, classified, visibleExpenses]);

  const subCountsBySection = useCallback((sec: ExpenseSection) => {
    const counts: Partial<Record<ExpenseSubcategory, number>> = {};
    for (const c of classified) {
      if (isFee(c.exp) || c.section !== sec || !c.subcategory) continue;
      counts[c.subcategory] = (counts[c.subcategory] ?? 0) + 1;
    }
    return counts;
  }, [classified]);

  return {
    classified,
    visibleExpenses,
    expenseStats,
    maintenanceStats,
    tabStats,
    subCountsBySection,
  };
}
