import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Layers, Trash2 } from 'lucide-react';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { formatCurrency } from '@/lib/utils';
import type { Expense, GroupedExpense } from '@/types';
import type { BankAccountRow } from '@/types/database';

type Status = 'pending' | 'partial' | 'paid';

interface ChildAmountChange {
  id: string;
  amount: number;
}

interface Props {
  groupExpense: GroupedExpense;
  bankAccounts: BankAccountRow[];
  /** Map of property_id → property name for labelling children. */
  propertyMap?: Map<string, string>;
  onClose: () => void;
  onSave: (
    sharedPatch: Partial<Pick<Expense, 'status' | 'bank_account_id' | 'date' | 'description'>>,
    childAmounts: ChildAmountChange[],
  ) => Promise<boolean>;
  onDelete?: () => void;
}

const STATUS_OPTS: { value: Status; label: string; color: string }[] = [
  { value: 'pending', label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'partial', label: 'Parcial',   color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'paid',    label: 'Pagado',    color: 'bg-green-100 text-green-700 border-green-200' },
];

export default function GroupExpenseEditModal({ groupExpense, bankAccounts, propertyMap = new Map(), onClose, onSave, onDelete }: Props) {
  const children: Expense[] = groupExpense.children ?? [];
  const groupTotal = groupExpense.groupTotal ?? groupExpense.amount;

  const initialStatus = (groupExpense.status as Status) ?? 'pending';
  const [status, setStatus]   = useState<Status>(initialStatus);
  const [date, setDate]       = useState(groupExpense.date ?? '');
  const [bankId, setBankId]   = useState<string>(groupExpense.bank_account_id ?? '');
  const [desc, setDesc]       = useState(groupExpense.description ?? '');
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Per-child editable amounts (string for input binding)
  const [childAmounts, setChildAmounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of children) init[c.id] = String(c.amount);
    return init;
  });

  const runningTotal = useMemo(() =>
    children.reduce((sum, c) => sum + (parseFloat(childAmounts[c.id] ?? String(c.amount)) || 0), 0),
    [children, childAmounts],
  );

  // Build the dropdown options — always include the currently assigned account even if inactive
  const visibleAccounts = useMemo(() => {
    const active = bankAccounts.filter(b => b.is_active);
    if (bankId && !active.find(b => b.id === bankId)) {
      const assigned = bankAccounts.find(b => b.id === bankId);
      if (assigned) return [assigned, ...active];
    }
    return active;
  }, [bankAccounts, bankId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only require bank account when status is being changed TO 'paid' from a non-paid state
    if (initialStatus !== 'paid' && status === 'paid' && !bankId) {
      setError('Para marcar como pagado, selecciona la cuenta que realizó el pago.');
      return;
    }
    setSaving(true);
    setError(null);

    const sharedPatch: Partial<Pick<Expense, 'status' | 'bank_account_id' | 'date' | 'description'>> = {
      status,
      date: date || undefined,
      // Only include bank_account_id if a value was selected; omitting it leaves the existing DB value intact
      ...(bankId ? { bank_account_id: bankId } : {}),
      description: desc.trim() || undefined,
    };

    // Collect only changed amounts
    const changedAmounts: ChildAmountChange[] = children
      .map(c => ({ id: c.id, amount: parseFloat(childAmounts[c.id] ?? '') || c.amount }))
      .filter((c, i) => c.amount !== children[i].amount);

    const ok = await onSave(sharedPatch, changedAmounts);
    setSaving(false);
    if (!ok) setError('No se pudo guardar. Intenta de nuevo.');
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    onDelete();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      {...makeBackdropHandlers(() => { if (!saving && !deleting) onClose(); })}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Editar grupo de gastos</h3>
              <p className="text-sm text-slate-500">
                {groupExpense.category}
                {children.length > 0 && ` · ${children.length} propiedad${children.length !== 1 ? 'es' : ''}`}
              </p>
            </div>
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
              className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors ml-2 flex-shrink-0"
              title="Eliminar grupo completo"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="my-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm font-semibold text-red-700 mb-1">¿Eliminar todo el grupo?</p>
            <p className="text-xs text-red-600 mb-3">
              Se eliminarán <strong>{children.length}</strong> gasto{children.length !== 1 ? 's' : ''} en total. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-1.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-1.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        )}

        {/* Group running total */}
        <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 mb-5 flex items-center justify-between">
          <span className="text-sm text-violet-700 font-medium">Total del grupo</span>
          <div className="text-right">
            <span className={`text-lg font-bold ${runningTotal !== groupTotal ? 'text-amber-600' : 'text-violet-800'}`}>
              {formatCurrency(runningTotal)}
            </span>
            {runningTotal !== groupTotal && (
              <p className="text-xs text-amber-600">antes: {formatCurrency(groupTotal)}</p>
            )}
          </div>
        </div>

        {/* Per-property breakdown */}
        {children.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Propiedades incluidas</p>
            <div className="space-y-2">
              {children.map(child => {
                const propName = child.property_id ? (propertyMap.get(child.property_id) ?? child.property_id) : '— Sin propiedad';
                return (
                  <div key={child.id} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2">
                    <span className="flex-1 text-sm text-slate-700 truncate" title={propName}>{propName}</span>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">$</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={childAmounts[child.id] ?? ''}
                        onChange={e => setChildAmounts(prev => ({ ...prev, [child.id]: e.target.value }))}
                        className="w-36 pl-6 pr-2 py-1.5 text-sm text-right border border-slate-200 rounded-md focus:ring-2 focus:ring-violet-400 outline-none bg-white"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500 mb-4">
          El estado, fecha y cuenta se aplican a <strong>todos los gastos del grupo</strong>. Los montos pueden editarse por propiedad.
        </p>

        <form onSubmit={submit} className="space-y-4">
          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Estado</label>
            <div className="flex gap-2">
              {STATUS_OPTS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                    status === opt.value
                      ? opt.color + ' shadow-sm ring-2 ring-offset-1 ring-violet-400'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha de pago</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-400 outline-none"
            />
          </div>

          {/* Bank account */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Cuenta bancaria {status === 'paid' && <span className="text-rose-600">*</span>}
            </label>
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-violet-400 outline-none bg-white ${
                status === 'paid' && !bankId ? 'border-rose-300' : 'border-slate-200'
              }`}
            >
              <option value="">— Sin cuenta asignada —</option>
              {visibleAccounts.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.bank ? ` · ${b.bank}` : ''}{!b.is_active ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción (opcional)</label>
            <input
              type="text"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Descripción del grupo…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-400 outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Guardando…' : 'Guardar grupo'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
