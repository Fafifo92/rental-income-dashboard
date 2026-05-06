/**
 * Financial transaction ledger service.
 *
 * Aggregates all real bank movements (income + expenses) for a given period
 * into a single sorted list, suitable for the "Movimientos" table in the
 * Ingresos vs Egresos tab.
 *
 * Sources:
 *   Income:
 *     1. booking_payments (new payout system)
 *     2. Legacy net_payout on bookings with payout_bank_account_id set
 *        and NO booking_payments entry
 *   Expenses:
 *     3. expenses table (status = 'paid')
 *   Informational (no real bank movement — tagged isSynthetic):
 *     4. Channel fees (deducted by platform before reaching the bank)
 *     5. Cancelled fines / multas (also deducted by platform)
 */

import { supabase } from '@/lib/supabase/client';
import { listBookings } from './bookings';
import type { ServiceResult } from './expenses';

// ─── Public interface ─────────────────────────────────────────────────────────

export interface FinancialTransaction {
  id: string;
  date: string;               // ISO date YYYY-MM-DD
  concept: string;            // human-readable description
  type: 'income' | 'expense';
  category: string;           // e.g. "Payout reserva", "Gasto fijo", "Multa"
  amount: number;             // absolute value (always ≥ 0)
  signedAmount: number;       // positive = income, negative = expense
  bankAccountId: string | null;
  bankAccountName: string | null;
  channel: string | null;     // Airbnb, Booking.com, Directo…
  bookingCode: string | null;
  guestName: string | null;
  notes: string | null;
  isSynthetic: boolean;       // true = not a real bank movement (fee/fine)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const listTransactions = async (
  fromISO: string,
  toISO: string,
  propertyIds?: string[],
): Promise<ServiceResult<FinancialTransaction[]>> => {
  const txs: FinancialTransaction[] = [];

  // 1. Bank accounts for name lookup
  const { data: accounts } = await supabase
    .from('bank_accounts')
    .select('id, name, is_cash');
  const acctName = (id: string | null): string | null => {
    if (!id) return null;
    const acc = (accounts ?? []).find((a: { id: string; name: string }) => a.id === id);
    return acc?.name ?? null;
  };

  // 2. Bookings in period (handles property filtering via listing resolution)
  const bkRes = await listBookings({
    propertyIds,
    dateFrom: fromISO,
    dateTo: toISO,
  });
  if (bkRes.error) return { data: null, error: bkRes.error };
  const bookings = bkRes.data ?? [];
  const bookingMap = new Map(bookings.map(b => [b.id, b]));

  // 3. booking_payments for these bookings (new system)
  const bookingIdsWithPayments = new Set<string>();

  if (bookings.length > 0) {
    const bookingIds = bookings.map(b => b.id);
    const { data: payments } = await supabase
      .from('booking_payments')
      .select('id, booking_id, amount, payment_date, bank_account_id, notes')
      .in('booking_id', bookingIds);

    for (const p of payments ?? []) {
      const bk = bookingMap.get(p.booking_id);
      bookingIdsWithPayments.add(p.booking_id);
      const amt = Number(p.amount);
      txs.push({
        id: `pay-${p.id}`,
        date: p.payment_date ?? bk?.start_date ?? fromISO,
        concept: bk
          ? `${bk.confirmation_code} · ${bk.guest_name ?? 'Huésped'}`
          : `Pago reserva #${p.booking_id.slice(0, 6)}`,
        type: amt >= 0 ? 'income' : 'expense',
        category: 'Payout reserva',
        amount: Math.abs(amt),
        signedAmount: amt,
        bankAccountId: p.bank_account_id,
        bankAccountName: acctName(p.bank_account_id),
        channel: bk?.channel ?? null,
        bookingCode: bk?.confirmation_code ?? null,
        guestName: bk?.guest_name ?? null,
        notes: p.notes,
        isSynthetic: false,
      });
    }
  }

  // 4. Legacy payouts (bookings with payout_bank_account_id but no booking_payments)
  for (const b of bookings) {
    if (bookingIdsWithPayments.has(b.id)) continue;
    if (!b.payout_bank_account_id) continue;
    const net = Number(b.net_payout ?? 0);
    if (net === 0) continue;
    txs.push({
      id: `bk-${b.id}`,
      date: b.payout_date ?? b.start_date ?? fromISO,
      concept: `${b.confirmation_code} · ${b.guest_name ?? 'Huésped'}`,
      type: net >= 0 ? 'income' : 'expense',
      category: 'Payout reserva',
      amount: Math.abs(net),
      signedAmount: net,
      bankAccountId: b.payout_bank_account_id,
      bankAccountName: acctName(b.payout_bank_account_id),
      channel: b.channel ?? null,
      bookingCode: b.confirmation_code ?? null,
      guestName: b.guest_name ?? null,
      notes: b.notes,
      isSynthetic: false,
    });
  }

  // 5. Cancelled fines (informational — deducted by platform, not a real bank tx)
  for (const b of bookings) {
    const rev = Number(b.total_revenue ?? 0);
    if (!b.status?.toLowerCase().includes('cancel') || rev >= 0) continue;
    txs.push({
      id: `fine-${b.id}`,
      date: b.start_date ?? fromISO,
      concept: `Multa cancelación · ${b.confirmation_code} · ${b.guest_name ?? ''}`,
      type: 'expense',
      category: 'Multa por cancelación',
      amount: Math.abs(rev),
      signedAmount: rev,
      bankAccountId: null,
      bankAccountName: null,
      channel: b.channel ?? null,
      bookingCode: b.confirmation_code ?? null,
      guestName: b.guest_name ?? null,
      notes: null,
      isSynthetic: true,
    });
  }

  // 6. Channel fees (informational — never reach the bank)
  for (const b of bookings) {
    const fees = Number(b.channel_fees ?? 0);
    if (fees <= 0) continue;
    txs.push({
      id: `fee-${b.id}`,
      date: b.start_date ?? fromISO,
      concept: `Fee canal · ${b.confirmation_code} · ${b.guest_name ?? ''}`,
      type: 'expense',
      category: 'Fee de canal',
      amount: fees,
      signedAmount: -fees,
      bankAccountId: null,
      bankAccountName: null,
      channel: b.channel ?? null,
      bookingCode: b.confirmation_code ?? null,
      guestName: b.guest_name ?? null,
      notes: null,
      isSynthetic: true,
    });
  }

  // 7. Paid expenses in period
  const { data: expData } = await supabase
    .from('expenses')
    .select('id, category, type, amount, date, bank_account_id, description')
    .eq('status', 'paid')
    .gte('date', fromISO)
    .lte('date', toISO);

  for (const e of expData ?? []) {
    const amt = Number(e.amount);
    txs.push({
      id: `exp-${e.id}`,
      date: e.date ?? fromISO,
      concept: e.description ?? e.category ?? 'Gasto',
      type: 'expense',
      category: e.category ?? 'Gasto',
      amount: amt,
      signedAmount: -amt,
      bankAccountId: e.bank_account_id ?? null,
      bankAccountName: acctName(e.bank_account_id ?? null),
      channel: null,
      bookingCode: null,
      guestName: null,
      notes: null,
      isSynthetic: false,
    });
  }

  // Sort by date desc, then by id for stability
  txs.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  return { data: txs, error: null };
};
