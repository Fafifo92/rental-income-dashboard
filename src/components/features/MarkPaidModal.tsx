import { useState } from 'react';
import { motion } from 'framer-motion';
import { markPeriodPaid } from '@/services/recurringPeriods';
import type { PropertyRecurringExpenseRow, BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

export default function MarkPaidModal({
  recurring, yearMonth, banks, onClose, onSaved,
}: {
  recurring: PropertyRecurringExpenseRow;
  yearMonth: string;
  banks: BankAccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(Number(recurring.amount)));
  const [date, setDate] = useState(() => {
    const [y, m] = yearMonth.split('-').map(Number);
    const dom = recurring.day_of_month ?? 1;
    const last = new Date(y, m, 0).getDate();
    const day = Math.min(dom, last);
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!n || n <= 0) { setError('El monto debe ser mayor a 0'); return; }
    if (!date) { setError('Indica la fecha del pago'); return; }
    setSaving(true);
    setError(null);
    const res = await markPeriodPaid({
      recurring,
      yearMonth,
      amount: n,
      date,
      bankAccountId: bankAccountId || null,
      note: note.trim() || null,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      {...makeBackdropHandlers(() => { if (!saving) onClose(); })}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-1">Registrar pago</h3>
        <p className="text-sm text-slate-500 mb-4">
          {recurring.category} — {ymLabel(yearMonth)}
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
          Se creará un gasto real en <strong>/expenses</strong> con los datos que ingreses y quedará
          vinculado a este mes. Podrás deshacer la marca pero el gasto permanecerá (puedes editarlo
          o eliminarlo después).
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Monto real pagado *</label>
            <input
              type="number" step="100" required autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <p className="text-xs text-slate-400 mt-1">Recurrente configurado en {formatCurrency(Number(recurring.amount))}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha de pago *</label>
            <input
              type="date" required
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Cuenta bancaria</label>
            <select
              value={bankAccountId}
              onChange={e => setBankAccountId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">— Sin cuenta asociada —</option>
              {banks.filter(b => b.is_active).map(b => (
                <option key={b.id} value={b.id}>{b.name}{b.bank ? ` · ${b.bank}` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Nota (opcional)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ej: pago por Nequi"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
