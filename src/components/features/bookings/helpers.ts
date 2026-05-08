import type { BookingWithListingRow } from '@/services/bookings';
import type { ParsedBooking } from '@/services/etl';
import { todayISO as todayISOFromUtils } from '@/lib/dateUtils';
import type { DisplayBooking } from './types';

export const fromRow = (row: BookingWithListingRow): DisplayBooking => ({
  id: row.id,
  confirmation_code: row.confirmation_code,
  guest_name: row.guest_name ?? '—',
  start_date: row.start_date,
  end_date: row.end_date,
  num_nights: row.num_nights,
  total_revenue: Number(row.total_revenue),
  status: row.status ?? '',
  listing_name: row.listings?.external_name ?? '',
  property_name: row.listings?.properties?.name ?? null,
  listing_id: row.listing_id ?? null,
  property_id: row.listings?.property_id ?? null,
  channel: row.channel ?? null,
  gross_revenue: row.gross_revenue !== null && row.gross_revenue !== undefined ? Number(row.gross_revenue) : null,
  channel_fees: row.channel_fees !== null && row.channel_fees !== undefined ? Number(row.channel_fees) : null,
  net_payout: row.net_payout !== null && row.net_payout !== undefined ? Number(row.net_payout) : null,
  payout_bank_account_id: row.payout_bank_account_id ?? null,
  payout_date: row.payout_date ?? null,
  notes: row.notes ?? null,
  num_adults: row.num_adults ?? null,
  num_children: row.num_children ?? null,
  checkin_done: row.checkin_done ?? false,
  checkout_done: row.checkout_done ?? false,
  inventory_checked: row.inventory_checked ?? false,
  operational_notes: row.operational_notes ?? null,
});

export const fromDemo = (b: ParsedBooking, i: number): DisplayBooking => ({
  id: `demo-${i}`,
  confirmation_code: b.confirmation_code,
  guest_name: b.guest_name || '—',
  start_date: b.start_date,
  end_date: b.end_date,
  num_nights: b.num_nights,
  total_revenue: b.revenue,
  status: b.status,
  listing_name: b.listing_name,
  isDemo: true,
});

/** Uses the user-configured timezone (from localStorage / dateUtils). */
export const todayISO = (): string => todayISOFromUtils();

/** Formats an arbitrary Date as YYYY-MM-DD using local components. */
export const localISO = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Computes a smart default start date based on local time.
 * After 6 PM suggests tomorrow; otherwise today. Default stay: 2 nights.
 */
export const getSmartDefaultStartDate = (): { start_date: string; end_date: string; num_nights: string } => {
  const now = new Date();
  const hour = now.getHours();

  let startDate: string;
  if (hour >= 18) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    startDate = localISO(tomorrow);
  } else {
    startDate = localISO(now);
  }

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const endD = new Date(sy, sm - 1, sd + 2);
  const endDate = localISO(endD);

  return { start_date: startDate, end_date: endDate, num_nights: '2' };
};
