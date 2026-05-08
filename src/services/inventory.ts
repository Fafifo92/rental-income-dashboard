import { supabase } from '@/lib/supabase/client';
import { todayISO } from '@/lib/dateUtils';
import type { ServiceResult } from './expenses';
import type {
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryItemStatus,
  InventoryMovementRow,
  InventoryMovementType,
} from '@/types/database';

// ──────────────────────────────────────────────────────────────────────────
// Categorías
// ──────────────────────────────────────────────────────────────────────────

export const DEFAULT_CATEGORIES: Array<{ name: string; icon: string }> = [
  { name: 'Mueble',           icon: '🛋️' },
  { name: 'Electrodoméstico', icon: '🔌' },
  { name: 'Utensilio',        icon: '🍴' },
  { name: 'Lencería',         icon: '🛏️' },
  { name: 'Decoración',       icon: '🖼️' },
  { name: 'Otro',             icon: '📦' },
];

export const listInventoryCategories = async (): Promise<ServiceResult<InventoryCategoryRow[]>> => {
  const { data, error } = await supabase
    .from('inventory_categories')
    .select('*')
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

/** Si no existen categorías, crea las default para el usuario actual. */
export const ensureDefaultCategories = async (): Promise<ServiceResult<InventoryCategoryRow[]>> => {
  const list = await listInventoryCategories();
  if (list.error || !list.data) return list;

  // Limpieza retroactiva: eliminar la antigua categoría "Insumo de aseo" si
  // ya no tiene items asociados. Si tiene items, los dejamos para no borrar
  // datos del usuario y que pueda re-asignarlos manualmente.
  const legacy = list.data.find(c => c.name.trim().toLowerCase() === 'insumo de aseo');
  if (legacy) {
    const { count, error: countErr } = await supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', legacy.id);
    if (countErr) return list;  // can't verify count — skip cleanup, return original list
    if (!count || count === 0) {
      await supabase.from('inventory_categories').delete().eq('id', legacy.id);
    }
  }

  // Re-listar tras posible borrado
  const refreshed = legacy ? await listInventoryCategories() : list;
  if (refreshed.error || !refreshed.data) return refreshed;
  if (refreshed.data.length > 0) return refreshed;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const rows = DEFAULT_CATEGORIES.map(c => ({ owner_id: user.id, name: c.name, icon: c.icon }));
  const ins = await supabase.from('inventory_categories').insert(rows).select();
  if (ins.error) return { data: null, error: ins.error.message };
  return { data: ins.data ?? [], error: null };
};

export const createInventoryCategory = async (
  name: string,
  icon?: string | null,
): Promise<ServiceResult<InventoryCategoryRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  const trimmed = name.trim();
  if (!trimmed) return { data: null, error: 'Nombre requerido' };
  const { data, error } = await supabase
    .from('inventory_categories')
    .insert({ owner_id: user.id, name: trimmed, icon: icon ?? null })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteInventoryCategory = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('inventory_categories').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

// ──────────────────────────────────────────────────────────────────────────
// Items
// ──────────────────────────────────────────────────────────────────────────

export interface InventoryItem extends InventoryItemRow {
  category?: InventoryCategoryRow | null;
}

export interface InventoryItemFilters {
  property_ids?: string[];
  category_id?: string | null;
  status?: InventoryItemStatus | null;
  is_consumable?: boolean | null;
  search?: string;
}

export const listInventoryItems = async (
  filters: InventoryItemFilters = {},
): Promise<ServiceResult<InventoryItemRow[]>> => {
  let q = supabase.from('inventory_items').select('*').order('updated_at', { ascending: false });
  if (filters.property_ids && filters.property_ids.length > 0) q = q.in('property_id', filters.property_ids);
  if (filters.category_id !== undefined && filters.category_id !== null) q = q.eq('category_id', filters.category_id);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.is_consumable !== undefined && filters.is_consumable !== null) q = q.eq('is_consumable', filters.is_consumable);
  if (filters.search && filters.search.trim()) {
    // Escapar caracteres que rompen el filtro PostgREST (.or)
    // Ref: https://postgrest.org/en/stable/api.html#operators
    const s = filters.search.trim().replace(/[%,()]/g, ' ').replace(/\s+/g, ' ');
    if (s) {
      q = q.or(`name.ilike.%${s}%,description.ilike.%${s}%,location.ilike.%${s}%`);
    }
  }
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export type CreateInventoryItemInput = Omit<
  InventoryItemRow,
  'id' | 'owner_id' | 'created_at' | 'updated_at'
>;

export const createInventoryItem = async (
  input: CreateInventoryItemInput,
): Promise<ServiceResult<InventoryItemRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  if (!input.name?.trim()) return { data: null, error: 'Nombre requerido' };
  if (input.quantity < 0) return { data: null, error: 'Cantidad no puede ser negativa' };

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({ ...input, owner_id: user.id, name: input.name.trim() })
    .select()
    .single();
  if (error) return { data: null, error: error.message };

  // Bitácora inicial
  await supabase.from('inventory_movements').insert({
    owner_id: user.id,
    item_id: data.id,
    type: 'added',
    quantity_delta: input.quantity,
    new_status: input.status,
    notes: 'Creación de item',
    related_booking_id: null,
    related_expense_id: null,
  });

  return { data, error: null };
};

export const updateInventoryItem = async (
  id: string,
  patch: Partial<Omit<InventoryItemRow, 'id' | 'owner_id' | 'created_at' | 'updated_at'>>,
): Promise<ServiceResult<InventoryItemRow>> => {
  const { data, error } = await supabase
    .from('inventory_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteInventoryItem = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

// ──────────────────────────────────────────────────────────────────────────
// Movimientos
// ──────────────────────────────────────────────────────────────────────────

export const listInventoryMovements = async (
  itemId: string,
): Promise<ServiceResult<InventoryMovementRow[]>> => {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: data ?? [], error: null };
};

export interface RegisterMovementInput {
  item_id: string;
  type: InventoryMovementType;
  quantity_delta: number;
  new_status?: InventoryItemStatus | null;
  notes?: string | null;
  related_booking_id?: string | null;
  related_expense_id?: string | null;
}

/**
 * Registra un movimiento Y aplica el delta a la cantidad/status del item
 * en una sola operación lógica. Si la cantidad final llega a 0 en un
 * consumible, se marca status='depleted' automáticamente.
 */
export const registerInventoryMovement = async (
  input: RegisterMovementInput,
): Promise<ServiceResult<InventoryMovementRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  // 1. Lee item para calcular nuevo estado
  const { data: item, error: getErr } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('id', input.item_id)
    .single();
  if (getErr || !item) return { data: null, error: getErr?.message ?? 'Item no encontrado' };

  const currentQty = Number(item.quantity) || 0;
  const newQty = Math.max(0, currentQty + (input.quantity_delta || 0));

  let nextStatus: InventoryItemStatus = input.new_status ?? item.status;
  if (item.is_consumable && newQty === 0 && nextStatus === 'good') {
    nextStatus = 'depleted';
  }

  // 2. Inserta el movimiento
  const { data: mov, error: movErr } = await supabase
    .from('inventory_movements')
    .insert({
      owner_id: user.id,
      item_id: input.item_id,
      type: input.type,
      quantity_delta: input.quantity_delta,
      new_status: input.new_status ?? null,
      notes: input.notes ?? null,
      related_booking_id: input.related_booking_id ?? null,
      related_expense_id: input.related_expense_id ?? null,
    })
    .select()
    .single();
  if (movErr) return { data: null, error: movErr.message };

  // 3. Actualiza el item
  const { error: upErr } = await supabase
    .from('inventory_items')
    .update({ quantity: newQty, status: nextStatus })
    .eq('id', input.item_id);
  if (upErr) return { data: null, error: upErr.message };

  return { data: mov, error: null };
};

// ──────────────────────────────────────────────────────────────────────────
// Reporte de daño orquestado (Bloque 13 — flujo simplificado para el usuario)
// ──────────────────────────────────────────────────────────────────────────
//
// Un solo paso atómico que conecta inventario ↔ gastos ↔ reservas:
//   1. (Opcional) Crea booking_adjustment kind='damage_charge' si el usuario
//      dice "Sí, voy a cobrarle al huésped/plataforma este daño".
//   2. Crea un expense status='pending' (Cuenta por Pagar) con category
//      'Reparación inventario', amount=repair_cost, atado a property + booking
//      + adjustment (si existe). Es el "queda pendiente repararlo" que el
//      usuario ve en /expenses.
//   3. Marca el item como damaged y registra inventory_movement type='damaged'
//      vinculado a booking + expense.
//
// Si algo falla a mitad, devuelve error sin hacer rollback (Supabase no soporta
// transacciones cliente). El orden minimiza inconsistencias: primero el ajuste,
// luego el gasto que lo referencia, luego el movimiento que referencia el gasto.

export interface ReportDamageInput {
  /** Item del inventario afectado. `null` cuando el daño es a la propiedad/estructura (no inventariada). */
  item_id: string | null;
  /** Nombre del item. Cuando `item_id=null` es el texto libre (ej. "Pared sala", "Estufa"). */
  item_name: string;
  property_id: string;
  booking_id: string | null;
  repair_cost: number;
  description: string | null;
  charge_to_guest: boolean;
  charge_amount: number | null;
  /** Cobro al huésped directamente (depósito/efectivo). */
  charge_from_guest?: number | null;
  /** Cobro a la plataforma (Airbnb resolution center, Booking.com, etc.). */
  charge_from_platform?: number | null;
  date?: string;
}

export interface ReportDamageResult {
  expense_id: string | null;
  movement_id: string | null;
  adjustment_id: string | null;
  /** True cuando se reusó un expense pendiente ya existente (idempotencia). */
  reused_existing?: boolean;
}

export const reportItemDamage = async (
  input: ReportDamageInput,
): Promise<ServiceResult<ReportDamageResult>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  if (input.repair_cost < 0) return { data: null, error: 'Costo de reparación inválido' };
  if (!input.item_id && !input.item_name?.trim()) {
    return { data: null, error: 'Especifica el item del inventario o describe qué se dañó (pared, estufa, etc.).' };
  }

  const today = input.date ?? todayISO();

  // 0. Guard de idempotencia: ¿ya existe un expense de daño pendiente para
  //    esta misma combinación (item|sujeto)?
  //    Evita duplicados cuando el usuario clickea dos veces o entra por dos vías.
  {
    const subjectKey = input.item_id ? `__item:${input.item_id}` : `__subject:${input.item_name.trim().toLowerCase()}`;
    let idempCheck = supabase
      .from('expenses')
      .select('id, description, status, adjustment_id')
      .eq('subcategory', 'damage')
      .in('status', ['pending', 'partial']);
    if (input.booking_id) idempCheck = idempCheck.eq('booking_id', input.booking_id);
    const { data: existing } = await idempCheck;
    const dup = (existing ?? []).find(e =>
      typeof e.description === 'string' && e.description.includes(subjectKey),
    );
    if (dup) {
      return {
        data: null,
        error: `Ya existe un gasto pendiente de daño para este item. Edítalo en /expenses.`,
      };
    }
  }

  // 1. Adjustment(s) — uno por fuente cuando se especifican guest y platform
  //    por separado. `charge_amount` legacy sigue funcionando como suma única.
  let adjustmentId: string | null = null;
  const adjustments: { id: string; source: 'guest' | 'platform' | 'combined' }[] = [];
  if (input.charge_to_guest && input.booking_id) {
    const fromGuest = Number(input.charge_from_guest ?? 0);
    const fromPlatform = Number(input.charge_from_platform ?? 0);
    const splitProvided = (input.charge_from_guest != null) || (input.charge_from_platform != null);

    const sources: { amount: number; source: 'guest' | 'platform' | 'combined' }[] = splitProvided
      ? [
          { amount: fromGuest,    source: 'guest' as const },
          { amount: fromPlatform, source: 'platform' as const },
        ].filter(s => s.amount > 0)
      : [{ amount: input.charge_amount ?? input.repair_cost, source: 'combined' as const }];

    for (const s of sources) {
      if (s.amount <= 0) continue;
      const sourceLabel = s.source === 'guest' ? 'Cobro huésped' : s.source === 'platform' ? 'Cobro plataforma' : 'Cobro';
      const adj = await supabase
        .from('booking_adjustments')
        .insert({
          booking_id: input.booking_id,
          kind: 'damage_charge',
          amount: s.amount,
          description: `${sourceLabel} – Daño: ${input.item_name}${input.description ? ' — ' + input.description : ''}`,
          date: today,
          bank_account_id: null,
        })
        .select()
        .single();
      if (adj.error) return { data: null, error: adj.error.message };
      adjustments.push({ id: adj.data.id, source: s.source });
    }
    adjustmentId = adjustments[0]?.id ?? null;
  }

  // Subject key embebido en la descripción para idempotencia futura.
  const subjectTag = input.item_id ? `__item:${input.item_id}` : `__subject:${input.item_name.trim().toLowerCase()}`;
  const visibleDesc = input.item_id
    ? `Reposición/reparación: ${input.item_name}${input.description ? ' — ' + input.description : ''}`
    : `Daño en propiedad: ${input.item_name}${input.description ? ' — ' + input.description : ''}`;

  // 2. Pending expense (si hay costo > 0)
  let expenseId: string | null = null;
  if (input.repair_cost > 0) {
    const { createExpense } = await import('./expenses');
    const exp = await createExpense({
      property_id: input.property_id,
      category: input.item_id ? 'Reparación inventario' : 'Reparación propiedad',
      subcategory: 'damage',
      type: 'variable',
      amount: input.repair_cost,
      date: today,
      description: `${visibleDesc} ${subjectTag}`,
      status: 'pending',
      bank_account_id: null,
      vendor: null,
      person_in_charge: null,
      booking_id: input.booking_id,
      adjustment_id: adjustmentId,
      vendor_id: null,
      shared_bill_id: null,
      expense_group_id: null,
    });
    if (exp.error || !exp.data) return { data: null, error: exp.error ?? 'No se pudo crear el gasto' };
    expenseId = exp.data.id;
  }

  // 3. Inventory movement + actualizar status del item — solo si hay item de inventario.
  let movementId: string | null = null;
  if (input.item_id) {
    const mov = await supabase
      .from('inventory_movements')
      .insert({
        owner_id: user.id,
        item_id: input.item_id,
        type: 'damaged',
        quantity_delta: 0,
        new_status: 'damaged',
        notes: input.description,
        related_booking_id: input.booking_id,
        related_expense_id: expenseId,
      })
      .select()
      .single();
    if (mov.error) return { data: null, error: mov.error.message };
    movementId = mov.data.id;

    const upd = await supabase
      .from('inventory_items')
      .update({ status: 'damaged' })
      .eq('id', input.item_id);
    if (upd.error) return { data: null, error: upd.error.message };
  }

  return {
    data: { expense_id: expenseId, movement_id: movementId, adjustment_id: adjustmentId },
    error: null,
  };
};

/** Alias semánticamente más correcto. `reportItemDamage` se mantiene por compatibilidad. */
export const reportDamage = reportItemDamage;

// ──────────────────────────────────────────────────────────────────────────
// KPIs / agregados
// ──────────────────────────────────────────────────────────────────────────

/**
 * Bloque 14C — cuando un gasto de "Reparación inventario" se marca como
 * pagado, marcamos el item asociado como reparado (status='good') y dejamos
 * un movimiento `repaired` en la bitácora.
 *
 * Idempotente: si el item ya está en good y ya existe un movimiento `repaired`
 * para ese expense, no hace nada.
 */
export const markDamageRepairedFromExpense = async (
  expenseId: string,
): Promise<ServiceResult<{ items: number; movements: number }>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  // Encontrar movimientos `damaged` ligados a este expense
  const { data: damagedMovs, error: e1 } = await supabase
    .from('inventory_movements')
    .select('id, item_id')
    .eq('related_expense_id', expenseId)
    .eq('type', 'damaged');
  if (e1) return { data: null, error: e1.message };
  if (!damagedMovs || damagedMovs.length === 0) {
    return { data: { items: 0, movements: 0 }, error: null };
  }

  // Verificar si ya existe un movimiento `repaired` para este expense (idempotencia)
  const { data: existingRepaired } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('related_expense_id', expenseId)
    .eq('type', 'repaired');
  if (existingRepaired && existingRepaired.length > 0) {
    return { data: { items: 0, movements: 0 }, error: null };
  }

  let movementsCreated = 0;
  let itemsUpdated = 0;
  for (const mov of damagedMovs) {
    const { error: e2 } = await supabase.from('inventory_movements').insert({
      owner_id: user.id,
      item_id: mov.item_id,
      type: 'repaired',
      quantity_delta: 0,
      new_status: 'good',
      notes: 'Reparación marcada automáticamente al pagar el gasto.',
      related_expense_id: expenseId,
      related_booking_id: null,
    });
    if (!e2) movementsCreated++;
    const { error: e3 } = await supabase
      .from('inventory_items')
      .update({ status: 'good' })
      .eq('id', mov.item_id);
    if (!e3) itemsUpdated++;
  }

  return { data: { items: itemsUpdated, movements: movementsCreated }, error: null };
};

// ---------- Bloque 14B — Reconciliación de daños ----------
// No requiere tabla nueva: derivamos del cruce
//   inventory_movements (type=damaged) → expenses (costo) → booking_adjustments (cobrado)
//   y movements (type=repaired) que indican que el daño está cerrado en inventario.
export type DamageReconciliationStatus =
  | 'balanced'         // |diff| <= 1 (cobré igual a lo que costó)
  | 'pending_recovery' // diff < 0 (cobré menos de lo que costó — falta recuperar)
  | 'overpaid'         // diff > 0 (cobré de más — sobra plata)
  | 'no_charge'        // no hubo adjustment (asumido por el negocio)
  | 'pending_repair';  // ni siquiera se ha pagado el expense (no hay nada qué reconciliar aún)

export interface DamageReconciliation {
  movement_id: string;
  item_id: string;
  item_name: string;
  property_id: string | null;
  property_name: string | null;
  booking_id: string | null;
  booking_code: string | null;
  guest_name: string | null;
  damage_date: string;            // movement.created_at
  description: string | null;
  expense_id: string | null;
  expense_status: 'pending' | 'paid' | null;
  repair_cost: number;            // expense.amount
  adjustment_id: string | null;
  charged_to_guest: number;       // booking_adjustments.amount (damage_charge)
  diff: number;                   // charged - repair_cost
  status: DamageReconciliationStatus;
  is_repaired: boolean;           // existe movement repaired posterior
}

export const getDamageReconciliations = async (): Promise<ServiceResult<DamageReconciliation[]>> => {
  // 1) Movements de tipo damaged
  const { data: damaged, error: e1 } = await supabase
    .from('inventory_movements')
    .select('id, item_id, related_expense_id, related_booking_id, notes, created_at')
    .eq('type', 'damaged')
    .order('created_at', { ascending: false });
  if (e1) return { data: null, error: e1.message };
  const dmg = (damaged ?? []) as Array<{
    id: string; item_id: string; related_expense_id: string | null;
    related_booking_id: string | null; notes: string | null; created_at: string;
  }>;
  if (dmg.length === 0) return { data: [], error: null };

  // 2) Movements repaired (para saber qué daños ya están cerrados en inventario)
  const itemIds = Array.from(new Set(dmg.map(d => d.item_id)));
  const { data: repaired, error: e2 } = await supabase
    .from('inventory_movements')
    .select('item_id, related_expense_id, created_at')
    .eq('type', 'repaired')
    .in('item_id', itemIds);
  if (e2) return { data: null, error: e2.message };
  const repairedByExpense = new Set(
    ((repaired ?? []) as Array<{ related_expense_id: string | null }>)
      .map(r => r.related_expense_id).filter((x): x is string => !!x),
  );

  // 3) Items
  const { data: itemsData, error: e3 } = await supabase
    .from('inventory_items')
    .select('id, name, property_id')
    .in('id', itemIds);
  if (e3) return { data: null, error: e3.message };
  type ItemMini = { id: string; name: string; property_id: string | null };
  const itemMap = new Map(((itemsData ?? []) as ItemMini[]).map(i => [i.id, i]));

  // 4) Properties
  const propIds = Array.from(new Set(((itemsData ?? []) as ItemMini[]).map(i => i.property_id).filter((x): x is string => !!x)));
  let propMap = new Map<string, { id: string; name: string }>();
  if (propIds.length > 0) {
    const { data: pData, error: e4 } = await supabase.from('properties').select('id, name').in('id', propIds);
    if (e4) return { data: null, error: e4.message };
    propMap = new Map(((pData ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p]));
  }

  // 5) Expenses (costo real)
  const expenseIds = Array.from(new Set(dmg.map(d => d.related_expense_id).filter((x): x is string => !!x)));
  type ExpenseMini = { id: string; amount: number; status: 'pending' | 'paid'; adjustment_id: string | null };
  let expenseMap = new Map<string, ExpenseMini>();
  if (expenseIds.length > 0) {
    const { data: eData, error: e5 } = await supabase
      .from('expenses')
      .select('id, amount, status, adjustment_id')
      .in('id', expenseIds);
    if (e5) return { data: null, error: e5.message };
    expenseMap = new Map(((eData ?? []) as ExpenseMini[]).map(e => [e.id, { ...e, amount: Number(e.amount) }]));
  }

  // 6) Adjustments (cobrado)
  const adjIds = Array.from(new Set(
    Array.from(expenseMap.values()).map(e => e.adjustment_id).filter((x): x is string => !!x),
  ));
  type AdjMini = { id: string; amount: number };
  let adjMap = new Map<string, AdjMini>();
  if (adjIds.length > 0) {
    const { data: aData, error: e6 } = await supabase
      .from('booking_adjustments')
      .select('id, amount')
      .in('id', adjIds);
    if (e6) return { data: null, error: e6.message };
    adjMap = new Map(((aData ?? []) as AdjMini[]).map(a => [a.id, { ...a, amount: Number(a.amount) }]));
  }

  // 7) Bookings (código + huésped)
  const bookingIds = Array.from(new Set(dmg.map(d => d.related_booking_id).filter((x): x is string => !!x)));
  type BkMini = { id: string; confirmation_code: string | null; guest_name: string | null };
  let bookingMap = new Map<string, BkMini>();
  if (bookingIds.length > 0) {
    const { data: bData, error: e7 } = await supabase
      .from('bookings')
      .select('id, confirmation_code, guest_name')
      .in('id', bookingIds);
    if (e7) return { data: null, error: e7.message };
    bookingMap = new Map(((bData ?? []) as BkMini[]).map(b => [b.id, b]));
  }

  // Cruce final
  const out: DamageReconciliation[] = dmg.map(d => {
    const item = itemMap.get(d.item_id);
    const property = item?.property_id ? propMap.get(item.property_id) ?? null : null;
    const booking = d.related_booking_id ? bookingMap.get(d.related_booking_id) ?? null : null;
    const expense = d.related_expense_id ? expenseMap.get(d.related_expense_id) ?? null : null;
    const adjustment = expense?.adjustment_id ? adjMap.get(expense.adjustment_id) ?? null : null;

    const repair_cost = expense?.amount ?? 0;
    const charged = adjustment?.amount ?? 0;
    const diff = charged - repair_cost;
    const is_repaired = d.related_expense_id ? repairedByExpense.has(d.related_expense_id) : false;

    let status: DamageReconciliationStatus;
    if (!expense || expense.status !== 'paid') status = 'pending_repair';
    else if (!adjustment) status = 'no_charge';
    else if (Math.abs(diff) <= 1) status = 'balanced';
    else if (diff < 0) status = 'pending_recovery';
    else status = 'overpaid';

    return {
      movement_id: d.id,
      item_id: d.item_id,
      item_name: item?.name ?? '(item eliminado)',
      property_id: property?.id ?? null,
      property_name: property?.name ?? null,
      booking_id: d.related_booking_id,
      booking_code: booking?.confirmation_code ?? null,
      guest_name: booking?.guest_name ?? null,
      damage_date: d.created_at,
      description: d.notes,
      expense_id: d.related_expense_id,
      expense_status: expense?.status ?? null,
      repair_cost,
      adjustment_id: expense?.adjustment_id ?? null,
      charged_to_guest: charged,
      diff,
      status,
      is_repaired,
    };
  });

  return { data: out, error: null };
};

/**
 * Bloque 18 — Registrar recuperación de un daño.
 *
 * - Si ya existe un adjustment damage_charge ligado al expense, lo reemplaza
 *   (suma el monto previo + el nuevo recovery → audit trail en description).
 * - Si no existe, crea uno nuevo y lo enlaza con `expense.adjustment_id`.
 * - Marca a qué `bank_account_id` cayó la plata para que el saldo del banco
 *   refleje el ingreso.
 */
export interface RecoverDamageInput {
  expense_id: string;
  booking_id: string;
  amount: number;             // monto recuperado en este movimiento
  bank_account_id: string;    // requerido — a qué cuenta cayó
  date: string;               // YYYY-MM-DD
  notes?: string | null;
}

export const recoverDamageAmount = async (
  input: RecoverDamageInput,
): Promise<ServiceResult<{ adjustment_id: string }>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  // Leer expense + adjustment previo si lo hay
  const { data: exp, error: eExp } = await supabase
    .from('expenses')
    .select('id, amount, adjustment_id')
    .eq('id', input.expense_id)
    .single();
  if (eExp) return { data: null, error: eExp.message };

  let adjustmentId = (exp?.adjustment_id ?? null) as string | null;
  const datedDescBase = `Recuperación de daño · ${input.date}`;
  const fullDesc = input.notes ? `${datedDescBase} — ${input.notes}` : datedDescBase;

  if (adjustmentId) {
    // Sumar el nuevo monto al existente
    const { data: prev, error: ePrev } = await supabase
      .from('booking_adjustments')
      .select('amount, description')
      .eq('id', adjustmentId)
      .single();
    if (ePrev) return { data: null, error: ePrev.message };
    const newAmount = Number(prev?.amount ?? 0) + Number(input.amount);
    const mergedDesc = [prev?.description, fullDesc].filter(Boolean).join(' | ');
    const { error: eUpd } = await supabase
      .from('booking_adjustments')
      .update({
        amount: newAmount,
        description: mergedDesc,
        bank_account_id: input.bank_account_id,
        date: input.date,
      })
      .eq('id', adjustmentId);
    if (eUpd) return { data: null, error: eUpd.message };
  } else {
    const { data: created, error: eIns } = await supabase
      .from('booking_adjustments')
      .insert({
        booking_id: input.booking_id,
        kind: 'damage_charge',
        amount: input.amount,
        description: fullDesc,
        date: input.date,
        bank_account_id: input.bank_account_id,
      })
      .select('id')
      .single();
    if (eIns) return { data: null, error: eIns.message };
    adjustmentId = (created as { id: string }).id;

    const { error: eLink } = await supabase
      .from('expenses')
      .update({ adjustment_id: adjustmentId })
      .eq('id', input.expense_id);
    if (eLink) return { data: null, error: eLink.message };
  }

  return { data: { adjustment_id: adjustmentId }, error: null };
};

export interface InventoryKpis {
  totalItems: number;
  damaged: number;
  needsMaintenance: number;
  lowStock: number;            // is_consumable && quantity <= min_stock
  depleted: number;            // is_consumable && quantity === 0
  estimatedValue: number;      // sum(quantity * purchase_price) si hay precio
}

export const computeInventoryKpis = (items: InventoryItemRow[]): InventoryKpis => {
  let damaged = 0, needs = 0, low = 0, depleted = 0, value = 0;
  for (const it of items) {
    const q = Number(it.quantity) || 0;
    const min = Number(it.min_stock) || 0;
    const price = Number(it.purchase_price) || 0;
    if (it.status === 'damaged') damaged++;
    if (it.status === 'needs_maintenance') needs++;
    if (it.status === 'depleted') depleted++;
    if (it.is_consumable && it.min_stock !== null && q <= min && q > 0) low++;
    if (price > 0) value += q * price;
  }
  return {
    totalItems: items.length,
    damaged,
    needsMaintenance: needs,
    lowStock: low,
    depleted,
    estimatedValue: value,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ──────────────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<InventoryItemStatus, string> = {
  good:               'Bueno',
  needs_maintenance:  'Mantenimiento',
  damaged:            'Dañado',
  lost:               'Perdido',
  depleted:           'Agotado',
  end_of_life:        'Vida útil cumplida',
};

export const STATUS_STYLE: Record<InventoryItemStatus, string> = {
  good:               'bg-emerald-100 text-emerald-700',
  needs_maintenance:  'bg-amber-100 text-amber-700',
  damaged:            'bg-rose-100 text-rose-700',
  lost:               'bg-slate-200 text-slate-700',
  depleted:           'bg-orange-100 text-orange-700',
  end_of_life:        'bg-purple-100 text-purple-700',
};

export const MOVEMENT_LABEL: Record<InventoryMovementType, string> = {
  added:         'Agregado',
  used:          'Usado',
  damaged:       'Dañado',
  repaired:      'Reparado',
  restocked:     'Repuesto',
  discarded:     'Descartado',
  lost:          'Perdido',
  status_change: 'Cambio de estado',
};

// ──────────────────────────────────────────────────────────────────────────
// Vida útil — detección y gestión
// ──────────────────────────────────────────────────────────────────────────

/** Items que superaron su vida útil estimada y aún no tienen status end_of_life. */
export const getEndOfLifeItems = async (): Promise<ServiceResult<InventoryItemRow[]>> => {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .in('status', ['good', 'needs_maintenance'])
    .not('purchase_date', 'is', null)
    .not('expected_lifetime_months', 'is', null);
  if (error) return { data: null, error: error.message };
  const expired = (data ?? []).filter(it => {
    if (!it.purchase_date || !it.expected_lifetime_months) return false;
    const expiry = new Date(it.purchase_date);
    expiry.setMonth(expiry.getMonth() + Number(it.expected_lifetime_months));
    return expiry.toISOString().slice(0, 10) <= today;
  });
  return { data: expired, error: null };
};

/**
 * Marca un item como 'end_of_life' y registra el movimiento de bitácora.
 * Idempotente: si ya está en end_of_life no hace nada.
 */
export const markEndOfLife = async (id: string): Promise<ServiceResult<true>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { data: item, error: ge } = await supabase
    .from('inventory_items').select('status').eq('id', id).single();
  if (ge || !item) return { data: null, error: ge?.message ?? 'Item no encontrado' };
  if (item.status === 'end_of_life') return { data: true, error: null };

  const { error: ue } = await supabase
    .from('inventory_items').update({ status: 'end_of_life' }).eq('id', id);
  if (ue) return { data: null, error: ue.message };

  await supabase.from('inventory_movements').insert({
    owner_id: user.id, item_id: id, type: 'status_change',
    quantity_delta: 0, new_status: 'end_of_life',
    notes: 'Vida útil estimada cumplida.',
    related_booking_id: null, related_expense_id: null,
  });
  return { data: true, error: null };
};

/**
 * Extiende la vida útil de un item sumando `extraMonths` a
 * expected_lifetime_months. Si el item estaba en end_of_life lo
 * devuelve a 'good'. Mínimo resultante: 1 mes.
 */
export const extendUsefulLife = async (
  id: string,
  extraMonths: number,
): Promise<ServiceResult<InventoryItemRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };
  if (extraMonths <= 0) return { data: null, error: 'Meses a extender debe ser > 0' };

  const { data: item, error: ge } = await supabase
    .from('inventory_items').select('*').eq('id', id).single();
  if (ge || !item) return { data: null, error: ge?.message ?? 'Item no encontrado' };

  const currentMonths = Number(item.expected_lifetime_months) || 0;
  const newMonths = Math.max(1, currentMonths + extraMonths);
  const newStatus: InventoryItemStatus = item.status === 'end_of_life' ? 'good' : item.status;

  const { data, error: ue } = await supabase
    .from('inventory_items')
    .update({ expected_lifetime_months: newMonths, status: newStatus })
    .eq('id', id).select().single();
  if (ue || !data) return { data: null, error: ue?.message ?? 'Error al actualizar' };

  await supabase.from('inventory_movements').insert({
    owner_id: user.id, item_id: id, type: 'status_change',
    quantity_delta: 0, new_status: newStatus,
    notes: `Vida útil extendida +${extraMonths} meses (total: ${newMonths} meses).`,
    related_booking_id: null, related_expense_id: null,
  });
  return { data, error: null };
};

/**
 * Detecta automáticamente los items que superaron su vida útil y los
 * marca como end_of_life. Llamar al cargar /inventory.
 * Devuelve el número de items actualizados.
 */
export const autoMarkEndOfLife = async (): Promise<number> => {
  const res = await getEndOfLifeItems();
  if (res.error || !res.data || res.data.length === 0) return 0;
  let count = 0;
  for (const item of res.data) {
    const r = await markEndOfLife(item.id);
    if (!r.error) count++;
  }
  return count;
};
