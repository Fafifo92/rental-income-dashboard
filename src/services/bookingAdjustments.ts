import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BookingAdjustmentRow } from '@/types/database';

export const listBookingAdjustments = async (
  bookingId: string,
): Promise<ServiceResult<BookingAdjustmentRow[]>> => {
  const { data, error } = await supabase
    .from('booking_adjustments')
    .select('*')
    .eq('booking_id', bookingId)
    .order('date', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export const createBookingAdjustment = async (
  input: Omit<BookingAdjustmentRow, 'id' | 'created_at'>,
): Promise<ServiceResult<BookingAdjustmentRow>> => {
  const { data, error } = await supabase
    .from('booking_adjustments')
    .insert(input)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteBookingAdjustment = async (
  id: string,
): Promise<ServiceResult<true>> => {
  const { error } = await supabase
    .from('booking_adjustments')
    .delete()
    .eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/** Devuelve el impacto neto: extra_income + damage_charge − discount */
export const netAdjustment = (adj: BookingAdjustmentRow[]): number =>
  adj.reduce((s, a) => {
    const v = Number(a.amount) || 0;
    return a.kind === 'discount' ? s - v : s + v;
  }, 0);
