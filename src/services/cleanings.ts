import { supabase } from '@/lib/supabase/client';
import type { BookingCleaningRow, CleaningStatus } from '@/types/database';

export type ServiceResult<T>=
  | { data: T; error: null }
  | { data: null; error: string };

export interface BookingCleaning {
  id: string;
  booking_id: string;
  cleaner_id: string | null;
  fee: number;
  status: CleaningStatus;
  done_date: string | null;
  paid_date: string | null;
  notes: string | null;
  supplies_amount: number;
  reimburse_to_cleaner: boolean;
  created_at: string;
}

const toCleaning = (row: BookingCleaningRow): BookingCleaning => ({
  id: row.id,
  booking_id: row.booking_id,
  cleaner_id: row.cleaner_id,
  fee: Number(row.fee),
  status: row.status,
  done_date: row.done_date,
  paid_date: row.paid_date,
  notes: row.notes,
  supplies_amount: Number(row.supplies_amount ?? 0),
  reimburse_to_cleaner: !!row.reimburse_to_cleaner,
  created_at: row.created_at,
});

export const listCleaningsByBooking = async (
  bookingId: string,
): Promise<ServiceResult<BookingCleaning[]>> => {
  const { data, error } = await supabase
    .from('booking_cleanings')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map(toCleaning), error: null };
};

export const listAllCleanings = async (): Promise<ServiceResult<BookingCleaning[]>> => {
  const { data, error } = await supabase
    .from('booking_cleanings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map(toCleaning), error: null };
};

// Bloque 15B — Historial enriquecido del cleaner: cada fila trae propiedad,
// reserva, huésped y fechas para mostrar en el modal "Ver historial".
export interface CleaningHistoryRow extends BookingCleaning {
  booking_code: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  property_id: string | null;
  property_name: string | null;
  listing_source: string | null;
}

export const listCleaningsByCleaner = async (
  cleanerId: string,
): Promise<ServiceResult<CleaningHistoryRow[]>> => {
  // 1) Cleanings de este cleaner.
  const { data: cleaningRows, error: cErr } = await supabase
    .from('booking_cleanings')
    .select('*')
    .eq('cleaner_id', cleanerId)
    .order('done_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (cErr) return { data: null, error: cErr.message };

  const cleanings = (cleaningRows ?? []) as BookingCleaningRow[];
  if (cleanings.length === 0) return { data: [], error: null };

  // 2) Bookings asociados.
  const bookingIds = Array.from(new Set(cleanings.map(c => c.booking_id)));
  const { data: bookingRows, error: bErr } = await supabase
    .from('bookings')
    .select('id, confirmation_code, guest_name, start_date, end_date, listing_id')
    .in('id', bookingIds);
  if (bErr) return { data: null, error: bErr.message };

  type BookingMini = {
    id: string; confirmation_code: string | null; guest_name: string | null;
    start_date: string | null; end_date: string | null; listing_id: string;
  };
  const bookings = (bookingRows ?? []) as BookingMini[];
  const bookingMap = new Map(bookings.map(b => [b.id, b]));

  // 3) Listings asociados.
  const listingIds = Array.from(new Set(bookings.map(b => b.listing_id).filter(Boolean)));
  type ListingMini = { id: string; source: string | null; property_id: string };
  let listings: ListingMini[] = [];
  if (listingIds.length > 0) {
    const { data: lRows, error: lErr } = await supabase
      .from('listings')
      .select('id, source, property_id')
      .in('id', listingIds);
    if (lErr) return { data: null, error: lErr.message };
    listings = (lRows ?? []) as ListingMini[];
  }
  const listingMap = new Map(listings.map(l => [l.id, l]));

  // 4) Properties asociadas.
  const propertyIds = Array.from(new Set(listings.map(l => l.property_id).filter(Boolean)));
  type PropertyMini = { id: string; name: string };
  let properties: PropertyMini[] = [];
  if (propertyIds.length > 0) {
    const { data: pRows, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', propertyIds);
    if (pErr) return { data: null, error: pErr.message };
    properties = (pRows ?? []) as PropertyMini[];
  }
  const propertyMap = new Map(properties.map(p => [p.id, p]));

  const rows: CleaningHistoryRow[] = cleanings.map((r) => {
    const base = toCleaning(r);
    const booking = bookingMap.get(r.booking_id);
    const listing = booking ? listingMap.get(booking.listing_id) : undefined;
    const property = listing ? propertyMap.get(listing.property_id) : undefined;
    return {
      ...base,
      booking_code: booking?.confirmation_code ?? null,
      guest_name: booking?.guest_name ?? null,
      check_in: booking?.start_date ?? null,
      check_out: booking?.end_date ?? null,
      property_id: property?.id ?? null,
      property_name: property?.name ?? null,
      listing_source: listing?.source ?? null,
    };
  });

  return { data: rows, error: null };
};

/** Same enrichment as listCleaningsByCleaner but for ALL cleaners at once,
 *  with optional date range (done_date) and cleaner id filter. */
export const listAllCleaningsEnriched = async (options?: {
  from?: string;
  to?: string;
  cleanerIds?: string[];
}): Promise<ServiceResult<CleaningHistoryRow[]>> => {
  let query = supabase
    .from('booking_cleanings')
    .select('*');
  if (options?.cleanerIds && options.cleanerIds.length > 0) {
    query = query.in('cleaner_id', options.cleanerIds);
  }
  if (options?.from) query = query.gte('done_date', options.from);
  if (options?.to)   query = query.lte('done_date', options.to);
  query = query
    .order('done_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  const { data: cleaningRows, error: cErr } = await query;
  if (cErr) return { data: null, error: cErr.message };

  const cleanings = (cleaningRows ?? []) as BookingCleaningRow[];
  if (cleanings.length === 0) return { data: [], error: null };

  const bookingIds = Array.from(new Set(cleanings.map(c => c.booking_id)));
  const { data: bookingRows, error: bErr } = await supabase
    .from('bookings')
    .select('id, confirmation_code, guest_name, start_date, end_date, listing_id')
    .in('id', bookingIds);
  if (bErr) return { data: null, error: bErr.message };

  type BookingMini = {
    id: string; confirmation_code: string | null; guest_name: string | null;
    start_date: string | null; end_date: string | null; listing_id: string;
  };
  const bookings = (bookingRows ?? []) as BookingMini[];
  const bookingMap = new Map(bookings.map(b => [b.id, b]));

  const listingIds = Array.from(new Set(bookings.map(b => b.listing_id).filter(Boolean)));
  type ListingMini = { id: string; source: string | null; property_id: string };
  let listings: ListingMini[] = [];
  if (listingIds.length > 0) {
    const { data: lRows, error: lErr } = await supabase
      .from('listings')
      .select('id, source, property_id')
      .in('id', listingIds);
    if (lErr) return { data: null, error: lErr.message };
    listings = (lRows ?? []) as ListingMini[];
  }
  const listingMap = new Map(listings.map(l => [l.id, l]));

  const propertyIds = Array.from(new Set(listings.map(l => l.property_id).filter(Boolean)));
  type PropertyMini = { id: string; name: string };
  let properties: PropertyMini[] = [];
  if (propertyIds.length > 0) {
    const { data: pRows, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', propertyIds);
    if (pErr) return { data: null, error: pErr.message };
    properties = (pRows ?? []) as PropertyMini[];
  }
  const propertyMap = new Map(properties.map(p => [p.id, p]));

  const rows: CleaningHistoryRow[] = cleanings.map((r) => {
    const base = toCleaning(r);
    const booking = bookingMap.get(r.booking_id);
    const listing = booking ? listingMap.get(booking.listing_id) : undefined;
    const property = listing ? propertyMap.get(listing.property_id) : undefined;
    return {
      ...base,
      booking_code: booking?.confirmation_code ?? null,
      guest_name: booking?.guest_name ?? null,
      check_in: booking?.start_date ?? null,
      check_out: booking?.end_date ?? null,
      property_id: property?.id ?? null,
      property_name: property?.name ?? null,
      listing_source: listing?.source ?? null,
    };
  });

  return { data: rows, error: null };
};

export const createCleaning = async (
  input: Omit<BookingCleaning, 'id' | 'created_at'>,
): Promise<ServiceResult<BookingCleaning>> => {
  const { data, error } = await supabase
    .from('booking_cleanings')
    .insert(input)
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: toCleaning(data as BookingCleaningRow), error: null };
};

export const updateCleaning = async (
  id: string,
  patch: Partial<Omit<BookingCleaning, 'id' | 'created_at' | 'booking_id'>>,
): Promise<ServiceResult<BookingCleaning>> => {
  const { data, error } = await supabase
    .from('booking_cleanings')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: toCleaning(data as BookingCleaningRow), error: null };
};

export const deleteCleaning = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('booking_cleanings').delete().eq('id', id);
  if (error) return { data: null, error: error.message };  return { data: true, error: null };
};

export interface CleanerBalance {
  cleaner_id: string;
  pending_count: number;
  done_unpaid_count: number;
  pending_amount: number;   // status 'pending'
  done_unpaid_amount: number; // status 'done' & paid_date NULL
  total_owed: number;        // pending + done_unpaid
}

export const computeCleanerBalances = (
  cleanings: BookingCleaning[],
): Map<string, CleanerBalance> => {
  const map = new Map<string, CleanerBalance>();
  for (const c of cleanings) {
    if (!c.cleaner_id) continue;
    const b = map.get(c.cleaner_id) ?? {
      cleaner_id: c.cleaner_id,
      pending_count: 0,
      done_unpaid_count: 0,
      pending_amount: 0,
      done_unpaid_amount: 0,
      total_owed: 0,
    };
    if (c.status === 'pending') {
      b.pending_count += 1;
      b.pending_amount += c.fee;
      if (c.reimburse_to_cleaner) b.pending_amount += c.supplies_amount;
    } else if (c.status === 'done') {
      b.done_unpaid_count += 1;
      b.done_unpaid_amount += c.fee;
      if (c.reimburse_to_cleaner) b.done_unpaid_amount += c.supplies_amount;
    }
    b.total_owed = b.pending_amount + b.done_unpaid_amount;
    map.set(c.cleaner_id, b);
  }
  return map;
};

// Update booking operational flags
export const updateBookingOperational = async (
  bookingId: string,
  patch: {
    checkin_done?: boolean;
    checkout_done?: boolean;
    inventory_checked?: boolean;
    operational_notes?: string | null;
  },
): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('bookings').update(patch).eq('id', bookingId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/**
 * Liquida los aseos pendientes/hechos-sin-pagar de una persona generando
 * **un gasto por aseo** (vinculado a la propiedad y reserva específicas) y,
 * cuando aplica, **un gasto separado de insumos** por cada aseo cuyo
 * `reimburse_to_cleaner=true` y `supplies_amount>0`. Luego marca los
 * cleanings incluidos como `paid`.
 *
 * Se mantiene un `expense_group_id` compartido (UUID generado del lado del
 * cliente) entre todos los gastos creados en una misma liquidación, de modo
 * que sigan siendo trazables como "una liquidación" sin perder el detalle
 * por reserva ni la separación aseo / insumos.
 */
export const payoutCleanerConsolidated = async (args: {
  cleanerId: string;
  cleanerName: string;
  paidDate: string;          // YYYY-MM-DD
  bankAccountId?: string | null;
  includePending?: boolean;  // si true, también liquida cleanings aún en status 'pending'
}): Promise<ServiceResult<{ expense_ids: string[]; cleaning_ids: string[]; total: number }>> => {
  const { cleanerId, cleanerName, paidDate, bankAccountId = null, includePending = false } = args;

  // 1. Traer cleanings elegibles
  const statusesIn: CleaningStatus[] = includePending ? ['done', 'pending'] : ['done'];
  const { data: eligible, error: qErr } = await supabase
    .from('booking_cleanings')
    .select('id, fee, booking_id, supplies_amount, reimburse_to_cleaner, done_date')
    .eq('cleaner_id', cleanerId)
    .in('status', statusesIn)
    .is('paid_date', null);

  if (qErr) return { data: null, error: qErr.message };

  // 1b. Traer expenses sueltos pendientes anclados al cleaner
  //     (compras de insumos pagadas por la persona de aseo y aún sin liquidar).
  const { data: looseExpenses, error: lqErr } = await supabase
    .from('expenses')
    .select('id, amount')
    .eq('vendor_id', cleanerId)
    .eq('status', 'pending')
    .eq('subcategory', 'cleaning');

  if (lqErr) return { data: null, error: lqErr.message };

  const hasCleanings = (eligible?.length ?? 0) > 0;
  const hasLoose = (looseExpenses?.length ?? 0) > 0;

  if (!hasCleanings && !hasLoose) {
    return { data: null, error: 'No hay aseos pendientes de liquidar para esta persona.' };
  }

  // 2. Resolver booking → property y datos de reserva (código, fechas).
  const bookingIds = Array.from(new Set((eligible ?? []).map(c => c.booking_id as string)));
  const { data: bookingRows, error: bErr } = await supabase
    .from('bookings')
    .select('id, confirmation_code, start_date, end_date, listing_id')
    .in('id', bookingIds);
  if (bErr) return { data: null, error: bErr.message };

  type BookingMini = {
    id: string; confirmation_code: string | null;
    start_date: string | null; end_date: string | null; listing_id: string;
  };
  const bookings = (bookingRows ?? []) as BookingMini[];
  const bookingMap = new Map(bookings.map(b => [b.id, b]));

  const listingIds = Array.from(new Set(bookings.map(b => b.listing_id).filter(Boolean)));
  type ListingMini = { id: string; property_id: string };
  let listings: ListingMini[] = [];
  if (listingIds.length > 0) {
    const { data: lRows, error: lErr } = await supabase
      .from('listings')
      .select('id, property_id')
      .in('id', listingIds);
    if (lErr) return { data: null, error: lErr.message };
    listings = (lRows ?? []) as ListingMini[];
  }
  const listingMap = new Map(listings.map(l => [l.id, l]));

  const propertyIds = Array.from(new Set(listings.map(l => l.property_id).filter(Boolean)));
  type PropertyMini = { id: string; name: string };
  let properties: PropertyMini[] = [];
  if (propertyIds.length > 0) {
    const { data: pRows, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', propertyIds);
    if (pErr) return { data: null, error: pErr.message };
    properties = (pRows ?? []) as PropertyMini[];
  }
  const propertyMap = new Map(properties.map(p => [p.id, p]));

  // 3. Construir filas de expenses (una por aseo + una por insumos cuando aplique)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado.' };

  const groupId =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const expensesToInsert: Array<Omit<import('@/types/database').ExpenseRow, 'id' | 'created_at'>> = [];
  let totalFee = 0;
  let totalSupplies = 0;

  for (const c of eligible ?? []) {
    const fee = Number(c.fee);
    const supplies = Number((c as { supplies_amount: number | null }).supplies_amount ?? 0);
    const reimb = !!(c as { reimburse_to_cleaner: boolean | null }).reimburse_to_cleaner;
    const booking = bookingMap.get(c.booking_id as string);
    const listing = booking ? listingMap.get(booking.listing_id) : undefined;
    const property = listing ? propertyMap.get(listing.property_id) : undefined;
    const propertyId = property?.id ?? null;
    const propertyName = property?.name ?? 'Sin propiedad';
    const code = booking?.confirmation_code ?? (c.booking_id as string).slice(0, 8);
    const doneDate = (c as { done_date: string | null }).done_date ?? booking?.end_date ?? paidDate;

    if (fee > 0) {
      totalFee += fee;
      expensesToInsert.push({
        owner_id: user.id,
        property_id: propertyId,
        category: 'Aseo',
        type: 'variable',
        amount: fee,
        currency: 'COP',
        date: paidDate,
        description: `Aseo – ${propertyName} · Reserva ${code} (${doneDate}) · ${cleanerName}`,
        status: 'paid',
        bank_account_id: bankAccountId,
        booking_id: c.booking_id as string,
        vendor: cleanerName,
        person_in_charge: null,
        adjustment_id: null,
        vendor_id: cleanerId,
        shared_bill_id: null,
        subcategory: 'cleaning',
        expense_group_id: groupId,
      });
    }

    if (reimb && supplies > 0) {
      totalSupplies += supplies;
      expensesToInsert.push({
        owner_id: user.id,
        property_id: propertyId,
        category: 'Insumos de aseo',
        type: 'variable',
        amount: supplies,
        currency: 'COP',
        date: paidDate,
        description: `Insumos de aseo – ${propertyName} · Reserva ${code} (${doneDate}) · ${cleanerName}`,
        status: 'paid',
        bank_account_id: bankAccountId,
        booking_id: c.booking_id as string,
        vendor: cleanerName,
        person_in_charge: null,
        adjustment_id: null,
        vendor_id: cleanerId,
        shared_bill_id: null,
        subcategory: 'cleaning',
        expense_group_id: groupId,
      });
    }
  }

  const total = totalFee + totalSupplies;
  const cleaningIds = (eligible ?? []).map(c => c.id as string);
  const looseExpenseIds = (looseExpenses ?? []).map(e => e.id as string);
  const looseTotal = (looseExpenses ?? []).reduce((acc, e) => acc + Number(e.amount), 0);

  if (expensesToInsert.length === 0 && looseExpenseIds.length === 0) {
    return { data: null, error: 'No hay montos a liquidar (todos los aseos están en cero).' };
  }

  // 4. Insertar nuevos expenses (cuando hay cleanings nuevos)
  let insertedIds: string[] = [];
  if (expensesToInsert.length > 0) {
    const { data: inserted, error: eErr } = await supabase
      .from('expenses')
      .insert(expensesToInsert)
      .select('id');
    if (eErr || !inserted) return { data: null, error: eErr?.message ?? 'No se pudieron crear los gastos.' };
    insertedIds = inserted.map(r => r.id as string);
  }

  // 4b. Marcar como pagados los expenses sueltos preexistentes y unificarlos al grupo.
  if (looseExpenseIds.length > 0) {
    const { error: upErr } = await supabase
      .from('expenses')
      .update({
        status: 'paid',
        bank_account_id: bankAccountId,
        date: paidDate,
        expense_group_id: groupId,
      })
      .in('id', looseExpenseIds);
    if (upErr) return { data: null, error: upErr.message };
  }

  // 5. Marcar cleanings como paid (si los hay)
  if (cleaningIds.length > 0) {
    const { error: uErr } = await supabase
      .from('booking_cleanings')
      .update({ status: 'paid', paid_date: paidDate })
      .in('id', cleaningIds);
    if (uErr) return { data: null, error: uErr.message };
  }

  return {
    data: {
      expense_ids: [...insertedIds, ...looseExpenseIds],
      cleaning_ids: cleaningIds,
      total: total + looseTotal,
    },
    error: null,
  };
};

/**
 * Devuelve el monto pendiente acumulado en `expenses` (insumos sueltos)
 * por cleaner. Sirve para sumarlo al balance de aseos en el dashboard.
 */
export const getLooseCleanerSuppliesTotals = async (): Promise<
  ServiceResult<Map<string, { amount: number; count: number }>>
> => {
  const { data, error } = await supabase
    .from('expenses')
    .select('vendor_id, amount')
    .eq('status', 'pending')
    .eq('subcategory', 'cleaning')
    .not('vendor_id', 'is', null);
  if (error) return { data: null, error: error.message };
  const map = new Map<string, { amount: number; count: number }>();
  for (const r of data ?? []) {
    const vid = r.vendor_id as string | null;
    if (!vid) continue;
    const cur = map.get(vid) ?? { amount: 0, count: 0 };
    cur.amount += Number(r.amount);
    cur.count += 1;
    map.set(vid, cur);
  }
  return { data: map, error: null };
};

/**
 * Historial de **insumos sueltos** comprados por un cleaner, registrados
 * directamente como `expenses` con `vendor_id=cleanerId`+`subcategory='cleaning'`
 * (es decir, NO atados a un booking_cleaning). Incluye estado y la propiedad
 * cuando aplica. Sirve para mostrarlos en el modal "Ver historial" y al
 * liquidar saber cuánto se le debe en insumos.
 */
export interface LooseSupplyRow {
  id: string;
  date: string;
  amount: number;
  status: string;
  description: string | null;
  paid_date: string | null;
  property_id: string | null;
  property_name: string | null;
  expense_group_id: string | null;
}

export const listCleanerLooseSupplies = async (
  cleanerId: string,
): Promise<ServiceResult<LooseSupplyRow[]>> => {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, date, amount, status, description, property_id, expense_group_id')
    .eq('vendor_id', cleanerId)
    .eq('subcategory', 'cleaning')
    .is('booking_id', null)
    .order('date', { ascending: false });
  if (error) return { data: null, error: error.message };

  const rows = data ?? [];
  const propertyIds = Array.from(new Set(rows.map(r => r.property_id).filter(Boolean) as string[]));
  let propertyMap = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: pRows, error: pErr } = await supabase
      .from('properties')
      .select('id, name')
      .in('id', propertyIds);
    if (pErr) return { data: null, error: pErr.message };
    propertyMap = new Map((pRows ?? []).map(p => [p.id as string, p.name as string]));
  }

  return {
    data: rows.map(r => ({
      id: r.id as string,
      date: r.date as string,
      amount: Number(r.amount),
      status: r.status as string,
      description: (r.description as string | null) ?? null,
      paid_date: r.status === 'paid' ? (r.date as string) : null,
      property_id: (r.property_id as string | null) ?? null,
      property_name: r.property_id ? propertyMap.get(r.property_id as string) ?? null : null,
      expense_group_id: (r.expense_group_id as string | null) ?? null,
    })),
    error: null,
  };
};
