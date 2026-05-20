import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Vendor } from '@/services/vendors';
import type { BankAccountRow } from '@/types/database';
import MoneyInput from '@/components/MoneyInput';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

export default function CleaningFormModal({
  cleaners, banks = [], defaultFee, defaultDate, onClose, onSave,
}: {
  cleaners: Vendor[];
  banks?: BankAccountRow[];
  defaultFee: number | null;
  defaultDate: string;
  onClose: () => void;
  onSave: (p: {
    cleaner_id: string; fee: number;
    status: 'pending' | 'done' | 'paid';
    done_date: string | null; notes: string | null;
    supplies_amount: number; reimburse_to_cleaner: boolean;
    paid_date: string | null;
    bank_account_id: string | null;
  }) => void;
}) {
  const [cleanerId, setCleanerId] = useState<string>('');
  const [fee, setFee] = useState<number | null>(defaultFee ?? null);
  const [status, setStatus] = useState<'pending' | 'done' | 'paid'>('pending');
  const [doneDate, setDoneDate] = useState<string>(defaultDate);
  const [paidDate, setPaidDate] = useState<string>(defaultDate);
  const [bankAccountId, setBankAccountId] = useState<string>('');
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
    if (status === 'paid') {
      if (!paidDate) {
        setError('Indica la fecha en la que se pagó este aseo.');
        return;
      }
      if (!bankAccountId) {
        setError('Indica de qué cuenta saliste a pagar este aseo.');
        return;
      }
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
      paid_date: status === 'paid' ? paidDate : null,
      bank_account_id: status === 'paid' ? bankAccountId : null,
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
          {status === 'paid' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
              <p className="text-xs font-semibold text-emerald-800">Datos del pago</p>
              <p className="text-[11px] text-emerald-700/80 leading-snug">
                Al marcar como pagado se registrará automáticamente el gasto contable y se descontará de la cuenta seleccionada.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Fecha de pago <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={paidDate}
                  onChange={e => setPaidDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Cuenta de pago <span className="text-rose-500">*</span>
                </label>
                <select
                  value={bankAccountId}
                  onChange={e => setBankAccountId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="">— Selecciona la cuenta —</option>
                  {banks.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.bank ? ` — ${b.bank}` : ''}
                    </option>
                  ))}
                </select>
                {banks.length === 0 && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    No tienes cuentas bancarias. <a href="/cuentas" className="underline font-semibold">Agregar →</a>
                  </p>
                )}
              </div>
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
            <button type="submit" disabled={saving || fee == null || (status === 'paid' && (!paidDate || !bankAccountId))}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
