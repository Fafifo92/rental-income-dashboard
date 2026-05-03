'use client';
/**
 * Editor especializado para gastos generados por `reportDamage` (subcategory='damage').
 *
 * Por qué existe:
 *  - El `ExpenseModal` genérico obliga al usuario a re-elegir tipo de gasto y
 *    sub-tipo, lo que duplica la información que `reportDamage` ya consolidó
 *    y permite errores (cambiar la categoría rompe la idempotencia, perder el
 *    `__item:` tag, etc.).
 *  - Un daño es un objeto financiero compuesto: tiene un costo de reparación
 *    (este expense) + cero o más cobros al huésped/plataforma (los
 *    `damage_charge` adjustments). El usuario necesita ver ambos lados juntos
 *    para decidir si "le faltó cobrar" o "cobró de más".
 *
 * Qué hace:
 *  - Muestra item / sujeto del daño (read-only, no se puede cambiar al editar).
 *  - Permite editar: costo real de reparación, fecha, descripción visible
 *    (preserva el tag `__item:` o `__subject:`), proveedor, cuenta bancaria,
 *    estado (pending/partial/paid).
 *  - Resume los cobros ya hechos (huésped + plataforma + total).
 *  - Calcula la diferencia y propone acciones (cobrar / asumir).
 *  - Permite descartar el daño completo (gasto + adjustment vinculado).
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { Expense } from '@/types';
import type { BankAccountRow, BookingAdjustmentRow, PropertyRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { useBackdropClose } from '@/lib/useBackdropClose';
import { parseDamageDescription, composeDamageDescription } from '@/lib/damageDescription';
import { listBookingAdjustments, createBookingAdjustment } from '@/services/bookingAdjustments';
import MoneyInput from '@/components/MoneyInput';
import { toast } from '@/lib/toast';

interface Props {
  expense: Expense;
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  onSave: (patch: Partial<Omit<Expense, 'id' | 'owner_id'>>) => Promise<void> | void;
  /** Disponible cuando el daño tiene un `damage_charge` adjustment vinculado: borra ambos. */
  onDiscard?: () => Promise<void> | void;
  /** Refresca tras crear ajuste por la diferencia. */
  onAfterReconcile?: () => Promise<void> | void;
}

export default function DamageExpenseEditModal({
  expense, properties, bankAccounts, onClose, onSave, onDiscard, onAfterReconcile,
}: Props): JSX.Element {
  const backdrop = useBackdropClose(onClose);
  const parsed = useMemo(() => parseDamageDescription(expense.description), [expense.description]);

  // ── Item / sujeto del daño extraído del texto visible ──────────────────
  const subjectLabel = useMemo(() => {
    const m = parsed.visible.match(/^(?:Reposición\/reparación|Daño en propiedad):\s*(.+?)(?:\s+—\s+|$)/i);
    return (m?.[1] ?? '').trim();
  }, [parsed.visible]);
  const userNote = useMemo(() => {
    const m = parsed.visible.match(/—\s+(.+)$/);
    return (m?.[1] ?? '').trim();
  }, [parsed.visible]);

  const isInventoryDamage = (expense.category ?? '').toLowerCase().includes('inventario');
  const property = properties.find(p => p.id === expense.property_id);

  // ── Form state ─────────────────────────────────────────────────────────
  const [amount, setAmount] = useState<number | null>(Number(expense.amount) || 0);
  const [date, setDate] = useState<string>(expense.date);
  const [note, setNote] = useState<string>(userNote);
  const [vendor, setVendor] = useState<string>(expense.vendor ?? '');
  const [status, setStatus] = useState<Expense['status']>(expense.status);
  const [bankAccountId, setBankAccountId] = useState<string | null>(expense.bank_account_id ?? null);
  const [saving, setSaving] = useState(false);

  // ── Reconciliación: trae los damage_charge adjustments del booking ─────
  const [charges, setCharges] = useState<BookingAdjustmentRow[]>([]);
  const [loadingCharges, setLoadingCharges] = useState(true);

  useEffect(() => {
    if (!expense.booking_id) { setLoadingCharges(false); return; }
    const expTag = `[exp:${expense.id}]`;
    listBookingAdjustments(expense.booking_id).then(res => {
      const all = (res.data ?? []).filter(a => a.kind === 'damage_charge');
      const matches = all.filter(a => {
        if (expense.adjustment_id && a.id === expense.adjustment_id) return true;
        // Robust match via embedded expense-ID tag (added since v2)
        if ((a.description ?? '').includes(expTag)) return true;
        // Fallback: text-based match
        if (subjectLabel && (a.description ?? '').toLowerCase().includes(subjectLabel.toLowerCase())) return true;
        return false;
      });
      setCharges(matches);
      setLoadingCharges(false);
    });
  }, [expense.booking_id, expense.id, expense.adjustment_id, subjectLabel]);

  const fromGuest = useMemo(() => charges
    .filter(a => /cobro huésped/i.test(a.description ?? ''))
    .reduce((s, a) => s + Number(a.amount), 0), [charges]);
  const fromPlatform = useMemo(() => charges
    .filter(a => /cobro plataforma/i.test(a.description ?? ''))
    .reduce((s, a) => s + Number(a.amount), 0), [charges]);
  const fromOther = useMemo(() => charges
    .filter(a => !/cobro (huésped|plataforma)/i.test(a.description ?? ''))
    .reduce((s, a) => s + Number(a.amount), 0), [charges]);
  const totalCharged = fromGuest + fromPlatform + fromOther;

  const repairCost = amount ?? 0;
  const diff = repairCost - totalCharged;
  const isShortfall = diff > 0.5 && status !== 'paid';
  const isSurplus = diff < -0.5;

  // ── Acciones ───────────────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!amount || amount <= 0) { toast.error('El costo de reparación debe ser mayor que cero.'); return; }
    if (status === 'paid' && !bankAccountId) {
      toast.error('Indica de qué cuenta salió el dinero para marcarlo como pagado.');
      return;
    }
    setSaving(true);
    await onSave({
      amount,
      date,
      vendor: vendor.trim() || null,
      status,
      bank_account_id: bankAccountId,
      description: composeDamageDescription(
        subjectLabel
          ? `${isInventoryDamage ? 'Reposición/reparación' : 'Daño en propiedad'}: ${subjectLabel}${note.trim() ? ' — ' + note.trim() : ''}`
          : note.trim(),
        parsed.tag,
      ),
    });
    setSaving(false);
  };

  const chargeDifference = async () => {
    if (!expense.booking_id || diff <= 0) return;
    const res = await createBookingAdjustment({
      booking_id: expense.booking_id,
      kind: 'damage_charge',
      amount: diff,
      description: `Cobro pendiente – Daño: ${subjectLabel || 'reparación'} [exp:${expense.id}] (diferencia no cobrada)`,
      date: new Date().toISOString().slice(0, 10),
      bank_account_id: null,
    });
    if (res.error) { toast.error(res.error); return; }
    toast.success('Ajuste creado por la diferencia.');
    await onAfterReconcile?.();
    setCharges(prev => [...prev, res.data!]);
  };

  const acknowledgeLoss = async () => {
    if (diff <= 0) return;
    // Mark the expense as paid/acknowledged — the financial loss is already implicit
    // (repair_cost > charged). No new adjustment needed; creating a 'discount' would double-count.
    setStatus('paid');
    await onSave({ status: 'paid' });
    toast.success('Pérdida asumida. El gasto queda marcado como resuelto.');
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">Editar daño</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {expense.category}
            {property?.name && <> · {property.name}</>}
          </p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          {/* Sujeto (read-only) */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">
              {isInventoryDamage ? 'Item dañado' : 'Daño en propiedad'}
            </label>
            <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium">
              {subjectLabel || <span className="text-slate-400 italic">(sin sujeto identificado)</span>}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              El item del daño no se puede cambiar al editar. Si fue otra cosa, descarta este daño y registra uno nuevo.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Costo real de reparación *</label>
              <MoneyInput value={amount} onChange={setAmount} />
              <p className="text-[11px] text-slate-500 mt-1">Lo que efectivamente cuesta arreglarlo o reponerlo.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Notas</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Detalle adicional sobre el daño o la reparación…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Proveedor / técnico</label>
              <input
                type="text"
                value={vendor}
                onChange={e => setVendor(e.target.value)}
                placeholder="Quién hizo la reparación"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Estado</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as Expense['status'])}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="pending">Pendiente</option>
                <option value="partial">Parcial</option>
                <option value="paid">Pagado</option>
              </select>
            </div>
          </div>

          {(status === 'paid' || status === 'partial') && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Cuenta bancaria *</label>
              <select
                value={bankAccountId ?? ''}
                onChange={e => setBankAccountId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">— Selecciona —</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Reconciliación financiera ─────────────────────────── */}
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-2">Reconciliación con cobros</h4>
            {!expense.booking_id ? (
              <p className="text-xs text-slate-500">Este daño no está vinculado a una reserva, no hay cobros para reconciliar.</p>
            ) : loadingCharges ? (
              <p className="text-xs text-slate-400">Cargando cobros…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                  <KpiBox label="Cobrado huésped" value={fromGuest} tone="ok" />
                  <KpiBox label="Cobrado plataforma" value={fromPlatform} tone="ok" />
                  <KpiBox label="Total cobrado" value={totalCharged} tone="ok" />
                  <KpiBox
                    label="Diferencia"
                    value={Math.abs(diff)}
                    prefix={isShortfall ? '−' : isSurplus ? '+' : ''}
                    tone={isShortfall ? 'bad' : isSurplus ? 'ok' : 'neutral'}
                  />
                </div>
                {totalCharged === 0 && (
                  <p className="text-xs text-slate-600">
                    No hay cobros registrados para este daño. Si vas a cobrar al huésped o a la plataforma, hazlo desde
                    el detalle de la reserva (Registrar daño) o usa "Cobrar la diferencia" abajo.
                  </p>
                )}
                {isShortfall && totalCharged > 0 && (
                  <p className="text-xs text-rose-700">
                    Faltó cobrar {formatCurrency(diff)}. Esto reduce tu utilidad real.
                  </p>
                )}
                {status === 'paid' && diff > 0.5 && (
                  <p className="text-xs text-slate-600">
                    Pérdida asumida: {formatCurrency(diff)} no cobrado, gasto marcado como resuelto.
                  </p>
                )}
                {isSurplus && (
                  <p className="text-xs text-emerald-800">
                    Cobraste {formatCurrency(Math.abs(diff))} más de lo que costó. El excedente queda como ingreso de la reserva.
                  </p>
                )}
                {Math.abs(diff) <= 0.5 && totalCharged > 0 && (
                  <p className="text-xs text-slate-600">Cuadrado: lo cobrado coincide con el costo real.</p>
                )}
                {(isShortfall || totalCharged === 0) && diff > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={chargeDifference}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition"
                    >
                      Cobrar la diferencia ({formatCurrency(diff)})
                    </button>
                    <button
                      type="button"
                      onClick={acknowledgeLoss}
                      className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg transition"
                    >
                      Asumir como pérdida
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </form>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          {onDiscard ? (
            <button
              type="button"
              onClick={onDiscard}
              className="px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-lg transition"
            >
              Descartar daño completo
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Cerrar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition"
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function KpiBox({
  label, value, prefix = '', tone,
}: {
  label: string; value: number; prefix?: string; tone: 'ok' | 'bad' | 'neutral';
}) {
  const cls = tone === 'bad' ? 'text-rose-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-700';
  return (
    <div className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-bold tabular-nums ${cls}`}>{prefix}{formatCurrency(value)}</div>
    </div>
  );
}
