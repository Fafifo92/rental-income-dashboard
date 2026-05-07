'use client';
/**
 * Formulario dedicado: registrar el gasto real de un mantenimiento de inventario.
 *
 * Flujo guiado en 3 pasos:
 *   1. Propiedad
 *   2. Categoría (derivada de los items disponibles en esa propiedad)
 *   3. Item + schedule vinculado (si existe)
 *   + Datos del gasto (monto, fecha, estado, banco, notas)
 *
 * Al guardar:
 *   - Crea el gasto (subcategory='maintenance')
 *   - Si hay schedule vinculado → lo marca como done (expense_registered=true)
 *     y si es recurrente crea el siguiente automáticamente
 *   - Si el item está en estado distinto de 'good' → lo devuelve a 'good'
 */
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { Wrench, CheckCircle2, X, Search } from 'lucide-react';
import type { Expense } from '@/types';
import {
  type PropertyRow, type BankAccountRow, type InventoryCategoryRow, type InventoryItemRow,
  type MaintenanceScheduleRow, SUBCATEGORY_TO_CATEGORY,
} from '@/types/database';
import { listInventoryCategories, listInventoryItems, updateInventoryItem } from '@/services/inventory';
import { listMaintenanceSchedules, completeMaintenanceSchedule } from '@/services/maintenanceSchedules';
import MoneyInput from '@/components/MoneyInput';
import { todayISO } from '@/lib/dateUtils';

type FormData = Omit<Expense, 'id' | 'owner_id'>;

interface Props {
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  /** Pre-selected property ID (from filter or linked schedule). */
  defaultPropertyId?: string | null;
  /** Pre-linked schedule (from "Registrar gasto" button on a schedule card). */
  linkedSchedule?: MaintenanceScheduleRow | null;
  onClose: () => void;
  onSave: (expense: FormData) => Promise<boolean | void>;
  error?: string | null;
}

export default function InventoryMaintenanceExpenseForm({
  properties, bankAccounts, defaultPropertyId, linkedSchedule, onClose, onSave, error: propError,
}: Props) {
  const backdrop = makeBackdropHandlers(onClose);

  // ── Step state ──────────────────────────────────────────────────────────────
  const [propertyId, setPropertyId] = useState<string | null>(
    linkedSchedule?.property_id ?? defaultPropertyId ?? (properties.length === 1 ? properties[0].id : null),
  );
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(linkedSchedule?.item_id ?? null);
  const [scheduleId, setScheduleId] = useState<string | null>(linkedSchedule?.id ?? null);
  // 'scheduled' = linked to a programmed maintenance, 'spontaneous' = preventive/unscheduled
  const [maintType, setMaintType] = useState<'scheduled' | 'spontaneous'>(
    linkedSchedule ? 'scheduled' : 'scheduled',
  );

  // ── Data ────────────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<InventoryCategoryRow[]>([]);
  const [allItems, setAllItems] = useState<InventoryItemRow[]>([]);
  const [pendingSchedules, setPendingSchedules] = useState<MaintenanceScheduleRow[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // ── Expense fields ──────────────────────────────────────────────────────────
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [status, setStatus] = useState<'pending' | 'paid' | 'partial'>('paid');
  const [bankId, setBankId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load categories once
  useEffect(() => {
    listInventoryCategories().then(res => {
      if (!res.error && res.data) setCategories(res.data);
    });
  }, []);

  // Load items + pending schedules when property changes
  useEffect(() => {
    if (!propertyId) { setAllItems([]); setPendingSchedules([]); return; }
    setLoadingItems(true);
    Promise.all([
      listInventoryItems({ property_ids: [propertyId] }),
      listMaintenanceSchedules({ propertyId, status: 'pending' }),
    ]).then(([itemsRes, schedRes]) => {
      setLoadingItems(false);
      if (!itemsRes.error && itemsRes.data) setAllItems(itemsRes.data);
      if (!schedRes.error) setPendingSchedules(schedRes.data);
    });
    // Reset downstream selections when property changes
    setCategoryId(null);
    if (!linkedSchedule) { setItemId(null); setScheduleId(null); }
  }, [propertyId, linkedSchedule]);

  // Auto-set category when item is pre-set from linked schedule
  useEffect(() => {
    if (linkedSchedule && allItems.length > 0) {
      const item = allItems.find(i => i.id === linkedSchedule.item_id);
      if (item) setCategoryId(item.category_id);
    }
  }, [linkedSchedule, allItems]);

  // Auto-link to CLOSEST (earliest date) schedule when item is selected and type is 'scheduled'
  useEffect(() => {
    if (!itemId || linkedSchedule || maintType !== 'scheduled') return;
    const closest = [...pendingSchedules]
      .filter(s => s.item_id === itemId)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0];
    setScheduleId(closest?.id ?? null);
  }, [itemId, pendingSchedules, linkedSchedule, maintType]);

  // Clear schedule link when switching to spontaneous
  useEffect(() => {
    if (maintType === 'spontaneous') setScheduleId(null);
    else if (itemId && !linkedSchedule) {
      const closest = [...pendingSchedules]
        .filter(s => s.item_id === itemId)
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0];
      setScheduleId(closest?.id ?? null);
    }
  }, [maintType]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ─────────────────────────────────────────────────────────────────

  // Categories that actually have items in the selected property
  const availableCategories = useMemo(() => {
    const catIds = new Set(allItems.map(i => i.category_id).filter(Boolean));
    return categories.filter(c => catIds.has(c.id));
  }, [categories, allItems]);

  const itemsInCategory = useMemo(
    () => categoryId ? allItems.filter(i => i.category_id === categoryId) : allItems,
    [allItems, categoryId],
  );

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return itemsInCategory;
    const q = itemSearch.toLowerCase();
    return itemsInCategory.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.location ?? '').toLowerCase().includes(q),
    );
  }, [itemsInCategory, itemSearch]);

  const selectedItem = useMemo(
    () => allItems.find(i => i.id === itemId) ?? null,
    [allItems, itemId],
  );

  const closestScheduleForItem = useMemo(
    () =>
      [...pendingSchedules]
        .filter(s => s.item_id === itemId)
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0] ?? null,
    [pendingSchedules, itemId],
  );

  const linkedScheduleData = useMemo(
    () => linkedSchedule ?? (scheduleId ? pendingSchedules.find(s => s.id === scheduleId) ?? null : null),
    [linkedSchedule, pendingSchedules, scheduleId],
  );

  const selectedProperty = properties.find(p => p.id === propertyId);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) { setErr('Selecciona una propiedad.'); return; }
    if (!itemId) { setErr('Selecciona un item.'); return; }
    if (!amount || amount <= 0) { setErr('Ingresa el monto del mantenimiento.'); return; }

    setSaving(true);
    setErr(null);

    // Resolve which schedule to mark as done
    const resolvedScheduleId = linkedSchedule?.id ?? (maintType === 'scheduled' ? (scheduleId ?? closestScheduleForItem?.id ?? null) : null);
    const resolvedScheduleData = linkedScheduleData ?? closestScheduleForItem;

    const itemName = selectedItem?.name ?? 'Item';
    const typeLabel = maintType === 'spontaneous' ? ' [preventivo]' : '';
    const scheduleTitlePart = resolvedScheduleData ? ` — ${resolvedScheduleData.title}` : '';

    const expenseData: FormData = {
      category:         SUBCATEGORY_TO_CATEGORY['maintenance'],
      subcategory:      'maintenance',
      type:             'variable',
      amount,
      date,
      status,
      property_id:      propertyId,
      bank_account_id:  bankId,
      vendor:           null,
      person_in_charge: null,
      booking_id:       null,
      adjustment_id:    null,
      description:      `[Inventario] ${itemName}${scheduleTitlePart}${typeLabel}${notes ? ' — ' + notes.trim() : ''}`,
    };

    // Mark schedule as done FIRST — so when onSave resolves and the parent calls
    // loadMaintenancePanel(), the DB already reflects expense_registered=true.
    if (resolvedScheduleId) {
      await completeMaintenanceSchedule(resolvedScheduleId, { expenseRegistered: true });
    }

    // Restore item status to 'good' if it's not already
    if (selectedItem && selectedItem.status !== 'good') {
      await updateInventoryItem(selectedItem.id, { status: 'good' });
    }

    const saved = await onSave(expenseData);
    if (saved === false) { setSaving(false); return; }

    setSaving(false);
  };

  return (
    <motion.div
      {...backdrop}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-lg font-bold text-slate-800">Gasto de mantenimiento</h3>
              <p className="text-xs text-slate-500">Inventario · Registra el costo real del mantenimiento</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Errors */}
          {(err || propError) && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {err ?? propError}
            </p>
          )}

          {/* ── Step 1: Propiedad ─────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Propiedad <span className="text-rose-500">*</span>
            </label>
            <select
              value={propertyId ?? ''}
              onChange={e => setPropertyId(e.target.value || null)}
              className="w-full px-3 py-2 text-sm text-slate-800 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 outline-none"
            >
              <option value="">— Selecciona —</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* ── Step 2: Categoría ─────────────────────────────────────────── */}
          <AnimatePresence>
            {propertyId && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Categoría <span className="text-slate-400 font-normal">(opcional — filtra items)</span>
                </label>
                {loadingItems ? (
                  <p className="text-xs text-slate-400">Cargando…</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCategoryId(null)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition ${
                        categoryId === null
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      Todas
                    </button>
                    {availableCategories.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCategoryId(c.id); setItemId(null); setScheduleId(null); }}
                        className={`px-2.5 py-1 text-xs rounded-full border transition ${
                          categoryId === c.id
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {c.icon} {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Step 3: Item ──────────────────────────────────────────────── */}
          <AnimatePresence>
            {propertyId && !loadingItems && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Item del inventario <span className="text-rose-500">*</span>
                </label>
                {itemsInCategory.length === 0 ? (
                  <p className="text-xs text-slate-400 mt-1">
                    No hay items de inventario en {selectedProperty?.name ?? 'esta propiedad'}.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    {/* Search input */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
                      <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={e => setItemSearch(e.target.value)}
                        placeholder="Buscar item…"
                        className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
                      />
                      {itemSearch && (
                        <button type="button" onClick={() => setItemSearch('')}
                          className="text-slate-400 hover:text-slate-600">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {/* Scrollable list — stays inside the modal */}
                    <ul className="max-h-44 overflow-y-auto divide-y divide-slate-50">
                      {filteredItems.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-slate-400">Sin resultados</li>
                      ) : filteredItems.map(i => {
                        const isSelected = itemId === i.id;
                        const hasSched = pendingSchedules.some(s => s.item_id === i.id);
                        return (
                          <li key={i.id}>
                            <button
                              type="button"
                              onClick={() => { setItemId(i.id); setItemSearch(''); }}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition ${
                                isSelected
                                  ? 'bg-amber-50 text-amber-800 font-semibold'
                                  : 'hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <span>
                                {i.name}
                                {i.location && (
                                  <span className="ml-1 text-xs text-slate-400">({i.location})</span>
                                )}
                              </span>
                              {hasSched && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 whitespace-nowrap flex-shrink-0">
                                  🔧 mant.
                                </span>
                              )}
                              {isSelected && (
                                <CheckCircle2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Tipo de mantenimiento ─────────────────────────────────────── */}
          <AnimatePresence>
            {itemId && !linkedSchedule && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Tipo de mantenimiento
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMaintType('scheduled')}
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition ${
                      maintType === 'scheduled'
                        ? 'bg-amber-500 text-white border-amber-500 font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    📅 Sobre uno programado
                  </button>
                  <button
                    type="button"
                    onClick={() => setMaintType('spontaneous')}
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition ${
                      maintType === 'spontaneous'
                        ? 'bg-slate-700 text-white border-slate-700 font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    ⚡ Espontáneo / preventivo
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Schedule vinculado ────────────────────────────────────────── */}
          <AnimatePresence>
            {itemId && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                {linkedSchedule ? (
                  // Pre-linked from outside (e.g., "done needs expense" panel)
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-amber-900">
                        Mantenimiento vinculado: {linkedSchedule.title}
                      </p>
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        Fecha programada: {linkedSchedule.scheduled_date}
                        {linkedSchedule.is_recurring && linkedSchedule.recurrence_days && (
                          <span className="ml-2">· 🔁 Recurrente cada {linkedSchedule.recurrence_days} días</span>
                        )}
                      </p>
                      <p className="text-[11px] text-amber-600 mt-0.5">
                        Al guardar se marcará como realizado{linkedSchedule.is_recurring ? ' y se agendará el siguiente' : ''}.
                      </p>
                    </div>
                  </div>
                ) : maintType === 'scheduled' ? (
                  // Show only the closest scheduled maintenance for this item
                  closestScheduleForItem ? (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-amber-900">
                          Próximo mantenimiento: {closestScheduleForItem.title}
                        </p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Fecha programada: {closestScheduleForItem.scheduled_date}
                          {closestScheduleForItem.is_recurring && closestScheduleForItem.recurrence_days && (
                            <span className="ml-2">· 🔁 Recurrente cada {closestScheduleForItem.recurrence_days} días</span>
                          )}
                        </p>
                        <p className="text-[11px] text-amber-600 mt-0.5">
                          Al guardar se marcará como realizado{closestScheduleForItem.is_recurring ? ' y se agendará el siguiente' : ''}.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      No hay mantenimientos programados para este item. El gasto se registrará sin vincular.
                    </p>
                  )
                ) : (
                  // Spontaneous / preventive
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-600">
                    ⚡ <span className="font-semibold">Mantenimiento espontáneo / preventivo</span> — se registrará el gasto sin vincular a un agendamiento programado.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Monto ─────────────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Monto del mantenimiento <span className="text-rose-500">*</span>
            </label>
            <MoneyInput value={amount} onChange={setAmount} />
          </div>

          {/* ── Fecha + Estado ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Estado</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as typeof status)}
                className="w-full px-3 py-2 text-sm text-slate-800 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 outline-none"
              >
                <option value="paid">Pagado</option>
                <option value="pending">Pendiente</option>
                <option value="partial">Parcial</option>
              </select>
            </div>
          </div>

          {/* ── Cuenta bancaria ───────────────────────────────────────────── */}
          {bankAccounts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Cuenta bancaria</label>
              <select
                value={bankId ?? ''}
                onChange={e => setBankId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm text-slate-800 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 outline-none"
              >
                <option value="">Sin especificar</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.name}{b.bank ? ` · ${b.bank}` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Notas ─────────────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Notas <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Proveedor, descripción del trabajo, etc."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none resize-none"
            />
          </div>

          {/* ── Acciones ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !propertyId || !itemId || !amount}
              className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <Wrench className="w-3.5 h-3.5" />
                  Registrar mantenimiento
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
