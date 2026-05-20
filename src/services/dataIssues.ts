/**
 * Servicio para la página /data-issues — detecta y repara inconsistencias
 * heredadas que no pueden prevenirse del lado del cliente.
 */
import { supabase } from '@/lib/supabase/client';
import type { BankAccountRow, BookingCleaningRow } from '@/types/database';
import type { ServiceResult } from './expenses';

export interface DataIssuesSummary {
  expenses_paid_without_account_count: number;
  expenses_paid_without_account_amount: number;
  cleanings_paid_without_expense_count: number;
  cleanings_paid_without_date_count: number;
  bookings_paid_without_account_count: number;
}

export const fetchDataIssuesSummary = async (): Promise<ServiceResult<DataIssuesSummary>> => {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
  ) => Promise<{ data: DataIssuesSummary[] | null; error: { message: string } | null }>)(
    'rpc_data_issues_summary',
  );
  if (error) return { data: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      data: {
        expenses_paid_without_account_count: 0,
        expenses_paid_without_account_amount: 0,
        cleanings_paid_without_expense_count: 0,
        cleanings_paid_without_date_count: 0,
        bookings_paid_without_account_count: 0,
      },
      error: null,
    };
  }
  return { data: row as DataIssuesSummary, error: null };
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
}

export const listExpensesPaidWithoutAccount = async (): Promise<ServiceResult<OrphanExpense[]>> => {
  const { data, error } = await supabase
    .from('expenses')
    .select(`
      id, date, amount, category, subcategory, description, vendor,
      booking_id, expense_group_id,
      property:properties ( name )
    `)
    .eq('status', 'paid')
    .is('bank_account_id', null)
    .order('date', { ascending: false });
  if (error) return { data: null, error: error.message };
  const rows: OrphanExpense[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(r => {
    const propertyRel = r.property as { name: string | null } | { name: string | null }[] | null | undefined;
    const propertyName = Array.isArray(propertyRel) ? propertyRel[0]?.name ?? null : propertyRel?.name ?? null;
    return {
      id: r.id as string,
      date: r.date as string,
      amount: Number(r.amount),
      category: r.category as string,
      subcategory: (r.subcategory as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      vendor: (r.vendor as string | null) ?? null,
      booking_id: (r.booking_id as string | null) ?? null,
      expense_group_id: (r.expense_group_id as string | null) ?? null,
      property_name: propertyName,
    };
  });
  return { data: rows, error: null };
};

export const assignBankAccountToExpenses = async (
  expenseIds: string[],
  bankAccountId: string,
): Promise<ServiceResult<number>> => {
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
  confirmation_code: string | null;
  property_name: string | null;
}

/**
 * Aseos en status='paid' sin expense respaldatorio.
 * Se separan en dos grupos: con/sin paid_date.
 */
export const listOrphanPaidCleanings = async (): Promise<ServiceResult<{
  withPaidDate: OrphanCleaning[];
  withoutPaidDate: OrphanCleaning[];
}>> => {
  const { data, error } = await supabase
    .from('booking_cleanings')
    .select(`
      id, booking_id, cleaner_id, fee, supplies_amount, reimburse_to_cleaner, paid_date,
      cleaner:vendors ( name ),
      booking:bookings (
        confirmation_code,
        listing:listings ( property:properties ( name ) )
      )
    `)
    .eq('status', 'paid');
  if (error) return { data: null, error: error.message };

  type Row = BookingCleaningRow & {
    cleaner: { name: string | null } | { name: string | null }[] | null;
    booking: {
      confirmation_code: string | null;
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
      confirmation_code: bookingRel?.confirmation_code ?? null,
      property_name: propertyName,
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
  const { error } = await supabase
    .from('booking_cleanings')
    .update({ status: 'pending', paid_date: null })
    .eq('id', cleaningId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

export type { BankAccountRow };
