import { useState } from 'react';
import { motion } from 'framer-motion';
import type { BookingAdjustmentKind } from '@/types/database';
import MoneyInput from '@/components/MoneyInput';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

export default function AdjustmentFormModal({
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
