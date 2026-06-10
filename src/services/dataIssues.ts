/**
 * Servicio para la página /data-issues — detecta y repara inconsistencias
 * heredadas que no pueden prevenirse del lado del cliente.
 */
import { supabase } from '@/lib/supabase/client';
import type { BankAccountRow, BookingCleaningRow } from '@/types/database';
import type { ServiceResult } from './expenses';
import { isDemoMode } from '@/lib/demoMode';
import { demoBlockWrite, demoWriteBlockedResult } from '@/lib/demoGuard';
import { deleteCleaning } from './cleanings';

export interface DataIssuesSummary {
  expenses_paid_without_account_count: number;
  expenses_paid_without_account_amount: number;
  cleanings_paid_without_expense_count: number;
  cleanings_paid_without_date_count: number;
  overlapping_bookings_count: number;
  bookings_without_payout_account_count: number;
  bookings_without_payout_account_amount: number;
  inconsistent_payouts_count: number;
  invalid_expenses_count: number;
  paid_cleanings_without_cleaner_count: number;
  done_cleanings_without_date_count: number;
  invalid_booking_dates_count: number;
  duplicate_codes_count: number;
}

const EMPTY_SUMMARY: DataIssuesSummary = {
  expenses_paid_without_account_count: 0,
  expenses_paid_without_account_amount: 0,
  cleanings_paid_without_expense_count: 0,
  cleanings_paid_without_date_count: 0,
  overlapping_bookings_count: 0,
  bookings_without_payout_account_count: 0,
  bookings_without_payout_account_amount: 0,
  inconsistent_payouts_count: 0,
  invalid_expenses_count: 0,
  paid_cleanings_without_cleaner_count: 0,
  done_cleanings_without_date_count: 0,
  invalid_booking_dates_count: 0,
  duplicate_codes_count: 0,
};

export const fetchDataIssuesSummary = async (): Promise<ServiceResult<DataIssuesSummary>> => {
  if (isDemoMode()) return { data: EMPTY_SUMMARY, error: null };
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
  ) => Promise<{ data: DataIssuesSummary[] | null; error: { message: string } | null }>)(
    'rpc_data_issues_summary_v2',
  );
  if (error) return { data: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row ? (row as DataIssuesSummary) : EMPTY_SUMMARY, error: null };
};

export interface OrphanExpense {
  id: string;
  date: string;
  amount: number;
  category: string;
  subcategory: string | null;
  description: string | null;
  vendor: string | null;
  booking_id: string | null;
  expense_group_id: string | null;
  property_name: string | null;
  // Contexto de reserva (cuando aplica) — para mostrar "Reserva" clickeable y fecha real.
  confirmation_code: string | null;
  booking_end_date: string | null;
  /** done_date del booking_cleaning ligado (cuando este gasto es de aseo). */
  cleaning_done_date: string | null;
}

export const listExpensesPaidWithoutAccount = async (): Promise<ServiceResult<OrphanExpense[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('expenses')
    .select(`
      id, date, amount, category, subcategory, description, vendor, vendor_id,
      booking_id, expense_group_id,
      property:properties ( name ),
      booking:bookings ( confirmation_code, end_date )
    `)
    .eq('status', 'paid')
    .is('bank_account_id', null)
    .order('date', { ascending: false });
  if (error) return { data: null, error: error.message };

  type Raw = Record<string, unknown> & {
    booking_id: string | null;
    vendor_id: string | null;
    category: string;
    property?: { name: string | null } | { name: string | null }[] | null;
    booking?: { confirmation_code: string | null; end_date: string | null }
      | { confirmation_code: string | null; end_date: string | null }[]
      | null;
  };
  const rawRows = (data ?? []) as unknown as Raw[];

  // Para gastos de aseo (category='Aseo' o 'Insumos de aseo'), buscar el booking_cleaning
  // correspondiente y traer su done_date — esa es la fecha "real" que el usuario espera ver.
  const cleaningKeys = rawRows
    .filter(r => (r.category === 'Aseo' || r.category === 'Insumos de aseo')
      && r.booking_id && r.vendor_id)
    .map(r => ({ booking_id: r.booking_id as string, cleaner_id: r.vendor_id as string }));

  const doneDateMap = new Map<string, string>(); // key: `${booking_id}__${cleaner_id}`
  if (cleaningKeys.length > 0) {
    const bookingIds = Array.from(new Set(cleaningKeys.map(k => k.booking_id)));
    const cleanerIds = Array.from(new Set(cleaningKeys.map(k => k.cleaner_id)));
    const { data: cleanings } = await supabase
      .from('booking_cleanings')
      .select('booking_id, cleaner_id, done_date')
      .in('booking_id', bookingIds)
      .in('cleaner_id', cleanerIds);
    for (const c of (cleanings ?? []) as Array<{ booking_id: string; cleaner_id: string; done_date: string | null }>) {
      if (c.done_date) doneDateMap.set(`${c.booking_id}__${c.cleaner_id}`, c.done_date);
    }
  }

  const rows: OrphanExpense[] = rawRows.map(r => {
    const propertyRel = r.property;
    const propertyName = Array.isArray(propertyRel) ? propertyRel[0]?.name ?? null : propertyRel?.name ?? null;
    const bookingRel = r.booking;
    const booking = Array.isArray(bookingRel) ? bookingRel[0] ?? null : bookingRel ?? null;
    const bId = (r.booking_id as string | null) ?? null;
    const vId = (r.vendor_id as string | null) ?? null;
    const cleaningDone = (bId && vId) ? (doneDateMap.get(`${bId}__${vId}`) ?? null) : null;
    return {
      id: r.id as string,
      date: r.date as string,
      amount: Number(r.amount),
      category: r.category as string,
      subcategory: (r.subcategory as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      vendor: (r.vendor as string | null) ?? null,
      booking_id: bId,
      expense_group_id: (r.expense_group_id as string | null) ?? null,
      property_name: propertyName,
      confirmation_code: booking?.confirmation_code ?? null,
      booking_end_date: booking?.end_date ?? null,
      cleaning_done_date: cleaningDone,
    };
  });
  return { data: rows, error: null };
};

export const assignBankAccountToExpenses = async (
  expenseIds: string[],
  bankAccountId: string,
): Promise<ServiceResult<number>> => {
  if (demoBlockWrite('asignar cuenta a gastos')) return demoWriteBlockedResult<number>();
  if (expenseIds.length === 0) return { data: 0, error: null };
  if (!bankAccountId) return { data: null, error: 'Debes seleccionar una cuenta.' };
  const { error, count } = await supabase
    .from('expenses')
    .update({ bank_account_id: bankAccountId }, { count: 'exact' })
    .in('id', expenseIds);
  if (error) return { data: null, error: error.message };
  return { data: count ?? expenseIds.length, error: null };
};

export interface OrphanCleaning {
  id: string;
  booking_id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  fee: number;
  supplies_amount: number;
  reimburse_to_cleaner: boolean;
  paid_date: string | null;
  done_date: string | null;
  confirmation_code: string | null;
  property_name: string | null;
  booking_end_date: string | null;
}

/**
 * Aseos en status='paid' sin expense respaldatorio.
 * Se separan en dos grupos: con/sin paid_date.
 */
export const listOrphanPaidCleanings = async (): Promise<ServiceResult<{
  withPaidDate: OrphanCleaning[];
  withoutPaidDate: OrphanCleaning[];
}>> => {
  if (isDemoMode()) return { data: { withPaidDate: [], withoutPaidDate: [] }, error: null };
  const { data, error } = await supabase
    .from('booking_cleanings')
    .select(`
      id, booking_id, cleaner_id, fee, supplies_amount, reimburse_to_cleaner, paid_date, done_date,
      cleaner:vendors ( name ),
      booking:bookings (
        confirmation_code,
        end_date,
        listing:listings ( property:properties ( name ) )
      )
    `)
    .eq('status', 'paid');
  if (error) return { data: null, error: error.message };

  type Row = BookingCleaningRow & {
    cleaner: { name: string | null } | { name: string | null }[] | null;
    booking: {
      confirmation_code: string | null;
      end_date: string | null;
      listing: { property: { name: string | null } | { name: string | null }[] | null } | { property: unknown }[] | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  // Cargar expenses 'Aseo' relevantes para descartar los que sí tienen respaldo.
  const bookingIds = Array.from(new Set(rows.map(r => r.booking_id)));
  const cleanerIds = Array.from(new Set(rows.map(r => r.cleaner_id).filter(Boolean) as string[]));
  let backedKeys = new Set<string>();
  if (bookingIds.length > 0 && cleanerIds.length > 0) {
    const { data: expRows, error: eErr } = await supabase
      .from('expenses')
      .select('booking_id, vendor_id')
      .eq('category', 'Aseo')
      .in('booking_id', bookingIds)
      .in('vendor_id', cleanerIds);
    if (eErr) return { data: null, error: eErr.message };
    backedKeys = new Set((expRows ?? []).map(e => `${e.booking_id}__${e.vendor_id}`));
  }

  const orphans = rows.filter(r => !backedKeys.has(`${r.booking_id}__${r.cleaner_id}`));

  const mapRow = (r: Row): OrphanCleaning => {
    const cleanerRel = r.cleaner;
    const cleanerName = Array.isArray(cleanerRel) ? cleanerRel[0]?.name ?? null : cleanerRel?.name ?? null;
    const bookingRel = r.booking;
    let propertyName: string | null = null;
    if (bookingRel) {
      const listing = Array.isArray(bookingRel.listing) ? bookingRel.listing[0] : bookingRel.listing;
      const prop = (listing as { property?: { name?: string } | { name?: string }[] } | null | undefined)?.property;
      propertyName = Array.isArray(prop) ? prop[0]?.name ?? null : prop?.name ?? null;
    }
    return {
      id: r.id,
      booking_id: r.booking_id,
      cleaner_id: r.cleaner_id,
      cleaner_name: cleanerName,
      fee: Number(r.fee),
      supplies_amount: Number(r.supplies_amount ?? 0),
      reimburse_to_cleaner: !!r.reimburse_to_cleaner,
      paid_date: r.paid_date,
      done_date: r.done_date,
      confirmation_code: bookingRel?.confirmation_code ?? null,
      property_name: propertyName,
      booking_end_date: bookingRel?.end_date ?? null,
    };
  };

  return {
    data: {
      withPaidDate: orphans.filter(r => !!r.paid_date).map(mapRow),
      withoutPaidDate: orphans.filter(r => !r.paid_date).map(mapRow),
    },
    error: null,
  };
};

export const repairOrphanCleaningWithExpense = async (
  cleaningId: string,
  bankAccountId: string,
): Promise<ServiceResult<string[]>> => {
  if (demoBlockWrite('reparar aseo huérfano')) return demoWriteBlockedResult<string[]>();
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: { expense_ids: string[] }[] | { expense_ids: string[] } | null; error: { message: string } | null }>)(
    'rpc_repair_orphan_cleaning_with_expense',
    { p_cleaning_id: cleaningId, p_bank_account_id: bankAccountId },
  );
  if (error) return { data: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row?.expense_ids ?? [], error: null };
};

export const revertCleaningToPending = async (cleaningId: string): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('revertir aseo')) return demoWriteBlockedResult<true>();
  const { error } = await supabase
    .from('booking_cleanings')
    .update({ status: 'pending', paid_date: null })
    .eq('id', cleaningId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

export type { BankAccountRow };

// ════════════════════════════════════════════════════════════════════════════
// Detectores nuevos (v2)
// ════════════════════════════════════════════════════════════════════════════

// ─── Helpers ────────────────────────────────────────────────────────────────

interface BookingLiteRow {
  id: string;
  confirmation_code: string | null;
  guest_name: string | null;
  start_date: string;
  end_date: string;
  num_nights: number | null;
  status: string | null;
  channel: string | null;
  net_payout: number | null;
  payout_date: string | null;
  payout_bank_account_id: string | null;
  listing_id: string | null;
  property_name: string | null;
}

const buildIgnoreKeyForOverlap = (idA: string, idB: string): string => {
  return [idA, idB].sort().join('_');
};

// ─── A) Reservas solapadas ──────────────────────────────────────────────────

export interface OverlapPair {
  ignore_key: string;
  property_name: string | null;
  listing_id: string | null;
  a: BookingLiteRow;
  b: BookingLiteRow;
}

interface BookingForOverlap {
  id: string;
  confirmation_code: string | null;
  guest_name: string | null;
  start_date: string;
  end_date: string;
  num_nights: number | null;
  status: string | null;
  channel: string | null;
  net_payout: number | null;
  payout_date: string | null;
  payout_bank_account_id: string | null;
  listing_id: string;
  listing: {
    external_name: string | null;
    property: { id: string | null; name: string | null } | { id: string | null; name: string | null }[] | null;
  } | { external_name: string | null; property: unknown }[] | null;
}

const propertyRowFromListing = (
  rel: BookingForOverlap['listing'],
): { id: string | null; name: string | null; external_name: string | null } => {
  if (!rel) return { id: null, name: null, external_name: null };
  const listing = Array.isArray(rel) ? rel[0] : rel;
  if (!listing) return { id: null, name: null, external_name: null };
  const prop = (listing as { property?: { id: string | null; name: string | null } | { id: string | null; name: string | null }[] | null }).property;
  const propRow = Array.isArray(prop) ? prop[0] : prop;
  return {
    id: propRow?.id ?? null,
    name: propRow?.name ?? null,
    external_name: listing.external_name ?? null,
  };
};

const propertyNameFromListing = (rel: BookingForOverlap['listing']): string | null => {
  const { name, external_name } = propertyRowFromListing(rel);
  return name ?? external_name ?? null;
};

const toBookingLite = (row: BookingForOverlap): BookingLiteRow => ({
  id: row.id,
  confirmation_code: row.confirmation_code,
  guest_name: row.guest_name,
  start_date: row.start_date,
  end_date: row.end_date,
  num_nights: row.num_nights,
  status: row.status,
  channel: row.channel,
  net_payout: row.net_payout != null ? Number(row.net_payout) : null,
  payout_date: row.payout_date,
  payout_bank_account_id: row.payout_bank_account_id,
  listing_id: row.listing_id,
  property_name: propertyNameFromListing(row.listing),
});

/**
 * Detecta pares de bookings en el mismo listing cuyos rangos [start, end) se cruzan
 * y ninguno está cancelado. Excluye pares con ignore persistente.
 *
 * Implementación: trae todos los bookings no cancelados ordenados por
 * (listing_id, start_date) y resuelve los overlaps en el cliente. El volumen
 * típico de reservas activas en este negocio es bajo (<5k), así que no
 * justificamos un VIEW dedicado.
 */
export const listOverlappingBookings = async (): Promise<ServiceResult<OverlapPair[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const [bookingsRes, ignoresRes] = await Promise.all([
    supabase
      .from('bookings')
      .select(`
        id, confirmation_code, guest_name, start_date, end_date, num_nights,
        status, channel, net_payout, payout_date, payout_bank_account_id, listing_id,
        listing:listings ( external_name, property:properties ( id, name ) )
      `)
      .not('listing_id', 'is', null)
      .order('start_date', { ascending: true }),
    (supabase
      .from('data_issue_ignores' as never)
      .select('key')
      .eq('kind', 'overlap_booking') as unknown as Promise<{ data: { key: string }[] | null; error: { message: string } | null }>),
  ]);

  if (bookingsRes.error) return { data: null, error: bookingsRes.error.message };
  if (ignoresRes.error) return { data: null, error: ignoresRes.error.message };

  const ignored = new Set((ignoresRes.data ?? []).map(r => (r as { key: string }).key));

  const rows = (bookingsRes.data ?? []).filter(b => {
    const s = (b.status ?? '').toLowerCase();
    return !s.includes('cancel');
  }) as unknown as BookingForOverlap[];

  // Agrupar por property_id (no por listing_id): una propiedad no puede tener
  // dos reservas simultáneas aunque vengan de listings/canales distintos
  // (p.ej. Airbnb + Directo apuntando a la misma propiedad).
  const byProperty = new Map<string, BookingForOverlap[]>();
  for (const row of rows) {
    const propId = propertyRowFromListing(row.listing).id ?? `listing:${row.listing_id}`;
    const arr = byProperty.get(propId) ?? [];
    arr.push(row);
    byProperty.set(propId, arr);
  }

  const pairs: OverlapPair[] = [];
  for (const [, group] of byProperty) {
    group.sort((x, y) => x.start_date.localeCompare(y.start_date));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        // Si b.start_date >= a.end_date, no overlap (y como está ordenado, los
        // siguientes tampoco overlapean con a → break).
        if (b.start_date >= a.end_date) break;
        if (a.start_date < b.end_date && b.start_date < a.end_date) {
          const key = buildIgnoreKeyForOverlap(a.id, b.id);
          if (ignored.has(key)) continue;
          const aLite = toBookingLite(a);
          const bLite = toBookingLite(b);
          pairs.push({
            ignore_key: key,
            listing_id: a.listing_id,
            property_name: aLite.property_name,
            a: aLite,
            b: bLite,
          });
        }
      }
    }
  }

  pairs.sort((x, y) => y.a.start_date.localeCompare(x.a.start_date));
  return { data: pairs, error: null };
};

// ─── B) Ingresos huérfanos (booking sin cuenta de payout) ───────────────────

export interface BookingOrphanIncome extends BookingLiteRow {
  // mismo shape; alias semántico
}

export const listBookingsWithoutPayoutAccount = async (): Promise<ServiceResult<BookingOrphanIncome[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, confirmation_code, guest_name, start_date, end_date, num_nights,
      status, channel, net_payout, payout_date, payout_bank_account_id, listing_id,
      listing:listings ( external_name, property:properties ( name ) )
    `)
    .is('payout_bank_account_id', null)
    .gt('net_payout', 0)
    .order('start_date', { ascending: false });

  if (error) return { data: null, error: error.message };

  const rows = ((data ?? []) as unknown as BookingForOverlap[])
    .filter(b => !(b.status ?? '').toLowerCase().includes('cancel'))
    .map(toBookingLite);
  return { data: rows, error: null };
};

// ─── C) Pagos parciales (solo fecha o solo cuenta) ──────────────────────────

export interface InconsistentPayout extends BookingLiteRow {
  missing: 'date' | 'account';
}

export const listInconsistentPayouts = async (): Promise<ServiceResult<InconsistentPayout[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  // Trae todos los bookings con net_payout>0 no cancelados; filtra en cliente
  // porque PostgREST no soporta XOR fácilmente.
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, confirmation_code, guest_name, start_date, end_date, num_nights,
      status, channel, net_payout, payout_date, payout_bank_account_id, listing_id,
      listing:listings ( external_name, property:properties ( name ) )
    `)
    .gt('net_payout', 0)
    .order('start_date', { ascending: false });
  if (error) return { data: null, error: error.message };

  const rows = ((data ?? []) as unknown as BookingForOverlap[])
    .filter(b => !(b.status ?? '').toLowerCase().includes('cancel'))
    .filter(b => (b.payout_date == null) !== (b.payout_bank_account_id == null))
    .map(b => {
      const lite = toBookingLite(b);
      return { ...lite, missing: (b.payout_date == null ? 'date' : 'account') as 'date' | 'account' };
    });
  return { data: rows, error: null };
};

// ─── D) Gastos con monto inválido ───────────────────────────────────────────

export interface InvalidExpense {
  id: string;
  date: string;
  amount: number;
  category: string;
  subcategory: string | null;
  description: string | null;
  status: string;
}

export const listInvalidExpenses = async (): Promise<ServiceResult<InvalidExpense[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('expenses')
    .select('id, date, amount, category, subcategory, description, status')
    .lte('amount', 0)
    .order('date', { ascending: false });
  if (error) return { data: null, error: error.message };
  return {
    data: (data ?? []).map(r => ({
      id: r.id as string,
      date: r.date as string,
      amount: Number(r.amount),
      category: r.category as string,
      subcategory: (r.subcategory as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      status: r.status as string,
    })),
    error: null,
  };
};

// ─── E) Aseos paid sin cleaner ──────────────────────────────────────────────

export interface CleaningWithoutCleaner {
  id: string;
  booking_id: string;
  fee: number;
  paid_date: string | null;
  done_date: string | null;
  confirmation_code: string | null;
  property_name: string | null;
}

export const listPaidCleaningsWithoutCleaner = async (): Promise<ServiceResult<CleaningWithoutCleaner[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('booking_cleanings')
    .select(`
      id, booking_id, fee, paid_date, done_date,
      booking:bookings ( confirmation_code, listing:listings ( property:properties ( name ) ) )
    `)
    .eq('status', 'paid')
    .is('cleaner_id', null);
  if (error) return { data: null, error: error.message };

  type Raw = {
    id: string; booking_id: string; fee: number; paid_date: string | null; done_date: string | null;
    booking: {
      confirmation_code: string | null;
      listing: { property: { name: string | null } | { name: string | null }[] | null } | unknown[] | null;
    } | null;
  };

  return {
    data: ((data ?? []) as unknown as Raw[]).map(r => {
      let propertyName: string | null = null;
      if (r.booking) {
        const listing = Array.isArray(r.booking.listing) ? r.booking.listing[0] : r.booking.listing;
        const prop = (listing as { property?: { name: string | null } | { name: string | null }[] | null } | null)?.property;
        const propRow = Array.isArray(prop) ? prop[0] : prop;
        propertyName = propRow?.name ?? null;
      }
      return {
        id: r.id,
        booking_id: r.booking_id,
        fee: Number(r.fee),
        paid_date: r.paid_date,
        done_date: r.done_date,
        confirmation_code: r.booking?.confirmation_code ?? null,
        property_name: propertyName,
      };
    }),
    error: null,
  };
};

// ─── F) Aseos done sin done_date ────────────────────────────────────────────

export interface CleaningDoneWithoutDate {
  id: string;
  booking_id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  fee: number;
  booking_end_date: string | null;
  confirmation_code: string | null;
  property_name: string | null;
}

export const listDoneCleaningsWithoutDate = async (): Promise<ServiceResult<CleaningDoneWithoutDate[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('booking_cleanings')
    .select(`
      id, booking_id, cleaner_id, fee,
      cleaner:vendors ( name ),
      booking:bookings ( confirmation_code, end_date, listing:listings ( property:properties ( name ) ) )
    `)
    .eq('status', 'done')
    .is('done_date', null);
  if (error) return { data: null, error: error.message };

  type Raw = {
    id: string; booking_id: string; cleaner_id: string | null; fee: number;
    cleaner: { name: string | null } | { name: string | null }[] | null;
    booking: {
      confirmation_code: string | null;
      end_date: string | null;
      listing: { property: { name: string | null } | { name: string | null }[] | null } | unknown[] | null;
    } | null;
  };

  return {
    data: ((data ?? []) as unknown as Raw[]).map(r => {
      const cleaner = Array.isArray(r.cleaner) ? r.cleaner[0] : r.cleaner;
      let propertyName: string | null = null;
      if (r.booking) {
        const listing = Array.isArray(r.booking.listing) ? r.booking.listing[0] : r.booking.listing;
        const prop = (listing as { property?: { name: string | null } | { name: string | null }[] | null } | null)?.property;
        const propRow = Array.isArray(prop) ? prop[0] : prop;
        propertyName = propRow?.name ?? null;
      }
      return {
        id: r.id,
        booking_id: r.booking_id,
        cleaner_id: r.cleaner_id,
        cleaner_name: cleaner?.name ?? null,
        fee: Number(r.fee),
        booking_end_date: r.booking?.end_date ?? null,
        confirmation_code: r.booking?.confirmation_code ?? null,
        property_name: propertyName,
      };
    }),
    error: null,
  };
};

// ─── G) Bookings con fechas inválidas ───────────────────────────────────────

export interface InvalidBookingDates extends BookingLiteRow {
  reason: 'end_le_start' | 'nights_invalid';
}

export const listInvalidBookingDates = async (): Promise<ServiceResult<InvalidBookingDates[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, confirmation_code, guest_name, start_date, end_date, num_nights,
      status, channel, net_payout, payout_date, payout_bank_account_id, listing_id,
      listing:listings ( external_name, property:properties ( name ) )
    `)
    .order('start_date', { ascending: false });
  if (error) return { data: null, error: error.message };

  const rows = ((data ?? []) as unknown as BookingForOverlap[])
    .filter(b => b.end_date <= b.start_date || (b.num_nights ?? 0) <= 0)
    .map(b => {
      const lite = toBookingLite(b);
      const reason: InvalidBookingDates['reason'] = b.end_date <= b.start_date ? 'end_le_start' : 'nights_invalid';
      return { ...lite, reason };
    });
  return { data: rows, error: null };
};

// ─── H) Duplicados de confirmation_code ─────────────────────────────────────

export interface DuplicateCodeGroup {
  confirmation_code: string;
  channel: string | null;
  bookings: BookingLiteRow[];
}

export const listDuplicateConfirmationCodes = async (): Promise<ServiceResult<DuplicateCodeGroup[]>> => {
  if (isDemoMode()) return { data: [], error: null };
  // Trae todos los bookings con código no nulo, agrupa en cliente.
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, confirmation_code, guest_name, start_date, end_date, num_nights,
      status, channel, net_payout, payout_date, payout_bank_account_id, listing_id,
      listing:listings ( external_name, property:properties ( name ) )
    `)
    .not('confirmation_code', 'is', null);
  if (error) return { data: null, error: error.message };

  const all = (data ?? []) as unknown as BookingForOverlap[];
  const groups = new Map<string, BookingForOverlap[]>();
  for (const row of all) {
    const code = (row.confirmation_code ?? '').trim();
    if (!code) continue;
    const key = `${code}__${row.channel ?? ''}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const out: DuplicateCodeGroup[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    out.push({
      confirmation_code: arr[0].confirmation_code ?? '',
      channel: arr[0].channel ?? null,
      bookings: arr.map(toBookingLite),
    });
  }
  out.sort((a, b) => b.bookings.length - a.bookings.length);
  return { data: out, error: null };
};

// ════════════════════════════════════════════════════════════════════════════
// Acciones de resolución
// ════════════════════════════════════════════════════════════════════════════

/** Marca un booking como cancelado. */
export const cancelBooking = async (bookingId: string): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('cancelar reserva')) return demoWriteBlockedResult<true>();
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelada' })
    .eq('id', bookingId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Borra un booking y todas sus dependencias en una sola transacción. */
export const deleteBookingCascade = async (bookingId: string): Promise<ServiceResult<{
  cleanings_deleted: number;
  expenses_deleted: number;
  adjustments_deleted: number;
  payments_deleted: number;
  deposits_deleted: number;
}>> => {
  if (demoBlockWrite('eliminar reserva en cascada')) {
    return demoWriteBlockedResult<{
      cleanings_deleted: number;
      expenses_deleted: number;
      adjustments_deleted: number;
      payments_deleted: number;
      deposits_deleted: number;
    }>();
  }
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: Array<Record<string, number>> | null; error: { message: string } | null }>)(
    'rpc_delete_booking_cascade',
    { p_booking_id: bookingId },
  );
  if (error) return { data: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    data: {
      cleanings_deleted: Number(row?.cleanings_deleted ?? 0),
      expenses_deleted: Number(row?.expenses_deleted ?? 0),
      adjustments_deleted: Number(row?.adjustments_deleted ?? 0),
      payments_deleted: Number(row?.payments_deleted ?? 0),
      deposits_deleted: Number(row?.deposits_deleted ?? 0),
    },
    error: null,
  };
};

/** Asigna una cuenta de payout a un booking. Si no había payout_date, queda igual sin fecha (eso queda como issue C). */
export const assignBookingPayoutAccount = async (
  bookingId: string,
  bankAccountId: string,
): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('asignar cuenta de payout')) return demoWriteBlockedResult<true>();
  if (!bankAccountId) return { data: null, error: 'Selecciona la cuenta.' };
  const { error } = await supabase
    .from('bookings')
    .update({ payout_bank_account_id: bankAccountId })
    .eq('id', bookingId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Limpia el payout de un booking (vuelve a no pagado). */
export const clearBookingPayout = async (bookingId: string): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('limpiar payout')) return demoWriteBlockedResult<true>();
  const { error } = await supabase
    .from('bookings')
    .update({ payout_bank_account_id: null, payout_date: null })
    .eq('id', bookingId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Setea solo la fecha de payout. */
export const setBookingPayoutDate = async (
  bookingId: string,
  payoutDate: string,
): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('asignar fecha de payout')) return demoWriteBlockedResult<true>();
  const { error } = await supabase
    .from('bookings')
    .update({ payout_date: payoutDate })
    .eq('id', bookingId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Asigna la fecha en que se hizo un aseo (done_date). */
export const setCleaningDoneDate = async (
  cleaningId: string,
  doneDate: string,
): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('asignar fecha de aseo')) return demoWriteBlockedResult<true>();
  const { error } = await supabase
    .from('booking_cleanings')
    .update({ done_date: doneDate })
    .eq('id', cleaningId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

// ════════════════════════════════════════════════════════════════════════════
// G) Aseos duplicados — misma reserva con 2+ booking_cleanings
// ════════════════════════════════════════════════════════════════════════════

export interface DuplicateCleaningRow {
  id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  fee: number;
  status: string;
  done_date: string | null;
  paid_date: string | null;
  supplies_amount: number;
}

export interface DuplicateCleaning {
  booking_id: string;
  booking_code: string | null;
  property_name: string | null;
  guest_name: string | null;
  cleanings: DuplicateCleaningRow[];
}

export const listDuplicateCleanings = async (): Promise<ServiceResult<DuplicateCleaning[]>> => {
  if (isDemoMode()) return { data: [], error: null };

  const { data: cRows, error: cErr } = await supabase
    .from('booking_cleanings')
    .select('id, booking_id, cleaner_id, fee, status, done_date, paid_date, supplies_amount');
  if (cErr) return { data: null, error: cErr.message };

  const grouped = new Map<string, typeof cRows>();
  for (const c of cRows ?? []) {
    const arr = grouped.get(c.booking_id) ?? [];
    arr.push(c);
    grouped.set(c.booking_id, arr);
  }
  const dupBookingIds = Array.from(grouped.entries())
    .filter(([, cs]) => cs.length > 1)
    .map(([id]) => id);

  if (dupBookingIds.length === 0) return { data: [], error: null };

  type BkMini = { id: string; confirmation_code: string | null; guest_name: string | null; listing_id: string };
  const { data: bookingRows, error: bErr } = await supabase
    .from('bookings')
    .select('id, confirmation_code, guest_name, listing_id')
    .in('id', dupBookingIds);
  if (bErr) return { data: null, error: bErr.message };
  const bookingMap = new Map((bookingRows ?? [] as BkMini[]).map((b: BkMini) => [b.id, b]));

  const listingIds = Array.from(new Set((bookingRows ?? [] as BkMini[]).map((b: BkMini) => b.listing_id).filter(Boolean)));
  type ListingMini = { id: string; property_id: string };
  let listings: ListingMini[] = [];
  if (listingIds.length > 0) {
    const { data: lRows } = await supabase.from('listings').select('id, property_id').in('id', listingIds);
    listings = (lRows ?? []) as ListingMini[];
  }
  const listingMap = new Map(listings.map(l => [l.id, l]));

  const propertyIds = Array.from(new Set(listings.map(l => l.property_id).filter(Boolean)));
  type PropMini = { id: string; name: string };
  let properties: PropMini[] = [];
  if (propertyIds.length > 0) {
    const { data: pRows } = await supabase.from('properties').select('id, name').in('id', propertyIds);
    properties = (pRows ?? []) as PropMini[];
  }
  const propertyMap = new Map(properties.map(p => [p.id, p]));

  const cleanerIds = Array.from(new Set(
    (cRows ?? []).filter(c => dupBookingIds.includes(c.booking_id) && c.cleaner_id).map(c => c.cleaner_id as string),
  ));
  type VendorMini = { id: string; name: string };
  let vendors: VendorMini[] = [];
  if (cleanerIds.length > 0) {
    const { data: vRows } = await supabase.from('vendors').select('id, name').in('id', cleanerIds);
    vendors = (vRows ?? []) as VendorMini[];
  }
  const vendorMap = new Map(vendors.map(v => [v.id, v]));

  const result: DuplicateCleaning[] = dupBookingIds.map(bookingId => {
    const booking = bookingMap.get(bookingId);
    const listing = booking ? listingMap.get(booking.listing_id) : undefined;
    const property = listing ? propertyMap.get(listing.property_id) : undefined;
    const cleanings = (grouped.get(bookingId) ?? []).map(c => ({
      id: c.id,
      cleaner_id: c.cleaner_id,
      cleaner_name: c.cleaner_id ? (vendorMap.get(c.cleaner_id)?.name ?? null) : null,
      fee: Number(c.fee),
      status: c.status as string,
      done_date: c.done_date,
      paid_date: c.paid_date,
      supplies_amount: Number(c.supplies_amount),
    }));
    return {
      booking_id: bookingId,
      booking_code: booking?.confirmation_code ?? null,
      property_name: property?.name ?? null,
      guest_name: booking?.guest_name ?? null,
      cleanings,
    };
  });

  return { data: result, error: null };
};

export const keepCleaningDeleteOthers = async (
  keepId: string,
  deleteIds: string[],
): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('eliminar aseos duplicados')) return demoWriteBlockedResult<true>();
  for (const id of deleteIds) {
    const res = await deleteCleaning(id);
    if (res.error) return { data: null, error: res.error };
  }
  return { data: true, error: null };
};

/** Borra un gasto. */
export const deleteExpenseById = async (expenseId: string): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('eliminar gasto')) return demoWriteBlockedResult<true>();
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Persiste un ignore (ej. overlap "no es duplicado"). */
export const ignoreDataIssue = async (
  kind: string,
  key: string,
  note?: string,
): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('ignorar incidencia')) return demoWriteBlockedResult<true>();
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'rpc_ignore_data_issue',
    { p_kind: kind, p_key: key, p_note: note ?? null },
  );
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Revierte un ignore previo. */
export const unignoreDataIssue = async (
  kind: string,
  key: string,
): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('revertir ignorado')) return demoWriteBlockedResult<true>();
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'rpc_unignore_data_issue',
    { p_kind: kind, p_key: key },
  );
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};
