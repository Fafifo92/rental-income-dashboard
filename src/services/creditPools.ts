/**
 * services/creditPools.ts
 *
 * Bolsas de créditos (típicamente seguros de responsabilidad civil que se compran
 * por bolsa con X créditos). Los créditos se descuentan automáticamente al hacer
 * check-in de cada reserva (manual o automático nocturno).
 *
 * Reglas:
 *   - Solo descuenta sobre reservas con start_date >= pool.activated_at
 *     (no sobre pasadas ni importadas con fecha previa).
 *   - Idempotente por (pool_id, booking_id): nunca dobla el descuento.
 *   - Si la bolsa activa no tiene créditos suficientes, se crea un gasto
 *     pendiente "Recarga de créditos" sugiriendo al usuario comprar otra bolsa.
 */

import { supabase } from '@/lib/supabase/client';
import { todayISO } from '@/lib/dateUtils';
import type { ServiceResult } from './expenses';
import type {
  CreditPoolRow,
  CreditPoolConsumptionRow,
  CreditPoolConsumptionRule,
  BookingRow,
} from '@/types/database';

// ─── CRUD básico ─────────────────────────────────────────────────────────────

export const listCreditPools = async (): Promise<ServiceResult<CreditPoolRow[]>> => {
  const { data, error } = await supabase
    .from('credit_pools')
    .select('*')
    .order('activated_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export interface CreateCreditPoolInput {
  vendor_id?: string | null;
  name: string;
  credits_total: number;
  total_price: number;
  consumption_rule: CreditPoolConsumptionRule;
  credits_per_unit: number;
  child_weight?: number;
  activated_at: string;
  expires_at?: string | null;
  notes?: string | null;
}

export const createCreditPool = async (
  input: CreateCreditPoolInput,
): Promise<ServiceResult<CreditPoolRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { data, error } = await supabase
    .from('credit_pools')
    .insert({
      owner_id: user.id,
      vendor_id: input.vendor_id ?? null,
      name: input.name,
      credits_total: input.credits_total,
      credits_used: 0,
      total_price: input.total_price,
      consumption_rule: input.consumption_rule,
      credits_per_unit: input.credits_per_unit,
      child_weight: input.child_weight ?? 1,
      activated_at: input.activated_at,
      expires_at: input.expires_at ?? null,
      status: 'active',
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updateCreditPool = async (
  id: string,
  patch: Partial<Omit<CreditPoolRow, 'id' | 'owner_id' | 'created_at'>>,
): Promise<ServiceResult<CreditPoolRow>> => {
  const { data, error } = await supabase
    .from('credit_pools')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const archiveCreditPool = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase
    .from('credit_pools')
    .update({ status: 'archived' })
    .eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

export const listConsumptionsForPool = async (
  poolId: string,
): Promise<ServiceResult<CreditPoolConsumptionRow[]>> => {
  const { data, error } = await supabase
    .from('credit_pool_consumptions')
    .select('*')
    .eq('pool_id', poolId)
    .order('occurred_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

// ─── Lógica de consumo ───────────────────────────────────────────────────────

/**
 * Calcula cuántas "unidades" base consume una reserva según la regla del pool.
 * - per_person_per_night  → (adultos + niños·child_weight) × noches
 * - per_person_per_booking → (adultos + niños·child_weight)
 * - per_booking            → 1
 */
export const calcUnitsForBooking = (
  booking: Pick<BookingRow, 'num_adults' | 'num_children' | 'num_nights'>,
  rule: CreditPoolConsumptionRule,
  childWeight: number,
): number => {
  const adults = Math.max(0, booking.num_adults ?? 1);
  const children = Math.max(0, booking.num_children ?? 0);
  const nights = Math.max(1, booking.num_nights ?? 1);
  const people = adults + children * childWeight;
  switch (rule) {
    case 'per_person_per_night':  return people * nights;
    case 'per_person_per_booking': return people;
    case 'per_booking':            return 1;
  }
};

/**
 * Devuelve el pool activo aplicable a una reserva: status='active', con
 * créditos disponibles y activated_at <= booking.start_date. Si hay varios,
 * usa el más reciente (último activado).
 */
export const findActivePoolForBooking = async (
  bookingStartDate: string,
): Promise<ServiceResult<CreditPoolRow | null>> => {
  const { data, error } = await supabase
    .from('credit_pools')
    .select('*')
    .eq('status', 'active')
    .lte('activated_at', bookingStartDate)
    .order('activated_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  const usable = (data ?? []).find(p => Number(p.credits_total) - Number(p.credits_used) > 0);
  return { data: usable ?? null, error: null };
};

/**
 * Realiza el descuento de créditos para una reserva al hacer check-in.
 * Es idempotente: si ya existe consumption para (pool, booking) no hace nada.
 *
 * Reglas:
 *   - Si booking.start_date < pool.activated_at → NO descuenta (devuelve skipped).
 *   - Si no hay pool activo aplicable → no descuenta (devuelve skipped).
 *   - Si el pool no tiene suficientes créditos → marca pool='depleted',
 *     descuenta lo que pueda y crea un gasto pendiente sugiriendo recarga.
 */
export interface ConsumeResult {
  consumed: boolean;
  skipped?: 'no_pool' | 'pre_activation' | 'already_consumed';
  pool_id?: string;
  units?: number;
  credits_used?: number;
  insufficient?: boolean;
}

export const consumeCreditsForCheckin = async (
  bookingId: string,
): Promise<ServiceResult<ConsumeResult>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  // 1) Cargar reserva
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, start_date, end_date, num_adults, num_children, num_nights, status, listing_id')
    .eq('id', bookingId)
    .single();
  if (bErr || !booking) return { data: null, error: bErr?.message ?? 'Reserva no encontrada' };
  if ((booking.status ?? '').toLowerCase().includes('cancel')) {
    return { data: { consumed: false, skipped: 'no_pool' }, error: null };
  }

  // 2) Buscar pool activo aplicable
  const poolRes = await findActivePoolForBooking(booking.start_date);
  if (poolRes.error) return { data: null, error: poolRes.error };
  const pool = poolRes.data;
  if (!pool) {
    return { data: { consumed: false, skipped: 'no_pool' }, error: null };
  }

  // 3) Validar fecha: no descontar sobre reservas previas a la activación
  if (booking.start_date < pool.activated_at) {
    return { data: { consumed: false, skipped: 'pre_activation', pool_id: pool.id }, error: null };
  }

  // 4) Idempotencia
  const { data: existing } = await supabase
    .from('credit_pool_consumptions')
    .select('id')
    .eq('pool_id', pool.id)
    .eq('booking_id', booking.id)
    .maybeSingle();
  if (existing) {
    return { data: { consumed: false, skipped: 'already_consumed', pool_id: pool.id }, error: null };
  }

  // 5) Calcular unidades y créditos
  const units = calcUnitsForBooking(booking, pool.consumption_rule, Number(pool.child_weight));
  const requested = units * Number(pool.credits_per_unit);
  const available = Number(pool.credits_total) - Number(pool.credits_used);
  const toUse = Math.min(requested, available);
  const insufficient = requested > available;

  // 6) Insertar consumption + actualizar pool
  const { error: cErr } = await supabase
    .from('credit_pool_consumptions')
    .insert({
      owner_id: user.id,
      pool_id: pool.id,
      booking_id: booking.id,
      units,
      credits_used: toUse,
      occurred_at: todayISO(),
      notes: insufficient ? 'Saldo insuficiente: se consumió el remanente.' : null,
    });
  if (cErr) return { data: null, error: cErr.message };

  const newUsed = Number(pool.credits_used) + toUse;
  const newStatus = newUsed >= Number(pool.credits_total) ? 'depleted' : pool.status;
  await supabase
    .from('credit_pools')
    .update({ credits_used: newUsed, status: newStatus })
    .eq('id', pool.id);

  // 7) Si no alcanzó, crear gasto pendiente sugiriendo recarga
  if (insufficient) {
    const missingCredits = requested - toUse;
    const unitPrice = Number(pool.credits_total) > 0
      ? Number(pool.total_price) / Number(pool.credits_total)
      : 0;
    const suggested = Math.round(missingCredits * unitPrice);
    await supabase.from('expenses').insert({
      owner_id: user.id,
      property_id: null,
      category: 'Seguros',
      type: 'variable' as const,
      amount: suggested,
      currency: 'COP',
      date: todayISO(),
      description: `Recarga sugerida de créditos · ${pool.name} (faltan ${missingCredits.toFixed(0)} créditos)`,
      status: 'pending' as const,
      bank_account_id: null,
      booking_id: null,
      vendor: pool.name,
      person_in_charge: null,
      adjustment_id: null,
      vendor_id: pool.vendor_id ?? null,
      shared_bill_id: null,
      subcategory: null,
      expense_group_id: null,
    });
  }

  return {
    data: {
      consumed: true,
      pool_id: pool.id,
      units,
      credits_used: toUse,
      insufficient,
    },
    error: null,
  };
};

// ─── Auto check-in nocturno (lazy en frontend) ───────────────────────────────

/**
 * Recorre las reservas del usuario cuya fecha de check-in ya pasó (o es hoy)
 * y aún no tienen checkin_done. Marca check-in y dispara el consumo del pool.
 *
 * Diseñado para ejecutarse al cargar la app (BookingsClient u otro punto).
 * Está protegido: si no hay reservas pendientes, no hace nada.
 */
export const runAutoCheckins = async (): Promise<{
  processed: number;
  consumed: number;
  errors: string[];
}> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { processed: 0, consumed: 0, errors: [] };

  const today = todayISO();
  const { data: pending, error } = await supabase
    .from('bookings')
    .select('id, start_date, status, checkin_done')
    .lte('start_date', today)
    .or('checkin_done.is.null,checkin_done.eq.false')
    .limit(200);
  if (error) return { processed: 0, consumed: 0, errors: [error.message] };

  let processed = 0;
  let consumed = 0;
  const errors: string[] = [];
  for (const b of pending ?? []) {
    if ((b.status ?? '').toLowerCase().includes('cancel')) continue;
    const upd = await supabase
      .from('bookings')
      .update({ checkin_done: true })
      .eq('id', b.id);
    if (upd.error) { errors.push(`${b.id}: ${upd.error.message}`); continue; }
    processed++;
    const cr = await consumeCreditsForCheckin(b.id);
    if (cr.error) errors.push(`${b.id}: ${cr.error}`);
    else if (cr.data?.consumed) consumed++;
  }
  return { processed, consumed, errors };
};
