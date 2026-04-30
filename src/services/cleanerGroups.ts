import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { CleanerGroupRow } from '@/types/database';

export interface CleanerGroup extends CleanerGroupRow {
  member_ids: string[];
}

const PALETTE = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const pickColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

/**
 * Lista todos los grupos del usuario con la lista de cleaner_ids miembros.
 */
export const listCleanerGroups = async (): Promise<ServiceResult<CleanerGroup[]>> => {
  const { data: groups, error: gErr } = await supabase
    .from('cleaner_groups')
    .select('*')
    .order('name');
  if (gErr) return { data: null, error: gErr.message };

  const ids = (groups ?? []).map(g => g.id);
  let memberMap = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: members, error: mErr } = await supabase
      .from('cleaner_group_members')
      .select('group_id, cleaner_id')
      .in('group_id', ids);
    if (mErr) return { data: null, error: mErr.message };
    memberMap = new Map();
    for (const m of members ?? []) {
      const arr = memberMap.get(m.group_id) ?? [];
      arr.push(m.cleaner_id);
      memberMap.set(m.group_id, arr);
    }
  }

  return {
    data: (groups ?? []).map(g => ({ ...g, member_ids: memberMap.get(g.id) ?? [] })),
    error: null,
  };
};

export const createCleanerGroup = async (
  name: string,
  color?: string | null,
): Promise<ServiceResult<CleanerGroupRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const trimmed = name.trim();
  if (!trimmed) return { data: null, error: 'El nombre es obligatorio' };
  const { data, error } = await supabase
    .from('cleaner_groups')
    .insert({ owner_id: user.id, name: trimmed, color: color ?? pickColor() })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const renameCleanerGroup = async (
  id: string,
  name: string,
  color?: string | null,
): Promise<ServiceResult<CleanerGroupRow>> => {
  const patch: Partial<Omit<CleanerGroupRow, 'id' | 'created_at'>> = { name: name.trim() };
  if (color !== undefined) patch.color = color;
  const { data, error } = await supabase
    .from('cleaner_groups')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteCleanerGroup = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('cleaner_groups').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

export const setCleanerGroupMembership = async (
  cleanerId: string,
  groupIds: string[],
): Promise<ServiceResult<true>> => {
  // Wipe & rewrite — simple y suficiente para volumen típico.
  const del = await supabase
    .from('cleaner_group_members')
    .delete()
    .eq('cleaner_id', cleanerId);
  if (del.error) return { data: null, error: del.error.message };
  if (groupIds.length === 0) return { data: true, error: null };

  const rows = groupIds.map(group_id => ({ group_id, cleaner_id: cleanerId }));
  const ins = await supabase.from('cleaner_group_members').insert(rows);
  if (ins.error) return { data: null, error: ins.error.message };
  return { data: true, error: null };
};
