import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BankAccountRow, BookingPaymentRow } from '@/types/database';

export interface BankAccountBalance {
  account: BankAccountRow;
  inflows: number;      // booking payments (new system) + legacy net_payout
  outflows: number;     // sum of expenses.amount paid from this bank
  currentBalance: number;
}

export const listBankAccounts = async (): Promise<ServiceResult<BankAccountRow[]>> => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .order('is_cash', { ascending: false })   // cash account first
    .order('is_active', { ascending: false })
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/**
 * Ensures a "Efectivo" cash account exists for the current user.
 * Called on app load. Safe to call multiple times (is idempotent).
 */
export const ensureCashAccount = async (): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: existing } = await supabase
    .from('bank_accounts')
    .select('id')
    .eq('owner_id', user.id)
    .eq('is_cash', true)
    .maybeSingle();
  if (existing) return;
  await supabase.from('bank_accounts').insert({
    owner_id: user.id,
    name: 'Efectivo',
    bank: null,
    account_type: 'otro',
    account_number_mask: null,
    currency: 'COP',
    opening_balance: 0,
    is_active: true,
    is_credit: false,
    credit_limit: null,
    is_cash: true,
    notes: 'Cuenta de efectivo. Los pagos en cash se registran aquí.',
  });
};

export const createBankAccount = async (
  input: Omit<BankAccountRow, 'id' | 'owner_id' | 'created_at'>,
): Promise<ServiceResult<BankAccountRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { data, error } = await supabase
    .from('bank_accounts')
    .insert({ ...input, owner_id: user.id })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updateBankAccount = async (
  id: string,
  patch: Partial<Omit<BankAccountRow, 'id' | 'owner_id' | 'created_at'>>,
): Promise<ServiceResult<BankAccountRow>> => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteBankAccount = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

// ─── Pagos parciales de reservas ─────────────────────────────────────────────

export const listBookingPayments = async (
  bookingId: string,
): Promise<ServiceResult<BookingPaymentRow[]>> => {
  const { data, error } = await supabase
    .from('booking_payments')
    .select('*')
    .eq('booking_id', bookingId)
    .order('payment_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: data as BookingPaymentRow[], error: null };
};

export const addBookingPayment = async (input: {
  booking_id: string;
  amount: number;
  bank_account_id: string | null;
  payment_date: string | null;
  notes: string | null;
}): Promise<ServiceResult<BookingPaymentRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const { data, error } = await supabase
    .from('booking_payments')
    .insert({ ...input, owner_id: user.id })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as BookingPaymentRow, error: null };
};

export const deleteBookingPayment = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('booking_payments').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/**
 * Compute current balance for each account.
 * Inflows = booking_payments (new system) + legacy net_payout on bookings that
 * have no booking_payments entries yet (backward compat).
 *
 * Performance: pre-fetches ALL rows once and aggregates in JS — avoids N×3
 * sequential Supabase queries that caused slow load on /accounts.
 */
export const computeBalances = async (): Promise<ServiceResult<BankAccountBalance[]>> => {
  const accRes = await listBankAccounts();
  if (accRes.error) return { data: null, error: accRes.error };
  const accounts = accRes.data ?? [];
  if (accounts.length === 0) return { data: [], error: null };

  // ── Single batch fetch of all data needed ───────────────────────────────────
  const [paymentsRes, bookingsRes, adjRes, expensesRes] = await Promise.all([
    supabase
      .from('booking_payments')
      .select('bank_account_id, amount, booking_id'),
    supabase
      .from('bookings')
      .select('id, net_payout, status, payout_bank_account_id')
      .not('payout_bank_account_id', 'is', null),
    supabase
      .from('booking_adjustments')
      .select('bank_account_id, amount, kind')
      .not('bank_account_id', 'is', null),
    supabase
      .from('expenses')
      .select('bank_account_id, amount')
      .not('bank_account_id', 'is', null)
      .eq('status', 'paid'),
  ]);

  // ── Pre-process into Maps keyed by account.id ────────────────────────────────
  const allPayments = paymentsRes.data ?? [];
  const allBookings = bookingsRes.data ?? [];
  const allAdj      = adjRes.data ?? [];
  const allExpenses = expensesRes.data ?? [];

  const bookingsWithPayments = new Set(allPayments.map(p => p.booking_id as string));

  // payment inflows per account
  const paymentInflowByAcc = new Map<string, number>();
  for (const p of allPayments) {
    if (!p.bank_account_id) continue;
    paymentInflowByAcc.set(p.bank_account_id, (paymentInflowByAcc.get(p.bank_account_id) ?? 0) + Number(p.amount));
  }

  // legacy booking inflows / outflows per account
  type BookingRow = { id: string; net_payout: number | null; status?: string | null; payout_bank_account_id: string | null };
  const legacyInflowByAcc  = new Map<string, number>();
  const legacyFineByAcc    = new Map<string, number>();
  for (const b of allBookings as BookingRow[]) {
    const acc = b.payout_bank_account_id;
    if (!acc || bookingsWithPayments.has(b.id)) continue;
    const net = Number(b.net_payout ?? 0);
    if (net > 0) {
      legacyInflowByAcc.set(acc, (legacyInflowByAcc.get(acc) ?? 0) + net);
    } else if (net < 0 && (b.status ?? '').toLowerCase().includes('cancel')) {
      legacyFineByAcc.set(acc, (legacyFineByAcc.get(acc) ?? 0) + Math.abs(net));
    }
  }

  // adjustment inflows per account
  type AdjRow = { bank_account_id: string | null; amount: number; kind: string };
  const adjInflowByAcc = new Map<string, number>();
  for (const a of allAdj as AdjRow[]) {
    if (!a.bank_account_id || a.kind === 'discount') continue;
    adjInflowByAcc.set(a.bank_account_id, (adjInflowByAcc.get(a.bank_account_id) ?? 0) + Number(a.amount));
  }

  // expense outflows per account
  type ExpRow = { bank_account_id: string | null; amount: number };
  const expOutflowByAcc = new Map<string, number>();
  for (const e of allExpenses as ExpRow[]) {
    if (!e.bank_account_id) continue;
    expOutflowByAcc.set(e.bank_account_id, (expOutflowByAcc.get(e.bank_account_id) ?? 0) + Number(e.amount));
  }

  // ── Assemble balances (pure JS, zero extra queries) ──────────────────────────
  const balances: BankAccountBalance[] = accounts.map(account => {
    const id = account.id;
    const inflows  = (paymentInflowByAcc.get(id) ?? 0) + (legacyInflowByAcc.get(id) ?? 0) + (adjInflowByAcc.get(id) ?? 0);
    const outflows = (expOutflowByAcc.get(id) ?? 0)    + (legacyFineByAcc.get(id) ?? 0);
    return {
      account,
      inflows,
      outflows,
      currentBalance: Number(account.opening_balance) + inflows - outflows,
    };
  });

  return { data: balances, error: null };
};

// ─── Bloque 4: Dinero sin asignar a cuenta ────────────────────────────────────

export interface UnassignedMoney {
  /** Reservas con net_payout > 0 pero sin payout_bank_account_id. */
  unassignedPayouts: { id: string; confirmation_code: string; guest_name: string; net_payout: number; start_date: string }[];
  /** Gastos pagados (status=paid) sin bank_account_id. Plata que salió pero no se sabe de dónde. */
  unassignedPaidExpenses: { id: string; description: string | null; category: string; amount: number; date: string }[];
  totalPayouts: number;
  totalPaidExpenses: number;
}

/**
 * Lista los flujos de dinero que NO tienen cuenta bancaria asignada.
 * Útil para el banner "dinero volando" en /accounts y dashboard.
 */
export const listUnassignedMoney = async (): Promise<ServiceResult<UnassignedMoney>> => {
  const [payoutsRes, expensesRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, confirmation_code, guest_name, net_payout, start_date, payout_bank_account_id')
      .is('payout_bank_account_id', null)
      .gt('net_payout', 0)
      .order('start_date', { ascending: false })
      .limit(50),
    supabase
      .from('expenses')
      .select('id, description, category, amount, date, bank_account_id, status')
      .is('bank_account_id', null)
      .eq('status', 'paid')
      .order('date', { ascending: false })
      .limit(50),
  ]);

  if (payoutsRes.error) return { data: null, error: payoutsRes.error.message };
  if (expensesRes.error) return { data: null, error: expensesRes.error.message };

  const unassignedPayouts = (payoutsRes.data ?? []).map((r) => ({
    id: r.id as string,
    confirmation_code: r.confirmation_code as string,
    guest_name: r.guest_name as string,
    net_payout: Number(r.net_payout ?? 0),
    start_date: r.start_date as string,
  }));
  const unassignedPaidExpenses = (expensesRes.data ?? []).map((r) => ({
    id: r.id as string,
    description: (r.description as string | null) ?? null,
    category: r.category as string,
    amount: Number(r.amount ?? 0),
    date: r.date as string,
  }));

  return {
    data: {
      unassignedPayouts,
      unassignedPaidExpenses,
      totalPayouts: unassignedPayouts.reduce((s, p) => s + p.net_payout, 0),
      totalPaidExpenses: unassignedPaidExpenses.reduce((s, p) => s + p.amount, 0),
    },
    error: null,
  };
};

/**
 * Verifica si registrar/pagar un gasto por `amount` desde la cuenta `accountId`
 * dejaría el saldo en negativo. Para cuentas crédito (`is_credit=true`) siempre
 * permite. Para débito, devuelve { ok:false, currentBalance, after } si no hay
 * saldo suficiente.
 */
export const validateAccountSpend = async (
  accountId: string,
  amount: number,
  excludeExpenseId?: string,
): Promise<ServiceResult<{ ok: boolean; account: BankAccountRow; currentBalance: number; after: number }>> => {
  const { data: account, error: accErr } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (accErr || !account) return { data: null, error: accErr?.message ?? 'Cuenta no encontrada' };

  const balRes = await computeBalances();
  if (balRes.error || !balRes.data) return { data: null, error: balRes.error ?? 'Error calculando saldo' };
  const acct = balRes.data.find(b => b.account.id === accountId);
  if (!acct) return { data: null, error: 'Cuenta no encontrada en balances' };

  // Si estamos editando un gasto existente, excluir su monto previo del cálculo de outflows.
  let currentBalance = acct.currentBalance;
  if (excludeExpenseId) {
    const { data: prev } = await supabase
      .from('expenses')
      .select('amount, bank_account_id')
      .eq('id', excludeExpenseId)
      .single();
    if (prev && prev.bank_account_id === accountId) {
      currentBalance += Number(prev.amount ?? 0);
    }
  }

  const after = currentBalance - amount;
  const ok = (account as BankAccountRow).is_credit ? true : after >= 0;

  return { data: { ok, account: account as BankAccountRow, currentBalance, after }, error: null };
};

// ---------- Bloque 18 — Historial de transacciones por cuenta ----------
export type BankTxKind =
  | 'opening'             // saldo de apertura
  | 'booking_payout'      // ingreso por payout de reserva
  | 'cancellation_fine'   // egreso por multa de cancelación (net_payout negativo)
  | 'damage_recovery'     // ingreso por recuperación de daño (booking_adjustment)
  | 'platform_refund'     // ingreso por reembolso de plataforma
  | 'extra_income'        // ingreso extra registrado en la reserva
  | 'extra_guest_fee'     // huésped extra
  | 'expense'             // egreso por gasto
  ;

export interface BankTransaction {
  id: string;
  date: string;             // YYYY-MM-DD
  kind: BankTxKind;
  amount: number;           // positivo = ingreso, negativo = egreso
  description: string;
  reference_id: string | null;       // booking.id, expense.id, adjustment.id
  reference_type: 'booking' | 'expense' | 'adjustment' | null;
  booking_code: string | null;
  property_name: string | null;
  category: string | null;            // para expenses
}

const ADJ_KIND_LABEL: Record<string, BankTxKind> = {
  damage_charge: 'damage_recovery',
  platform_refund: 'platform_refund',
  extra_income: 'extra_income',
  extra_guest_fee: 'extra_guest_fee',
};

export const getBankAccountTransactions = async (
  accountId: string,
): Promise<ServiceResult<BankTransaction[]>> => {
  // 1) Bookings con payout a esta cuenta
  const { data: bookings, error: e1 } = await supabase
    .from('bookings')
    .select('id, confirmation_code, guest_name, end_date, net_payout, listing_id, status')
    .eq('payout_bank_account_id', accountId)
    .order('end_date', { ascending: false });
  if (e1) return { data: null, error: e1.message };

  // 2) Adjustments con bank_account_id = esta cuenta
  const { data: adjs, error: e2 } = await supabase
    .from('booking_adjustments')
    .select('id, kind, amount, description, date, booking_id')
    .eq('bank_account_id', accountId);
  if (e2) return { data: null, error: e2.message };

  // 3) Expenses con esta cuenta
  const { data: expenses, error: e3 } = await supabase
    .from('expenses')
    .select('id, date, amount, description, category, booking_id, property_id')
    .eq('bank_account_id', accountId);
  if (e3) return { data: null, error: e3.message };

  // 4) Resolver listings → properties para nombres
  type B = { id: string; confirmation_code: string | null; guest_name: string | null; end_date: string | null; net_payout: number | null; listing_id: string; status: string | null };
  type A = { id: string; kind: string; amount: number; description: string | null; date: string; booking_id: string };
  type E = { id: string; date: string; amount: number; description: string | null; category: string | null; booking_id: string | null; property_id: string | null };

  const bs = (bookings ?? []) as B[];
  const ajs = (adjs ?? []) as A[];
  const es = (expenses ?? []) as E[];

  const listingIds = Array.from(new Set(bs.map(b => b.listing_id).filter(Boolean)));
  const propIdsFromExpenses = Array.from(new Set(es.map(e => e.property_id).filter((x): x is string => !!x)));
  const propMap = new Map<string, string>();
  const listingPropMap = new Map<string, string | null>();

  if (listingIds.length > 0) {
    const { data: ls } = await supabase.from('listings').select('id, property_id').in('id', listingIds);
    const lsArr = (ls ?? []) as Array<{ id: string; property_id: string }>;
    const morePropIds = lsArr.map(l => l.property_id);
    const allPropIds = Array.from(new Set([...propIdsFromExpenses, ...morePropIds]));
    if (allPropIds.length > 0) {
      const { data: ps } = await supabase.from('properties').select('id, name').in('id', allPropIds);
      for (const p of (ps ?? []) as Array<{ id: string; name: string }>) propMap.set(p.id, p.name);
    }
    for (const l of lsArr) listingPropMap.set(l.id, propMap.get(l.property_id) ?? null);
  } else if (propIdsFromExpenses.length > 0) {
    const { data: ps } = await supabase.from('properties').select('id, name').in('id', propIdsFromExpenses);
    for (const p of (ps ?? []) as Array<{ id: string; name: string }>) propMap.set(p.id, p.name);
  }

  // 5) Resolver bookings de adjustments para mostrar code
  const adjBookingIds = Array.from(new Set(ajs.map(a => a.booking_id)));
  const bookingMap = new Map<string, { code: string | null; property: string | null }>();
  for (const b of bs) bookingMap.set(b.id, { code: b.confirmation_code, property: listingPropMap.get(b.listing_id) ?? null });
  const missingBookings = adjBookingIds.filter(id => !bookingMap.has(id));
  if (missingBookings.length > 0) {
    const { data: extra } = await supabase
      .from('bookings')
      .select('id, confirmation_code, listing_id')
      .in('id', missingBookings);
    const extraArr = (extra ?? []) as Array<{ id: string; confirmation_code: string | null; listing_id: string }>;
    const extraListingIds = Array.from(new Set(extraArr.map(e => e.listing_id).filter(Boolean)));
    if (extraListingIds.length > 0) {
      const { data: ls2 } = await supabase.from('listings').select('id, property_id').in('id', extraListingIds);
      const ls2Arr = (ls2 ?? []) as Array<{ id: string; property_id: string }>;
      const moreProps = Array.from(new Set(ls2Arr.map(l => l.property_id)));
      const missingProps = moreProps.filter(p => !propMap.has(p));
      if (missingProps.length > 0) {
        const { data: ps2 } = await supabase.from('properties').select('id, name').in('id', missingProps);
        for (const p of (ps2 ?? []) as Array<{ id: string; name: string }>) propMap.set(p.id, p.name);
      }
      const lsListingPropMap = new Map<string, string | null>();
      for (const l of ls2Arr) lsListingPropMap.set(l.id, propMap.get(l.property_id) ?? null);
      for (const e of extraArr) {
        bookingMap.set(e.id, { code: e.confirmation_code, property: lsListingPropMap.get(e.listing_id) ?? null });
      }
    }
  }

  const txs: BankTransaction[] = [];

  // Opening balance
  const accRow = await supabase.from('bank_accounts').select('opening_balance, created_at').eq('id', accountId).single();
  if (accRow.data) {
    txs.push({
      id: `opening-${accountId}`,
      date: (accRow.data.created_at as string).slice(0, 10),
      kind: 'opening',
      amount: Number(accRow.data.opening_balance ?? 0),
      description: 'Saldo de apertura',
      reference_id: null,
      reference_type: null,
      booking_code: null,
      property_name: null,
      category: null,
    });
  }

  // Bookings → payouts and fines
  for (const b of bs) {
    const amount = Number(b.net_payout ?? 0);
    if (amount === 0) continue;
    const isFine = amount < 0 && !!b.status?.toLowerCase().includes('cancel');
    txs.push({
      id: `booking-${b.id}`,
      date: b.end_date ?? '',
      kind: isFine ? 'cancellation_fine' : 'booking_payout',
      amount,
      description: isFine
        ? `Multa por cancelación${b.guest_name ? ' · ' + b.guest_name : ''}`
        : `Payout reserva${b.guest_name ? ' · ' + b.guest_name : ''}`,
      reference_id: b.id,
      reference_type: 'booking',
      booking_code: b.confirmation_code,
      property_name: listingPropMap.get(b.listing_id) ?? null,
      category: isFine ? 'Multa por cancelación' : null,
    });
  }

  // Adjustments
  for (const a of ajs) {
    if (a.kind === 'discount') continue; // los descuentos no traen plata
    const ref = bookingMap.get(a.booking_id);
    txs.push({
      id: `adj-${a.id}`,
      date: a.date,
      kind: ADJ_KIND_LABEL[a.kind] ?? 'extra_income',
      amount: Number(a.amount),
      description: a.description ?? labelForAdjKind(a.kind),
      reference_id: a.id,
      reference_type: 'adjustment',
      booking_code: ref?.code ?? null,
      property_name: ref?.property ?? null,
      category: null,
    });
  }

  // Expenses
  for (const e of es) {
    txs.push({
      id: `exp-${e.id}`,
      date: e.date,
      kind: 'expense',
      amount: -Number(e.amount),
      description: e.description ?? e.category ?? 'Gasto',
      reference_id: e.id,
      reference_type: 'expense',
      booking_code: null,
      property_name: e.property_id ? propMap.get(e.property_id) ?? null : null,
      category: e.category,
    });
  }

  // Orden cronológico descendente, opening al final si misma fecha
  txs.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.kind === 'opening') return 1;
    if (b.kind === 'opening') return -1;
    return 0;
  });

  return { data: txs, error: null };
};

const labelForAdjKind = (kind: string): string => {
  switch (kind) {
    case 'damage_charge': return 'Recuperación por daño';
    case 'platform_refund': return 'Reembolso de plataforma';
    case 'extra_income': return 'Ingreso extra';
    case 'extra_guest_fee': return 'Cobro huésped adicional';
    default: return 'Ajuste';
  }
};

export const BANK_TX_KIND_META: Record<BankTxKind, { label: string; tone: 'in' | 'out' | 'neutral' }> = {
  opening:           { label: 'Apertura',                tone: 'neutral' },
  booking_payout:    { label: 'Payout reserva',           tone: 'in' },
  cancellation_fine: { label: 'Multa por cancelación',    tone: 'out' },
  damage_recovery:   { label: 'Recuperación por daño',    tone: 'in' },
  platform_refund:   { label: 'Reembolso plataforma',     tone: 'in' },
  extra_income:      { label: 'Ingreso extra',            tone: 'in' },
  extra_guest_fee:   { label: 'Huésped adicional',        tone: 'in' },
  expense:           { label: 'Gasto',                    tone: 'out' },
};
