import type { Expense } from '@/types';
import type { ExpenseFilters } from '@/services/expenses';

export const EMPTY_FILTERS: ExpenseFilters = {};

export const isFee  = (e: { id: string }) => e.id.startsWith('fee-');
export const isFine = (e: { id: string }) => e.id.startsWith('fine-');

export const dispatchRecurringChange = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('recurring-period-changed'));
  }
};

export const DEMO_EXPENSES: Expense[] = [
  { id: '1', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 150000, date: '2024-03-01', description: 'Limpieza post-huésped', status: 'paid' },
  { id: '2', property_id: 'demo', category: 'Internet',           type: 'fixed',    amount:  89000, date: '2024-03-05', description: null,                    status: 'paid' },
  { id: '3', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed',    amount: 320000, date: '2024-03-10', description: 'Agua y luz',            status: 'pending' },
  { id: '4', property_id: 'demo', category: 'Mantenimiento',      type: 'variable', amount: 450000, date: '2024-03-12', description: 'Reparación de grifo',   status: 'partial' },
  { id: '5', property_id: 'demo', category: 'Lavandería',         type: 'variable', amount:  80000, date: '2024-03-15', description: null,                    status: 'paid' },
  { id: '6', property_id: 'demo', category: 'Administración',     type: 'fixed',    amount: 200000, date: '2024-03-20', description: 'Comisión plataforma',   status: 'pending' },
];
