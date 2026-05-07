import { supabase } from '@/lib/supabase/client';
import type { VendorRow, VendorKind } from '@/types/database';

export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export interface Vendor {
  id: string;
  owner_id: string;
  name: string;
  kind: VendorKind;
  contact: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  category: string | null;
  default_amount: number | null;
  day_of_month: number | null;
  is_variable: boolean;
  /** Formato 'YYYY-MM'. Si está seteado, no se generarán periodos previos. */
  start_year_month: string | null;
}

const toVendor = (row: VendorRow): Vendor => ({
  id: row.id,
  owner_id: row.owner_id,
  name: row.name,
  kind: row.kind,
  contact: row.contact,
  notes: row.notes,
  active: row.active,
  created_at: row.created_at,
  category: row.category,
  default_amount: row.default_amount,
  day_of_month: row.day_of_month,
  is_variable: row.is_variable ?? false,
  start_year_month: row.start_year_month ?? null,
});

export const listVendors = async (
  kind?: VendorKind,
): Promise<ServiceResult<Vendor[]>> => {
  let q = supabase.from('vendors').select('id, owner_id, name, kind, contact, notes, active, created_at, category, default_amount, day_of_month, is_variable, start_year_month').order('name', { ascending: true });
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map(toVendor), error: null };
};

export const createVendor = async (
  input: Omit<Vendor, 'id' | 'created_at' | 'owner_id'>,
): Promise<ServiceResult<Vendor>> => {
  const { data: userData } = await supabase.auth.getUser();
  const owner_id = userData.user?.id;
  if (!owner_id) return { data: null, error: 'No autenticado.' };

  const { data, error } = await supabase
    .from('vendors')
    .insert({ ...input, owner_id })
    .select('id, owner_id, name, kind, contact, notes, active, created_at, category, default_amount, day_of_month, is_variable, start_year_month')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: toVendor(data as VendorRow), error: null };
};

export const updateVendor = async (
  id: string,
  patch: Partial<Omit<Vendor, 'id' | 'created_at' | 'owner_id'>>,
): Promise<ServiceResult<Vendor>> => {
  const { data, error } = await supabase
    .from('vendors')
    .update(patch)
    .eq('id', id)
    .select('id, owner_id, name, kind, contact, notes, active, created_at, category, default_amount, day_of_month, is_variable, start_year_month')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: toVendor(data as VendorRow), error: null };
};

export const deleteVendor = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('vendors').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};
