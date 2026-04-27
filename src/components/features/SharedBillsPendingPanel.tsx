import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listPendingSharedBills, type PendingSharedBill } from '@/services/sharedBills';
import { listBankAccounts } from '@/services/bankAccounts';
import type { BankAccountRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import SharedBillPayModal from './SharedBillPayModal';

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

export default function SharedBillsPendingPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<PendingSharedBill[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [paying, setPaying] = useState<PendingSharedBill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, bankRes] = await Promise.all([
      listPendingSharedBills(6),
      listBankAccounts(),
    ]);
    if (res.data) setItems(res.data);
    if (bankRes.data) setBanks(bankRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('recurring-period-changed', handler);
    return () => window.removeEventListener('recurring-period-changed', handler);
  }, [load]);

  if (loading) return <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />;
  if (items.length === 0) return null;

  const overdue = items.filter(p => !p.isCurrentMonth).length;
  const currentMonth = items.filter(p => p.isCurrentMonth).length;
  const total = items.reduce((s, p) => s + p.estimatedAmount, 0);

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border-2 bg-blue-50 border-blue-200"
      >
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-between gap-3 p-4 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl">🧾</span>
            <div className="min-w-0">
              <h3 className="font-bold text-blue-800">
                Facturas de proveedor pendientes
                <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800">
                  {items.length}
                </span>
              </h3>
              <p className="text-xs text-blue-700">
                {overdue > 0 && `${overdue} atrasada${overdue > 1 ? 's' : ''}`}
                {overdue > 0 && currentMonth > 0 && ' · '}
                {currentMonth > 0 && `${currentMonth} este mes`}
                {' · '}
                Estimado {formatCurrency(total)} · se dividen entre propiedades cubiertas
              </p>
            </div>
          </div>
          <span className="text-xs font-medium text-blue-700">
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
                {items.map((p, i) => (
                  <motion.div
                    key={`${p.vendor.id}-${p.yearMonth}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="bg-white rounded-lg p-3 border border-blue-200 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800 text-sm truncate">{p.vendor.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {ymLabel(p.yearMonth)} · cubre {p.propertiesCount} propiedad{p.propertiesCount > 1 ? 'es' : ''}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                        p.isCurrentMonth
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : 'bg-rose-100 text-rose-700 border border-rose-200'
                      }`}>
                        {p.isCurrentMonth ? 'este mes' : 'atrasado'}
                      </span>
                    </div>
                    <p className="font-bold text-slate-800 text-sm mb-2">
                      ≈ {formatCurrency(p.estimatedAmount)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPaying(p)}
                      className="w-full text-xs font-semibold px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      🧾 Registrar pago
                    </button>
                  </motion.div>
                ))}
              </div>
              <p className="px-4 pb-3 text-[11px] text-slate-500">
                Al registrar el pago se divide automáticamente entre las propiedades del proveedor
                (según el % configurado o por partes iguales) y crea un gasto por cada una.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      <AnimatePresence>
        {paying && (
          <SharedBillPayModal
            vendor={paying.vendor}
            yearMonth={paying.yearMonth}
            estimatedAmount={paying.estimatedAmount}
            banks={banks}
            onClose={() => setPaying(null)}
            onSaved={() => { setPaying(null); load(); onChanged?.(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
