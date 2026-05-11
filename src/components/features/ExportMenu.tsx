import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { exportKpisToCsv, exportMonthlyToCsv, exportToExcel, type BookingExportRow } from '@/services/export';
import type { FinancialKPIs, MonthlyPnL, Period } from '@/services/financial';
import { resolvePeriodRange } from '@/services/financial';
import { listBookings } from '@/services/bookings';
import { listAllBookingAdjustmentsForExport } from '@/services/bookingAdjustments';
import type { BookingWithListingRow } from '@/services/bookings';

const PERIOD_LABELS: Record<Exclude<Period, 'custom'>, string> = {
  'current-month':  'Este mes',
  'last-3-months':  'Últimos 3 meses',
  'this-year':      'Este año',
  'all':            'Todo',
};

interface Props {
  kpis: FinancialKPIs;
  monthly: MonthlyPnL[];
  /** @deprecated retained for prop-compatibility with DashboardClient — not used */
  monthlyByBookings: MonthlyPnL[];
  period: Period;
  customRange?: { from: string; to: string };
  propertyIds?: string[];
}

interface ExportOption {
  label: string;
  description: string;
  /** Whether this action can include booking data */
  supportsBookings: boolean;
  /** For PDF: just opens a window. For CSV/Excel: receives fetched booking rows. */
  isPdf?: boolean;
  action: (bookings?: BookingExportRow[]) => void | Promise<void>;
}

export default function ExportMenu({ kpis, monthly, period, customRange, propertyIds }: Props) {
  const [open, setOpen]                   = useState(false);
  const [loading, setLoading]             = useState<string | null>(null);
  const [pendingOption, setPendingOption] = useState<ExportOption | null>(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [includeBookings, setIncludeBookings]   = useState(true);
  const [includeAdjustments, setIncludeAdjustments] = useState(false);

  const periodLabel = period === 'custom' && customRange
    ? `${customRange.from} al ${customRange.to}`
    : PERIOD_LABELS[period as Exclude<Period, 'custom'>];

  const options: ExportOption[] = [
    {
      label: 'KPIs — CSV',
      description: 'Métricas principales del período',
      supportsBookings: false,
      action: () => exportKpisToCsv(kpis, periodLabel),
    },
    {
      label: 'P&L Mensual — CSV',
      description: 'Ingresos / gastos mes a mes + reservas (opcional)',
      supportsBookings: true,
      action: (bookings) => exportMonthlyToCsv(monthly, bookings),
    },
    {
      label: 'Reporte Excel',
      description: 'KPIs + P&L + hoja de reservas (opcional)',
      supportsBookings: true,
      action: (bookings) => exportToExcel(kpis, monthly, periodLabel, bookings),
    },
    {
      label: 'Imprimir / PDF',
      description: 'Reporte con calendario de reservas (opcional)',
      supportsBookings: true,
      isPdf: true,
      action: () => { /* handled in handleOptionsSubmit */ },
    },
  ];

  const handleClick = (opt: ExportOption) => {
    setOpen(false);
    if (opt.supportsBookings) {
      setPendingOption(opt);
      setShowOptionsModal(true);
    } else {
      setLoading(opt.label);
      Promise.resolve(opt.action()).finally(() => setLoading(null));
    }
  };

  const handleOptionsSubmit = async () => {
    if (!pendingOption) return;
    setShowOptionsModal(false);
    setLoading(pendingOption.label);

    try {
      if (pendingOption.isPdf) {
        // PDF: PrintReport fetches its own data — just pass flags via URL
        const url = new URL('/report', window.location.origin);
        url.searchParams.set('period', period);
        if (period === 'custom' && customRange) {
          url.searchParams.set('from', customRange.from);
          url.searchParams.set('to', customRange.to);
        }
        if (propertyIds && propertyIds.length > 0) {
          url.searchParams.set('propertyIds', propertyIds.join(','));
        }
        if (includeBookings)    url.searchParams.set('includeBookings', 'true');
        if (includeAdjustments) url.searchParams.set('includeAdjustments', 'true');
        window.open(url.toString(), '_blank');
        return;
      }

      // CSV / Excel: fetch bookings here if requested
      let bookingRows: BookingExportRow[] | undefined;

      if (includeBookings) {
        const { from, to } = resolvePeriodRange(
          period,
          period === 'custom' ? customRange : undefined,
        );
        const bRes = await listBookings({
          propertyIds: propertyIds?.length ? propertyIds : undefined,
          dateFrom: from,
          dateTo: to,
        });

        if (!bRes.error && bRes.data) {
          const adjMap = new Map<string, number>();

          if (includeAdjustments) {
            const adjRes = await listAllBookingAdjustmentsForExport();
            if (!adjRes.error && adjRes.data) {
              const bookingIdSet = new Set(bRes.data.map(b => b.id));
              for (const a of adjRes.data) {
                if (!bookingIdSet.has(a.booking_id)) continue;
                const delta = a.kind === 'discount' ? -Number(a.amount) : Number(a.amount);
                adjMap.set(a.booking_id, (adjMap.get(a.booking_id) ?? 0) + delta);
              }
            }
          }

          bookingRows = bRes.data.map((b: BookingWithListingRow) => ({
            confirmation_code: b.confirmation_code,
            guest_name: b.guest_name,
            check_in: b.start_date,
            check_out: b.end_date,
            nights: b.num_nights,
            revenue: Number(b.total_revenue),
            net_payout: b.net_payout !== null ? Number(b.net_payout) : null,
            status: b.status ?? '',
            channel: b.channel,
            property_name: (b.listings?.properties as { name: string } | null | undefined)?.name ?? null,
            net_adjustment: includeAdjustments ? (adjMap.get(b.id) ?? 0) : null,
          }));
        }
      }

      await pendingOption.action(bookingRows);
    } finally {
      setLoading(null);
      setPendingOption(null);
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
                        {opt.supportsBookings && (
                          <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded font-medium">+ reservas</span>
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

      {/* Report options modal */}
      <AnimatePresence>
        {showOptionsModal && pendingOption && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowOptionsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <h3 className="text-lg font-bold text-slate-800 mb-1">Opciones del informe</h3>
              <p className="text-xs text-slate-500 mb-5">
                <span className="font-medium text-slate-700">{pendingOption.label}</span> — {periodLabel}
              </p>

              {/* Toggle: include bookings */}
              <label className="flex items-start gap-3 cursor-pointer group mb-4">
                <div className="mt-0.5">
                  <input
                    type="checkbox"
                    checked={includeBookings}
                    onChange={e => {
                      setIncludeBookings(e.target.checked);
                      if (!e.target.checked) setIncludeAdjustments(false);
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 accent-blue-600 cursor-pointer"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">
                    📅 Incluir datos de reservas
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pendingOption.isPdf
                      ? 'Agrega calendario mensual y tabla de reservas al PDF'
                      : 'Agrega una sección / hoja con el detalle de cada reserva'}
                  </p>
                </div>
              </label>

              {/* Toggle: include adjustments (only when bookings is checked) */}
              <AnimatePresence>
                {includeBookings && (
                  <motion.label
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-start gap-3 cursor-pointer group mb-5 pl-7 overflow-hidden"
                  >
                    <div className="mt-0.5">
                      <input
                        type="checkbox"
                        checked={includeAdjustments}
                        onChange={e => setIncludeAdjustments(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 accent-blue-600 cursor-pointer"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700 group-hover:text-blue-700">
                        🔧 Incluir ajustes por reserva
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Daños cobrados, ingresos extra, descuentos dados
                      </p>
                    </div>
                  </motion.label>
                )}
              </AnimatePresence>

              <button
                onClick={handleOptionsSubmit}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Generar informe
              </button>
              <button
                onClick={() => setShowOptionsModal(false)}
                className="mt-3 w-full py-2 text-sm text-slate-500 hover:text-slate-700"
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
