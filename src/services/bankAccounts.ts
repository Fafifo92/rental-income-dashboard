import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BankAccountRow } from '@/types/database';

export interface BankAccountBalance {
  account: BankAccountRow;
  inflows: number;      // sum of bookings.net_payout with this bank
  outflows: number;     // sum of expenses.amount paid from this bank
  currentBalance: number;
}

export const listBankAccounts = async (): Promise<ServiceResult<BankAccountRow[]>> => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .order('is_active', { ascending: false })
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
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

/**
 * Compute current balance for each account by summing inflows (booking payouts)
 * and outflows (expenses) tied to that account.
 */
export const computeBalances = async (): Promise<ServiceResult<BankAccountBalance[]>> => {
  const accRes = await listBankAccounts();
  if (accRes.error) return { data: null, error: accRes.error };

  const balances: BankAccountBalance[] = [];

  for (const account of accRes.data ?? []) {
    // Inflows = sum of net_payout on bookings with this bank
    const { data: inflowData } = await supabase
      .from('bookings')
      .select('net_payout')
      .eq('payout_bank_account_id', account.id);

    const inflows = (inflowData ?? []).reduce(
      (sum: number, row: { net_payout: number | null }) => sum + Number(row.net_payout ?? 0),
      0,
    );

    // Inflows extra: ajustes de reserva que cayeron a esta cuenta (ej. recuperación
    // de daños cobrada aparte por la plataforma). 'discount' nunca trae plata, se ignora.
    const { data: adjData } = await supabase
      .from('booking_adjustments')
      .select('amount, kind')
      .eq('bank_account_id', account.id);

    const adjInflows = (adjData ?? []).reduce(
      (sum: number, row: { amount: number; kind: string }) =>
        row.kind === 'discount' ? sum : sum + Number(row.amount ?? 0),
      0,
    );

    // Outflows = sum of expenses amount with this bank
    const { data: outflowData } = await supabase
      .from('expenses')
      .select('amount')
      .eq('bank_account_id', account.id);

    const outflows = (outflowData ?? []).reduce(
      (sum: number, row: { amount: number }) => sum + Number(row.amount),
      0,
    );

    balances.push({
      account,
      inflows: inflows + adjInflows,
      outflows,
      currentBalance: Number(account.opening_balance) + inflows + adjInflows - outflows,
    });
  }

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
    .select('id, confirmation_code, guest_name, end_date, net_payout, listing_id')
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
  type B = { id: string; confirmation_code: string | null; guest_name: string | null; end_date: string | null; net_payout: number | null; listing_id: string };
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

  // Bookings → payouts
  for (const b of bs) {
    const amount = Number(b.net_payout ?? 0);
    if (amount === 0) continue;
    txs.push({
      id: `booking-${b.id}`,
      date: b.end_date ?? '',
      kind: 'booking_payout',
      amount,
      description: `Payout reserva ${b.guest_name ? '· ' + b.guest_name : ''}`.trim(),
      reference_id: b.id,
      reference_type: 'booking',
      booking_code: b.confirmation_code,
      property_name: listingPropMap.get(b.listing_id) ?? null,
      category: null,
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

export const BANK_TX_KIND_META: Record<BankTxKind, { label: string; emoji: string; tone: 'in' | 'out' | 'neutral' }> = {
  opening:           { label: 'Apertura',                emoji: '🏦', tone: 'neutral' },
  booking_payout:    { label: 'Payout reserva',           emoji: '💵', tone: 'in' },
  damage_recovery:   { label: 'Recuperación por daño',    emoji: '🛠️', tone: 'in' },
  platform_refund:   { label: 'Reembolso plataforma',     emoji: '↩️', tone: 'in' },
  extra_income:      { label: 'Ingreso extra',            emoji: '➕', tone: 'in' },
  extra_guest_fee:   { label: 'Huésped adicional',        emoji: '👥', tone: 'in' },
  expense:           { label: 'Gasto',                    emoji: '💸', tone: 'out' },
};
