import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { PropertyRecurringExpenseRow } from '@/types/database';

export const listRecurringExpenses = async (
  propertyId: string,
): Promise<ServiceResult<PropertyRecurringExpenseRow[]>> => {
  const { data, error } = await supabase
    .from('property_recurring_expenses')
    .select('*')
    .eq('property_id', propertyId)
    .order('category')
    .order('valid_from', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/** Devuelve solo la versión vigente por (property, category). */
export const listActiveRecurringExpensesForOwner = async (): Promise<
  ServiceResult<PropertyRecurringExpenseRow[]>
> => {
  const { data, error } = await supabase
    .from('property_recurring_expenses')
    .select('*')
    .eq('is_active', true)
    .is('valid_to', null);
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/** Devuelve TODAS las versiones (incluyendo históricas) para expandir en rangos pasados. */
export const listAllRecurringExpensesForOwner = async (): Promise<
  ServiceResult<PropertyRecurringExpenseRow[]>
> => {
  const { data, error } = await supabase
    .from('property_recurring_expenses')
    .select('*');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const createRecurringExpense = async (
  input: Omit<PropertyRecurringExpenseRow, 'id' | 'created_at'>,
): Promise<ServiceResult<PropertyRecurringExpenseRow>> => {
  const { data, error } = await supabase
    .from('property_recurring_expenses')
    .insert(input)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updateRecurringExpense = async (
  id: string,
  patch: Partial<Omit<PropertyRecurringExpenseRow, 'id' | 'property_id' | 'created_at'>>,
): Promise<ServiceResult<PropertyRecurringExpenseRow>> => {
  const { data, error } = await supabase
    .from('property_recurring_expenses')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

/**
 * SCD Type 2: registrar un cambio de precio/atributos a partir de una fecha.
 * - Cierra la versión actual con valid_to = effectiveDate - 1 día
 * - Inserta una nueva versión con valid_from = effectiveDate, valid_to = NULL
 * Usar cuando la factura sube/baja a partir de un mes específico.
 */
export const changeRecurringExpensePrice = async (
  currentId: string,
  effectiveDate: string, // YYYY-MM-DD (día a partir del cual aplica el nuevo valor)
  newAttrs: {
    amount: number;
    category?: string;
    day_of_month?: number | null;
    description?: string | null;
    vendor?: string | null;
    person_in_charge?: string | null;
  },
): Promise<ServiceResult<PropertyRecurringExpenseRow>> => {
  // 1. Obtener fila actual para heredar property_id + atributos no modificados
  const { data: current, error: cErr } = await supabase
    .from('property_recurring_expenses')
    .select('*')
    .eq('id', currentId)
    .single();
  if (cErr || !current) return { data: null, error: cErr?.message ?? 'No encontrado' };

  // 2. Cerrar la versión actual
  const prevDay = new Date(effectiveDate + 'T00:00:00');
  prevDay.setDate(prevDay.getDate() - 1);
  const validTo = prevDay.toISOString().split('T')[0];

  const { error: upErr } = await supabase
    .from('property_recurring_expenses')
    .update({ valid_to: validTo, is_active: false })
    .eq('id', currentId);
  if (upErr) return { data: null, error: upErr.message };

  // 3. Crear la nueva versión
  const { data, error } = await supabase
    .from('property_recurring_expenses')
    .insert({
      property_id: current.property_id,
      category: newAttrs.category ?? current.category,
      amount: newAttrs.amount,
      is_active: true,
      day_of_month: newAttrs.day_of_month ?? current.day_of_month,
      description: newAttrs.description ?? current.description,
      vendor: newAttrs.vendor ?? current.vendor,
      person_in_charge: newAttrs.person_in_charge ?? current.person_in_charge,
      valid_from: effectiveDate,
      valid_to: null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteRecurringExpense = async (
  id: string,
): Promise<ServiceResult<true>> => {
  const { error } = await supabase
    .from('property_recurring_expenses')
    .delete()
    .eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};
