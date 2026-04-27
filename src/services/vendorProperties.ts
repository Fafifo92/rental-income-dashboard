import { supabase } from '@/lib/supabase/client';
import type { VendorPropertyRow } from '@/types/database';
import type { ServiceResult } from './vendors';

export const listVendorProperties = async (
  vendorId: string,
): Promise<ServiceResult<VendorPropertyRow[]>> => {
  const { data, error } = await supabase
    .from('vendor_properties')
    .select('*')
    .eq('vendor_id', vendorId);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as VendorPropertyRow[], error: null };
};

export const listAllVendorProperties = async (): Promise<ServiceResult<VendorPropertyRow[]>> => {
  const { data, error } = await supabase.from('vendor_properties').select('*');
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as VendorPropertyRow[], error: null };
};

/**
 * Sobrescribe la lista de propiedades cubiertas por un vendor.
 * items: [{propertyId, sharePercent?, fixedAmount?}]
 *   - fixedAmount: monto fijo absoluto que paga esa propiedad
 *   - sharePercent: % del resto (después de descontar fixedAmount totales)
 *   - ambos null → reparto igual sobre lo que sobra
 * Borra las asignaciones previas y re-crea. Simple y consistente.
 */
export const setVendorProperties = async (
  vendorId: string,
  items: { propertyId: string; sharePercent: number | null; fixedAmount?: number | null }[],
): Promise<ServiceResult<true>> => {
  const { error: delErr } = await supabase
    .from('vendor_properties')
    .delete()
    .eq('vendor_id', vendorId);
  if (delErr) return { data: null, error: delErr.message };

  if (items.length === 0) return { data: true, error: null };

  const payload = items.map(i => ({
    vendor_id: vendorId,
    property_id: i.propertyId,
    share_percent: i.sharePercent,
    fixed_amount: i.fixedAmount ?? null,
  }));

  const { error: insErr } = await supabase.from('vendor_properties').insert(payload);
  if (insErr) return { data: null, error: insErr.message };
  return { data: true, error: null };
};

/**
 * Calcula el reparto de un monto total entre las propiedades del vendor.
 * Reglas (orden de prioridad):
 *   1. fixed_amount fijo: esa propiedad paga ese monto literal.
 *   2. share_percent: % del total restante (después de descontar fijos).
 *   3. NULL/NULL: reparto igual entre las que no tengan fijo ni %.
 * Ajuste de centavos a la última propiedad para que la suma cierre.
 */
export const computeShares = (
  total: number,
  rows: VendorPropertyRow[],
): Map<string, number> => {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;

  const withFixed   = rows.filter(r => r.fixed_amount != null);
  const withPct     = rows.filter(r => r.fixed_amount == null && r.share_percent != null);
  const withoutAny  = rows.filter(r => r.fixed_amount == null && r.share_percent == null);

  const fixedSum = withFixed.reduce((s, r) => s + Number(r.fixed_amount), 0);
  const remainingAfterFixed = Math.max(0, total - fixedSum);

  const pctSum = withPct.reduce((s, r) => s + total * (Number(r.share_percent) / 100), 0);
  const remainingAfterPct = Math.max(0, remainingAfterFixed - pctSum);
  const perEqual = withoutAny.length > 0 ? remainingAfterPct / withoutAny.length : 0;

  for (const r of withFixed) out.set(r.property_id, round2(Number(r.fixed_amount)));
  for (const r of withPct)   out.set(r.property_id, round2(total * (Number(r.share_percent) / 100)));
  for (const r of withoutAny) out.set(r.property_id, round2(perEqual));

  // Ajuste de centavos: que la suma sea exactamente total.
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  const diff = round2(total - sum);
  if (diff !== 0 && rows.length > 0) {
    const lastId = rows[rows.length - 1].property_id;
    out.set(lastId, round2((out.get(lastId) ?? 0) + diff));
  }

  return out;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
