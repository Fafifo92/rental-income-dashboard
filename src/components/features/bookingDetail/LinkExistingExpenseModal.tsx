import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { listExpenses } from '@/services/expenses';
import type { Expense } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';

export default function LinkExistingExpenseModal({
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
