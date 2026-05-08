import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { exportKpisToCsv, exportMonthlyToCsv, exportToExcel } from '@/services/export';
import type { FinancialKPIs, MonthlyPnL, Period } from '@/services/financial';

const PERIOD_LABELS: Record<Exclude<Period, 'custom'>, string> = {
  'current-month':  'Este mes',
  'last-3-months':  'Últimos 3 meses',
  'this-year':      'Este año',
  'all':            'Todo',
};

const MODE_OPTIONS = [
  {
    id: 'by-days' as const,
    label: 'Por días (prorrateo)',
    description: 'Reparte cada reserva noche a noche. Más preciso para períodos parciales.',
  },
  {
    id: 'by-bookings' as const,
    label: 'Por reservas (check-in)',
    description: 'Toda la reserva se atribuye al mes de llegada. Útil para ver ingresos comprometidos.',
  },
];

interface Props {
  kpis: FinancialKPIs;
  monthly: MonthlyPnL[];
  monthlyByBookings: MonthlyPnL[];
  period: Period;
  customRange?: { from: string; to: string };
  propertyIds?: string[];
}

export default function ExportMenu({ kpis, monthly, monthlyByBookings, period, customRange, propertyIds }: Props) {
  const [open, setOpen]                             = useState(false);
  const [loading, setLoading]                       = useState<string | null>(null);
  const [pendingLabel, setPendingLabel]             = useState<string | null>(null);
  const [pendingAction, setPendingAction]           = useState<((mode: 'by-days' | 'by-bookings') => void) | null>(null);
  const [showModeChooser, setShowModeChooser]       = useState(false);

  const periodLabel = period === 'custom' && customRange
    ? `${customRange.from} al ${customRange.to}`
    : PERIOD_LABELS[period as Exclude<Period, 'custom'>];

  type ExportAction = (mode: 'by-days' | 'by-bookings') => void;

  const options: { label: string; description: string; needsMode: boolean; action: ExportAction }[] = [
    {
      label: 'KPIs — CSV',
      description: 'Métricas principales del período',
      needsMode: false,
      action: () => exportKpisToCsv(kpis, periodLabel),
    },
    {
      label: 'P&L Mensual — CSV',
      description: 'Ingresos / gastos mes a mes',
      needsMode: true,
      action: (mode) => exportMonthlyToCsv(
        mode === 'by-bookings' ? monthlyByBookings : monthly,
        MODE_OPTIONS.find(m => m.id === mode)!.label,
      ),
    },
    {
      label: 'Reporte Excel',
      description: 'KPIs + P&L en múltiples hojas',
      needsMode: true,
      action: (mode) => exportToExcel(
        kpis,
        mode === 'by-bookings' ? monthlyByBookings : monthly,
        periodLabel,
        MODE_OPTIONS.find(m => m.id === mode)!.label,
      ),
    },
    {
      label: 'Imprimir / PDF',
      description: 'Reporte para archivar o compartir',
      needsMode: true,
      action: (mode) => {
        const url = new URL('/report', window.location.origin);
        url.searchParams.set('period', period);
        if (period === 'custom' && customRange) {
          url.searchParams.set('from', customRange.from);
          url.searchParams.set('to', customRange.to);
        }
        if (propertyIds && propertyIds.length > 0) {
          url.searchParams.set('propertyIds', propertyIds.join(','));
        }
        url.searchParams.set('mode', mode);
        window.open(url.toString(), '_blank');
      },
    },
  ];

  const handleClick = (opt: typeof options[0]) => {
    if (opt.needsMode) {
      setPendingLabel(opt.label);
      setPendingAction(() => opt.action);
      setOpen(false);
      setShowModeChooser(true);
    } else {
      setLoading(opt.label);
      Promise.resolve(opt.action('by-days')).finally(() => {
        setLoading(null);
        setOpen(false);
      });
    }
  };

  const handleModeSelect = async (mode: 'by-days' | 'by-bookings') => {
    if (!pendingAction) return;
    setLoading(pendingLabel);
    setShowModeChooser(false);
    try {
      await pendingAction(mode);
    } finally {
      setLoading(null);
      setPendingAction(null);
      setPendingLabel(null);
    }
  };

  return (
    <>
      <div className="relative">
        <motion.button
          type="button"
          onClick={() => setOpen(v => !v)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:border-slate-300 hover:shadow-sm transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
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
                    <div>
                      <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                        {loading === opt.label ? 'Generando…' : opt.label}
                        {opt.needsMode && (
                          <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded font-medium">modo</span>
                        )}
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

      {/* Mode chooser modal */}
      <AnimatePresence>
        {showModeChooser && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModeChooser(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <h3 className="text-lg font-bold text-slate-800 mb-1">¿Cómo atribuir los ingresos?</h3>
              <p className="text-xs text-slate-500 mb-4">Solo afecta la exportación — el dashboard no cambia.</p>
              <div className="space-y-3">
                {MODE_OPTIONS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => handleModeSelect(m.id)}
                    className="w-full text-left px-4 py-3 border-2 border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors group"
                  >
                    <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">{m.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowModeChooser(false)}
                className="mt-4 w-full py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancelar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
