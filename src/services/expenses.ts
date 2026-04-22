import { supabase } from '@/lib/supabase/client';
import type { Expense } from '@/types';
import type { ExpenseRow } from '@/types/database';

export interface ExpenseFilters {
  category?: string;
  type?: 'fixed' | 'variable';
  status?: 'pending' | 'paid' | 'partial';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

// Map DB row → frontend Expense type
const toExpense = (row: ExpenseRow): Expense => ({
  id: row.id,
  owner_id: row.owner_id,
  property_id: row.property_id,
  category: row.category,
  type: row.type,
  amount: Number(row.amount),
  date: row.date,
  description: row.description,
  status: row.status,
});

export const listExpenses = async (
  propertyId?: string,
  filters?: ExpenseFilters,
): Promise<ServiceResult<Expense[]>> => {
  let query = supabase
    .from('expenses')
    .select('*')
    .order('date', { ascending: false });

  if (propertyId) query = query.eq('property_id', propertyId);
  if (filters?.category) query = query.eq('category', filters.category);
  if (filters?.type) query = query.eq('type', filters.type);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.dateFrom) query = query.gte('date', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('date', filters.dateTo);

  const { data, error } = await query;

  if (error) return { data: null, error: error.message };

  let expenses = data.map(toExpense);

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    expenses = expenses.filter(
      e =>
        e.category.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q),
    );
  }

  return { data: expenses, error: null };
};

export const createExpense = async (
  expense: Omit<Expense, 'id' | 'owner_id'>,
): Promise<ServiceResult<Expense>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado — inicia sesión primero' };

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      owner_id:    user.id,
      property_id: expense.property_id ?? null,
      category:    expense.category,
      type:        expense.type,
      amount:      expense.amount,
      date:        expense.date,
      description: expense.description,
      status:      expense.status,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: toExpense(data), error: null };
};

export const updateExpense = async (
  id: string,
  patch: Partial<Omit<Expense, 'id' | 'property_id'>>,
): Promise<ServiceResult<Expense>> => {
  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: toExpense(data), error: null };
};

export const deleteExpense = async (id: string): Promise<ServiceResult<null>> => {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: null, error: null };
};

export const getPendingExpenses = async (
  propertyId?: string,
): Promise<ServiceResult<Expense[]>> =>
  listExpenses(propertyId, { status: 'pending' });
