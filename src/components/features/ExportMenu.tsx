import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { exportKpisToCsv, exportMonthlyToCsv, exportToExcel } from '@/services/export';
import type { FinancialKPIs, MonthlyPnL, Period } from '@/services/financial';

const PERIOD_LABELS: Record<Period, string> = {
  'current-month':  'Este mes',
  'last-3-months':  'Últimos 3 meses',
  'this-year':      'Este año',
  'all':            'Todo',
};

interface Props {
  kpis: FinancialKPIs;
  monthly: MonthlyPnL[];
  period: Period;
}

interface ExportOption {
  label: string;
  description: string;
  icon: string;
  action: () => Promise<void> | void;
}

export default function ExportMenu({ kpis, monthly, period }: Props) {
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState<string | null>(null);

  const periodLabel = PERIOD_LABELS[period];

  const options: ExportOption[] = [
    {
      label: 'KPIs — CSV',
      description: 'Métricas principales del período',
      icon: '📊',
      action: () => exportKpisToCsv(kpis, periodLabel),
    },
    {
      label: 'P&L Mensual — CSV',
      description: 'Ingresos / gastos mes a mes',
      icon: '📈',
      action: () => exportMonthlyToCsv(monthly),
    },
    {
      label: 'Reporte Excel',
      description: 'KPIs + P&L en múltiples hojas',
      icon: '📋',
      action: () => exportToExcel(kpis, monthly, periodLabel),
    },
    {
      label: 'Imprimir / PDF',
      description: 'Reporte para archivar o compartir',
      icon: '🖨️',
      action: () => window.open('/report', '_blank'),
    },
  ];

  const handleClick = async (opt: ExportOption) => {
    setLoading(opt.label);
    try {
      await opt.action();
    } finally {
      setLoading(null);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen(v => !v)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:border-slate-300 hover:shadow-sm transition-all"
      >
        <span>⬇️</span>
        Exportar
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-12 z-20 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Exportar datos</p>
                <p className="text-xs text-slate-400 mt-0.5">Período: {periodLabel}</p>
              </div>
              {options.map((opt, i) => (
                <motion.button
                  key={opt.label}
                  type="button"
                  onClick={() => handleClick(opt)}
                  disabled={loading !== null}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors disabled:opacity-50 border-b border-slate-50 last:border-0"
                >
                  <span className="text-xl mt-0.5 shrink-0">{opt.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {loading === opt.label ? '⏳ Generando...' : opt.label}
                    </p>
                    <p className="text-xs text-slate-400">{opt.description}</p>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
