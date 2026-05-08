import { motion, AnimatePresence } from 'framer-motion';
import type { Expense } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { cleanDamageDescription } from '@/lib/damageDescription';

interface Props {
  pendingExpenses: Expense[];
  totalPending: number;
  onPendingClick: (expense: Expense) => void;
}

export default function PendingPayablesPanel({ pendingExpenses, totalPending, onPendingClick }: Props) {
  if (pendingExpenses.length === 0) return null;
  return (
    <AnimatePresence>
      <motion.section
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="border border-yellow-200 bg-yellow-50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-yellow-900 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span> Cuentas por Pagar
              <span className="text-xs font-semibold px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded-full">
                {pendingExpenses.length}
              </span>
            </h3>
            <span className="font-bold text-yellow-800">{formatCurrency(totalPending)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingExpenses.map((e, i) => {
              const cat = (e.category ?? '').toLowerCase();
              const sub = (e.subcategory ?? '').toLowerCase();
              const isCleaning = sub === 'cleaning' || cat === 'aseo' || cat === 'insumos de aseo' || cat === 'cleaning';
              return (
                <motion.button
                  key={e.id}
                  type="button"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => onPendingClick(e)}
                  title={isCleaning ? 'Clic → ir a /aseo para liquidar' : 'Clic para completar, pagar o descartar este gasto pendiente'}
                  className="bg-white rounded-lg p-4 border border-yellow-100 shadow-sm text-left hover:border-yellow-300 hover:shadow transition focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-slate-800 text-sm truncate">{e.category}</p>
                        {isCleaning && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-cyan-50 text-cyan-700 border-cyan-200 whitespace-nowrap">
                            🧹 ASEO
                          </span>
                        )}
                        {e.adjustment_id && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-red-50 text-red-700 border-red-200 whitespace-nowrap">
                            🔗 DAÑO
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{e.date}</p>
                      {(() => { const d = cleanDamageDescription(e.description); return d ? (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">{d}</p>
                      ) : null; })()}
                    </div>
                    <p className="font-bold text-yellow-700 text-sm whitespace-nowrap">{formatCurrency(e.amount)}</p>
                  </div>
                  <p className="text-[10px] text-yellow-700/70 mt-2 font-medium uppercase tracking-wide">
                    {isCleaning ? 'Liquidar en /aseo →' : 'Clic para resolver →'}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
