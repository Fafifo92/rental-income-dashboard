import { supabase } from '@/lib/supabase/client';
import type { Expense } from '@/types';
import type { ExpenseRow } from '@/types/database';
// listAllRecurringExpensesForOwner ya no se usa: synthesis legacy desactivada.
import { listBookings } from './bookings';

export interface ExpenseFilters {
  category?: string;
  type?: 'fixed' | 'variable';
  status?: 'pending' | 'paid' | 'partial';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  vendor?: string;
  bankAccountId?: string;
  personInCharge?: string;
  bookingId?: string;
  includeRecurring?: boolean; // synthesize monthly recurring entries
  includeChannelFees?: boolean; // synthesize channel fees from bookings
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
  subcategory: (row as ExpenseRow & { subcategory?: string | null }).subcategory ?? null,
  type: row.type,
  amount: Number(row.amount),
  date: row.date,
  description: row.description,
  status: row.status,
  bank_account_id: row.bank_account_id ?? null,
  vendor: row.vendor ?? null,
  person_in_charge: row.person_in_charge ?? null,
  booking_id: row.booking_id ?? null,
  adjustment_id: row.adjustment_id ?? null,
  vendor_id: row.vendor_id ?? null,
  shared_bill_id: row.shared_bill_id ?? null,
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
  if (filters?.bankAccountId) query = query.eq('bank_account_id', filters.bankAccountId);
  if (filters?.vendor) query = query.ilike('vendor', `%${filters.vendor}%`);
  if (filters?.personInCharge) query = query.ilike('person_in_charge', `%${filters.personInCharge}%`);
  if (filters?.bookingId) query = query.eq('booking_id', filters.bookingId);

  const { data, error } = await query;

  if (error) return { data: null, error: error.message };

  let expenses = (data ?? []).map(toExpense);

  // ── Synthesis legacy de recurrentes (Fase 15+: deshabilitado) ──────
  // Antes inyectábamos expenses sintéticos con id='rec-...' a partir de
  // property_recurring_expenses. Con el nuevo modelo de servicios +
  // shared_bills, los gastos reales se crean al pagar la factura, así
  // que ya no necesitamos sintetizar. Esto arregla el bug "aparece como
  // pagado pero todavía se debe".
  // Mantenemos el flag por compat pero lo ignoramos.
  void filters?.includeRecurring;

  // ── Inject synthetic channel fee expenses ─────────────────────────────
  if (filters?.includeChannelFees !== false) {
    const bkRes = await listBookings(propertyId ? { propertyId } : undefined);
    if (!bkRes.error && bkRes.data) {
      for (const r of bkRes.data) {
        const fees = Number(r.channel_fees ?? 0);
        if (fees > 0) {
          expenses.push({
            id: `fee-${r.id}`,
            property_id: null,
            category: 'Comisiones de canal',
            type: 'variable',
            amount: fees,
            date: r.start_date,
            description: `[Fees] ${r.channel ?? 'canal'} — ${r.confirmation_code}`,
            status: 'paid',
          } as Expense);
        }
      }
    }
  }

  // Apply filters that must run post-merge (affect synthetic entries too)
  if (filters?.category) expenses = expenses.filter(e => e.category === filters.category);
  if (filters?.type) expenses = expenses.filter(e => e.type === filters.type);
  if (filters?.status) expenses = expenses.filter(e => e.status === filters.status);
  if (filters?.dateFrom) expenses = expenses.filter(e => e.date >= filters.dateFrom!);
  if (filters?.dateTo) expenses = expenses.filter(e => e.date <= filters.dateTo!);
  if (filters?.bankAccountId) expenses = expenses.filter(e => e.bank_account_id === filters.bankAccountId);
  if (filters?.vendor) {
    const v = filters.vendor.toLowerCase();
    expenses = expenses.filter(e => (e.vendor ?? '').toLowerCase().includes(v));
  }
  if (filters?.personInCharge) {
    const p = filters.personInCharge.toLowerCase();
    expenses = expenses.filter(e => (e.person_in_charge ?? '').toLowerCase().includes(p));
  }
  if (filters?.bookingId) expenses = expenses.filter(e => e.booking_id === filters.bookingId);

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    expenses = expenses.filter(
      e =>
        e.category.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.vendor?.toLowerCase().includes(q),
    );
  }

  // Sort by date desc
  expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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
      owner_id:         user.id,
      property_id:      expense.property_id ?? null,
      category:         expense.category,
      type:             expense.type,
      amount:           expense.amount,
      currency:         'COP',
      date:             expense.date,
      description:      expense.description,
      status:           expense.status,
      bank_account_id:  expense.bank_account_id ?? null,
      vendor:           expense.vendor ?? null,
      person_in_charge: expense.person_in_charge ?? null,
      booking_id:       expense.booking_id ?? null,
      adjustment_id:    expense.adjustment_id ?? null,
      vendor_id:        expense.vendor_id ?? null,
      shared_bill_id:   expense.shared_bill_id ?? null,
      subcategory:      expense.subcategory ?? null,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: toExpense(data), error: null };
};

export const updateExpense = async (
  id: string,
  patch: Partial<Omit<Expense, 'id' | 'owner_id'>>,
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
