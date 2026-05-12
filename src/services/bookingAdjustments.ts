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

export const updateBookingAdjustment = async (
  id: string,
  patch: Partial<Pick<BookingAdjustmentRow, 'bank_account_id' | 'amount' | 'description' | 'date'>>,
): Promise<ServiceResult<BookingAdjustmentRow>> => {
  const { data, error } = await supabase
    .from('booking_adjustments')
    .update(patch)
    .eq('id', id)
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

/**
 * Carga todos los ajustes de reserva del propietario autenticado.
 * RLS garantiza que solo se devuelven ajustes de reservas propias.
 * Usado por `computeFinancials` para incluir cobros de daños, ingresos extra
 * y descuentos en los KPIs globales y gráficas mensuales.
 */
export const listAllBookingAdjustmentsForOwner = async (): Promise<
  ServiceResult<Pick<BookingAdjustmentRow, 'kind' | 'amount' | 'date'>[]>
> => {
  const { data, error } = await supabase
    .from('booking_adjustments')
    .select('kind, amount, date');
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

/** Devuelve el impacto neto: todos suman (entran como ingreso), excepto `discount` que resta. */
export const netAdjustment = (adj: BookingAdjustmentRow[]): number =>
  adj.reduce((s, a) => {
    const v = Number(a.amount) || 0;
    return a.kind === 'discount' ? s - v : s + v;
  }, 0);

/**
 * Carga todos los ajustes de reserva con booking_id y descripción para exportes.
 * RLS garantiza que solo se devuelven ajustes de reservas propias.
 */
export const listAllBookingAdjustmentsForExport = async (): Promise<
  ServiceResult<Pick<BookingAdjustmentRow, 'booking_id' | 'kind' | 'amount' | 'date' | 'description'>[]>
> => {
  const { data, error } = await supabase
    .from('booking_adjustments')
    .select('booking_id, kind, amount, date, description')
    .order('date', { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};
