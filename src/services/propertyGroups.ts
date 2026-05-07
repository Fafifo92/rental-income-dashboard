import { supabase } from '@/lib/supabase/client';
import type { PropertyGroupRow } from '@/types/database';
import type { ServiceResult } from './expenses';

export const listPropertyGroups = async (): Promise<ServiceResult<PropertyGroupRow[]>> => {
  const { data, error } = await supabase
    .from('property_groups')
    .select('id, owner_id, name, color, sort_order, created_at')
    .order('sort_order')
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const createPropertyGroup = async (
  input: { name: string; color?: string; sort_order?: number },
): Promise<ServiceResult<PropertyGroupRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const { data, error } = await supabase
    .from('property_groups')
    .insert({
      owner_id: user.id,
      name: input.name,
      color: input.color ?? 'slate',
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updatePropertyGroup = async (
  id: string,
  patch: Partial<{ name: string; color: string; sort_order: number }>,
): Promise<ServiceResult<PropertyGroupRow>> => {
  const { data, error } = await supabase
    .from('property_groups')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/** Fetches minimal group data (id, name, color) for specific group IDs — used by occupancy chart. */
export const getPropertyGroupsByIds = async (
  ids: string[],
): Promise<ServiceResult<Array<{ id: string; name: string; color: string }>>> => {
  if (!ids.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from('property_groups')
    .select('id, name, color')
    .in('id', ids);
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const deletePropertyGroup = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('property_groups').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};
