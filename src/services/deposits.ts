/**
 * services/deposits.ts
 * ====================
 * Manejo del ciclo de vida de los DEPÓSITOS DE SEGURIDAD por reserva.
 *
 * Conceptos:
 *  - El depósito real entra a la cuenta bancaria elegida en
 *    `bookings.deposit_bank_account_id` (Bancolombia, Davivienda, etc.).
 *    El balance de esa cuenta SÍ refleja la plata físicamente.
 *  - La "cuenta Depósitos de huéspedes" del UI es un LEDGER VIRTUAL:
 *    una vista derivada de `bookings` + `booking_deposit_applications`
 *    que permite ver saldo retenido y trazabilidad SIN afectar P&L.
 *
 * El estado `deposit_status` se RECALCULA en el servidor (trigger) cada vez
 * que se inserta/elimina una fila en `booking_deposit_applications`.
 *
 * Funciones expuestas:
 *   - applyDepositToDamage:        crea fila applied_to_damage vinculada a un expense.
 *   - returnDepositToGuest:        crea fila returned_to_guest.
 *   - convertDepositSurplusToIncome: crea fila surplus_to_income + booking_adjustment.
 *   - listDepositApplications:     trazabilidad por reserva.
 *   - getDepositBalance:           saldo disponible de una reserva.
 *   - getDepositsSummary:          agregado global para la vista virtual.
 *   - getDepositLedger:            timeline ordenado de movimientos por reserva.
 */
import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type {
  BookingDepositApplicationRow,
  BookingDepositApplicationKind,
  BookingRow,
  DepositStatus,
} from '@/types/database';
import { todayISO } from '@/lib/dateUtils';
import { computeDepositBalance, type DepositBalance } from '@/lib/depositMath';
import { isDemoMode } from '@/lib/demoMode';
import { demoBlockWrite, demoWriteBlockedResult } from '@/lib/demoGuard';

// ── Balance helpers ─────────────────────────────────────────────────────────

export { computeDepositBalance };
export type { DepositBalance };

// ── Queries ─────────────────────────────────────────────────────────────────

export const listDepositApplications = async (
  bookingId: string,
): Promise<ServiceResult<BookingDepositApplicationRow[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('booking_deposit_applications')
    .select('*')
    .eq('booking_id', bookingId)
    .order('applied_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const getDepositBalance = async (
  bookingId: string,
): Promise<ServiceResult<DepositBalance>> => {
  if (isDemoMode()) {
    return {
      data: computeDepositBalance(0, []),
      error: null,
    };
  }
  const [bRes, aRes] = await Promise.all([
    supabase.from('bookings').select('security_deposit').eq('id', bookingId).single(),
    supabase
      .from('booking_deposit_applications')
      .select('kind, amount')
      .eq('booking_id', bookingId),
  ]);
  if (bRes.error) return { data: null, error: bRes.error.message };
  if (aRes.error) return { data: null, error: aRes.error.message };
  return {
    data: computeDepositBalance(bRes.data?.security_deposit, aRes.data ?? []),
    error: null,
  };
};

// ── Mutations ───────────────────────────────────────────────────────────────

interface ApplyToDamageInput {
  booking_id: string;
  expense_id: string | null;
  amount: number;
  applied_date?: string;
  notes?: string | null;
}

const insertApplication = async (
  input: Omit<BookingDepositApplicationRow, 'id' | 'owner_id' | 'created_at'>,
): Promise<ServiceResult<BookingDepositApplicationRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const { data, error } = await supabase
    .from('booking_deposit_applications')
    .insert({ ...input, owner_id: user.id })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const applyDepositToDamage = async (
  input: ApplyToDamageInput,
): Promise<ServiceResult<BookingDepositApplicationRow>> => {
  if (demoBlockWrite('aplicar depósito a daño')) return demoWriteBlockedResult<BookingDepositApplicationRow>();
  if (input.amount <= 0) return { data: null, error: 'Monto inválido' };
  const bal = await getDepositBalance(input.booking_id);
  if (bal.error || !bal.data) return { data: null, error: bal.error ?? 'Sin balance' };
  if (input.amount > bal.data.available) {
    return {
      data: null,
      error: `El monto excede el depósito disponible (${bal.data.available}).`,
    };
  }
  return insertApplication({
    booking_id: input.booking_id,
    expense_id: input.expense_id,
    kind: 'applied_to_damage',
    amount: input.amount,
    applied_date: input.applied_date ?? todayISO(),
    notes: input.notes ?? null,
  });
};

interface ReturnInput {
  booking_id: string;
  amount: number;
  applied_date?: string;
  notes?: string | null;
}

export const returnDepositToGuest = async (
  input: ReturnInput,
): Promise<ServiceResult<BookingDepositApplicationRow>> => {
  if (demoBlockWrite('devolver depósito al huésped')) return demoWriteBlockedResult<BookingDepositApplicationRow>();
  if (input.amount <= 0) return { data: null, error: 'Monto inválido' };
  const bal = await getDepositBalance(input.booking_id);
  if (bal.error || !bal.data) return { data: null, error: bal.error ?? 'Sin balance' };
  if (input.amount > bal.data.available) {
    return {
      data: null,
      error: `El monto excede el depósito disponible (${bal.data.available}).`,
    };
  }
  return insertApplication({
    booking_id: input.booking_id,
    expense_id: null,
    kind: 'returned_to_guest',
    amount: input.amount,
    applied_date: input.applied_date ?? todayISO(),
    notes: input.notes ?? null,
  });
};

interface SurplusInput {
  booking_id: string;
  amount: number;
  /** Cuenta donde queda el ingreso (booking_adjustment.bank_account_id). */
  target_bank_account_id: string | null;
  applied_date?: string;
  notes?: string | null;
}

/**
 * Convierte el sobrante del depósito en un ingreso de la reserva.
 *
 * Crea DOS filas:
 *  1) `booking_deposit_applications` kind='surplus_to_income' (para que el ledger
 *     virtual sepa que ese dinero ya no está retenido al huésped).
 *  2) `booking_adjustments` kind='extra_income' (para que entre al P&L de la reserva).
 *
 * Efecto neto: la plata estaba en la cuenta bancaria del depósito; al "cerrarse"
 * como ingreso, se queda en esa cuenta (o el usuario puede mover manualmente a
 * otra cuenta cambiando bank_account_id del adjustment).
 */
export const convertDepositSurplusToIncome = async (
  input: SurplusInput,
): Promise<ServiceResult<BookingDepositApplicationRow>> => {
  if (demoBlockWrite('convertir excedente de depósito')) return demoWriteBlockedResult<BookingDepositApplicationRow>();
  if (input.amount <= 0) return { data: null, error: 'Monto inválido' };
  const bal = await getDepositBalance(input.booking_id);
  if (bal.error || !bal.data) return { data: null, error: bal.error ?? 'Sin balance' };
  if (input.amount > bal.data.available) {
    return {
      data: null,
      error: `El monto excede el depósito disponible (${bal.data.available}).`,
    };
  }
  const date = input.applied_date ?? todayISO();
  // 1) Adjustment de ingreso
  const adj = await supabase
    .from('booking_adjustments')
    .insert({
      booking_id: input.booking_id,
      kind: 'extra_income',
      amount: input.amount,
      description: `Excedente del depósito de seguridad${input.notes ? ' — ' + input.notes : ''}`,
      date,
      bank_account_id: input.target_bank_account_id,
    })
    .select()
    .single();
  if (adj.error) return { data: null, error: adj.error.message };
  // 2) Fila de aplicación
  return insertApplication({
    booking_id: input.booking_id,
    expense_id: null,
    kind: 'surplus_to_income',
    amount: input.amount,
    applied_date: date,
    notes: input.notes ?? `Convertido a ingreso (adj ${adj.data.id})`,
  });
};

export const deleteDepositApplication = async (
  id: string,
): Promise<ServiceResult<void>> => {
  if (demoBlockWrite('eliminar aplicación de depósito')) return demoWriteBlockedResult<void>();
  const { error } = await supabase
    .from('booking_deposit_applications')
    .delete()
    .eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: undefined, error: null };
};

// ── Vista virtual / agregados ───────────────────────────────────────────────

export interface DepositSummaryRow {
  booking: Pick<
    BookingRow,
    | 'id' | 'confirmation_code' | 'guest_name' | 'start_date' | 'end_date'
    | 'security_deposit' | 'deposit_bank_account_id' | 'deposit_status'
  >;
  balance: DepositBalance;
}

export interface DepositsGlobalSummary {
  total_held: number;          // suma de "available" en todas las reservas con depósito
  total_received: number;      // sum security_deposit (de bookings con depósito)
  total_returned: number;
  total_applied_to_damage: number;
  total_surplus_to_income: number;
  /** Saldo retenido agrupado por cuenta bancaria real (account_id → monto). */
  held_by_account: Record<string, number>;
  rows: DepositSummaryRow[];
}

export const getDepositsSummary = async (): Promise<ServiceResult<DepositsGlobalSummary>> => {
  if (isDemoMode()) {
    return {
      data: {
        total_held: 0, total_received: 0, total_returned: 0,
        total_applied_to_damage: 0, total_surplus_to_income: 0,
        held_by_account: {}, rows: [],
      },
      error: null,
    };
  }
  // Reservas con depósito > 0
  const bRes = await supabase
    .from('bookings')
    .select(
      'id, confirmation_code, guest_name, start_date, end_date, security_deposit, deposit_bank_account_id, deposit_status',
    )
    .not('security_deposit', 'is', null)
    .gt('security_deposit', 0)
    .order('start_date', { ascending: false });
  if (bRes.error) return { data: null, error: bRes.error.message };
  const bookings = bRes.data ?? [];
  if (bookings.length === 0) {
    return {
      data: {
        total_held: 0, total_received: 0, total_returned: 0,
        total_applied_to_damage: 0, total_surplus_to_income: 0,
        held_by_account: {}, rows: [],
      },
      error: null,
    };
  }
  const bookingIds = bookings.map(b => b.id);
  const aRes = await supabase
    .from('booking_deposit_applications')
    .select('booking_id, kind, amount')
    .in('booking_id', bookingIds);
  if (aRes.error) return { data: null, error: aRes.error.message };
  const apps = aRes.data ?? [];
  const appsByBooking = new Map<string, typeof apps>();
  for (const ap of apps) {
    const arr = appsByBooking.get(ap.booking_id) ?? [];
    arr.push(ap);
    appsByBooking.set(ap.booking_id, arr);
  }

  let total_held = 0, total_received = 0, total_returned = 0,
      total_applied = 0, total_surplus = 0;
  const held_by_account: Record<string, number> = {};
  const rows: DepositSummaryRow[] = bookings.map(b => {
    const bal = computeDepositBalance(b.security_deposit, appsByBooking.get(b.id) ?? []);
    total_held     += bal.available;
    total_received += bal.security_deposit;
    total_returned += bal.returned_amount;
    total_applied  += bal.applied_amount;
    total_surplus  += bal.surplus_amount;
    if (b.deposit_bank_account_id && bal.available > 0) {
      held_by_account[b.deposit_bank_account_id] =
        (held_by_account[b.deposit_bank_account_id] ?? 0) + bal.available;
    }
    return { booking: b as DepositSummaryRow['booking'], balance: bal };
  });
  return {
    data: {
      total_held, total_received, total_returned,
      total_applied_to_damage: total_applied,
      total_surplus_to_income: total_surplus,
      held_by_account, rows,
    },
    error: null,
  };
};

export interface DepositLedgerEntry {
  date: string;
  kind: 'received' | BookingDepositApplicationKind;
  amount: number;
  /** Para inflows (received) es +; para applied/returned/surplus es − (sale del depósito). */
  signed_amount: number;
  notes: string | null;
  expense_id: string | null;
}

/** Devuelve la línea de tiempo del depósito de una reserva (incluye recepción inicial). */
// ── Pending deposit returns ─────────────────────────────────────────────────

export interface PendingDepositReturn {
  booking: {
    id: string;
    confirmation_code: string;
    guest_name: string | null;
    end_date: string;
    security_deposit: number;
    deposit_bank_account_id: string | null;
    deposit_status: DepositStatus;
    property_name: string | null;
    property_id: string | null;
  };
  balance: DepositBalance;
}

/**
 * Returns bookings (any status) with a deposit balance still pending return.
 * Used by the Pendientes tab and status badges.
 */
export const listPendingDepositReturns = async (
  propertyIds?: string[] | null,
): Promise<ServiceResult<PendingDepositReturn[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  let allowedListingIds: string[] | undefined;
  if (propertyIds && propertyIds.length > 0) {
    const lRes = await supabase
      .from('listings')
      .select('id')
      .in('property_id', propertyIds);
    if (lRes.error) return { data: null, error: lRes.error.message };
    allowedListingIds = (lRes.data ?? []).map((l: { id: string }) => l.id);
    if (allowedListingIds.length === 0) return { data: [], error: null };
  }

  let query = supabase
    .from('bookings')
    .select(
      'id, confirmation_code, guest_name, end_date, security_deposit, deposit_bank_account_id, deposit_status, listing_id, listings(id, external_name, property_id, properties(id, name)), booking_deposit_applications(kind, amount)',
    )
    .not('security_deposit', 'is', null)
    .gt('security_deposit', 0)
    .order('end_date', { ascending: false });

  if (allowedListingIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).in('listing_id', allowedListingIds);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    confirmation_code: string;
    guest_name: string | null;
    end_date: string;
    security_deposit: number;
    deposit_bank_account_id: string | null;
    deposit_status: DepositStatus;
    listing_id: string | null;
    listings: { property_id: string; properties: { id: string; name: string } | null } | null;
    booking_deposit_applications: Array<{ kind: BookingDepositApplicationKind; amount: number }>;
  }>;

  const result: PendingDepositReturn[] = [];
  for (const row of rows) {
    const balance = computeDepositBalance(row.security_deposit, row.booking_deposit_applications ?? []);
    if (balance.available <= 0) continue;
    result.push({
      booking: {
        id: row.id,
        confirmation_code: row.confirmation_code,
        guest_name: row.guest_name,
        end_date: row.end_date,
        security_deposit: row.security_deposit,
        deposit_bank_account_id: row.deposit_bank_account_id,
        deposit_status: row.deposit_status,
        property_name: row.listings?.properties?.name ?? null,
        property_id: row.listings?.property_id ?? null,
      },
      balance,
    });
  }
  return { data: result, error: null };
};

export const getDepositLedger = async (
  bookingId: string,
): Promise<ServiceResult<DepositLedgerEntry[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const [bRes, aRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('security_deposit, start_date')
      .eq('id', bookingId)
      .single(),
    supabase
      .from('booking_deposit_applications')
      .select('kind, amount, applied_date, notes, expense_id, created_at')
      .eq('booking_id', bookingId),
  ]);
  if (bRes.error) return { data: null, error: bRes.error.message };
  if (aRes.error) return { data: null, error: aRes.error.message };

  const out: DepositLedgerEntry[] = [];
  const security = Number(bRes.data?.security_deposit ?? 0);
  if (security > 0) {
    out.push({
      date: bRes.data?.start_date ?? '',
      kind: 'received',
      amount: security,
      signed_amount: security,
      notes: null,
      expense_id: null,
    });
  }
  for (const ap of (aRes.data ?? [])) {
    out.push({
      date: ap.applied_date,
      kind: ap.kind as BookingDepositApplicationKind,
      amount: Number(ap.amount),
      signed_amount: -Number(ap.amount),
      notes: ap.notes ?? null,
      expense_id: ap.expense_id ?? null,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { data: out, error: null };
};
