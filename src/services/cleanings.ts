import { supabase } from '@/lib/supabase/client';
import type { BookingCleaningRow, CleaningStatus } from '@/types/database';

const formatCurrencyForDesc = (n: number): string =>
  '$' + Math.round(n).toLocaleString('es-CO');

export type ServiceResult<T> =
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
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
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
 * Consolida los aseos pendientes/hechos-sin-pagar de una persona en un único
 * gasto ("Aseo – Pago consolidado") y marca esos aseos como `paid`.
 *
 * Flujo:
 *   1. Calcula total sobre cleanings que cumplan criterio (status ∈ {done} o
 *      también {pending} si `includePending = true`).
 *   2. Crea un Expense kind='cleaning' (categoría 'variable'), status='paid'
 *      con la fecha de pago y el banco opcionales.
 *   3. Marca cada cleaning incluido como status='paid' + paid_date.
 *
 * Si falla a mitad, devuelve el error (se sobreentiende que el dueño puede
 * revertir manualmente; no usamos transacción Supabase para simplificar).
 */
export const payoutCleanerConsolidated = async (args: {
  cleanerId: string;
  cleanerName: string;
  paidDate: string;          // YYYY-MM-DD
  bankAccountId?: string | null;
  includePending?: boolean;  // si true, también liquida cleanings aún en status 'pending'
}): Promise<ServiceResult<{ expense_id: string; cleaning_ids: string[]; total: number }>> => {
  const { cleanerId, cleanerName, paidDate, bankAccountId = null, includePending = false } = args;

  // 1. Traer cleanings elegibles (incluye supplies_amount + reimburse_to_cleaner para Bloque 16)
  const statusesIn: CleaningStatus[] = includePending ? ['done', 'pending'] : ['done'];
  const { data: eligible, error: qErr } = await supabase
    .from('booking_cleanings')
    .select('id, fee, booking_id, supplies_amount, reimburse_to_cleaner')
    .eq('cleaner_id', cleanerId)
    .in('status', statusesIn)
    .is('paid_date', null);

  if (qErr) return { data: null, error: qErr.message };
  if (!eligible || eligible.length === 0) {
    return { data: null, error: 'No hay aseos pendientes de liquidar para esta persona.' };
  }

  const totalFee = eligible.reduce((s, c) => s + Number(c.fee), 0);
  // Solo se reembolsan insumos cuando reimburse_to_cleaner=true.
  const totalSupplies = eligible.reduce(
    (s, c) => s + ((c as { reimburse_to_cleaner: boolean | null }).reimburse_to_cleaner ? Number((c as { supplies_amount: number | null }).supplies_amount ?? 0) : 0),
    0,
  );
  const total = totalFee + totalSupplies;
  const cleaningIds = eligible.map(c => c.id as string);
  const desc = totalSupplies > 0
    ? `Pago consolidado aseo – ${cleanerName} (${eligible.length} aseos: ${formatCurrencyForDesc(totalFee)} tarifa + ${formatCurrencyForDesc(totalSupplies)} insumos)`
    : `Pago consolidado aseo – ${cleanerName} (${eligible.length} aseos)`;

  // 2. Crear gasto consolidado
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado.' };

  const { data: expense, error: eErr } = await supabase
    .from('expenses')
    .insert({
      owner_id: user.id,
      property_id: null,
      category: 'cleaning',
      type: 'variable',
      amount: total,
      currency: 'COP',
      date: paidDate,
      description: desc,
      status: 'paid',
      bank_account_id: bankAccountId,
      booking_id: null,
      vendor: cleanerName,
      person_in_charge: null,
      adjustment_id: null,
      vendor_id: cleanerId,
      shared_bill_id: null,
      subcategory: 'cleaning',
      expense_group_id: null,
    })
    .select('id')
    .single();

  if (eErr || !expense) return { data: null, error: eErr?.message ?? 'No se pudo crear el gasto.' };

  // 3. Marcar cleanings como paid
  const { error: uErr } = await supabase
    .from('booking_cleanings')
    .update({ status: 'paid', paid_date: paidDate })
    .in('id', cleaningIds);

  if (uErr) return { data: null, error: uErr.message };

  return {
    data: { expense_id: expense.id as string, cleaning_ids: cleaningIds, total },
    error: null,
  };
};
