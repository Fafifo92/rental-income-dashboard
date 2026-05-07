import { supabase } from '@/lib/supabase/client';
import type {
  RecurringExpensePeriodRow,
  RecurringPeriodStatus,
  PropertyRecurringExpenseRow,
  ExpenseRow,
} from '@/types/database';
import { createExpense, type ServiceResult } from './expenses';
import { listActiveRecurringExpensesForOwner } from './recurringExpenses';
import { listProperties } from './properties';

/**
 * Periodos mensuales de gastos recurrentes (Fase 12).
 *
 * REGLA CONTABLE — fuente única de verdad:
 * Un rubro recurrente se considera PAGADO en un mes si:
 *   (a) existe un registro explícito en recurring_expense_periods.status='paid', O
 *   (b) existe al menos un expense pagado con mismo (property_id, category)
 *       cuya fecha caiga dentro de ese mes.
 *
 * La tabla `recurring_expense_periods` complementa:
 *   - status='skipped' → marca "no aplica" (sin expense correspondiente)
 *   - status='paid'    → vínculo explícito expense ↔ period (creado desde la UI)
 *
 * Esto garantiza consistencia aunque el usuario registre el pago desde /expenses
 * directamente (sin pasar por la matriz "Pagos del mes").
 */

export const toYearMonth = (dateOrYm: string | Date): string => {
  if (typeof dateOrYm === 'string') {
    if (dateOrYm.length === 7) return dateOrYm;
    return dateOrYm.slice(0, 7);
  }
  const y = dateOrYm.getFullYear();
  const m = String(dateOrYm.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

export const currentYearMonth = (): string => toYearMonth(new Date());

/**
 * Genera una lista de YYYY-MM desde `fromYm` hasta `toYm` inclusive (ambos 'YYYY-MM').
 */
export const yearMonthRange = (fromYm: string, toYm: string): string[] => {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

export const ymIsBetween = (ym: string, from: string | null, to: string | null): boolean => {
  if (from && ym < from.slice(0, 7)) return false;
  if (to && ym > to.slice(0, 7)) return false;
  return true;
};

// ── Tipos resueltos ───────────────────────────────────────────
export type ResolvedStatus = 'paid_explicit' | 'paid_auto' | 'skipped';

export type ResolvedPeriod = {
  recurring_id: string;
  year_month: string;
  status: ResolvedStatus;
  period_id: string | null;     // fila en recurring_expense_periods (puede no existir si es auto)
  expense_id: string | null;    // expense asociado (si lo hay)
  amount: number | null;
  note: string | null;
};

/** Periodos crudos (tabla recurring_expense_periods) — uso interno. */
export const listPeriodsForRecurrings = async (
  recurringIds: string[],
): Promise<ServiceResult<RecurringExpensePeriodRow[]>> => {
  if (recurringIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from('recurring_expense_periods')
    .select('*')
    .in('recurring_id', recurringIds);
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

/**
 * Resolver estado consolidado por (recurring, year_month).
 * Combina periods explícitos + expenses reales (auto-detect).
 * Key del map = `${recurring_id}::${year_month}`.
 * Ausencia de key = pendiente.
 */
export const resolveRecurringPeriods = async (
  recurrings: PropertyRecurringExpenseRow[],
): Promise<ServiceResult<Map<string, ResolvedPeriod>>> => {
  const map = new Map<string, ResolvedPeriod>();
  if (recurrings.length === 0) return { data: map, error: null };

  const recIds = recurrings.map(r => r.id);
  const propertyIds = Array.from(new Set(recurrings.map(r => r.property_id)));
  const categories  = Array.from(new Set(recurrings.map(r => r.category)));

  // 1. Periods explícitos (paid | skipped)
  const { data: periodsData, error: pErr } = await supabase
    .from('recurring_expense_periods')
    .select('*')
    .in('recurring_id', recIds);
  if (pErr) return { data: null, error: pErr.message };

  const explicitExpenseIds = new Set<string>();
  for (const p of (periodsData ?? []) as RecurringExpensePeriodRow[]) {
    const key = `${p.recurring_id}::${p.year_month}`;
    map.set(key, {
      recurring_id: p.recurring_id,
      year_month:   p.year_month,
      status:       p.status === 'paid' ? 'paid_explicit' : 'skipped',
      period_id:    p.id,
      expense_id:   p.expense_id,
      amount:       p.amount !== null ? Number(p.amount) : null,
      note:         p.note,
    });
    if (p.expense_id) explicitExpenseIds.add(p.expense_id);
  }

  // 2. Expenses pagados con matching (property, category) — auto-detect
  const { data: expData, error: eErr } = await supabase
    .from('expenses')
    .select('id, property_id, category, amount, date, status')
    .in('property_id', propertyIds)
    .in('category', categories)
    .eq('status', 'paid');
  if (eErr) return { data: null, error: eErr.message };

  type ExpRef = Pick<ExpenseRow, 'id' | 'property_id' | 'category' | 'amount' | 'date' | 'status'>;
  for (const e of (expData ?? []) as ExpRef[]) {
    if (!e.property_id) continue;
    const rec = recurrings.find(r => r.property_id === e.property_id && r.category === e.category);
    if (!rec) continue;
    const ym = toYearMonth(e.date);
    if (!ymIsBetween(ym, rec.valid_from, rec.valid_to)) continue;
    if (explicitExpenseIds.has(e.id)) continue; // ya referenciado por un period.expense_id

    const key = `${rec.id}::${ym}`;
    const existing = map.get(key);

    // Explícito (registrado desde la matriz) gana: solo sumamos monto extra.
    if (existing && existing.status === 'paid_explicit') {
      existing.amount = (existing.amount ?? 0) + Number(e.amount);
      continue;
    }
    // Si había un "skipped" pero existe un expense real, el gasto real es la verdad contable.
    if (existing && existing.status === 'skipped') {
      map.set(key, {
        recurring_id: rec.id,
        year_month:   ym,
        status:       'paid_auto',
        period_id:    existing.period_id,
        expense_id:   e.id,
        amount:       Number(e.amount),
        note:         existing.note,
      });
      continue;
    }
    if (existing && existing.status === 'paid_auto') {
      existing.amount = (existing.amount ?? 0) + Number(e.amount);
      continue;
    }
    map.set(key, {
      recurring_id: rec.id,
      year_month:   ym,
      status:       'paid_auto',
      period_id:    null,
      expense_id:   e.id,
      amount:       Number(e.amount),
      note:         null,
    });
  }

  return { data: map, error: null };
};

/**
 * Marcar un mes como pagado: crea expense real + vínculo explícito (soft).
 * Si el insert del period falla (p.ej. unique violation), no es crítico:
 * el resolver detectará el expense vía auto-match.
 */
export const markPeriodPaid = async (args: {
  recurring: PropertyRecurringExpenseRow;
  yearMonth: string;
  amount: number;
  date: string;
  bankAccountId: string | null;
  note?: string | null;
}): Promise<ServiceResult<RecurringExpensePeriodRow | null>> => {
  const { recurring, yearMonth, amount, date, bankAccountId, note } = args;

  const expRes = await createExpense({
    property_id:      recurring.property_id,
    category:         recurring.category,
    type:             'fixed',
    amount,
    date,
    description:      note?.trim() || recurring.description || `${recurring.category} ${yearMonth}`,
    status:           'paid',
    bank_account_id:  bankAccountId,
    vendor:           recurring.vendor,
    person_in_charge: recurring.person_in_charge,
    booking_id:       null,
    adjustment_id:    null,
  });
  if (!expRes.data) return { data: null, error: expRes.error ?? 'No se pudo crear el gasto' };

  // Sobrescribir cualquier period previo (p.ej. un skipped)
  await supabase
    .from('recurring_expense_periods')
    .delete()
    .eq('recurring_id', recurring.id)
    .eq('year_month', yearMonth);

  const { data, error } = await supabase
    .from('recurring_expense_periods')
    .insert({
      recurring_id: recurring.id,
      year_month:   yearMonth,
      status:       'paid' as RecurringPeriodStatus,
      expense_id:   expRes.data.id,
      paid_at:      new Date().toISOString(),
      amount,
      note:         note?.trim() || null,
    })
    .select()
    .single();
  if (error) {
    // El expense quedó creado; el auto-detect lo capta igual.
    return { data: null, error: null };
  }
  return { data, error: null };
};

/** Marcar un mes como "no aplica / saltado". */
export const markPeriodSkipped = async (args: {
  recurringId: string;
  yearMonth: string;
  note?: string | null;
}): Promise<ServiceResult<RecurringExpensePeriodRow>> => {
  // Reemplaza cualquier marca previa
  await supabase
    .from('recurring_expense_periods')
    .delete()
    .eq('recurring_id', args.recurringId)
    .eq('year_month', args.yearMonth);

  const { data, error } = await supabase
    .from('recurring_expense_periods')
    .insert({
      recurring_id: args.recurringId,
      year_month:   args.yearMonth,
      status:       'skipped' as RecurringPeriodStatus,
      expense_id:   null,
      paid_at:      null,
      amount:       null,
      note:         args.note?.trim() || null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/**
 * Deshacer una marca de un mes.
 *  - Borra el period si existe.
 *  - Si `deleteLinkedExpense` y hay expense vinculado (explícito o auto), lo elimina.
 */
export const unmarkPeriod = async (args: {
  recurringId: string;
  yearMonth: string;
  expenseId?: string | null;        // expense a eliminar si el usuario lo pide
  deleteLinkedExpense?: boolean;
}): Promise<ServiceResult<true>> => {
  if (args.deleteLinkedExpense && args.expenseId) {
    const { error } = await supabase.from('expenses').delete().eq('id', args.expenseId);
    if (error) return { data: null, error: error.message };
  }
  await supabase
    .from('recurring_expense_periods')
    .delete()
    .eq('recurring_id', args.recurringId)
    .eq('year_month', args.yearMonth);
  return { data: true, error: null };
};

/**
 * Pendientes globales: meses en ventana [−monthsBack, actual] sin pago/skip.
 */
export type PendingRecurring = {
  recurring: PropertyRecurringExpenseRow;
  propertyName: string;
  yearMonth: string;
  isCurrentMonth: boolean;
};

export const listPendingRecurringForOwner = async (
  monthsBack = 6,
): Promise<ServiceResult<PendingRecurring[]>> => {
  const [recRes, propRes] = await Promise.all([
    listActiveRecurringExpensesForOwner(),
    listProperties(),
  ]);
  if (!recRes.data) return { data: null, error: recRes.error };
  // Rubros is_shared se excluyen: se pagan vía factura compartida del vendor y aparecen en el panel de shared_bills pendientes.
  const recs = recRes.data.filter(r => !r.is_shared);
  if (recs.length === 0) return { data: [], error: null };

  const propNameById = new Map<string, string>();
  (propRes.data ?? []).forEach(p => propNameById.set(p.id, p.name));

  const nowYm = currentYearMonth();
  const [cy, cm] = nowYm.split('-').map(Number);
  let sy = cy;
  let sm = cm - monthsBack;
  while (sm <= 0) { sm += 12; sy -= 1; }
  const startYm = `${sy}-${String(sm).padStart(2, '0')}`;

  const resolvedRes = await resolveRecurringPeriods(recs);
  if (!resolvedRes.data) return { data: null, error: resolvedRes.error };
  const resolved = resolvedRes.data;

  const pendings: PendingRecurring[] = [];
  for (const r of recs) {
    const firstYm = r.valid_from ? r.valid_from.slice(0, 7) : startYm;
    const fromYm = firstYm > startYm ? firstYm : startYm;
    if (fromYm > nowYm) continue;
    for (const ym of yearMonthRange(fromYm, nowYm)) {
      if (!ymIsBetween(ym, r.valid_from, r.valid_to)) continue;
      if (resolved.has(`${r.id}::${ym}`)) continue;
      pendings.push({
        recurring: r,
        propertyName: propNameById.get(r.property_id) ?? 'Propiedad',
        yearMonth: ym,
        isCurrentMonth: ym === nowYm,
      });
    }
  }

  pendings.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return { data: pendings, error: null };
};
