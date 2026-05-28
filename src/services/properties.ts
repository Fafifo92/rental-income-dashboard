import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { PropertyRow } from '@/types/database';
import { isDemoMode } from '@/lib/demoMode';
import { demoBlockWrite, demoWriteBlockedResult } from '@/lib/demoGuard';
import { DEMO_PROPERTIES } from './demo/fixtures';

export const listProperties = async (): Promise<ServiceResult<PropertyRow[]>> => {
  if (isDemoMode()) return { data: DEMO_PROPERTIES, error: null };
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return { data: null, error: 'No autenticado' };
  const { data, error } = await supabase
    .from('properties')
    .select('id, owner_id, name, address, base_currency, estrato, bedrooms, max_guests, notes, created_at, default_cleaning_fee, rnt, group_id')
    .eq('owner_id', authData.user.id)
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/** Slim projection used by occupancy charts — only id, name, group_id. */
export const listPropertiesSlim = async (
  propertyIds?: string[],
): Promise<ServiceResult<Array<{ id: string; name: string; group_id: string | null }>>> => {
  if (isDemoMode()) {
    const filtered = propertyIds?.length
      ? DEMO_PROPERTIES.filter(p => propertyIds.includes(p.id))
      : DEMO_PROPERTIES;
    return { data: filtered.map(p => ({ id: p.id, name: p.name, group_id: p.group_id })), error: null };
  }
  let query = supabase.from('properties').select('id, name, group_id').order('name');
  if (propertyIds?.length) query = query.in('id', propertyIds);
  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const getProperty = async (id: string): Promise<ServiceResult<PropertyRow>> => {
  if (isDemoMode()) {
    const p = DEMO_PROPERTIES.find(x => x.id === id);
    return p ? { data: p, error: null } : { data: null, error: 'No encontrada' };
  }
  const { data, error } = await supabase
    .from('properties')
    .select('id, owner_id, name, address, base_currency, estrato, bedrooms, max_guests, notes, created_at, default_cleaning_fee, rnt, group_id')
    .eq('id', id)
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const createProperty = async (
  name: string,
  address?: string,
  baseCurrency = 'COP',
  rnt?: string | null,
): Promise<ServiceResult<PropertyRow>> => {
  if (demoBlockWrite('crear propiedad')) return demoWriteBlockedResult<PropertyRow>();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return { data: null, error: 'No autenticado — inicia sesión primero' };
  const user = authData.user;

  const { data, error } = await supabase
    .from('properties')
    .insert({
      owner_id: user.id,
      name,
      address: address ?? null,
      base_currency: baseCurrency,
      estrato: null,
      bedrooms: null,
      max_guests: null,
      notes: null,
      default_cleaning_fee: null,
      rnt: rnt ?? null,
      group_id: null,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updateProperty = async (
  id: string,
  patch: Partial<Omit<PropertyRow, 'id' | 'owner_id' | 'created_at'>>,
): Promise<ServiceResult<PropertyRow>> => {
  if (demoBlockWrite('actualizar propiedad')) return demoWriteBlockedResult<PropertyRow>();
  const { data, error } = await supabase
    .from('properties')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

