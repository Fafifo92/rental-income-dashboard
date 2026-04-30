import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { PropertyRow } from '@/types/database';

export const listProperties = async (): Promise<ServiceResult<PropertyRow[]>> => {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const getProperty = async (id: string): Promise<ServiceResult<PropertyRow>> => {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado — inicia sesión primero' };

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
  const { data, error } = await supabase
    .from('properties')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

