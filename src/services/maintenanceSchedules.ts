import { supabase } from '@/lib/supabase/client';
import type { MaintenanceScheduleRow, MaintenanceScheduleStatus } from '@/types/database';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateMaintenanceScheduleInput {
  item_id: string;
  property_id: string;
  title: string;
  description?: string | null;
  scheduled_date: string; // 'YYYY-MM-DD'
  notify_before_days?: number;
  email_notify?: boolean;
}

export interface UpdateMaintenanceScheduleInput {
  title?: string;
  description?: string | null;
  scheduled_date?: string;
  status?: MaintenanceScheduleStatus;
  notify_before_days?: number;
  email_notify?: boolean;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listMaintenanceSchedules(filters?: {
  itemId?: string;
  propertyId?: string;
  status?: MaintenanceScheduleStatus;
}): Promise<{ data: MaintenanceScheduleRow[]; error: string | null }> {
  let q = supabase
    .from('inventory_maintenance_schedules')
    .select('*')
    .order('scheduled_date', { ascending: true });

  if (filters?.itemId)     q = q.eq('item_id',     filters.itemId);
  if (filters?.propertyId) q = q.eq('property_id', filters.propertyId);
  if (filters?.status)     q = q.eq('status',      filters.status);

  const { data, error } = await q;
  return { data: data ?? [], error: error?.message ?? null };
}

export async function createMaintenanceSchedule(
  input: CreateMaintenanceScheduleInput,
): Promise<{ data: MaintenanceScheduleRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('inventory_maintenance_schedules')
    .insert({
      item_id:            input.item_id,
      property_id:        input.property_id,
      title:              input.title,
      description:        input.description ?? null,
      scheduled_date:     input.scheduled_date,
      notify_before_days: input.notify_before_days ?? 3,
      email_notify:       input.email_notify ?? false,
    })
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

export async function updateMaintenanceSchedule(
  id: string,
  patch: UpdateMaintenanceScheduleInput,
): Promise<{ data: MaintenanceScheduleRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('inventory_maintenance_schedules')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

export async function deleteMaintenanceSchedule(
  id: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('inventory_maintenance_schedules')
    .delete()
    .eq('id', id);

  return { error: error?.message ?? null };
}

export async function completeMaintenanceSchedule(
  id: string,
): Promise<{ data: MaintenanceScheduleRow | null; error: string | null }> {
  return updateMaintenanceSchedule(id, { status: 'done' });
}

// ─── Helpers for alerts ───────────────────────────────────────────────────────

/** Returns all pending schedules, including overdue ones. */
export async function getUpcomingAndOverdueSchedules(): Promise<{
  data: MaintenanceScheduleRow[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('inventory_maintenance_schedules')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_date', { ascending: true });

  return { data: data ?? [], error: error?.message ?? null };
}
