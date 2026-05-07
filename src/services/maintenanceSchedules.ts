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
  is_recurring?: boolean;
  recurrence_days?: number | null;
}

export interface UpdateMaintenanceScheduleInput {
  title?: string;
  description?: string | null;
  scheduled_date?: string;
  status?: MaintenanceScheduleStatus;
  notify_before_days?: number;
  email_notify?: boolean;
  is_recurring?: boolean;
  recurrence_days?: number | null;
  expense_registered?: boolean;
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
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { data: null, error: 'No autenticado' };

  const { data, error } = await supabase
    .from('inventory_maintenance_schedules')
    .insert({
      owner_id:           user.id,
      item_id:            input.item_id,
      property_id:        input.property_id,
      title:              input.title,
      description:        input.description ?? null,
      scheduled_date:     input.scheduled_date,
      notify_before_days: input.notify_before_days ?? 3,
      email_notify:       input.email_notify ?? false,
      is_recurring:       input.is_recurring ?? false,
      recurrence_days:    input.recurrence_days ?? null,
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

/**
 * Marks a schedule as done.
 * - expenseRegistered: true when called from expense registration flow, false when
 *   manually marked done from inventory (expense still needs to be logged).
 * - If the schedule is recurring, automatically creates the next occurrence.
 */
export async function completeMaintenanceSchedule(
  id: string,
  options: { expenseRegistered?: boolean } = {},
): Promise<{ data: MaintenanceScheduleRow | null; error: string | null }> {
  // Fetch current to check recurrence
  const { data: current, error: fetchErr } = await supabase
    .from('inventory_maintenance_schedules')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !current) return { data: null, error: fetchErr?.message ?? 'No encontrado' };

  const result = await updateMaintenanceSchedule(id, {
    status: 'done',
    expense_registered: options.expenseRegistered ?? false,
  });
  if (result.error) return result;

  // Auto-create next occurrence if recurring
  if (current.is_recurring && current.recurrence_days && current.recurrence_days > 0) {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + current.recurrence_days);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    await createMaintenanceSchedule({
      item_id:            current.item_id,
      property_id:        current.property_id,
      title:              current.title,
      description:        current.description,
      scheduled_date:     nextDateStr,
      notify_before_days: current.notify_before_days,
      is_recurring:       true,
      recurrence_days:    current.recurrence_days,
    });
  }

  return result;
}

// ─── Helpers for alerts ───────────────────────────────────────────────────────

/** Returns all pending schedules (overdue or upcoming). */
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

/** Returns schedules marked done but with no expense registered yet. */
export async function getSchedulesDoneNeedingExpense(): Promise<{
  data: MaintenanceScheduleRow[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('inventory_maintenance_schedules')
    .select('*')
    .eq('status', 'done')
    .eq('expense_registered', false)
    .order('updated_at', { ascending: false });

  return { data: data ?? [], error: error?.message ?? null };
}
