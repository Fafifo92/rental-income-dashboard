import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listExpenses, updateExpense, deleteExpense } from '@/services/expenses';
import { hasBookingStarted } from '@/lib/bookingStatus';
import { cleanDamageDescription } from '@/lib/damageDescription';
import { toast } from '@/lib/toast';
import { updateBooking } from '@/services/bookings';
import {
  listBookingAdjustments, createBookingAdjustment, deleteBookingAdjustment, netAdjustment,
} from '@/services/bookingAdjustments';
import {
  listCleaningsByBooking, createCleaning, updateCleaning, deleteCleaning,
  updateBookingOperational, type BookingCleaning,
} from '@/services/cleanings';
import { listVendors, type Vendor } from '@/services/vendors';
import { consumeCreditsForCheckin } from '@/services/creditPools';
import { todayISO } from '@/lib/dateUtils';
import type { Expense } from '@/types';
import type {
  PropertyRow, BankAccountRow, BookingAdjustmentRow, BookingAdjustmentKind,
} from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { useBackdropClose, makeBackdropHandlers } from '@/lib/useBackdropClose';
import DamageReportModal from './DamageReportModal';
import MoneyInput from '@/components/MoneyInput';
import { getDamageReconciliations, type DamageReconciliation } from '@/services/inventory';

interface BookingLite {
  id: string;
  confirmation_code: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string;
  channel?: string | null;
  gross_revenue?: number | null;
  channel_fees?: number | null;
  net_payout?: number | null;
  payout_date?: string | null;
  listing_id?: string | null;
  notes?: string | null;
  num_adults?: number | null;
  num_children?: number | null;
  // Fase 11 — banderas operativas
  checkin_done?: boolean;
  checkout_done?: boolean;
  inventory_checked?: boolean;
  operational_notes?: string | null;
}

interface Props {
  booking: BookingLite;
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  /** Resuelve property_id a partir de listing_id (BookingsClient se lo pasa). */
  resolvePropertyId?: (listingId: string | null | undefined) => string | null;
}

export default function BookingDetailModal({
  booking, properties, bankAccounts, onClose, resolvePropertyId,
}: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLinkExisting, setShowLinkExisting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bloque C — ajustes
  const [adjustments, setAdjustments] = useState<BookingAdjustmentRow[]>([]);
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [showDamageReport, setShowDamageReport] = useState(false);
  const [deletingAdjId, setDeletingAdjId] = useState<string | null>(null);

  // Fase 11 — operativo
  const [opFlags, setOpFlags] = useState({
    checkin_done: booking.checkin_done ?? false,
    checkout_done: booking.checkout_done ?? false,
    inventory_checked: booking.inventory_checked ?? false,
  });
  const [cleanings, setCleanings] = useState<BookingCleaning[]>([]);
  const [cleaners, setCleaners] = useState<Vendor[]>([]);
  const [showAddCleaning, setShowAddCleaning] = useState(false);

  const propertyId = resolvePropertyId?.(booking.listing_id) ?? null;
  const property = propertyId ? properties.find(p => p.id === propertyId) : null;

  const bookingStarted = useMemo(() => hasBookingStarted({
    start_date: booking.start_date,
    end_date: booking.end_date,
    cancelled_at: (booking as any).cancelled_at,
    status: booking.status,
  }), [booking.start_date, booking.end_date, (booking as any).cancelled_at, booking.status]);
  const damageDisabledReason = !propertyId
    ? 'No se puede resolver la propiedad de esta reserva'
    : !bookingStarted
      ? 'Solo se puede registrar un daño cuando la reserva está en curso o ya terminó'
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    const [resE, resA, resC, resV] = await Promise.all([
      listExpenses(undefined, {
        bookingId: booking.id,
        includeRecurring: false,
        includeChannelFees: false,
      }),
      listBookingAdjustments(booking.id),
      listCleaningsByBooking(booking.id),
      listVendors('cleaner'),
    ]);
    if (!resE.error) setExpenses(resE.data ?? []);
    if (!resA.error) setAdjustments(resA.data ?? []);
    if (!resC.error) setCleanings(resC.data ?? []);
    if (!resV.error) setCleaners(resV.data ?? []);
    setLoading(false);
  }, [booking.id]);

  useEffect(() => { load(); }, [load]);

  // ESC cierra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netAdj = netAdjustment(adjustments);
  const gross = Number(booking.gross_revenue ?? booking.total_revenue ?? 0);
  const fees = Number(booking.channel_fees ?? 0);
  const netPayout = booking.net_payout !== null && booking.net_payout !== undefined
    ? Number(booking.net_payout)
    : gross - fees;
  const realProfit = netPayout + netAdj - totalExpenses;

  /**
   * Agrupa cada daño con sus cobros para reconciliación financiera.
   *  - repair_cost: lo que costó arreglar (expense.amount)
   *  - charged: suma de los `damage_charge` adjustments del mismo daño,
   *    desglosado por origen (huésped / plataforma)
   *  - diff = repair_cost - charged
   *      > 0 → faltó cobrar (te quita dinero)
   *      < 0 → cobraste de más (queda a tu favor)
   *      = 0 → cuadrado
   *
   * El matching usa el item_name extraído de la descripción (los `damage_charge`
   * adjustments creados por `reportDamage` siempre tienen el formato
   * `Cobro huésped|plataforma – Daño: <item_name>...`).
   */
  const damageGroups = useMemo(() => {
    const damageExpenses = expenses.filter(e => (e.subcategory ?? '').toLowerCase() === 'damage');
    const damageChargeAdjs = adjustments.filter(a => a.kind === 'damage_charge');
    return damageExpenses.map(exp => {
      const visible = cleanDamageDescription(exp.description);
      const m = visible.match(/^(?:Reposición\/reparación|Daño en propiedad):\s*(.+?)(?:\s+—\s+|$)/i);
      const itemName = (m?.[1] ?? '').trim();
      const expTag = `[exp:${exp.id}]`;
      const matches = damageChargeAdjs.filter(a => {
        if (exp.adjustment_id && a.id === exp.adjustment_id) return true;
        const desc = (a.description ?? '').toLowerCase();
        // Robust: match by embedded expense-ID tag (added since v2)
        if ((a.description ?? '').includes(expTag)) return true;
        // Fallback: text-based match when itemName is available
        if (itemName && desc.includes(itemName.toLowerCase())) return true;
        return false;
      });
      const fromGuest = matches
        .filter(a => /cobro huésped/i.test(a.description ?? ''))
        .reduce((s, a) => s + Number(a.amount), 0);
      const fromPlatform = matches
        .filter(a => /cobro plataforma/i.test(a.description ?? ''))
        .reduce((s, a) => s + Number(a.amount), 0);
      const fromOther = matches
        .filter(a => !/cobro (huésped|plataforma)/i.test(a.description ?? ''))
        .reduce((s, a) => s + Number(a.amount), 0);
      const charged = fromGuest + fromPlatform + fromOther;
      const repairCost = Number(exp.amount) || 0;
      const diff = repairCost - charged;
      // If the expense was manually marked 'paid', treat as acknowledged
      const isAcknowledged = exp.status === 'paid';
      return { expense: exp, itemName: itemName || visible || 'Daño', repairCost, fromGuest, fromPlatform, fromOther, charged, diff, matches, isAcknowledged };
    });
  }, [expenses, adjustments]);

  const handleChargeDifference = useCallback(async (g: typeof damageGroups[number]) => {
    if (g.diff <= 0) return;
    const res = await createBookingAdjustment({
      booking_id: booking.id,
      kind: 'damage_charge',
      amount: g.diff,
      description: `Cobro pendiente – Daño: ${g.itemName} [exp:${g.expense.id}] (diferencia no cobrada)`,
      date: todayISO(),
      bank_account_id: null,
    });
    if (res.error) { toast.error(res.error); return; }
    toast.success('Ajuste creado por la diferencia.');
    await load();
  }, [booking.id, load]);

  const handleAcknowledgeDamage = useCallback(async (g: typeof damageGroups[number]) => {
    if (g.diff <= 0) return;
    // Mark the expense as paid/acknowledged — the financial loss is already reflected
    // in the fact that repair_cost > charged. Creating a 'discount' adj would double-count the loss.
    const res = await updateExpense(g.expense.id, { status: 'paid' });
    if (res.error) { toast.error(`No se pudo actualizar el estado: ${res.error}`); return; }
    toast.success('Diferencia asumida. El gasto queda marcado como resuelto.');
    await load();
  }, [load]);

  const handleLinkExisting= useCallback(async (expenseId: string) => {
    const res = await updateExpense(expenseId, { booking_id: booking.id });
    if (!res.error) {
      setShowLinkExisting(false);
      await load();
    }
  }, [booking.id, load]);

  const handleUnlinkExpense = useCallback(async (id: string) => {
    const res = await updateExpense(id, { booking_id: null });
    if (!res.error) { setDeletingId(null); await load(); }
  }, [load]);

  const handleDeleteAdjustment = useCallback(async (id: string) => {
    // Cascade: si hay un gasto vinculado vía adjustment_id, también lo borramos
    // para evitar dejar gastos huérfanos referenciando un ajuste inexistente.
    const linkedExp = expenses.find(e => e.adjustment_id === id);
    if (linkedExp) {
      const resExp = await deleteExpense(linkedExp.id);
      if (resExp.error) { toast.error(`No se pudo borrar el gasto vinculado: ${resExp.error}`); return; }
    }
    const res = await deleteBookingAdjustment(id);
    if (!res.error) { setDeletingAdjId(null); await load(); }
  }, [load, expenses]);

  const handleCreateAdjustment = useCallback(async (
    payload: {
      kind: BookingAdjustmentKind; amount: number; description: string | null; date: string;
    },
  ) => {
    const res = await createBookingAdjustment({ ...payload, booking_id: booking.id, bank_account_id: null });
    if (res.error || !res.data) return;
    setShowAddAdjustment(false);
    await load();
  }, [booking.id, load]);

  // Fase 11 — Operativo handlers
  const [opError, setOpError] = useState<string | null>(null);
  const toggleFlag = useCallback(async (
    field: 'checkin_done' | 'checkout_done' | 'inventory_checked',
  ) => {
    const next = !opFlags[field];
    setOpError(null);

    // Regla: no se puede marcar check-out si el check-in no está hecho.
    if (field === 'checkout_done' && next && !opFlags.checkin_done) {
      setOpError('No puedes marcar el check-out sin haber hecho el check-in primero.');
      return;
    }

    setOpFlags(prev => ({ ...prev, [field]: next }));
    await updateBookingOperational(booking.id, { [field]: next });

    // Al hacer check-in (manual), descuenta créditos del seguro/bolsa activa
    // si aplica. Idempotente: no dobla el descuento si ya se hizo.
    if (field === 'checkin_done' && next) {
      try { await consumeCreditsForCheckin(booking.id); } catch { /* no-op */ }
    }

    // Auto-marcar aseos pendientes como hechos cuando se marca el check-out.
    if (field === 'checkout_done' && next) {
      const doneDate = booking.end_date || todayISO();
      const pending = cleanings.filter(c => c.status === 'pending');
      if (pending.length > 0) {
        await Promise.all(pending.map(c => updateCleaning(c.id, { status: 'done', done_date: c.done_date ?? doneDate })));
        await load();
      }
    }
  }, [booking.id, booking.end_date, opFlags, cleanings, load]);

  const addCleaning = useCallback(async (payload: {
    cleaner_id: string; fee: number; status: 'pending' | 'done' | 'paid';
    done_date: string | null; notes: string | null;
    supplies_amount: number; reimburse_to_cleaner: boolean;
  }) => {
    const res = await createCleaning({ ...payload, booking_id: booking.id, paid_date: null });
    if (!res.error) await load();
  }, [booking.id, load]);

  const setCleaningStatus = useCallback(async (
    c: BookingCleaning,
    next: 'pending' | 'done' | 'paid',
  ) => {
    const today = todayISO();
    const patch: Partial<BookingCleaning> = { status: next };
    if (next === 'done' && !c.done_date) patch.done_date = today;
    if (next === 'paid' && !c.paid_date) patch.paid_date = today;
    await updateCleaning(c.id, patch);
    await load();
  }, [load]);

  const removeCleaning = useCallback(async (id: string) => {
    await deleteCleaning(id);
    await load();
  }, [load]);

  // Marcar reserva como completada: valida operativo + bypass con advertencia
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const isAlreadyCompleted = (booking.status ?? '').toLowerCase() === 'completed';

  const operationalChecklist = useMemo(() => {
    const hasCleaning = cleanings.length > 0;
    const allCleaningsDone = hasCleaning && cleanings.every(c => c.status === 'done' || c.status === 'paid');
    return {
      checkin: opFlags.checkin_done,
      checkout: opFlags.checkout_done,
      inventory: opFlags.inventory_checked,
      cleaning_assigned: hasCleaning,
      cleaning_done: allCleaningsDone,
      allDone:
        opFlags.checkin_done &&
        opFlags.checkout_done &&
        opFlags.inventory_checked &&
        hasCleaning &&
        allCleaningsDone,
    };
  }, [opFlags, cleanings]);

  const markCompleted = useCallback(async (_force: boolean) => {
    setCompleting(true);
    setCompleteError(null);
    const res = await updateBooking(booking.id, { status: 'completed' });
    setCompleting(false);
    if (res.error) { setCompleteError(res.error); return; }
    setShowCompleteModal(false);
    onClose();
  }, [booking.id, onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        {...makeBackdropHandlers(onClose)}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-4 sm:px-7 py-4 sm:py-5 bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest opacity-80">Reserva</p>
              <h2 className="text-2xl font-bold mt-0.5">{booking.guest_name || 'Sin nombre'}</h2>
              <p className="text-xs opacity-90 mt-1 font-mono">
                #{booking.confirmation_code} · {booking.channel?.toUpperCase() ?? 'AIRBNB'}
              </p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white p-1">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1">
            {/* Datos principales */}
            <div className="px-4 sm:px-7 py-4 sm:py-5 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 text-sm border-b border-slate-100">
              <InfoRow label="Check-in" value={booking.start_date} />
              <InfoRow label="Check-out" value={booking.end_date} />
              <InfoRow label="Noches" value={String(booking.num_nights)} />
              <InfoRow label="Estado" value={booking.status} />
              <InfoRow label="Propiedad" value={property?.name ?? '—'} />
              <InfoRow label="Canal" value={booking.channel ?? '—'} />
              <InfoRow label="Adultos" value={String(booking.num_adults ?? 1)} />
              <InfoRow label="Niños" value={String(booking.num_children ?? 0)} />
              <InfoRow label="Payout real" value={booking.payout_date ?? 'Pendiente'} />
            </div>

            {/* Resumen financiero */}
            <div className="px-4 sm:px-7 py-4 sm:py-5 bg-slate-50 border-b border-slate-100">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
                Ganancia real de la estadía
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Metric label="Bruto" value={gross} tone="slate" />
                <Metric label="Fees canal" value={-fees} tone="rose" />
                <Metric label="Ajustes" value={netAdj} tone={netAdj >= 0 ? 'emerald' : 'rose'} />
                <Metric label="Gastos vinculados" value={-totalExpenses} tone="amber" />
                <Metric label="Ganancia real" value={realProfit} tone={realProfit >= 0 ? 'emerald' : 'rose'} bold />
              </div>
              <p className="text-xs text-slate-500 mt-3">
                <strong>Ganancia real</strong> = payout neto + ajustes (ingresos extra / cargos por daño − descuentos) − gastos atribuibles.
                No incluye gastos fijos de la propiedad.
              </p>
            </div>

            {/* Notas */}
            {booking.notes && (
              <div className="px-4 sm:px-7 py-3 sm:py-4 border-b border-slate-100">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Notas</p>
                <p className="text-sm text-slate-700 whitespace-pre-line">{booking.notes}</p>
              </div>
            )}

            {/* Fase 11 — Operativo */}
            <div className="px-4 sm:px-7 py-4 sm:py-5 border-b border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Operativo de la estadía</h3>
                  <p className="text-xs text-slate-500">Check-in / check-out, aseo e inventario.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
                {([
                  ['checkin_done',     'Check-in hecho',      '🛬'],
                  ['checkout_done',    'Check-out hecho',     '🛫'],
                  ['inventory_checked','Inventario revisado', '📋'],
                ] as const).map(([key, label, icon]) => {
                  const active = opFlags[key];
                  const disabled = key === 'checkout_done' && !active && !opFlags.checkin_done;
                  return (
                    <button
                      key={key}
                      onClick={() => toggleFlag(key)}
                      disabled={disabled}
                      title={disabled ? 'Marca primero el check-in' : undefined}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border-2 transition ${
                        active
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                          : disabled
                            ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-lg">{icon}</span>
                      <span className="font-semibold flex-1 text-left">{label}</span>
                      <span className={active ? 'text-emerald-600' : 'text-slate-300'}>
                        {active ? '✓' : '○'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {opError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  {opError}
                </p>
              )}

              {/* Aseo */}
              <div className="border border-slate-200 rounded-lg bg-slate-50/40">
                <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">🧹 Aseo</p>
                  <button
                    onClick={() => setShowAddCleaning(true)}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    + Asignar aseo
                  </button>
                </div>
                {cleanings.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">Aún no has asignado aseo.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {cleanings.map(c => {
                      const cleaner = cleaners.find(v => v.id === c.cleaner_id);
                      return (
                        <div key={c.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                          <div className="flex-1">
                            <p className="font-semibold text-slate-800">
                              {cleaner?.name ?? 'Sin asignar'}
                              <span className="ml-2 text-xs font-normal text-slate-500">{formatCurrency(c.fee)}</span>
                            </p>
                            {c.done_date && <p className="text-xs text-slate-500">Hecho {c.done_date}</p>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {c.status === 'paid' && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">Pagado</span>}
                            {c.status === 'done' && (
                              <>
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Hecho</span>
                                <button onClick={() => setCleaningStatus(c, 'paid')} className="text-xs text-emerald-700 font-semibold hover:underline">Pagar</button>
                              </>
                            )}
                            {c.status === 'pending' && (
                              <>
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-semibold">Pendiente</span>
                                <button onClick={() => setCleaningStatus(c, 'done')} className="text-xs text-blue-700 font-semibold hover:underline">Marcar hecho</button>
                              </>
                            )}
                            <button onClick={() => removeCleaning(c.id)} className="text-slate-400 hover:text-red-600 text-xs ml-1">✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Gastos vinculados */}
            <div className="px-4 sm:px-7 py-4 sm:py-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Gastos vinculados a esta reserva</h3>
                  <p className="text-xs text-slate-500">Daños, reparaciones, amenities extra que ya existen como gasto.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLinkExisting(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition"
                  >
                    Vincular gasto existente
                  </button>
                </div>
              </div>

              {loading ? (
                <p className="text-sm text-slate-400 text-center py-4">Cargando…</p>
              ) : expenses.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  Sin gastos vinculados todavía.
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                        <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                        <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
                        <th className="px-3 py-2 text-right font-semibold">Monto</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map(e => (
                        <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{e.date}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{e.category}</div>
                            {(() => { const d = cleanDamageDescription(e.description); return d ? <div className="text-xs text-slate-500">{d}</div> : null; })()}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{e.vendor ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-rose-600 tabular-nums whitespace-nowrap">
                            {formatCurrency(Number(e.amount))}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {deletingId === e.id ? (
                              <span className="inline-flex gap-2 text-xs">
                                <span className="text-slate-500">¿Desvincular?</span>
                                <button onClick={() => handleUnlinkExpense(e.id)} className="text-blue-600 hover:underline font-semibold">Sí</button>
                                <button onClick={() => setDeletingId(null)} className="text-slate-500 hover:underline">No</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setDeletingId(e.id)}
                                className="text-slate-400 hover:text-blue-600 p-1"
                                title="Desvincular de esta reserva"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-rose-700 tabular-nums">{formatCurrency(totalExpenses)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Ajustes de reserva (Bloque C) */}
            <div className="px-4 sm:px-7 py-4 sm:py-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Ajustes de reserva</h3>
                  <p className="text-xs text-slate-500">Ingresos extra, descuentos al huésped, reembolsos de plataforma.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDamageReport(true)}
                    disabled={!!damageDisabledReason}
                    title={damageDisabledReason ?? 'Registrar un daño (inventario o estructura)'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition"
                  >
                    Registrar daño
                  </button>
                  <button
                    onClick={() => setShowAddAdjustment(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Nuevo ajuste
                  </button>
                </div>
              </div>

              {adjustments.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  Sin ajustes registrados.
                </p>
              ) : (
                <>
                <p className="text-[11px] text-slate-500 mb-2 italic">
                  💡 Los ajustes son del lado del huésped (lo que cobras o descuentas).
                  Para registrar un <strong>daño</strong> (inventario o estructura) usa el botón{' '}
                  <strong>"Registrar daño"</strong>: queda atado a esta reserva, evita duplicados y vincula al inventario cuando aplica.
                </p>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                        <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                        <th className="px-3 py-2 text-left font-semibold">Descripción</th>
                        <th className="px-3 py-2 text-right font-semibold">Impacto</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map(a => {
                        const sign = a.kind === 'discount' ? -1 : 1;
                        const impact = sign * Number(a.amount);
                        const linkedExpense = expenses.find(e => e.adjustment_id === a.id);
                        return (
                          <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                            <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{a.date}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex whitespace-nowrap text-xs font-semibold px-2 py-0.5 rounded-full ${ADJ_KIND_STYLE[a.kind]}`}>
                                {ADJ_KIND_LABEL[a.kind]}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {a.description ?? '—'}
                              {linkedExpense && (
                                <div className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                                  Gasto reparación: {formatCurrency(Number(linkedExpense.amount))}
                                  <span className="font-semibold uppercase">· {linkedExpense.status}</span>
                                </div>
                              )}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${impact >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {impact >= 0 ? '+' : ''}{formatCurrency(impact)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {deletingAdjId === a.id ? (
                                <span className="inline-flex gap-2 text-xs">
                                  <span className="text-slate-500">
                                    {linkedExpense ? '¿Eliminar ajuste + gasto vinculado?' : '¿Eliminar?'}
                                  </span>
                                  <button onClick={() => handleDeleteAdjustment(a.id)} className="text-red-600 hover:underline font-semibold">Sí</button>
                                  <button onClick={() => setDeletingAdjId(null)} className="text-slate-500 hover:underline">No</button>
                                </span>
                              ) : (
                                <button onClick={() => setDeletingAdjId(a.id)} className="text-slate-400 hover:text-red-600 p-1" title="Eliminar ajuste">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
                                  </svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Neto</td>
                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${netAdj >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {netAdj >= 0 ? '+' : ''}{formatCurrency(netAdj)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                </>
              )}
            </div>

            {/* Reconciliación de daños — comparación cobrado vs costo real */}
            {damageGroups.length > 0 && (
              <div className="px-4 sm:px-7 py-4 sm:py-5 border-t border-slate-100">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-800">Reconciliación de daños</h3>
                  <p className="text-xs text-slate-500">Compara lo cobrado al huésped o a la plataforma con lo que realmente costó reparar.</p>
                </div>
                <div className="space-y-3">
                  {damageGroups.map((g, i) => {
                    const isShortfall = g.diff > 0.5 && !g.isAcknowledged;
                    const isSurplus = g.diff < -0.5;
                    const isBalanced = !isShortfall && !isSurplus;
                    const banner = isShortfall
                      ? 'border-rose-200 bg-rose-50'
                      : isSurplus
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-slate-50';
                    return (
                      <div key={g.expense.id ?? i} className={`border rounded-lg p-3 ${banner}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-800 truncate">{g.itemName}</div>
                            <div className="text-[11px] text-slate-500">
                              {g.expense.category} · estado:{' '}
                              <span className="font-semibold uppercase">{g.expense.status}</span>
                            </div>
                          </div>
                          <div className="text-right text-xs">
                            <div className="text-slate-500">Costo real</div>
                            <div className="font-bold text-rose-700 tabular-nums">{formatCurrency(g.repairCost)}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
                          <div className="bg-white/60 border border-slate-200 rounded px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">Cobrado huésped</div>
                            <div className="font-semibold text-emerald-700 tabular-nums">{formatCurrency(g.fromGuest)}</div>
                          </div>
                          <div className="bg-white/60 border border-slate-200 rounded px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">Cobrado plataforma</div>
                            <div className="font-semibold text-emerald-700 tabular-nums">{formatCurrency(g.fromPlatform)}</div>
                          </div>
                          <div className="bg-white/60 border border-slate-200 rounded px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">Total cobrado</div>
                            <div className="font-semibold text-emerald-700 tabular-nums">{formatCurrency(g.charged)}</div>
                          </div>
                          <div className="bg-white/60 border border-slate-200 rounded px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">Diferencia</div>
                            <div className={`font-bold tabular-nums ${isShortfall ? 'text-rose-700' : isSurplus ? 'text-emerald-700' : 'text-slate-600'}`}>
                              {g.diff > 0 ? '−' : g.diff < 0 ? '+' : ''}{formatCurrency(Math.abs(g.diff))}
                            </div>
                          </div>
                        </div>

                        {isBalanced && !g.isAcknowledged && (
                          <p className="text-xs text-slate-600">Cuadrado: lo cobrado coincide con el costo real.</p>
                        )}
                        {g.isAcknowledged && g.diff > 0.5 && (
                          <p className="text-xs text-slate-600">
                            Pérdida asumida: {formatCurrency(g.diff)} no cobrado, registrado como resuelto.
                          </p>
                        )}
                        {isSurplus && (
                          <p className="text-xs text-emerald-800">
                            Cobraste {formatCurrency(Math.abs(g.diff))} más de lo que costó reparar. El excedente ya quedó como ingreso del ajuste.
                          </p>
                        )}
                        {isShortfall && (
                          <div className="space-y-2">
                            <p className="text-xs text-rose-800">
                              Faltó cobrar {formatCurrency(g.diff)}. Esto reduce tu utilidad real de la reserva.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleChargeDifference(g)}
                                className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition"
                                title="Crea un ajuste por la diferencia. Úsalo si vas a cobrar al huésped o a la plataforma."
                              >
                                Cobrar la diferencia
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAcknowledgeDamage(g)}
                                className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg transition"
                                title="Marca el gasto como resuelto sin cobrar. La pérdida ya está reflejada en el costo real."
                              >
                                Asumir como pérdida
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Daños del inventario — Bloque 16 */}
            <BookingDamagesSection bookingId={booking.id} />
          </div>

          {/* Footer */}
          <div className="px-4 sm:px-7 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {isAlreadyCompleted ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded-full">
                  ✓ Reserva completada
                </span>
              ) : operationalChecklist.allDone ? (
                <button
                  onClick={() => setShowCompleteModal(true)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center gap-1.5"
                >
                  ✓ Marcar completada
                </button>
              ) : (
                <button
                  onClick={() => setShowCompleteModal(true)}
                  className="px-4 py-2 text-sm font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg inline-flex items-center gap-1.5"
                  title="Faltan tareas operativas"
                >
                  Marcar completada
                </button>
              )}
            </div>
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cerrar</button>
          </div>
        </motion.div>

        {/* Modal para agregar gasto eliminado: ahora solo se permite vincular gastos existentes huérfanos */}

        {/* Link existing expense picker */}
        <AnimatePresence>
          {showLinkExisting && (
            <LinkExistingExpenseModal
              propertyId={propertyId}
              onClose={() => setShowLinkExisting(false)}
              onLink={handleLinkExisting}
            />
          )}
        </AnimatePresence>

        {/* Add adjustment modal */}
        <AnimatePresence>
          {showAddAdjustment && (
            <AdjustmentFormModal
              defaultDate={booking.end_date || todayISO()}
              onClose={() => setShowAddAdjustment(false)}
              onSave={handleCreateAdjustment}
            />
          )}
        </AnimatePresence>

        {/* Damage report modal — punto único para registrar daños */}
        <AnimatePresence>
          {showDamageReport && propertyId && bookingStarted && (
            <DamageReportModal
              propertyId={propertyId}
              propertyName={property?.name ?? undefined}
              booking={{
                id: booking.id,
                confirmation_code: booking.confirmation_code,
                guest_name: booking.guest_name,
                start_date: booking.start_date,
                end_date: booking.end_date,
              }}
              onClose={() => setShowDamageReport(false)}
              onSaved={async () => { setShowDamageReport(false); await load(); }}
            />
          )}
        </AnimatePresence>

        {/* Add cleaning modal — Fase 11 */}
        <AnimatePresence>
          {showAddCleaning && (
            <CleaningFormModal
              cleaners={cleaners}
              defaultFee={property?.default_cleaning_fee ?? null}
              defaultDate={booking.end_date || todayISO()}
              onClose={() => setShowAddCleaning(false)}
              onSave={async (payload) => { await addCleaning(payload); setShowAddCleaning(false); }}
            />
          )}
        </AnimatePresence>

        {/* Complete booking confirmation — Fase 11 */}
        <AnimatePresence>
          {showCompleteModal && (
            <CompleteBookingModal
              checklist={operationalChecklist}
              working={completing}
              error={completeError}
              onClose={() => { setShowCompleteModal(false); setCompleteError(null); }}
              onConfirm={markCompleted}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

const ADJ_KIND_LABEL: Record<BookingAdjustmentKind, string> = {
  extra_income:    'Ingreso extra',
  discount:        'Descuento',
  damage_charge:   'Cobro por daño',
  platform_refund: 'Reembolso plataforma',
  extra_guest_fee: 'Huésped adicional',
};
const ADJ_KIND_STYLE: Record<BookingAdjustmentKind, string> = {
  extra_income:    'bg-emerald-100 text-emerald-700',
  discount:        'bg-rose-100 text-rose-700',
  damage_charge:   'bg-amber-100 text-amber-700',
  platform_refund: 'bg-sky-100 text-sky-700',
  extra_guest_fee: 'bg-teal-100 text-teal-700',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

function Metric({
  label, value, tone, bold,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'rose' | 'amber';
  bold?: boolean;
}) {
  const toneClass = {
    slate:   'text-slate-800',
    emerald: 'text-emerald-700',
    rose:    'text-rose-700',
    amber:   'text-amber-700',
  }[tone];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`mt-0.5 tabular-nums ${toneClass} ${bold ? 'text-lg font-bold' : 'font-semibold'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

// ─── Sub-modal: Vincular gasto existente ──────────────────────────────
function LinkExistingExpenseModal({
  propertyId, onClose, onLink,
}: {
  propertyId: string | null;
  onClose: () => void;
  onLink: (expenseId: string) => void;
}) {
  const [candidates, setCandidates] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Carga gastos reales SIN booking asignado (prioriza la propiedad)
    listExpenses(propertyId ?? undefined, {
      includeRecurring: false,
      includeChannelFees: false,
    }).then(res => {
      if (!res.error && res.data) {
        setCandidates(res.data.filter(e => !e.booking_id && !e.id.startsWith('rec-') && !e.id.startsWith('fee-')));
      }
      setLoading(false);
    });
  }, [propertyId]);

  const q = search.toLowerCase().trim();
  const filtered = q
    ? candidates.filter(e =>
        e.category.toLowerCase().includes(q)
        || e.description?.toLowerCase().includes(q)
        || e.vendor?.toLowerCase().includes(q)
        || e.date.includes(q),
      )
    : candidates;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">Vincular gasto existente</h3>
          <p className="text-xs text-slate-500 mt-0.5">Solo se muestran gastos reales sin reserva asignada {propertyId ? '(de esta propiedad)' : ''}.</p>
          <input
            type="text"
            placeholder="Buscar por categoría, proveedor, fecha…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mt-3 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No hay gastos disponibles para vincular.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map(e => (
                <li key={e.id}>
                  <button
                    onClick={() => onLink(e.id)}
                    className="w-full text-left px-3 py-3 hover:bg-blue-50 rounded-lg transition flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate">{e.category}</span>
                        {e.vendor && <span className="text-xs text-slate-500 truncate">· {e.vendor}</span>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {e.date}{e.description ? ` — ${e.description}` : ''}
                      </div>
                    </div>
                    <span className="font-semibold text-rose-600 tabular-nums whitespace-nowrap">
                      {formatCurrency(Number(e.amount))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Sub-modal: Crear ajuste de reserva ──────────────────────────────
// NOTA: `damage_charge` ya NO se crea desde aquí. Para registrar daños
// se usa el botón "⚠ Registrar daño" que abre `DamageReportModal`.
// Esto evita la duplicación de gastos y garantiza el vínculo a inventario.
function AdjustmentFormModal({
  defaultDate, onClose, onSave,
}: {
  defaultDate: string;
  onClose: () => void;
  onSave: (p: {
    kind: BookingAdjustmentKind; amount: number; description: string | null; date: string;
  }) => void;
}) {
  const [kind, setKind] = useState<BookingAdjustmentKind>('extra_income');
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0) return;
    setSaving(true);
    await onSave({
      kind, amount, description: description.trim() || null, date,
    });
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">Nuevo ajuste</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            <strong>Solo</strong> dinero ligado a esta reserva (huésped, plataforma).
            Servicios públicos, aseo o gastos del negocio NO van aquí.
          </p>
          <p className="text-[11px] text-amber-700 mt-1">
            ¿Es un <strong>daño</strong>? Cierra esto y usa el botón <strong>"Registrar daño"</strong>.
          </p>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo *</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value as BookingAdjustmentKind)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="extra_income">Ingreso extra (suma)</option>
              <option value="extra_guest_fee">Huésped adicional (suma)</option>
              <option value="discount">Descuento al huésped (resta)</option>
              <option value="platform_refund">Reembolso de plataforma (suma)</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {kind === 'extra_income'    && 'Ingreso atípico cobrado al huésped: late check-out, mascota, servicio adicional.'}
              {kind === 'extra_guest_fee' && 'Cobro por persona adicional fuera del precio base.'}
              {kind === 'discount'        && 'Compensación o descuento otorgado al huésped por algún inconveniente.'}
              {kind === 'platform_refund' && 'La plataforma me devuelve dinero: resolution center, impuestos, reembolso por cancelación.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Monto *</label>
              <MoneyInput value={amount} onChange={setAmount} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha *</label>
              <input
                type="date" required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: 2 personas adicionales, late check-out…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving || !amount}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Sub-modal: Asignar aseo — Fase 11 ──────────────────────────────
function CleaningFormModal({
  cleaners, defaultFee, defaultDate, onClose, onSave,
}: {
  cleaners: Vendor[];
  defaultFee: number | null;
  defaultDate: string;
  onClose: () => void;
  onSave: (p: {
    cleaner_id: string; fee: number;
    status: 'pending' | 'done' | 'paid';
    done_date: string | null; notes: string | null;
    supplies_amount: number; reimburse_to_cleaner: boolean;
  }) => void;
}) {
  const [cleanerId, setCleanerId] = useState<string>('');
  const [fee, setFee] = useState<number | null>(defaultFee ?? null);
  const [status, setStatus] = useState<'pending' | 'done' | 'paid'>('pending');
  const [doneDate, setDoneDate] = useState<string>(defaultDate);
  const [notes, setNotes] = useState('');
  const [suppliesAmount, setSuppliesAmount] = useState<number | null>(null);
  const [reimburse, setReimburse] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cleanerId) {
      setError('Debes seleccionar la persona de aseo que ejecutó el turno.');
      return;
    }
    if (fee == null || fee < 0) {
      setError('Tarifa inválida.');
      return;
    }
    const suppliesNum = suppliesAmount ?? 0;
    if (suppliesNum < 0) {
      setError('Monto de insumos inválido.');
      return;
    }
    setSaving(true);
    await onSave({
      cleaner_id: cleanerId,
      fee,
      status,
      done_date: status === 'pending' ? null : doneDate,
      notes: notes.trim() || null,
      supplies_amount: suppliesNum,
      reimburse_to_cleaner: suppliesNum > 0 && reimburse,
    });
    setSaving(false);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">🧹 Asignar aseo</h3>
          <p className="text-xs text-slate-500">Se guarda como parte de esta reserva y suma al saldo de la persona.</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Persona de aseo <span className="text-rose-500">*</span>
            </label>
            <select
              value={cleanerId}
              onChange={e => setCleanerId(e.target.value)}
              required
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white ${
                !cleanerId && error ? 'border-rose-300' : ''
              }`}
            >
              <option value="">— Selecciona quién hizo la limpieza —</option>
              {cleaners.filter(c => c.active).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {cleaners.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">
                Aún no hay personal. <a href="/aseo" className="underline font-semibold">Agregar →</a>
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">
                Obligatorio: cada turno debe quedar atribuido a alguien para que su saldo y su histórico sean correctos.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tarifa *</label>
            <MoneyInput
              value={fee}
              onChange={setFee}
              placeholder={defaultFee ? `Default: ${defaultFee}` : 'Ej: 50.000'}
              required
            />
            {defaultFee != null && (
              <p className="text-xs text-slate-500 mt-1">Tarifa por defecto de la propiedad: {formatCurrency(defaultFee)}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Estado</label>
            <div className="grid grid-cols-3 gap-2">
              {(['pending','done','paid'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`py-2 rounded-lg text-xs font-semibold border-2 transition ${
                    status === s
                      ? 'bg-blue-50 border-blue-500 text-blue-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {s === 'pending' && 'Pendiente'}
                  {s === 'done' && 'Hecho'}
                  {s === 'paid' && 'Pagado'}
                </button>
              ))}
            </div>
          </div>
          {status !== 'pending' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha realización</label>
              <input
                type="date"
                value={doneDate}
                onChange={e => setDoneDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700">Insumos del turno</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Monto en insumos (papel, jabón, blanqueador, etc.)
              </label>
              <MoneyInput
                value={suppliesAmount}
                onChange={setSuppliesAmount}
                placeholder="0 si no hubo gasto en insumos"
              />
            </div>
            <label className={`flex items-center gap-2 text-xs ${(suppliesAmount ?? 0) > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
              <input
                type="checkbox"
                checked={reimburse}
                onChange={e => setReimburse(e.target.checked)}
                disabled={!((suppliesAmount ?? 0) > 0)}
                className="rounded"
              />
              <span>Reembolsar al aseador (los insumos los puso él/ella)</span>
            </label>
          </div>
          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving || fee == null}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ──── Complete booking modal (Fase 11) ─────────────────────────────────

function CompleteBookingModal({
  checklist, working, error, onClose, onConfirm,
}: {
  checklist: {
    checkin: boolean;
    checkout: boolean;
    inventory: boolean;
    cleaning_assigned: boolean;
    cleaning_done: boolean;
    allDone: boolean;
  };
  working: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const items: { ok: boolean; label: string }[] = [
    { ok: checklist.checkin, label: 'Check-in realizado' },
    { ok: checklist.checkout, label: 'Check-out realizado' },
    { ok: checklist.inventory, label: 'Inventario revisado' },
    { ok: checklist.cleaning_assigned, label: 'Aseo asignado' },
    { ok: checklist.cleaning_done, label: 'Aseo hecho o pagado' },
  ];
  const missing = items.filter(i => !i.ok);

  return (
    <motion.div
      {...backdrop}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-5 border-b">
          <h3 className="text-lg font-bold text-slate-900">Marcar reserva como completada</h3>
          <p className="text-xs text-slate-500 mt-0.5">Revisa el checklist operativo antes de cerrar la reserva.</p>
        </div>

        <div className="p-6 space-y-4">
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  it.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                }`}>
                  {it.ok ? '✓' : '○'}
                </span>
                <span className={it.ok ? 'text-slate-800' : 'text-slate-500'}>{it.label}</span>
              </li>
            ))}
          </ul>

          {checklist.allDone ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
              Todo está en orden. La reserva se marcará como <strong>completada</strong>.
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 space-y-1">
              <div className="font-semibold">Quedan {missing.length} tareas pendientes.</div>
              <div className="text-xs">
                Puedes completar la reserva de todos modos, pero quedará <strong>cerrada con pendientes</strong>. Las banderas faltantes seguirán visibles para que las termines luego.
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-slate-50">
          <button onClick={onClose} disabled={working}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
            Cancelar
          </button>
          {checklist.allDone ? (
            <button onClick={() => onConfirm(false)} disabled={working}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50">
              {working ? 'Guardando…' : '✓ Completar'}
            </button>
          ) : (
            <button onClick={() => onConfirm(true)} disabled={working}
              className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
              {working ? 'Guardando…' : 'Completar de todos modos'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
// ---------- Bloque 16 — Sección "Daños del inventario" en BookingDetailModal ----------

function BookingDamagesSection({ bookingId }: { bookingId: string }): JSX.Element | null {
  const [rows, setRows] = useState<DamageReconciliation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getDamageReconciliations().then(res => {
      if (!mounted) return;
      const filtered = (res.data ?? []).filter(r => r.booking_id === bookingId);
      setRows(filtered);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [bookingId]);

  if (loading || rows.length === 0) return null;

  const totalCost = rows.reduce((s, r) => s + r.repair_cost, 0);
  const totalCharged = rows.reduce((s, r) => s + r.charged_to_guest, 0);
  const netDiff = totalCharged - totalCost;

  return (
    <div className="bg-rose-50/40 border border-rose-200 rounded-xl p-4 mt-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-rose-800 flex items-center gap-1.5">Daños del inventario ({rows.length})</h3>
          <p className="text-[11px] text-rose-700/80">Items reportados como dañados durante esta reserva.</p>
        </div>
        <div className="text-right text-xs">
          <div className="text-slate-500">Costo {formatCurrency(totalCost)} · Cobrado {formatCurrency(totalCharged)}</div>
          <div className={`font-bold ${netDiff < 0 ? 'text-rose-700' : netDiff > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
            Neto: {netDiff < 0 ? '−' : netDiff > 0 ? '+' : ''}{formatCurrency(Math.abs(netDiff))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-500 bg-white/60">
            <tr>
              <th className="text-left py-1.5 px-2">Item</th>
              <th className="text-right py-1.5 px-2">Costo</th>
              <th className="text-right py-1.5 px-2">Cobrado</th>
              <th className="text-right py-1.5 px-2">Diff</th>
              <th className="text-left py-1.5 px-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rose-100">
            {rows.map(r => (
              <tr key={r.movement_id}>
                <td className="py-1.5 px-2 font-medium text-slate-800">{r.item_name}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatCurrency(r.repair_cost)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{formatCurrency(r.charged_to_guest)}</td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${
                  r.diff < 0 ? 'text-rose-700' : r.diff > 0 ? 'text-emerald-700' : 'text-slate-500'
                }`}>
                  {r.diff < 0 ? '−' : r.diff > 0 ? '+' : ''}{formatCurrency(Math.abs(r.diff))}
                </td>
                <td className="py-1.5 px-2">
                  {r.status === 'balanced' && <span className="text-emerald-700">✓ Balanceado</span>}
                  {r.status === 'pending_recovery' && <span className="text-rose-700">Falta recuperar</span>}
                  {r.status === 'overpaid' && <span className="text-emerald-700">Sobrante</span>}
                  {r.status === 'no_charge' && <span className="text-slate-600">Sin cobro</span>}
                  {r.status === 'pending_repair' && <span className="text-amber-700">Pago pendiente</span>}
                  {!r.is_repaired && r.expense_status === 'paid' && (
                    <span className="ml-1.5 text-[10px] text-slate-400">· item dañado</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
