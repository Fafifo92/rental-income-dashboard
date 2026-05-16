import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listPendingRecurringForOwner, markPeriodSkipped, type PendingRecurring } from '@/services/recurringPeriods';
import { listBankAccounts } from '@/services/bankAccounts';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import MarkPaidModal from './MarkPaidModal';
import { toast } from '@/lib/toast';

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

export default function RecurringPendingPanel({
  propertyFilter = null,
  propertyIds = null,
  onChanged,
  autoOpenRecurringId,
  autoOpenYm,
}: {
  propertyFilter?: string | null;
  propertyIds?: string[] | null;
  onChanged?: () => void;
  autoOpenRecurringId?: string | null;
  autoOpenYm?: string | null;
}) {
  const [items, setItems] = useState<PendingRecurring[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [paying, setPaying] = useState<PendingRecurring | null>(null);
  const autoOpened = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, bankRes] = await Promise.all([
      listPendingRecurringForOwner(6),
      listBankAccounts(),
    ]);
    if (res.data) setItems(res.data);
    if (bankRes.data) setBanks(bankRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = propertyIds && propertyIds.length > 0
    ? items.filter(p => propertyIds.includes(p.recurring.property_id))
    : propertyFilter
      ? items.filter(p => p.recurring.property_id === propertyFilter)
      : items;

  // Deep-link: auto-open MarkPaidModal for a specific recurring + yearMonth
  useEffect(() => {
    if (!autoOpenRecurringId || !autoOpenYm || autoOpened.current || loading || visible.length === 0) return;
    const match = visible.find(p => p.recurring.id === autoOpenRecurringId && p.yearMonth === autoOpenYm);
    if (match) {
      autoOpened.current = true;
      setCollapsed(false);
      setPaying(match);
    }
  }, [autoOpenRecurringId, autoOpenYm, loading, visible]);

  const handleSkip = async (p: PendingRecurring) => {
    const note = prompt(`Marcar "${p.recurring.category}" de ${ymLabel(p.yearMonth)} como no aplicable. Razón (opcional):`);
    if (note === null) return;
    const res = await markPeriodSkipped({ recurringId: p.recurring.id, yearMonth: p.yearMonth, note: note || null });
    if (res.error) { toast.error(res.error); return; }
    toast.success('Periodo marcado como no aplicable');
    await load();
    onChanged?.();
  };

  if (loading) {
    return (
      <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
    );
  }

  if (visible.length === 0) return null;

  const overdue = visible.filter(p => !p.isCurrentMonth).length;
  const currentMonth = visible.filter(p => p.isCurrentMonth).length;
  const totalAmount = visible.reduce((s, p) => s + Number(p.recurring.amount), 0);

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border-2 ${overdue > 0 ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-between gap-3 p-4 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={`text-2xl ${overdue > 0 ? 'animate-pulse' : ''}`}>
              {overdue > 0 ? '⚠️' : '🔔'}
            </span>
            <div className="min-w-0">
              <h3 className={`font-bold ${overdue > 0 ? 'text-rose-800' : 'text-amber-800'}`}>
                Pagos recurrentes pendientes
                <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  overdue > 0 ? 'bg-rose-200 text-rose-800' : 'bg-amber-200 text-amber-800'
                }`}>
                  {visible.length}
                </span>
              </h3>
              <p className={`text-xs ${overdue > 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                {overdue > 0 && `${overdue} atrasado${overdue > 1 ? 's' : ''}`}
                {overdue > 0 && currentMonth > 0 && ' · '}
                {currentMonth > 0 && `${currentMonth} este mes`}
                {' · '}
                Total estimado {formatCurrency(totalAmount)}
              </p>
            </div>
          </div>
          <span className={`text-xs font-medium ${overdue > 0 ? 'text-rose-700' : 'text-amber-700'}`}>
            {collapsed ? 'Ver detalle ▾' : 'Ocultar ▴'}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visible.map((p, i) => (
                  <motion.div
                    key={`${p.recurring.id}-${p.yearMonth}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className={`bg-white rounded-lg p-3 border shadow-sm ${
                      p.isCurrentMonth ? 'border-amber-200' : 'border-rose-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800 text-sm truncate">{p.recurring.category}</p>
                        <p className="text-xs text-slate-500 truncate" title={p.propertyName}>
                          {p.propertyName} · {ymLabel(p.yearMonth)}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                        p.isCurrentMonth
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'bg-rose-100 text-rose-700 border border-rose-200'
                      }`}>
                        {p.isCurrentMonth ? 'este mes' : 'atrasado'}
                      </span>
                    </div>
                    <p className="font-bold text-slate-800 text-sm mb-2">
                      {formatCurrency(Number(p.recurring.amount))}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPaying(p)}
                        className="flex-1 text-xs font-semibold px-2 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        ✓ Marcar pagado
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSkip(p)}
                        className="text-xs font-medium px-2 py-1.5 text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
                        title="No aplica este mes (ej. desocupado)"
                      >
                        omitir
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
              <p className="px-4 pb-3 text-[11px] text-slate-500">
                Tip: al marcar pagado se crea el gasto real en esta lista automáticamente.
                Puedes gestionar los rubros recurrentes desde cada propiedad.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      <AnimatePresence>
        {paying && (
          <MarkPaidModal
            recurring={paying.recurring}
            yearMonth={paying.yearMonth}
            banks={banks}
            onClose={() => setPaying(null)}
            onSaved={() => { setPaying(null); load(); onChanged?.(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
