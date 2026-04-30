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
  expense_group_id: (row as ExpenseRow & { expense_group_id?: string | null }).expense_group_id ?? null,
});

export const listExpenses = async (
  propertyIdOrIds?: string | string[],
  filters?: ExpenseFilters,
): Promise<ServiceResult<Expense[]>> => {
  const propertyIds: string[] | undefined = Array.isArray(propertyIdOrIds)
    ? (propertyIdOrIds.length > 0 ? propertyIdOrIds : undefined)
    : (propertyIdOrIds ? [propertyIdOrIds] : undefined);

  let query = supabase
    .from('expenses')
    .select('*')
    .order('date', { ascending: false });

  if (propertyIds) query = query.in('property_id', propertyIds);
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
    const bkRes = await listBookings(propertyIds ? { propertyIds } : undefined);
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

  // Bloque 14A: banco obligatorio cuando se marca como pagado.
  if (expense.status === 'paid' && !expense.bank_account_id) {
    return {
      data: null,
      error: 'Para marcar un gasto como pagado debes indicar de qué cuenta bancaria salió el dinero.',
    };
  }

  // Bloque 4: bloquear gasto que dejaría una cuenta de débito en negativo.
  if (expense.bank_account_id && expense.status === 'paid') {
    const { validateAccountSpend } = await import('./bankAccounts');
    const v = await validateAccountSpend(expense.bank_account_id, expense.amount);
    if (v.data && !v.data.ok) {
      return {
        data: null,
        error: `Saldo insuficiente en "${v.data.account.name}". Saldo actual: ${v.data.currentBalance.toLocaleString('es-CO')}, quedaría en ${v.data.after.toLocaleString('es-CO')}. Marca la cuenta como crédito o usa otra cuenta.`,
      };
    }
  }

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
      expense_group_id: expense.expense_group_id ?? null,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };

  // Bloque 14C — auto-reparar inventario si el gasto se crea ya como paid.
  if (data && data.status === 'paid' && data.category === 'Reparación inventario') {
    try {
      const { markDamageRepairedFromExpense } = await import('./inventory');
      await markDamageRepairedFromExpense(data.id);
    } catch {
      /* best-effort */
    }
  }

  return { data: toExpense(data), error: null };
};

/**
 * Crea un gasto compartido entre N propiedades como N filas en `expenses`,
 * todas con el mismo `expense_group_id`. Bloque 6.
 */
export const createSharedExpense = async (
  rows: Omit<Expense, 'id' | 'owner_id'>[],
  groupId?: string,
): Promise<ServiceResult<{ groupId: string; expenses: Expense[] }>> => {
  if (rows.length === 0) return { data: null, error: 'Sin filas para crear' };
  // Bloque 14A: banco obligatorio cuando se marca como pagado.
  for (const r of rows) {
    if (r.status === 'paid' && !r.bank_account_id) {
      return {
        data: null,
        error: 'Para marcar un gasto como pagado debes indicar de qué cuenta bancaria salió el dinero.',
      };
    }
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado — inicia sesión primero' };

  const finalGroupId = groupId ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `grp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

  const payload = rows.map(r => ({
    owner_id:         user.id,
    property_id:      r.property_id ?? null,
    category:         r.category,
    type:             r.type,
    amount:           r.amount,
    currency:         'COP',
    date:             r.date,
    description:      r.description,
    status:           r.status,
    bank_account_id:  r.bank_account_id ?? null,
    vendor:           r.vendor ?? null,
    person_in_charge: r.person_in_charge ?? null,
    booking_id:       r.booking_id ?? null,
    adjustment_id:    r.adjustment_id ?? null,
    vendor_id:        r.vendor_id ?? null,
    shared_bill_id:   r.shared_bill_id ?? null,
    subcategory:      r.subcategory ?? null,
    expense_group_id: finalGroupId,
  }));

  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select();

  if (error) return { data: null, error: error.message };
  return { data: { groupId: finalGroupId, expenses: (data ?? []).map(toExpense) }, error: null };
};

export const updateExpense = async (
  id: string,
  patch: Partial<Omit<Expense, 'id' | 'owner_id'>>,
): Promise<ServiceResult<Expense>> => {
  // Bloque 14A: banco obligatorio cuando se marca como pagado.
  if (patch.status === 'paid' && patch.bank_account_id === null) {
    return {
      data: null,
      error: 'Para marcar un gasto como pagado debes indicar de qué cuenta bancaria salió el dinero.',
    };
  }
  if (patch.status === 'paid' && patch.bank_account_id === undefined) {
    // Verificar que el row actual ya tenga bank_account_id; si no, error.
    const { data: existing } = await supabase
      .from('expenses')
      .select('bank_account_id')
      .eq('id', id)
      .single();
    if (existing && !existing.bank_account_id) {
      return {
        data: null,
        error: 'Para marcar un gasto como pagado debes indicar de qué cuenta bancaria salió el dinero.',
      };
    }
  }

  // Bloque 4: validar saldo si se cambia bank_account_id o se marca como pagado.
  if (patch.bank_account_id && (patch.status === 'paid' || patch.amount != null)) {
    const { validateAccountSpend } = await import('./bankAccounts');
    const amount = patch.amount ?? 0;
    if (amount > 0) {
      const v = await validateAccountSpend(patch.bank_account_id, amount, id);
      if (v.data && !v.data.ok) {
        return {
          data: null,
          error: `Saldo insuficiente en "${v.data.account.name}". Quedaría en ${v.data.after.toLocaleString('es-CO')}. Marca la cuenta como crédito o usa otra.`,
        };
      }
    }
  }

  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return { data: null, error: error.message };

  // Bloque 14C — auto-reparar inventario cuando un gasto de "Reparación
  // inventario" pasa a paid. Best-effort: si falla no rompe el flujo.
  if (patch.status === 'paid' && data?.category === 'Reparación inventario') {
    try {
      const { markDamageRepairedFromExpense } = await import('./inventory');
      await markDamageRepairedFromExpense(id);
    } catch {
      /* swallow — el gasto ya quedó actualizado */
    }
  }

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
