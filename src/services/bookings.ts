import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BookingRow } from '@/types/database';
import type { ParsedBooking } from './etl';
import { findOrCreateListing } from './listings';
import { inferOperationalFlags } from '@/lib/bookingStatus';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ImportResult {
  upserted: number;
  skipped: number;
  errors: string[];
}

export interface BookingFilters {
  listingId?: string;
  /** @deprecated usar `propertyIds`. Si ambos están, gana `propertyIds`. */
  propertyId?: string;
  propertyIds?: string[];
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
    } else if (result.data) {
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

    const flags = inferOperationalFlags(b.start_date, b.end_date);
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
      channel: 'airbnb',
      gross_revenue: b.revenue,
      channel_fees: null,
      taxes_withheld: null,
      net_payout: null,
      payout_bank_account_id: null,
      payout_date: null,
      currency: 'COP',
      exchange_rate: null,
      notes: null,
      checkin_done: flags.checkin_done,
      checkout_done: flags.checkout_done,
      inventory_checked: false,
      operational_notes: null,
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
  const propIds: string[] | undefined =
    filters?.propertyIds && filters.propertyIds.length > 0
      ? filters.propertyIds
      : filters?.propertyId
        ? [filters.propertyId]
        : undefined;
  if (propIds) {
    const { data: listings, error } = await supabase
      .from('listings')
      .select('id')
      .in('property_id', propIds);
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

  let rows = data ?? [];
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

  const all = result.data ?? [];
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

// ─── Overlap detection ───────────────────────────────────────────────────────

export type OverlapCheck = {
  /** No hay solape ni colindancia. */
  ok: true;
  warning?: never;
} | {
  /** Solape duro: NO se puede guardar. */
  ok: false;
  error: string;
} | {
  /** Misma fecha de check-in que el check-out de otra reserva. Permitido con aviso. */
  ok: true;
  warning: string;
};

/**
 * Devuelve si una reserva propuesta solapa con otras del MISMO listing.
 * Se permite el "turnover": end_date de una == start_date de la otra.
 */
export const checkBookingOverlap = async (
  listingId: string,
  startDate: string,
  endDate: string,
  excludeBookingId?: string,
): Promise<OverlapCheck> => {
  // (a.start < b.end) && (a.end > b.start) → solape estricto
  let q = supabase
    .from('bookings')
    .select('id, start_date, end_date, guest_name, status')
    .eq('listing_id', listingId)
    .lt('start_date', endDate)
    .gt('end_date', startDate);
  if (excludeBookingId) q = q.neq('id', excludeBookingId);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const conflicts = (data ?? []).filter(b => {
    const s = (b.status ?? '').toLowerCase();
    return !s.includes('cancel');
  });
  if (conflicts.length > 0) {
    const c = conflicts[0];
    return {
      ok: false,
      error: `Esta reserva se solapa con otra del ${c.start_date} al ${c.end_date}${c.guest_name ? ` (${c.guest_name})` : ''}.`,
    };
  }
  // Turnover: alguna reserva termina exactamente cuando esta empieza,
  // o esta termina exactamente cuando otra empieza.
  let qAdj = supabase
    .from('bookings')
    .select('id, start_date, end_date, guest_name, status')
    .eq('listing_id', listingId)
    .or(`end_date.eq.${startDate},start_date.eq.${endDate}`);
  if (excludeBookingId) qAdj = qAdj.neq('id', excludeBookingId);
  const { data: adj } = await qAdj;
  const adjActive = (adj ?? []).filter(b => !((b.status ?? '').toLowerCase().includes('cancel')));
  if (adjActive.length > 0) {
    return {
      ok: true,
      warning: '⚠️ Hay otra reserva el mismo día (check-out/check-in). Coordina el aseo con prioridad.',
    };
  }
  return { ok: true };
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
    channel?: string;
    num_adults?: number;
    num_children?: number;
    notes?: string;
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
      num_adults: data.num_adults ?? 1,
      num_children: data.num_children ?? 0,
      total_revenue: data.total_revenue,
      gross_revenue: data.total_revenue,
      status: data.status ?? null,
      channel: data.channel ?? null,
      channel_fees: null,
      taxes_withheld: null,
      net_payout: null,
      payout_bank_account_id: null,
      payout_date: null,
      currency: null,
      exchange_rate: null,
      notes: data.notes ?? null,
      raw_data: null,
      checkin_done: false,
      checkout_done: false,
      inventory_checked: false,
      operational_notes: null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: row, error: null };
};

/** Update basic booking fields (edit flow). */
export const updateBooking = async (
  bookingId: string,
  patch: {
    guest_name?: string | null;
    start_date?: string;
    end_date?: string;
    num_nights?: number;
    total_revenue?: number;
    gross_revenue?: number | null;
    status?: string | null;
    channel?: string | null;
    num_adults?: number;
    num_children?: number;
    notes?: string | null;
  },
): Promise<ServiceResult<BookingRow>> => {
  const dbPatch: Partial<Omit<BookingRow, 'id' | 'created_at'>> = { ...patch } as Partial<Omit<BookingRow, 'id' | 'created_at'>>;
  // mantener gross_revenue en sync con total_revenue
  if (patch.total_revenue !== undefined && patch.gross_revenue === undefined) {
    dbPatch.gross_revenue = patch.total_revenue;
  }
  const { data, error } = await supabase
    .from('bookings')
    .update(dbPatch)
    .eq('id', bookingId)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteBooking = async (bookingId: string): Promise<ServiceResult<null>> => {
  const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
  if (error) return { data: null, error: error.message };
  return { data: null, error: null };
};

/** Update the real payout fields of a booking (what actually arrived in the bank). */
export const updateBookingPayout = async (
  bookingId: string,
  patch: {
    net_payout?: number | null;
    channel_fees?: number | null;
    taxes_withheld?: number | null;
    payout_bank_account_id?: string | null;
    payout_date?: string | null;
    gross_revenue?: number | null;
    exchange_rate?: number | null;
    notes?: string | null;
  },
): Promise<ServiceResult<BookingRow>> => {
  // Si se modifica el bruto, también sincronizamos total_revenue
  // (campo legado que alimenta KPIs históricos).
  const dbPatch: Partial<Omit<BookingRow, 'id' | 'created_at'>> = { ...patch } as Partial<Omit<BookingRow, 'id' | 'created_at'>>;
  if (patch.gross_revenue !== undefined && patch.gross_revenue !== null) {
    dbPatch.total_revenue = patch.gross_revenue;
  }
  const { data, error } = await supabase
    .from('bookings')
    .update(dbPatch)
    .eq('id', bookingId)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/** Generate a unique code for direct-channel bookings: DIR-YYYY-XXXXX */
export const generateDirectBookingCode = (): string => {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return `DIR-${year}-${rand}`;
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
