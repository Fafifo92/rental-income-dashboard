/**
 * services/creditPools.ts
 *
 * Bolsas de créditos (seguros prepagados, asistencias, etc.) que se compran
 * en tandas y se consumen automáticamente al hacer check-in de cada reserva.
 *
 * Modelo:
 *   - Cada **recarga es una bolsa nueva** (fila independiente en credit_pools).
 *     NO se promedia precio: cada bolsa conserva su credits_total y total_price
 *     originales, y el precio/crédito de cada consumption se congela en
 *     `unit_price_snapshot` para blindar reportes históricos.
 *   - Consumo **FIFO** por vendor: la bolsa más antigua activa con saldo se
 *     consume primero. Si una bolsa se agota mid-reserva, el resto se cobra a
 *     la siguiente bolsa elegible (split → 2 consumption rows).
 *   - **Scoping por propiedad**:
 *       · Si la bolsa tiene `vendor_id` → cobertura = `vendor_properties` del
 *         vendor (una sola fuente: la lista del proveedor).
 *       · Si NO tiene vendor → cobertura = `credit_pool_properties` propio.
 *   - **Idempotencia**: una misma reserva no consume dos veces del mismo vendor
 *     (suma de consumption.credits_used por vendor ≥ requested → skip).
 *   - **Backfill**: cuando nace una bolsa, recorre las reservas elegibles con
 *     start_date ∈ [activated_at, hoy] de las propiedades cubiertas que aún no
 *     hayan sido cubiertas por otra bolsa del mismo vendor.
 */

import { supabase } from '@/lib/supabase/client';
import { todayISO } from '@/lib/dateUtils';
import { calcUnitsForBooking, unitPriceOf } from '@/lib/creditPoolCalc';
import type { ServiceResult } from './expenses';
import type {
  CreditPoolRow,
  CreditPoolConsumptionRow,
  CreditPoolConsumptionRule,
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
  /** Liga la bolsa al expense de compra (opcional). */
  expense_id?: string | null;
  /**
   * Cobertura por propiedad SOLO se aplica si la bolsa NO tiene vendor_id.
   * Si tiene vendor_id, la cobertura se hereda de vendor_properties (este
   * campo se ignora silenciosamente para evitar inconsistencias).
   */
  property_ids?: string[];
}

export const createCreditPool = async (
  input: CreateCreditPoolInput,
): Promise<ServiceResult<CreditPoolRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  // Guardar integridad: sin precio y créditos completos, la bolsa no puede
  // calcular unit_price_snapshot ni atribuir costos correctamente.
  if (!input.credits_total || input.credits_total <= 0) {
    return { data: null, error: 'La bolsa requiere al menos 1 crédito total.' };
  }
  if (!input.total_price || input.total_price <= 0) {
    return { data: null, error: 'El precio total es obligatorio — define el costo por crédito.' };
  }
  if (!input.credits_per_unit || input.credits_per_unit <= 0) {
    return { data: null, error: 'Créditos por unidad debe ser mayor a 0.' };
  }

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
      expense_id: input.expense_id ?? null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };

  // Cobertura propia solo si NO hay vendor
  if (!input.vendor_id && input.property_ids && input.property_ids.length > 0) {
    const rows = input.property_ids.map(pid => ({
      pool_id: data.id,
      property_id: pid,
    }));
    await supabase.from('credit_pool_properties').insert(rows);
  }

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

/**
 * Borra TODOS los consumos (`credit_pool_consumptions`) de una bolsa y resetea
 * su contador `credits_used` a 0. Útil para limpiar el panel de "Atribución de
 * bolsas por propiedad" cuando una bolsa quedó mal configurada y sus consumos
 * históricos no tienen sentido contable.
 *
 * Esto NO afecta el `expense` original de compra de la bolsa (eso vive en
 * `expenses` aparte). Sólo limpia la atribución informativa.
 *
 * Si la bolsa estaba en estado `depleted`, vuelve a su estado anterior según
 * corresponda (archived si estaba archivada, active en otro caso).
 */
export const deleteCreditPoolConsumptions = async (
  poolId: string,
): Promise<ServiceResult<{ deleted: number }>> => {
  const { data: existing, error: countErr } = await supabase
    .from('credit_pool_consumptions')
    .select('id')
    .eq('pool_id', poolId);
  if (countErr) return { data: null, error: countErr.message };
  const deleted = existing?.length ?? 0;

  if (deleted > 0) {
    const { error: delErr } = await supabase
      .from('credit_pool_consumptions')
      .delete()
      .eq('pool_id', poolId);
    if (delErr) return { data: null, error: delErr.message };
  }

  // Resetear contador y, si estaba depleted, volver a active/archived según corresponda.
  const { data: pool } = await supabase
    .from('credit_pools')
    .select('status')
    .eq('id', poolId)
    .single();
  const nextStatus = pool?.status === 'depleted' ? 'active' : pool?.status ?? 'active';
  const { error: updErr } = await supabase
    .from('credit_pools')
    .update({ credits_used: 0, status: nextStatus })
    .eq('id', poolId);
  if (updErr) return { data: null, error: updErr.message };

  return { data: { deleted }, error: null };
};

/**
 * Recalcula `unit_price_snapshot` en todos los consumos de una bolsa usando
 * el precio/crédito ACTUAL de la bolsa. Útil cuando la bolsa se configuró con
 * 0 (o un precio incorrecto) en el momento del consumo y luego se ajustó.
 *
 * Importante: rompe el contrato normal de "snapshot inmutable" — usar sólo
 * para corregir consumos creados con datos incompletos.
 */
export const recomputeCreditPoolSnapshots = async (
  poolId: string,
): Promise<ServiceResult<{ updated: number; unitPrice: number }>> => {
  const { data: pool, error: pErr } = await supabase
    .from('credit_pools')
    .select('id, total_price, credits_total')
    .eq('id', poolId)
    .single();
  if (pErr || !pool) return { data: null, error: pErr?.message ?? 'Bolsa no encontrada' };
  const credits = Number(pool.credits_total);
  const total = Number(pool.total_price);
  if (credits <= 0 || total <= 0) {
    return { data: null, error: 'La bolsa no tiene precio o créditos totales válidos para recalcular.' };
  }
  const unitPrice = total / credits;

  const { data: rows, error: lErr } = await supabase
    .from('credit_pool_consumptions')
    .select('id')
    .eq('pool_id', poolId);
  if (lErr) return { data: null, error: lErr.message };
  const updated = rows?.length ?? 0;
  if (updated === 0) return { data: { updated: 0, unitPrice }, error: null };

  const { error: uErr } = await supabase
    .from('credit_pool_consumptions')
    .update({ unit_price_snapshot: unitPrice })
    .eq('pool_id', poolId);
  if (uErr) return { data: null, error: uErr.message };
  return { data: { updated, unitPrice }, error: null };
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

// ─── Cobertura por propiedad ─────────────────────────────────────────────────

/**
 * Devuelve los property_ids cubiertos por una bolsa.
 * - Si tiene vendor_id → usa vendor_properties del vendor.
 * - Si no tiene vendor → usa credit_pool_properties propio.
 */
export const resolvePoolProperties = async (
  pool: Pick<CreditPoolRow, 'id' | 'vendor_id'>,
): Promise<string[]> => {
  if (pool.vendor_id) {
    const { data } = await supabase
      .from('vendor_properties')
      .select('property_id')
      .eq('vendor_id', pool.vendor_id);
    return (data ?? []).map(r => r.property_id);
  }
  const { data } = await supabase
    .from('credit_pool_properties')
    .select('property_id')
    .eq('pool_id', pool.id);
  return (data ?? []).map(r => r.property_id);
};

/**
 * Sobrescribe la cobertura por propiedad de una bolsa SIN vendor.
 * Si la bolsa tiene vendor, no hace nada (la cobertura se gestiona en el vendor).
 */
export const setCreditPoolProperties = async (
  poolId: string,
  propertyIds: string[],
): Promise<ServiceResult<true>> => {
  const { data: pool } = await supabase
    .from('credit_pools')
    .select('vendor_id')
    .eq('id', poolId)
    .single();
  if (pool?.vendor_id) {
    return { data: null, error: 'Esta bolsa hereda cobertura del proveedor. Edita las propiedades en el proveedor.' };
  }
  const del = await supabase.from('credit_pool_properties').delete().eq('pool_id', poolId);
  if (del.error) return { data: null, error: del.error.message };
  if (propertyIds.length > 0) {
    const ins = await supabase
      .from('credit_pool_properties')
      .insert(propertyIds.map(pid => ({ pool_id: poolId, property_id: pid })));
    if (ins.error) return { data: null, error: ins.error.message };
  }
  return { data: true, error: null };
};

// ─── Cálculo de unidades y precio (re-exportados desde lib pura) ─────────────

export { calcUnitsForBooking, unitPriceOf } from '@/lib/creditPoolCalc';

// ─── Lookup FIFO con scope por propiedad ─────────────────────────────────────

interface FindPoolsOptions {
  bookingStartDate: string;
  propertyId: string;
  vendorId?: string | null;
}

/**
 * Devuelve todas las bolsas elegibles para una reserva+propiedad, ordenadas
 * FIFO (más antigua activación primero). Filtra por cobertura.
 */
export const findActivePoolsForBookingProperty = async (
  opts: FindPoolsOptions,
): Promise<ServiceResult<CreditPoolRow[]>> => {
  let q = supabase
    .from('credit_pools')
    .select('*')
    .eq('status', 'active')
    .lte('activated_at', opts.bookingStartDate)
    .order('activated_at', { ascending: true });
  if (opts.vendorId !== undefined) {
    if (opts.vendorId === null) q = q.is('vendor_id', null);
    else q = q.eq('vendor_id', opts.vendorId);
  }
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };

  const candidates = (data ?? []).filter(p =>
    // Saldo disponible
    Number(p.credits_total) - Number(p.credits_used) > 0 &&
    // La ecuación debe estar completa: sin precio no se puede calcular
    // unit_price_snapshot y la atribución de costos sería $0 (silenciosamente rota).
    Number(p.total_price) > 0 &&
    Number(p.credits_per_unit) > 0,
  );

  // Filtrar por cobertura (resolución por bolsa)
  const out: CreditPoolRow[] = [];
  for (const pool of candidates) {
    const covered = await resolvePoolProperties(pool);
    if (covered.length === 0) continue; // bolsa sin cobertura → no consume
    if (covered.includes(opts.propertyId)) out.push(pool);
  }
  return { data: out, error: null };
};

/**
 * Wrapper legacy: primera bolsa elegible (la más antigua activa con saldo).
 * Mantiene la firma anterior para no romper consumidores.
 */
export const findActivePoolForBooking = async (
  bookingStartDate: string,
  propertyId?: string,
): Promise<ServiceResult<CreditPoolRow | null>> => {
  if (!propertyId) {
    // Comportamiento legacy sin scoping (no debería usarse en nuevo código).
    const { data, error } = await supabase
      .from('credit_pools')
      .select('*')
      .eq('status', 'active')
      .lte('activated_at', bookingStartDate)
      .order('activated_at', { ascending: true });
    if (error) return { data: null, error: error.message };
    const usable = (data ?? []).find(p =>
      Number(p.credits_total) - Number(p.credits_used) > 0 &&
      Number(p.total_price) > 0 &&
      Number(p.credits_per_unit) > 0,
    );
    return { data: usable ?? null, error: null };
  }
  const res = await findActivePoolsForBookingProperty({ bookingStartDate, propertyId });
  if (res.error) return { data: null, error: res.error };
  return { data: (res.data ?? [])[0] ?? null, error: null };
};

// ─── Consumo (con split FIFO + snapshot + idempotencia por vendor) ───────────

export interface ConsumeResult {
  consumed: boolean;
  skipped?: 'no_pool' | 'pre_activation' | 'already_consumed' | 'no_coverage';
  pool_ids?: string[];
  units?: number;
  credits_used?: number;
  credits_missing?: number;
  insufficient?: boolean;
}

/**
 * Suma cuántos créditos ya consumió una reserva agrupados por vendor (null
 * cuenta como su propio bucket). Sirve para idempotencia entre recargas.
 */
const sumConsumedByVendorForBooking = async (
  bookingId: string,
): Promise<Map<string | 'null', number>> => {
  const { data } = await supabase
    .from('credit_pool_consumptions')
    .select('credits_used, pool_id')
    .eq('booking_id', bookingId);
  const rows = (data ?? []) as Array<{ credits_used: number; pool_id: string }>;
  if (rows.length === 0) return new Map();
  const poolIds = [...new Set(rows.map(r => r.pool_id))];
  const { data: poolsData } = await supabase
    .from('credit_pools')
    .select('id, vendor_id')
    .in('id', poolIds);
  const vendorByPool = new Map<string, string | null>();
  for (const p of (poolsData ?? []) as Array<{ id: string; vendor_id: string | null }>) {
    vendorByPool.set(p.id, p.vendor_id);
  }
  const m = new Map<string | 'null', number>();
  for (const row of rows) {
    const key: string | 'null' = vendorByPool.get(row.pool_id) ?? 'null';
    m.set(key, (m.get(key) ?? 0) + Number(row.credits_used));
  }
  return m;
};

export const consumeCreditsForCheckin = async (
  bookingId: string,
): Promise<ServiceResult<ConsumeResult>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  // 1) Reserva + propiedad
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, start_date, end_date, num_adults, num_children, num_nights, status, listing_id')
    .eq('id', bookingId)
    .single();
  if (bErr || !booking) return { data: null, error: bErr?.message ?? 'Reserva no encontrada' };
  if ((booking.status ?? '').toLowerCase().includes('cancel')) {
    return { data: { consumed: false, skipped: 'no_pool' }, error: null };
  }
  const { data: listing } = await supabase
    .from('listings')
    .select('property_id')
    .eq('id', booking.listing_id)
    .maybeSingle();
  const propertyId = listing?.property_id as string | undefined;
  if (!propertyId) {
    return { data: { consumed: false, skipped: 'no_pool' }, error: null };
  }

  // 2) Bolsas elegibles (FIFO)
  const poolsRes = await findActivePoolsForBookingProperty({
    bookingStartDate: booking.start_date,
    propertyId,
  });
  if (poolsRes.error) return { data: null, error: poolsRes.error };
  const pools = poolsRes.data ?? [];
  if (pools.length === 0) {
    return { data: { consumed: false, skipped: 'no_pool' }, error: null };
  }

  // Validar activación: ya filtramos por activated_at <= start_date, así que ok.

  // 3) Agrupar por vendor para idempotencia
  const consumedByVendor = await sumConsumedByVendorForBooking(booking.id);

  // 4) Procesar la reserva contra cada bolsa elegible (FIFO),
  //    cobrando solo lo que falta por cubrir según la regla de cada bolsa.
  const usedPoolIds: string[] = [];
  let totalUnits = 0;
  let totalCreditsUsed = 0;
  let totalMissing = 0;
  let anyConsumed = false;

  // Agrupamos bolsas por vendor para no consumir dos veces lo mismo.
  // Iteramos en orden FIFO (ya viene ordenado).
  const handledVendorKeys = new Set<string | 'null'>();
  for (const pool of pools) {
    const vendorKey: string | 'null' = pool.vendor_id ?? 'null';
    if (handledVendorKeys.has(vendorKey)) continue;

    const units = calcUnitsForBooking(booking, pool.consumption_rule, Number(pool.child_weight));
    const requested = units * Number(pool.credits_per_unit);
    const alreadyByVendor = consumedByVendor.get(vendorKey) ?? 0;
    const remaining = requested - alreadyByVendor;

    if (remaining <= 0) {
      // Esta reserva ya está cubierta para este vendor → marcamos y seguimos
      handledVendorKeys.add(vendorKey);
      continue;
    }

    // Repartir 'remaining' entre las bolsas de este vendor (FIFO).
    const vendorPools = pools.filter(p => (p.vendor_id ?? 'null') === vendorKey);
    let toCover = remaining;
    for (const p of vendorPools) {
      if (toCover <= 0) break;

      // Idempotencia por (pool, booking)
      const { data: existing } = await supabase
        .from('credit_pool_consumptions')
        .select('id, credits_used')
        .eq('pool_id', p.id)
        .eq('booking_id', booking.id)
        .maybeSingle();
      if (existing) continue;

      const available = Number(p.credits_total) - Number(p.credits_used);
      if (available <= 0) continue;
      const toUse = Math.min(toCover, available);
      const snapshot = unitPriceOf(p);

      const { error: cErr } = await supabase
        .from('credit_pool_consumptions')
        .insert({
          owner_id: user.id,
          pool_id: p.id,
          booking_id: booking.id,
          units: units * (toUse / requested), // unidades proporcionales
          credits_used: toUse,
          occurred_at: todayISO(),
          unit_price_snapshot: snapshot,
          notes: vendorPools.length > 1 ? `Split FIFO con otras bolsas de ${vendorKey === 'null' ? 'la cobertura' : 'este proveedor'}.` : null,
        });
      if (cErr) return { data: null, error: cErr.message };

      const newUsed = Number(p.credits_used) + toUse;
      const newStatus = newUsed >= Number(p.credits_total) ? 'depleted' : p.status;
      await supabase.from('credit_pools')
        .update({ credits_used: newUsed, status: newStatus })
        .eq('id', p.id);

      usedPoolIds.push(p.id);
      totalCreditsUsed += toUse;
      totalUnits += units * (toUse / requested);
      anyConsumed = true;
      toCover -= toUse;
    }

    if (toCover > 0) {
      // Quedó sin cubrir → sugerir recarga
      totalMissing += toCover;
      const refPool = vendorPools[0];
      const unitPrice = unitPriceOf(refPool);
      const suggested = Math.round(toCover * unitPrice);
      await supabase.from('expenses').insert({
        owner_id: user.id,
        property_id: null,
        category: 'Seguros',
        type: 'variable' as const,
        amount: suggested,
        currency: 'COP',
        date: todayISO(),
        description: `Recarga sugerida de créditos · ${refPool.name} (faltan ${toCover.toFixed(0)} créditos)`,
        status: 'pending' as const,
        bank_account_id: null,
        booking_id: null,
        vendor: refPool.name,
        person_in_charge: null,
        adjustment_id: null,
        vendor_id: refPool.vendor_id ?? null,
        shared_bill_id: null,
        subcategory: null,
        expense_group_id: null,
      });
    }

    handledVendorKeys.add(vendorKey);
  }

  if (!anyConsumed) {
    return { data: { consumed: false, skipped: 'already_consumed' }, error: null };
  }

  return {
    data: {
      consumed: true,
      pool_ids: usedPoolIds,
      units: totalUnits,
      credits_used: totalCreditsUsed,
      credits_missing: totalMissing,
      insufficient: totalMissing > 0,
    },
    error: null,
  };
};

// ─── Backfill al crear/recargar una bolsa ────────────────────────────────────

/**
 * Recorre reservas no canceladas con start_date en [pool.activated_at, hoy] de
 * las propiedades cubiertas por la bolsa y dispara `consumeCreditsForCheckin`.
 * La idempotencia por vendor evita duplicar consumos cuando otra bolsa del
 * mismo vendor ya cubrió la reserva.
 */
export const backfillConsumptionsForPool = async (
  poolId: string,
): Promise<{ processed: number; consumed: number; errors: string[] }> => {
  const errors: string[] = [];
  const { data: pool, error: pErr } = await supabase
    .from('credit_pools')
    .select('*')
    .eq('id', poolId)
    .single();
  if (pErr || !pool) return { processed: 0, consumed: 0, errors: [pErr?.message ?? 'pool not found'] };

  const covered = await resolvePoolProperties(pool);
  if (covered.length === 0) return { processed: 0, consumed: 0, errors: [] };

  const { data: listings } = await supabase
    .from('listings')
    .select('id, property_id')
    .in('property_id', covered);
  const listingIds = (listings ?? []).map(l => l.id);
  if (listingIds.length === 0) return { processed: 0, consumed: 0, errors: [] };

  const today = todayISO();
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, status, checkin_done')
    .in('listing_id', listingIds)
    .gte('start_date', pool.activated_at)
    .lte('start_date', today)
    .limit(1000);
  if (bErr) return { processed: 0, consumed: 0, errors: [bErr.message] };

  let processed = 0, consumed = 0;
  for (const b of bookings ?? []) {
    if ((b.status ?? '').toLowerCase().includes('cancel')) continue;
    if (!b.checkin_done) {
      const upd = await supabase.from('bookings').update({ checkin_done: true }).eq('id', b.id);
      if (upd.error) { errors.push(`${b.id}: ${upd.error.message}`); continue; }
    }
    processed++;
    const cr = await consumeCreditsForCheckin(b.id);
    if (cr.error) errors.push(`${b.id}: ${cr.error}`);
    else if (cr.data?.consumed) consumed++;
  }
  return { processed, consumed, errors };
};

// ─── Atribución de costo por propiedad ───────────────────────────────────────

export interface PoolCostByPropertyRow {
  property_id: string;
  pool_id: string;
  vendor_id: string | null;
  pool_name: string;
  credits: number;
  cost_cop: number;
  consumptions: number;
}

/**
 * Agrega el costo en COP de las bolsas atribuido a cada propiedad en un rango.
 * Usa unit_price_snapshot cuando existe; si no, deriva del pool actual.
 *
 * Nota: este resultado es INFORMATIVO y no se persiste en `expenses` para
 * evitar doble contabilidad — el COP real ya salió por el expense de compra
 * de la bolsa.
 */
export const getCreditPoolCostByProperty = async (opts: {
  from?: string;
  to?: string;
  propertyId?: string;
  vendorId?: string;
  /**
   * Si `true`, incluye consumos de bolsas archivadas. Por defecto se excluyen
   * para no ensuciar el panel de atribución con bolsas que el usuario ya retiró.
   * El historial real (`expenses` de compra) no se ve afectado.
   */
  includeArchived?: boolean;
} = {}): Promise<ServiceResult<PoolCostByPropertyRow[]>> => {
  let q = supabase
    .from('credit_pool_consumptions')
    .select('id, units, credits_used, occurred_at, unit_price_snapshot, pool_id, booking_id');
  if (opts.from) q = q.gte('occurred_at', opts.from);
  if (opts.to)   q = q.lte('occurred_at', opts.to);
  const { data: rawConsumptions, error } = await q;
  if (error) return { data: null, error: error.message };

  type ConsRow = {
    credits_used: number;
    unit_price_snapshot: number | null;
    pool_id: string;
    booking_id: string;
  };
  const consumptions = (rawConsumptions ?? []) as ConsRow[];
  if (consumptions.length === 0) return { data: [], error: null };

  const poolIds = [...new Set(consumptions.map(r => r.pool_id))];
  const bookingIds = [...new Set(consumptions.map(r => r.booking_id))];

  let poolsQuery = supabase
    .from('credit_pools')
    .select('id, name, vendor_id, total_price, credits_total, status')
    .in('id', poolIds);
  if (!opts.includeArchived) {
    poolsQuery = poolsQuery.neq('status', 'archived');
  }
  const { data: poolsData } = await poolsQuery;
  const poolsById = new Map<string, { id: string; name: string; vendor_id: string | null; total_price: number; credits_total: number; status: string }>();
  for (const p of (poolsData ?? []) as Array<{ id: string; name: string; vendor_id: string | null; total_price: number; credits_total: number; status: string }>) {
    poolsById.set(p.id, p);
  }

  const { data: bookingsData } = await supabase
    .from('bookings')
    .select('id, listing_id')
    .in('id', bookingIds);
  const listingIds = [...new Set((bookingsData ?? []).map(b => b.listing_id))];
  const bookingListing = new Map<string, string>();
  for (const b of (bookingsData ?? []) as Array<{ id: string; listing_id: string }>) {
    bookingListing.set(b.id, b.listing_id);
  }

  const { data: listingsData } = await supabase
    .from('listings')
    .select('id, property_id')
    .in('id', listingIds);
  const listingProperty = new Map<string, string>();
  for (const l of (listingsData ?? []) as Array<{ id: string; property_id: string }>) {
    listingProperty.set(l.id, l.property_id);
  }

  const buckets = new Map<string, PoolCostByPropertyRow>();
  for (const r of consumptions) {
    const pool = poolsById.get(r.pool_id);
    if (!pool) continue;
    const listingId = bookingListing.get(r.booking_id);
    if (!listingId) continue;
    const propertyId = listingProperty.get(listingId);
    if (!propertyId) continue;

    if (opts.propertyId && opts.propertyId !== propertyId) continue;
    if (opts.vendorId && opts.vendorId !== pool.vendor_id) continue;

    const credits = Number(r.credits_used);
    // Fallback de precio: si el snapshot es null O 0 (bolsa mal configurada al
    // momento del consumo), usar el precio actual del pool. Esto sólo aplica
    // a consumos que históricamente quedaron sin precio válido — un snapshot
    // legítimo positivo siempre prevalece.
    const snapshotRaw = r.unit_price_snapshot != null ? Number(r.unit_price_snapshot) : null;
    const fallback = Number(pool.credits_total) > 0 ? Number(pool.total_price) / Number(pool.credits_total) : 0;
    const unitPrice = snapshotRaw != null && snapshotRaw > 0 ? snapshotRaw : fallback;
    const cost = credits * unitPrice;

    const key = `${propertyId}::${pool.id}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.credits += credits;
      existing.cost_cop += cost;
      existing.consumptions += 1;
    } else {
      buckets.set(key, {
        property_id: propertyId,
        pool_id: pool.id,
        vendor_id: pool.vendor_id,
        pool_name: pool.name,
        credits,
        cost_cop: cost,
        consumptions: 1,
      });
    }
  }
  return { data: [...buckets.values()], error: null };
};

// ─── Auto check-in nocturno (lazy en frontend) ───────────────────────────────

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

// ─── Cotizador (sin escribir nada) ───────────────────────────────────────────

export interface QuoteForBookingResult {
  pool: CreditPoolRow | null;
  units: number;
  credits: number;
  unit_price: number;
  cost_cop: number;
}

/**
 * Cotiza cuánto costaría la bolsa para una reserva (sin escribir). Devuelve
 * pool=null si no hay bolsa elegible.
 */
export const quoteBookingPoolCost = async (opts: {
  bookingStartDate: string;
  propertyId: string;
  num_adults: number;
  num_children: number;
  num_nights: number;
}): Promise<ServiceResult<QuoteForBookingResult>> => {
  const res = await findActivePoolsForBookingProperty({
    bookingStartDate: opts.bookingStartDate,
    propertyId: opts.propertyId,
  });
  if (res.error) return { data: null, error: res.error };
  const pool = (res.data ?? [])[0] ?? null;
  if (!pool) {
    return { data: { pool: null, units: 0, credits: 0, unit_price: 0, cost_cop: 0 }, error: null };
  }
  const units = calcUnitsForBooking(opts, pool.consumption_rule, Number(pool.child_weight));
  const credits = units * Number(pool.credits_per_unit);
  const unit_price = unitPriceOf(pool);
  return {
    data: {
      pool,
      units,
      credits,
      unit_price,
      cost_cop: credits * unit_price,
    },
    error: null,
  };
};
