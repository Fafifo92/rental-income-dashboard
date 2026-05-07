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

/** Returns listings with only id + property_id for the given property IDs — used by occupancy views. */
export const listListingsByPropertyIds = async (
  propertyIds: string[],
): Promise<ServiceResult<Array<{ id: string; property_id: string }>>> => {
  if (!propertyIds.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from('listings')
    .select('id, property_id')
    .in('property_id', propertyIds);
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

/** Returns listings with id + source for given listing IDs — used for charge-target labelling. */
export const getListingsByIds = async (
  ids: string[],
): Promise<ServiceResult<Array<{ id: string; source: string }>>> => {
  if (!ids.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from('listings')
    .select('id, source')
    .in('id', ids);
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};
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
