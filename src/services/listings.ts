import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { ListingRow } from '@/types/database';

export const listListings = async (): Promise<ServiceResult<ListingRow[]>> => {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .order('external_name');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/** Upserts a listing by (property_id, external_name) — returns existing or newly created row. */
export const findOrCreateListing = async (
  propertyId: string,
  externalName: string,
  source = 'airbnb',
): Promise<ServiceResult<ListingRow>> => {
  // Check if already exists
  const { data: existing } = await supabase
    .from('listings')
    .select('*')
    .eq('property_id', propertyId)
    .eq('external_name', externalName)
    .maybeSingle();

  if (existing) return { data: existing, error: null };

  // Create new listing
  const { data, error } = await supabase
    .from('listings')
    .insert({ property_id: propertyId, external_name: externalName, source })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data, error: null };
};
