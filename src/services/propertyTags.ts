import { supabase } from '@/lib/supabase/client';
import type { PropertyTagRow, PropertyTagAssignmentRow } from '@/types/database';
import type { ServiceResult } from './expenses';

export const listPropertyTags = async (): Promise<ServiceResult<PropertyTagRow[]>> => {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return { data: [], error: null };
  const { data, error } = await supabase
    .from('property_tags')
    .select('id, owner_id, name, color, created_at')
    .eq('owner_id', authData.user.id)
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const createPropertyTag = async (
  input: { name: string; color?: string },
): Promise<ServiceResult<PropertyTagRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const { data, error } = await supabase
    .from('property_tags')
    .insert({
      owner_id: user.id,
      name: input.name,
      color: input.color ?? 'blue',
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updatePropertyTag = async (
  id: string,
  patch: Partial<{ name: string; color: string }>,
): Promise<ServiceResult<PropertyTagRow>> => {
  const { data, error } = await supabase
    .from('property_tags')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deletePropertyTag = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('property_tags').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

export const listAllTagAssignments = async (): Promise<ServiceResult<PropertyTagAssignmentRow[]>> => {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return { data: [], error: null };
  const { data, error } = await supabase
    .from('property_tag_assignments')
    .select('property_id, tag_id, owner_id, created_at')
    .eq('owner_id', authData.user.id);
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

/**
 * Reemplaza el conjunto completo de etiquetas de una propiedad.
 * Borra las asignaciones existentes y luego inserta las nuevas.
 */
export const setPropertyTags = async (
  propertyId: string,
  tagIds: string[],
): Promise<ServiceResult<true>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { error: delErr } = await supabase
    .from('property_tag_assignments')
    .delete()
    .eq('property_id', propertyId);
  if (delErr) return { data: null, error: delErr.message };

  if (tagIds.length === 0) return { data: true, error: null };

  const rows = tagIds.map(tag_id => ({
    property_id: propertyId,
    tag_id,
    owner_id: user.id,
  }));
  const { error: insErr } = await supabase
    .from('property_tag_assignments')
    .insert(rows);
  if (insErr) return { data: null, error: insErr.message };
  return { data: true, error: null };
};

/**
 * Asigna una etiqueta a una propiedad (idempotente: si ya existe, no falla).
 */
export const addPropertyTagAssignment = async (
  propertyId: string,
  tagId: string,
): Promise<ServiceResult<true>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const { error } = await supabase
    .from('property_tag_assignments')
    .upsert(
      { property_id: propertyId, tag_id: tagId, owner_id: user.id },
      { onConflict: 'property_id,tag_id', ignoreDuplicates: true },
    );
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/**
 * Quita una etiqueta específica de una propiedad.
 */
export const removePropertyTagAssignment = async (
  propertyId: string,
  tagId: string,
): Promise<ServiceResult<true>> => {
  const { error } = await supabase
    .from('property_tag_assignments')
    .delete()
    .eq('property_id', propertyId)
    .eq('tag_id', tagId);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};
