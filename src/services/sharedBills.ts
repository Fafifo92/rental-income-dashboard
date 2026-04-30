import { supabase } from '@/lib/supabase/client';
import type { SharedBillRow, VendorPropertyRow, VendorRow, ExpenseRow } from '@/types/database';
import type { ServiceResult } from './vendors';
import { listVendorProperties, computeShares } from './vendorProperties';
import { currentYearMonth, yearMonthRange } from './recurringPeriods';

/**
 * Crea una factura compartida + N expenses (uno por propiedad cubierta),
 * divididos según share_percent. Todo en una sola transacción "manual":
 * si falla la creación de algún expense, se hace rollback borrando lo creado.
 */
export const createSharedBill = async (args: {
  vendorId: string;
  yearMonth: string;
  totalAmount: number;
  paidDate: string;
  bankAccountId: string | null;
  category: string;
  notes: string | null;
  /** Si se provee, fuerza estos montos por propiedad (ignora computeShares).
   *  Útil para vendors con monto variable (luz, gas) donde el usuario
   *  ingresa exactamente cuánto le tocó a cada apto. La suma debe
   *  coincidir con totalAmount (validado en cliente). */
  perPropertyAmounts?: Map<string, number> | null;
}): Promise<ServiceResult<SharedBillRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const vpRes = await listVendorProperties(args.vendorId);
  if (!vpRes.data) return { data: null, error: vpRes.error };
  const vps = vpRes.data;
  if (vps.length === 0) {
    return { data: null, error: 'Este proveedor no tiene propiedades asignadas. Configúralo en /vendors.' };
  }

  const { data: bill, error: billErr } = await supabase
    .from('shared_bills')
    .insert({
      vendor_id: args.vendorId,
      year_month: args.yearMonth,
      total_amount: args.totalAmount,
      paid_date: args.paidDate,
      bank_account_id: args.bankAccountId,
      category: args.category,
      notes: args.notes,
    })
    .select()
    .single();
  if (billErr || !bill) return { data: null, error: billErr?.message ?? 'No se pudo crear la factura' };

  // Carga el vendor para inferir la subcategory canónica del expense
  // generado. Sin esto los gastos quedan "huérfanos" en la taxonomía 4+3.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('kind')
    .eq('id', args.vendorId)
    .single();
  const kindToSub: Record<string, string | null> = {
    utility:     'utilities',
    admin:       'administration',
    insurance:   'administration',
    maintenance: 'maintenance',
    other:       null,
    cleaner:     'cleaning',
  };
  const subcategoryFromVendor = vendor?.kind ? (kindToSub[vendor.kind] ?? null) : null;

  const shares = args.perPropertyAmounts && args.perPropertyAmounts.size > 0
    ? args.perPropertyAmounts
    : computeShares(args.totalAmount, vps);
  const expensesPayload = [...shares.entries()].map(([propertyId, amount]) => ({
    owner_id:         user.id,
    property_id:      propertyId,
    category:         args.category,
    type:             'fixed' as const,
    amount,
    currency:         'COP',
    date:             args.paidDate,
    description:      args.notes,
    status:           'paid' as const,
    bank_account_id:  args.bankAccountId,
    vendor:           null,
    person_in_charge: null,
    booking_id:       null,
    adjustment_id:    null,
    vendor_id:        args.vendorId,
    shared_bill_id:   (bill as SharedBillRow).id,
    subcategory:      subcategoryFromVendor,
    expense_group_id: null,
  }));

  const { error: expErr } = await supabase.from('expenses').insert(expensesPayload);
  if (expErr) {
    await supabase.from('shared_bills').delete().eq('id', (bill as SharedBillRow).id);
    return { data: null, error: `Factura creada pero fallaron los gastos: ${expErr.message}` };
  }

  return { data: bill as SharedBillRow, error: null };
};

export const listSharedBills = async (
  vendorId?: string,
): Promise<ServiceResult<SharedBillRow[]>> => {
  let q = supabase.from('shared_bills').select('*').order('year_month', { ascending: false });
  if (vendorId) q = q.eq('vendor_id', vendorId);
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as SharedBillRow[], error: null };
};

export const deleteSharedBill = async (id: string): Promise<ServiceResult<true>> => {
  // Los expenses vinculados quedan con shared_bill_id=NULL por ON DELETE SET NULL.
  // Decisión: borrar la factura compartida borra también los expenses asociados,
  // porque son derivados (no tenían vida propia).
  const { error: delExp } = await supabase.from('expenses').delete().eq('shared_bill_id', id);
  if (delExp) return { data: null, error: delExp.message };
  const { error } = await supabase.from('shared_bills').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Expenses derivados de una factura compartida (uno por propiedad). */
export const listSharedBillExpenses = async (
  billId: string,
): Promise<ServiceResult<ExpenseRow[]>> => {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('shared_bill_id', billId);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as ExpenseRow[], error: null };
};

/**
 * Facturas compartidas pendientes:
 * Para cada vendor activo (no cleaner) con propiedades asignadas y default_amount > 0,
 * por cada mes en [now-monthsBack, now] donde NO exista shared_bill,
 * generamos un PendingSharedBill con estimatedAmount = default_amount.
 * Solo se considera "pendiente" desde el mes en que el vendor adquirió propiedades
 * (o desde la fecha más antigua si no hay rastro: empezamos desde monthsBack).
 */
export type PendingSharedBill = {
  vendor: VendorRow;
  yearMonth: string;
  propertiesCount: number;
  estimatedAmount: number;
  isCurrentMonth: boolean;
};

export const listPendingSharedBills = async (
  monthsBack = 6,
): Promise<ServiceResult<PendingSharedBill[]>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const [vRes, vpRes, billsRes] = await Promise.all([
    supabase.from('vendors').select('*').eq('owner_id', user.id).eq('active', true),
    supabase.from('vendor_properties').select('*'),
    supabase.from('shared_bills').select('vendor_id, year_month'),
  ]);
  if (vRes.error)     return { data: null, error: vRes.error.message };
  if (vpRes.error)    return { data: null, error: vpRes.error.message };
  if (billsRes.error) return { data: null, error: billsRes.error.message };

  const vendors = (vRes.data  ?? []) as VendorRow[];
  const vps     = (vpRes.data ?? []) as VendorPropertyRow[];
  const paidSet = new Set<string>(
    (billsRes.data ?? []).map((b: { vendor_id: string; year_month: string }) => `${b.vendor_id}::${b.year_month}`),
  );

  const vpsByVendor = new Map<string, VendorPropertyRow[]>();
  for (const vp of vps) {
    const arr = vpsByVendor.get(vp.vendor_id) ?? [];
    arr.push(vp);
    vpsByVendor.set(vp.vendor_id, arr);
  }

  const nowYm = currentYearMonth();
  const [cy, cm] = nowYm.split('-').map(Number);
  let sy = cy, sm = cm - monthsBack;
  while (sm <= 0) { sm += 12; sy -= 1; }
  const fromYm = `${sy}-${String(sm).padStart(2, '0')}`;
  const months = yearMonthRange(fromYm, nowYm);

  const out: PendingSharedBill[] = [];
  for (const v of vendors) {
    if (v.kind === 'cleaner') continue;
    const props = vpsByVendor.get(v.id) ?? [];
    if (props.length === 0) continue;
    const estimated = Number(v.default_amount ?? 0);
    if (estimated <= 0) continue;

    for (const ym of months) {
      if (paidSet.has(`${v.id}::${ym}`)) continue;
      // No generar periodos previos a start_year_month si el vendor lo define.
      const start = (v as VendorRow & { start_year_month?: string | null }).start_year_month;
      if (start && ym < start) continue;
      out.push({
        vendor: v,
        yearMonth: ym,
        propertiesCount: props.length,
        estimatedAmount: estimated,
        isCurrentMonth: ym === nowYm,
      });
    }
  }

  out.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.vendor.name.localeCompare(b.vendor.name));
  return { data: out, error: null };
};
