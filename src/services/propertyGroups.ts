import { supabase } from '@/lib/supabase/client';
import type { PropertyGroupRow } from '@/types/database';
import type { ServiceResult } from './expenses';
import { isDemoMode } from '@/lib/demoMode';
import { demoBlockWrite, demoWriteBlockedResult } from '@/lib/demoGuard';
import { DEMO_PROPERTY_GROUPS } from './demo/fixtures';

export const listPropertyGroups = async (): Promise<ServiceResult<PropertyGroupRow[]>> => {
  if (isDemoMode()) return { data: DEMO_PROPERTY_GROUPS, error: null };
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
  if (demoBlockWrite('crear grupo de propiedades')) return demoWriteBlockedResult<PropertyGroupRow>();
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
  if (demoBlockWrite('actualizar grupo de propiedades')) return demoWriteBlockedResult<PropertyGroupRow>();
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
  if (isDemoMode()) {
    return {
      data: DEMO_PROPERTY_GROUPS
        .filter(g => ids.includes(g.id))
        .map(g => ({ id: g.id, name: g.name, color: g.color })),
      error: null,
    };
  }
  const { data, error } = await supabase
    .from('property_groups')
    .select('id, name, color')
    .in('id', ids);
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const deletePropertyGroup = async (id: string): Promise<ServiceResult<true>> => {
  if (demoBlockWrite('eliminar grupo de propiedades')) return demoWriteBlockedResult<true>();
  const { error } = await supabase.from('property_groups').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};
