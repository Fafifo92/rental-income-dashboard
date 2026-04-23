import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BookingRow } from '@/types/database';
import type { ParsedBooking } from './etl';
import { findOrCreateListing } from './listings';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ImportResult {
  upserted: number;
  skipped: number;
  errors: string[];
}

export interface BookingFilters {
  listingId?: string;
  propertyId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface BookingKPIs {
  totalBookings: number;
  totalRevenue: number;
  totalNights: number;
  avgRevenuePerNight: number;
  avgBookingValue: number;
  completedCount: number;
  cancelledCount: number;
}

// ─── Demo / localStorage helpers ─────────────────────────────────────────────

const DEMO_KEY = 'str_demo_bookings';

const isBrowser = () => typeof window !== 'undefined';

export const getDemoBookings = (): ParsedBooking[] => {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as ParsedBooking[]) : [];
  } catch {
    return [];
  }
};

export const saveDemoBookings = (incoming: ParsedBooking[]): ImportResult => {
  const existing = getDemoBookings();
  const existingCodes = new Set(existing.map(b => b.confirmation_code));
  const newRows = incoming.filter(b => b.confirmation_code && !existingCodes.has(b.confirmation_code));
  const skipped = incoming.length - newRows.length;
  if (isBrowser()) {
    localStorage.setItem(DEMO_KEY, JSON.stringify([...newRows, ...existing]));
  }
  return { upserted: newRows.length, skipped, errors: [] };
};

export const clearDemoBookings = (): void => {
  if (isBrowser()) localStorage.removeItem(DEMO_KEY);
};

// ─── Supabase operations ──────────────────────────────────────────────────────

/**
 * Persist parsed bookings to Supabase.
 * @param bookings   Rows from the ETL parser
 * @param listingMap mapping of listing_name → property_id
 */
export const upsertBookings = async (
  bookings: ParsedBooking[],
  listingMap: Record<string, string>,
): Promise<ServiceResult<ImportResult>> => {
  const errors: string[] = [];
  const skippedCodes: string[] = [];

  // 1. Resolve listing_name → listing_id (create listings if needed)
  const listingIdCache: Record<string, string> = {};
  for (const [listingName, propertyId] of Object.entries(listingMap)) {
    const result = await findOrCreateListing(propertyId, listingName);
    if (result.error) {
      errors.push(`Anuncio "${listingName}": ${result.error}`);
    } else {
      listingIdCache[listingName] = result.data.id;
    }
  }

  // 2. Build insert rows
  type BookingInsert = Omit<BookingRow, 'id' | 'created_at'>;
  const rows: BookingInsert[] = [];

  for (const b of bookings) {
    if (!b.confirmation_code) { skippedCodes.push('(sin código)'); continue; }
    const listingId = listingIdCache[b.listing_name];
    if (!listingId) { skippedCodes.push(b.confirmation_code); continue; }

    rows.push({
      listing_id: listingId,
      confirmation_code: b.confirmation_code,
      guest_name: b.guest_name || null,
      start_date: b.start_date,
      end_date: b.end_date,
      booked_at: null,
      num_nights: b.num_nights,
      num_adults: 1,
      num_children: 0,
      total_revenue: b.revenue,
      status: b.status || null,
      raw_data: null,
    });
  }

  if (rows.length === 0) {
    return { data: { upserted: 0, skipped: skippedCodes.length, errors }, error: null };
  }

  // 3. Upsert — confirmation_code is UNIQUE in DB
  const { data, error } = await supabase
    .from('bookings')
    .upsert(rows, { onConflict: 'confirmation_code' })
    .select('id');

  if (error) return { data: null, error: error.message };

  return {
    data: { upserted: data.length, skipped: skippedCodes.length, errors },
    error: null,
  };
};

export const listBookings = async (
  filters?: BookingFilters,
): Promise<ServiceResult<BookingRow[]>> => {
  // If filtering by property, resolve listing IDs first
  let allowedListingIds: string[] | undefined;
  if (filters?.propertyId) {
    const { data: listings, error } = await supabase
      .from('listings')
      .select('id')
      .eq('property_id', filters.propertyId);
    if (error) return { data: null, error: error.message };
    if (!listings || listings.length === 0) return { data: [], error: null };
    allowedListingIds = listings.map((l: { id: string }) => l.id);
  }

  let query = supabase
    .from('bookings')
    .select('*')
    .order('start_date', { ascending: false });

  if (allowedListingIds) query = query.in('listing_id', allowedListingIds);
  if (filters?.listingId) query = query.eq('listing_id', filters.listingId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.dateFrom) query = query.gte('start_date', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('start_date', filters.dateTo);

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };

  let rows = data;
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      b =>
        b.guest_name?.toLowerCase().includes(q) ||
        b.confirmation_code.toLowerCase().includes(q),
    );
  }

  return { data: rows, error: null };
};

export const getBookingKPIs = async (): Promise<ServiceResult<BookingKPIs>> => {
  const result = await listBookings();
  if (result.error) return { data: null, error: result.error };

  const all = result.data;
  const completed = all.filter(
    b => b.status && !b.status.toLowerCase().includes('cancel'),
  );
  const cancelled = all.filter(
    b => b.status?.toLowerCase().includes('cancel'),
  );

  const totalRevenue = completed.reduce((s, b) => s + Number(b.total_revenue), 0);
  const totalNights = completed.reduce((s, b) => s + b.num_nights, 0);

  return {
    data: {
      totalBookings: all.length,
      totalRevenue,
      totalNights,
      avgRevenuePerNight: totalNights > 0 ? totalRevenue / totalNights : 0,
      avgBookingValue: completed.length > 0 ? totalRevenue / completed.length : 0,
      completedCount: completed.length,
      cancelledCount: cancelled.length,
    },
    error: null,
  };
};

export const insertBooking = async (
  listingId: string,
  data: {
    confirmation_code: string;
    guest_name?: string;
    start_date: string;
    end_date: string;
    num_nights: number;
    total_revenue: number;
    status?: string;
  },
): Promise<ServiceResult<BookingRow>> => {
  const { data: row, error } = await supabase
    .from('bookings')
    .insert({
      listing_id: listingId,
      confirmation_code: data.confirmation_code,
      guest_name: data.guest_name ?? null,
      start_date: data.start_date,
      end_date: data.end_date,
      booked_at: null,
      num_nights: data.num_nights,
      num_adults: 1,
      num_children: 0,
      total_revenue: data.total_revenue,
      status: data.status ?? null,
      raw_data: null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: row, error: null };
};
export const getDemoKPIs = (bookings: ParsedBooking[]): BookingKPIs => {
  const completed = bookings.filter(b => !b.status.toLowerCase().includes('cancel'));
  const cancelled = bookings.filter(b => b.status.toLowerCase().includes('cancel'));
  const totalRevenue = completed.reduce((s, b) => s + b.revenue, 0);
  const totalNights = completed.reduce((s, b) => s + b.num_nights, 0);
  return {
    totalBookings: bookings.length,
    totalRevenue,
    totalNights,
    avgRevenuePerNight: totalNights > 0 ? totalRevenue / totalNights : 0,
    avgBookingValue: completed.length > 0 ? totalRevenue / completed.length : 0,
    completedCount: completed.length,
    cancelledCount: cancelled.length,
  };
};
