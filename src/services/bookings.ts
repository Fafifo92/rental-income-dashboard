import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BookingRow } from '@/types/database';
import { datesOverlap, type ParsedBooking, type ConflictEntry, type DuplicateEntry } from './etl';
import { findOrCreateListing } from './listings';
import { inferOperationalFlags, isCancelled } from '@/lib/bookingStatus';
import { todayISO } from '@/lib/dateUtils';

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
  /** 1-indexed page number for server-side pagination. Requires `pageSize`. */
  page?: number;
  /** Rows per page for server-side pagination. Requires `page`. */
  pageSize?: number;
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

    const flags = isCancelled({ status: b.status })
      ? { checkin_done: false, checkout_done: false }
      : inferOperationalFlags(b.start_date, b.end_date);
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

/** BookingRow enriched with its parent listing (joined via listing_id FK). */
export type BookingWithListingRow = BookingRow & {
  listings?: {
    id: string;
    external_name: string;
    property_id: string;
    properties?: { id: string; name: string } | null;
  } | null;
};

export const getBooking = async (
  id: string,
): Promise<ServiceResult<BookingWithListingRow>> => {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, listings(id, external_name, property_id, properties(id, name))')
    .eq('id', id)
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as unknown as BookingWithListingRow, error: null };
};

export const listBookings = async (
  filters?: BookingFilters,
): Promise<ServiceResult<BookingWithListingRow[]>> => {
  // If filtering by property, resolve listing IDs first
  let allowedListingIds: string[] | undefined;
  const propIds: string[] | undefined =
    filters?.propertyIds && filters.propertyIds.length > 0
      ? filters.propertyIds
      : filters?.propertyId
        ? [filters.propertyId]
        : undefined;
  if (propIds) {
    const { data: listingsData, error } = await supabase
      .from('listings')
      .select('id')
      .in('property_id', propIds);
    if (error) return { data: null, error: error.message };
    if (!listingsData || listingsData.length === 0) return { data: [], error: null };
    allowedListingIds = listingsData.map((l: { id: string }) => l.id);
  }

  // Join listing + property so each row carries external_name, property_id and property name inline.
  let query = supabase
    .from('bookings')
    .select('*, listings(id, external_name, property_id, properties(id, name))')
    .order('start_date', { ascending: false });

  if (allowedListingIds) query = query.in('listing_id', allowedListingIds);
  if (filters?.listingId) query = query.eq('listing_id', filters.listingId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.dateFrom) query = query.gte('start_date', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('start_date', filters.dateTo);

  // Search: server-side ilike (avoids fetching all rows for JS filter)
  if (filters?.search) {
    const q = `%${filters.search}%`;
    query = query.or(`guest_name.ilike.${q},confirmation_code.ilike.${q}`);
  }

  // Pagination: use range when requested, otherwise safety cap at 1 000 rows
  if (filters?.page && filters?.pageSize) {
    const from = (filters.page - 1) * filters.pageSize;
    query = query.range(from, from + filters.pageSize - 1);
  } else {
    query = query.limit(1000);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };

  const rows = (data ?? []) as unknown as BookingWithListingRow[];

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

// ─── Booking alerts ──────────────────────────────────────────────────────────

export type BookingAlertIssue = 'checkout' | 'inventory' | 'payout' | 'cleaning';

export interface BookingAlert {
  id: string;
  confirmation_code: string;
  guest_name: string | null;
  end_date: string;
  issues: BookingAlertIssue[];
}

/**
 * Devuelve reservas finalizadas (end_date <= hoy) con tareas operativas pendientes.
 *
 * Issues checkout / inventory / payout → cualquier reserva dentro de la ventana `daysBack`.
 *
 * Issue "cleaning" → SOLO la última reserva completada por propiedad que no tenga
 * ningún booking_cleaning con status 'done' o 'paid'.
 * Máximo 1 alerta de aseo por propiedad, independientemente de cuántas reservas
 * hayan ocurrido en el período.
 */
export const listBookingAlerts = async (
  daysBack = 45,
): Promise<ServiceResult<BookingAlert[]>> => {
  const today = todayISO();
  const [ty, tm, td] = today.split('-').map(Number);
  const fromDate = new Date(ty, tm - 1, td - daysBack);
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;

  // ── A. Bookings en la ventana (para checkout / inventory / payout) ──────────
  const [windowRes, listingsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, confirmation_code, guest_name, end_date, checkout_done, inventory_checked, payout_bank_account_id, status, listing_id')
      .lte('end_date', today)
      .gte('end_date', from)
      .order('end_date', { ascending: false }),
    supabase
      .from('listings')
      .select('id, property_id'),
  ]);

  if (windowRes.error) return { data: null, error: windowRes.error.message };

  const windowRows = (windowRes.data ?? []).filter(b => !isCancelled(b));
  const listingToProperty = new Map(
    (listingsRes.data ?? []).map((l: { id: string; property_id: string }) => [l.id, l.property_id]),
  );

  // ── B. Última reserva completada por propiedad (para cleaning) ──────────────
  // Busca en los últimos 2 años para cubrir propiedades con baja rotación.
  const twoYearsAgo = `${ty - 2}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
  const { data: allCompleted } = await supabase
    .from('bookings')
    .select('id, listing_id, end_date, status')
    .lte('end_date', today)
    .gte('end_date', twoYearsAgo)
    .order('end_date', { ascending: false })
    .limit(2000);

  // Por propiedad: la primera que aparezca (ordenado DESC) = la más reciente
  const lastBookingIdByProperty = new Map<string, string>();
  for (const b of (allCompleted ?? [])) {
    if (isCancelled(b)) continue;
    const propId = listingToProperty.get(b.listing_id);
    if (propId && !lastBookingIdByProperty.has(propId)) {
      lastBookingIdByProperty.set(propId, b.id);
    }
  }

  const lastBookingIds = new Set(lastBookingIdByProperty.values());

  // ── C. Qué "últimas reservas" ya tienen cleaning done/paid ──────────────────
  let cleanedIds = new Set<string>();
  if (lastBookingIds.size > 0) {
    const { data: cleaningsData } = await supabase
      .from('booking_cleanings')
      .select('booking_id')
      .in('booking_id', [...lastBookingIds])
      .in('status', ['done', 'paid']);
    cleanedIds = new Set((cleaningsData ?? []).map((c: { booking_id: string }) => c.booking_id));
  }

  // IDs de reservas con aseo pendiente (última de su propiedad, sin cleaning registrado)
  const pendingCleaningIds = new Set(
    [...lastBookingIds].filter(id => !cleanedIds.has(id)),
  );

  // ── D. Construir alertas ────────────────────────────────────────────────────
  const alertMap = new Map<string, BookingAlert>();

  // Procesar reservas en la ventana (checkout / inventory / payout + cleaning si aplica)
  for (const b of windowRows) {
    const issues: BookingAlertIssue[] = [
      ...(b.checkout_done ? [] : ['checkout' as const]),
      ...(b.inventory_checked ? [] : ['inventory' as const]),
      ...(b.payout_bank_account_id ? [] : ['payout' as const]),
      ...(pendingCleaningIds.has(b.id) ? ['cleaning' as const] : []),
    ];
    if (issues.length > 0) {
      alertMap.set(b.id, {
        id: b.id,
        confirmation_code: b.confirmation_code,
        guest_name: b.guest_name,
        end_date: b.end_date,
        issues,
      });
    }
  }

  // Si la última reserva con cleaning pendiente está FUERA de la ventana,
  // igual la mostramos (solo como cleaning, sin los otros flags).
  const outsideWindow = [...pendingCleaningIds].filter(id => !alertMap.has(id));
  if (outsideWindow.length > 0) {
    const { data: extraRows } = await supabase
      .from('bookings')
      .select('id, confirmation_code, guest_name, end_date')
      .in('id', outsideWindow);
    for (const b of (extraRows ?? [])) {
      alertMap.set(b.id, {
        id: b.id,
        confirmation_code: b.confirmation_code,
        guest_name: b.guest_name,
        end_date: b.end_date,
        issues: ['cleaning'],
      });
    }
  }

  return { data: [...alertMap.values()].sort((a, b) => b.end_date.localeCompare(a.end_date)), error: null };
};

// ─── Import conflict detection ────────────────────────────────────────────────

/**
 * Detects bookings in the uploaded file that overlap with existing DB bookings
 * for the same listing. Same confirmation_code = upsert (not a conflict).
 * Cancelled bookings on either side are excluded.
 */
export const detectDbConflicts = async (
  bookings: ParsedBooking[],
  listingNameToPropertyId: Record<string, string>,
): Promise<ServiceResult<ConflictEntry[]>> => {
  const propertyIds = [...new Set(Object.values(listingNameToPropertyId))];
  if (propertyIds.length === 0) return { data: [], error: null };

  const { data: listings, error: lErr } = await supabase
    .from('listings')
    .select('id, external_name, property_id')
    .in('property_id', propertyIds);
  if (lErr) return { data: null, error: lErr.message };

  const nameToListingId: Record<string, string> = {};
  for (const l of listings ?? []) {
    if (listingNameToPropertyId[l.external_name] === l.property_id) {
      nameToListingId[l.external_name] = l.id;
    }
  }

  const listingIds = [...new Set(Object.values(nameToListingId))];
  if (listingIds.length === 0) return { data: [], error: null };

  const { data: existing, error: bErr } = await supabase
    .from('bookings')
    .select('id, confirmation_code, guest_name, start_date, end_date, listing_id, num_nights, status')
    .in('listing_id', listingIds);
  if (bErr) return { data: null, error: bErr.message };

  const listingIdToName: Record<string, string> = {};
  for (const [name, id] of Object.entries(nameToListingId)) {
    listingIdToName[id] = name;
  }

  const conflicts: ConflictEntry[] = [];
  const seen = new Set<string>();

  for (const incoming of bookings) {
    if (!incoming.start_date || !incoming.end_date) continue;
    if (incoming.status?.toLowerCase().includes('cancel')) continue;
    const listingId = nameToListingId[incoming.listing_name];
    if (!listingId) continue;

    for (const ex of existing ?? []) {
      if (ex.listing_id !== listingId) continue;
      if (ex.confirmation_code === incoming.confirmation_code) continue;
      if ((ex.status as string | null)?.toLowerCase().includes('cancel')) continue;
      if (!ex.start_date || !ex.end_date) continue;

      if (datesOverlap(incoming.start_date, incoming.end_date, ex.start_date, ex.end_date)) {
        const key = [incoming.confirmation_code, ex.confirmation_code].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          id: `db-${incoming.confirmation_code}-${ex.confirmation_code}`,
          type: 'with_db',
          listingName: listingIdToName[listingId] ?? incoming.listing_name,
          incoming,
          opponent: {
            confirmation_code: ex.confirmation_code,
            guest_name: ex.guest_name,
            start_date: ex.start_date,
            end_date: ex.end_date,
            num_nights: ex.num_nights,
            source: 'db',
          },
        });
      }
    }
  }

  return { data: conflicts, error: null };
};

/**
 * Fetches existing DB rows for any confirmation_code in the incoming list.
 * Returns one DuplicateEntry per code that already exists in the DB.
 */
export const detectDbDuplicates = async (
  bookings: ParsedBooking[],
): Promise<ServiceResult<DuplicateEntry[]>> => {
  const codes = [...new Set(bookings.map(b => b.confirmation_code).filter(Boolean))];
  if (codes.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from('bookings')
    .select('confirmation_code, status, guest_name, start_date, end_date, num_nights, total_revenue, payout_date, payout_bank_account_id, notes, listings(external_name)')
    .in('confirmation_code', codes);
  if (error) return { data: null, error: error.message };

  const dbMap = new Map<string, Record<string, unknown>>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    dbMap.set(row.confirmation_code as string, row);
  }

  const duplicates: DuplicateEntry[] = [];
  for (const b of bookings) {
    const row = dbMap.get(b.confirmation_code);
    if (!row) continue;

    const dbRevenue = Number(row.total_revenue ?? 0);
    const differingFields: string[] = [];
    if ((b.status ?? '') !== String(row.status ?? '')) differingFields.push('status');
    if ((b.guest_name ?? '') !== String(row.guest_name ?? '')) differingFields.push('guest_name');
    if ((b.start_date ?? '') !== String(row.start_date ?? '')) differingFields.push('start_date');
    if ((b.end_date ?? '') !== String(row.end_date ?? '')) differingFields.push('end_date');
    if (b.num_nights !== Number(row.num_nights ?? 0)) differingFields.push('num_nights');
    if (b.revenue !== dbRevenue) differingFields.push('revenue');

    const listingRow = row.listings as { external_name?: string } | null | undefined;

    duplicates.push({
      id: `db-dup-${b.confirmation_code}`,
      confirmation_code: b.confirmation_code,
      type: 'with_db',
      incoming: b,
      existing: {
        confirmation_code: b.confirmation_code,
        status: String(row.status ?? ''),
        guest_name: (row.guest_name as string | null) ?? null,
        start_date: String(row.start_date ?? ''),
        end_date: String(row.end_date ?? ''),
        num_nights: Number(row.num_nights ?? 0),
        listing_name: listingRow?.external_name ?? '',
        revenue: dbRevenue,
        has_payout: !!(row.payout_date || row.payout_bank_account_id),
        has_notes: !!row.notes,
        source: 'db',
      },
      differingFields,
    });
  }

  return { data: duplicates, error: null };
};

export type OccupancyBooking = Pick<BookingRow, 'id' | 'listing_id' | 'confirmation_code' | 'guest_name' | 'start_date' | 'end_date' | 'status' | 'channel'>;

/**
 * Fetches bookings overlapping [from, to] for given listing IDs.
 * Used by occupancy charts/grid — applies an optional cancelled-status filter.
 */
export const listBookingsForOccupancy = async (opts: {
  from: string;
  to: string;
  listingIds: string[];
  excludeCancelled?: boolean;
}): Promise<ServiceResult<OccupancyBooking[]>> => {
  if (!opts.listingIds.length) return { data: [], error: null };
  let q = supabase
    .from('bookings')
    .select('id, listing_id, confirmation_code, guest_name, start_date, end_date, status, channel')
    .gte('end_date', opts.from)
    .lte('start_date', opts.to)
    .in('listing_id', opts.listingIds);
  if (opts.excludeCancelled) q = q.not('status', 'ilike', '%cancel%');
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as OccupancyBooking[], error: null };
};

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
    checkin_done?: boolean;
    checkout_done?: boolean;
    security_deposit?: number | null;
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
      checkin_done: data.checkin_done ?? false,
      checkout_done: data.checkout_done ?? false,
      inventory_checked: false,
      operational_notes: null,
      security_deposit: data.security_deposit ?? null,
      deposit_status: 'none',
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
    listing_id?: string | null;
    security_deposit?: number | null;
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

/** Update the deposit-related fields of a booking. */
export const updateBookingDeposit = async (
  bookingId: string,
  patch: {
    security_deposit?: number | null;
    deposit_bank_account_id?: string | null;
    deposit_status?: 'none' | 'received' | 'partial_return' | 'returned';
    deposit_returned_amount?: number | null;
    deposit_return_date?: string | null;
  },
): Promise<ServiceResult<BookingRow>> => {
  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
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
