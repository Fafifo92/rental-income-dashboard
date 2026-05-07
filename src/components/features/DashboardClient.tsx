import { useState, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardSummary, { KPISkeleton } from './DashboardSummary';
import RevenueChart from './RevenueChart';
import OccupancyGrid from './OccupancyGrid';
import OccupancyByProperty from './OccupancyByProperty';
import PeriodSelector from './PeriodSelector';
import CSVUploader from './CSVUploader';
import ExportMenu from './ExportMenu';
import AlertsPanel from './AlertsPanel';
import IncomeExpenseTab from './IncomeExpenseTab';
import ActiveBookingsWidget from './ActiveBookingsWidget';
const BookingDetailModal = lazy(() => import('./BookingDetailModal'));
import PropertyMultiSelect from '@/components/PropertyMultiSelectFilter';
import { computeFinancials, resolvePeriodRange, type Period, type FinancialKPIs, type MonthlyPnL, type PayoutBreakdown } from '@/services/financial';
import { listTransactions, type FinancialTransaction } from '@/services/transactions';
import type { ParsedBooking } from '@/services/etl';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';
import { formatCurrency } from '@/lib/utils';
import { listInventoryItems, getDamageReconciliations, computeInventoryKpis, STATUS_LABEL, type DamageReconciliation } from '@/services/inventory';
import type { InventoryItemRow, PropertyRow, BankAccountRow } from '@/types/database';
import { getBooking, type BookingWithListingRow } from '@/services/bookings';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';

// ─── Break-even Alert ─────────────────────────────────────────────────────────

// ─── P&L Waterfall panel ──────────────────────────────────────────────────────

function PLPanel({ kpis }: { kpis: FinancialKPIs }) {
  const bookingRevenue = kpis.grossRevenue - (kpis.netAdjustmentIncome ?? 0) - (kpis.cancelledRevenue ?? 0);
  const rows: Array<{ label: string; value: number; variant: 'revenue' | 'expense' | 'total' | 'adj' | 'info' }> = [
    { label: 'Ingresos por reservas', value: bookingRevenue,               variant: 'revenue' },
    ...(kpis.cancelledRevenue && kpis.cancelledRevenue > 0
      ? [{ label: 'Ingresos por cancelación', value: kpis.cancelledRevenue, variant: 'adj' as const }]
      : []),
    ...(kpis.netAdjustmentIncome && kpis.netAdjustmentIncome !== 0
      ? [{ label: 'Ajustes (daños cobrados, extras, etc.)', value: kpis.netAdjustmentIncome, variant: 'adj' as const }]
      : []),
    { label: 'Ingreso Bruto Total',  value: kpis.grossRevenue,            variant: 'total' },
    ...(kpis.totalChannelFees && kpis.totalChannelFees > 0
      ? [{ label: '↳ Fees de canal (referencia)', value: kpis.totalChannelFees, variant: 'info' as const }]
      : []),
    { label: 'Gastos Variables',     value: -kpis.totalVariableExpenses,   variant: 'expense' },
    ...(kpis.cancelledFines && kpis.cancelledFines > 0
      ? [{ label: '  · incl. multas por cancelación', value: -kpis.cancelledFines, variant: 'adj' as const }]
      : []),
    { label: 'Margen Contribución',  value: kpis.contributionMargin,      variant: 'total' },
    { label: 'Gastos Fijos',         value: -kpis.totalFixedExpenses,     variant: 'expense' },
    { label: 'Utilidad Neta',        value: kpis.netProfit,               variant: 'total' },
  ];
  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm">
      <h3 className="font-bold text-slate-800 mb-4">Análisis de Rentabilidad</h3>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.07 }}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
              row.variant === 'total'
                ? row.value >= 0
                  ? 'bg-green-50 font-bold text-green-800'
                  : 'bg-red-50 font-bold text-red-800'
                : row.variant === 'expense'
                  ? 'text-red-700'
                  : row.variant === 'adj'
                    ? row.value >= 0 ? 'text-emerald-700 text-xs' : 'text-rose-700 text-xs'
                    : row.variant === 'info'
                      ? 'text-slate-500 text-xs italic'
                      : 'text-blue-700 font-medium'
            }`}
          >
            <span>{row.label}</span>
            <span className={
              row.variant === 'expense' ? 'text-red-600'
              : row.variant === 'adj' ? (row.value >= 0 ? 'text-emerald-600' : 'text-rose-600')
              : row.variant === 'info' ? 'text-slate-400'
              : undefined
            }>
              {row.variant === 'expense' ? '−' : row.variant === 'adj' && row.value >= 0 ? '+' : ''}
              {formatCurrency(Math.abs(row.value))}
            </span>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t text-xs text-slate-400 space-y-1">
        <p>Break-even: <strong className="text-slate-500">{kpis.breakEvenNights} noches / {kpis.breakEvenOccupancy}%</strong></p>
        <p>ADR: <strong className="text-slate-500">{formatCurrency(kpis.adr)}</strong> · RevPAR: <strong className="text-slate-500">{formatCurrency(kpis.revpar)}</strong></p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardClient() {
  const authStatus = useAuth();
  const { properties, propertyIds, setPropertyIds, groups, tags, tagAssigns } = usePropertyFilter();
  const [period, setPeriod]               = useState<Period>('last-3-months');
  const [customRange, setCustomRange]     = useState<{ from: string; to: string } | undefined>(undefined);
  const [kpis, setKpis]                   = useState<FinancialKPIs | null>(null);
  const [monthlyPnL, setMonthlyPnL]       = useState<MonthlyPnL[]>([]);
  const [exportMonthly, setExportMonthly] = useState<MonthlyPnL[]>([]);
  const [payoutBreakdown, setPayoutBreakdown] = useState<PayoutBreakdown | null>(null);
  const [granularity, setGranularity]     = useState<import('@/services/financial').ChartGranularity>('week');
  const [transactions, setTransactions]   = useState<FinancialTransaction[]>([]);
  const [txLoading, setTxLoading]         = useState(false);
  const [activeTab, setActiveTab]         = useState<'resumen' | 'ingresos-egresos' | 'en-curso' | 'calendario'>('resumen');
  const [loading, setLoading]             = useState(true);
  const [showUploader, setShowUploader]   = useState(false);
  const [importedBookings, setImportedBookings] = useState<ParsedBooking[]>([]);
  const [calendarDetailBooking, setCalendarDetailBooking] = useState<BookingWithListingRow | null>(null);
  const [calendarDetailLoading, setCalendarDetailLoading] = useState(false);
  const [allProperties, setAllProperties] = useState<PropertyRow[]>([]);
  const [allBankAccounts, setAllBankAccounts] = useState<BankAccountRow[]>([]);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    listProperties().then(res => { if (!res.error) setAllProperties(res.data ?? []); });
    listBankAccounts().then(res => { if (!res.error) setAllBankAccounts((res.data ?? []).filter(a => a.is_active)); });
  }, [authStatus]);

  const handleCalendarBookingClick = async (bookingId: string) => {
    setCalendarDetailLoading(true);
    const res = await getBooking(bookingId);
    setCalendarDetailLoading(false);
    if (!res.error && res.data) setCalendarDetailBooking(res.data);
  };

  useEffect(() => {
    if (authStatus === 'checking') return;
    // Don't fire for 'custom' until a valid range is set
    if (period === 'custom' && (!customRange?.from || !customRange?.to)) return;
    let cancelled = false;
    setLoading(true);
    computeFinancials(period, authStatus === 'authed', propertyIds, customRange).then(result => {
      if (cancelled) return;
      setKpis(result.kpis);
      setMonthlyPnL(result.monthlyPnL);
      setExportMonthly(result.exportMonthly);
      setPayoutBreakdown(result.payoutBreakdown);
      setGranularity(result.granularity);
      setLoading(false);
    });

    // Load financial transaction ledger
    setTxLoading(true);
    const { from, to } = resolvePeriodRange(period, customRange);
    listTransactions(from, to, propertyIds?.length ? propertyIds : undefined).then(result => {
      if (cancelled) return;
      setTransactions(result.data ?? []);
      setTxLoading(false);
    });

    return () => { cancelled = true; };
  }, [period, authStatus, propertyIds, customRange]);

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  return (
    <>
      <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Panel de Control</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-slate-500">Análisis de tus rentas de corta estancia.</p>
              {kpis?.isDemo && (
                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                  Modo demo
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <PropertyMultiSelect properties={properties} value={propertyIds} onChange={setPropertyIds} groups={groups} tags={tags} tagAssigns={tagAssigns} />
            <PeriodSelector value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
            {!loading && kpis && (
              <ExportMenu kpis={kpis} monthly={exportMonthly} period={period} customRange={customRange} propertyIds={propertyIds} />
            )}
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {(['resumen', 'ingresos-egresos', 'en-curso', 'calendario'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                activeTab === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'resumen' ? 'Resumen'
                : tab === 'ingresos-egresos' ? 'Ingresos vs Egresos'
                : tab === 'en-curso' ? 'Reservas en curso'
                : 'Calendario de ocupacion'}
            </button>
          ))}
        </div>

        {activeTab === 'ingresos-egresos' && kpis && payoutBreakdown ? (
          <IncomeExpenseTab payout={payoutBreakdown} kpis={kpis} granularity={granularity} transactions={transactions} txLoading={txLoading} />
        ) : activeTab === 'en-curso' ? (
          <ActiveBookingsWidget propertyIds={propertyIds} />
        ) : activeTab === 'calendario' ? (
          <div className="space-y-4">
            {calendarDetailLoading && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm">
                <div className="bg-white rounded-xl px-6 py-4 shadow-xl flex items-center gap-3">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full" />
                  <span className="text-sm text-slate-600 font-medium">Cargando reserva…</span>
                </div>
              </div>
            )}
            {(() => {
              const { from, to } = resolvePeriodRange(period, customRange);
              return (
                <OccupancyGrid
                  from={from}
                  to={to}
                  propertyIds={propertyIds}
                  totalNights={kpis?.totalNights ?? 0}
                  availableNights={kpis?.availableNights ?? 0}
                  occupancyRate={kpis?.occupancyRate ?? 0}
                  breakEvenOccupancy={kpis?.breakEvenOccupancy ?? 0}
                  onBookingClick={handleCalendarBookingClick}
                />
              );
            })()}
          </div>
        ) : (
          <>
        {/* KPI Grid */}
        <section>
          {loading || !kpis ? <KPISkeleton /> : <DashboardSummary kpis={kpis} />}
        </section>

        {/* Alerts */}
        {!loading && kpis && <AlertsPanel kpis={kpis} monthly={monthlyPnL} />}

        {/* Bloque 16 — Items con problemas */}
        {!loading && <InventoryProblemsWidget />}

        {/* Empty state for new authenticated users */}
        {!loading && authStatus === 'authed' && kpis && kpis.totalBookings === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-10 text-center"
          >
          <div className="text-4xl mb-4 text-slate-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4a1 1 0 001-1v-5h2v5a1 1 0 001 1h4a1 1 0 001-1V10" />
            </svg>
          </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">¡Bienvenido a STR Analytics!</h3>
            <p className="text-slate-500 mb-8 max-w-md mx-auto">
              Tu cuenta está lista. Comienza importando tus reservas de Airbnb para ver tus métricas financieras en tiempo real.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => setShowUploader(true)}
                className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
              >
                Importar reservas de Airbnb
              </button>
              <a
                href="/properties"
                className="px-6 py-3 bg-white text-blue-600 font-semibold rounded-xl border border-blue-200 hover:bg-blue-50 transition-colors"
              >
                Crear propiedad
              </a>
            </div>
          </motion.div>
        )}

        {/* Charts + Sidebar */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <RevenueChart data={monthlyPnL} />
            {(() => {
              const { from, to } = resolvePeriodRange(period, customRange);
              return (
                <OccupancyByProperty
                  granularity={granularity}
                  from={from}
                  to={to}
                  propertyIds={propertyIds}
                  breakEvenOccupancy={kpis?.breakEvenOccupancy ?? 0}
                />
              );
            })()}
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="space-y-6"
          >
            {/* Quick Actions */}
            <div className="p-6 bg-white border rounded-xl shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4">Acciones Rápidas</h3>
              <div className="grid gap-3">
                {[
                  { label: 'Importar CSV / XLSX de Airbnb', onClick: () => setShowUploader(true) },
                  { label: 'Ver Reservas', href: '/bookings' },
                  { label: 'Registrar Gasto', href: '/expenses' },
                  { label: 'Ver Propiedades', href: '/properties' },
                ].map(item => (
                  item.href ? (
                    <motion.a
                      key={item.label}
                      href={item.href}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full text-left px-4 py-3 text-sm font-medium rounded-lg bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      {item.label}
                    </motion.a>
                  ) : (
                    <motion.button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full text-left px-4 py-3 text-sm font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      {item.label}
                    </motion.button>
                  )
                ))}
              </div>
            </div>

            {/* P&L Waterfall */}
            {!loading && kpis && <PLPanel kpis={kpis} />}

            {/* Import summary */}
            {importedBookings.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-6 bg-green-50 border border-green-200 rounded-xl"
              >
                <p className="text-sm font-semibold text-green-800 mb-3">✅ Datos importados</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-green-700">Reservas</span>
                    <span className="font-bold text-green-900">{importedBookings.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-700">Ingresos</span>
                    <span className="font-bold text-green-900">
                      {formatCurrency(importedBookings.reduce((s, b) => s + b.revenue, 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-700">Noches</span>
                    <span className="font-bold text-green-900">
                      {importedBookings.reduce((s, b) => s + b.num_nights, 0)}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.aside>
        </section>

        {/* Imported bookings table */}
        <AnimatePresence>
          {importedBookings.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-slate-900">Reservas Importadas</h3>
                <span className="text-sm text-slate-500">{importedBookings.length} reservas</span>
              </div>
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto max-h-[400px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 border-b">
                      <tr>
                        {['Código', 'Estado', 'Huésped', 'Check-in', 'Check-out', 'Noches', 'Anuncio', 'Ingresos'].map(h => (
                          <th key={h} className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importedBookings.map((b, i) => (
                        <motion.tr
                          key={b.confirmation_code || i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(i * 0.02, 0.8) }}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{b.confirmation_code}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              b.status.toLowerCase().includes('complet') ? 'bg-green-100 text-green-700' :
                              b.status.toLowerCase().includes('cancel') ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>{b.status}</span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-800">{b.guest_name}</td>
                          <td className="px-4 py-3 text-slate-500">{b.start_date}</td>
                          <td className="px-4 py-3 text-slate-500">{b.end_date}</td>
                          <td className="px-4 py-3 text-center">{b.num_nights}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{b.listing_name}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(b.revenue)}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
          </>
        )}
      </main>

      <AnimatePresence>
        {showUploader && (
          <CSVUploader
            onClose={() => setShowUploader(false)}
            onImport={setImportedBookings}
          />
        )}
      </AnimatePresence>

      {calendarDetailBooking && (
        <Suspense fallback={null}>
          <BookingDetailModal
            booking={{
              ...calendarDetailBooking,
              listing_id: calendarDetailBooking.listing_id,
              property_id: calendarDetailBooking.listings?.property_id ?? null,
            }}
            properties={allProperties}
            bankAccounts={allBankAccounts}
            onClose={() => setCalendarDetailBooking(null)}
          />
        </Suspense>
      )}
    </>
  );
}

// ---------- Bloque 16 — Widget "Items con problemas" ----------
function InventoryProblemsWidget(): JSX.Element | null {
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [recon, setRecon] = useState<DamageReconciliation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([listInventoryItems({}), getDamageReconciliations()]).then(([i, r]) => {
      if (!mounted) return;
      setItems(i.data ?? []);
      setRecon(r.data ?? []);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  if (loading) return null;

  const kpis = computeInventoryKpis(items);
  const openRecon = recon.filter(r =>
    r.status === 'pending_recovery' || r.status === 'overpaid' || r.status === 'no_charge',
  );
  const totalProblems = kpis.damaged + kpis.needsMaintenance + kpis.lowStock + kpis.depleted;

  if (totalProblems === 0 && openRecon.length === 0) return null;

  const problemItems = items
    .filter(it => it.status === 'damaged' || it.status === 'needs_maintenance' || it.status === 'depleted')
    .slice(0, 6);
  const totalUnreconciled = openRecon
    .filter(r => r.status === 'pending_recovery')
    .reduce((s, r) => s + Math.abs(r.diff), 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6"
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">📦 Items con problemas</h2>
          <p className="text-xs text-slate-500">Inventario que requiere atención y daños sin reconciliar.</p>
        </div>
        <a href="/inventory" className="text-xs text-blue-600 hover:underline whitespace-nowrap">Ver inventario →</a>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <ProblemKPI label="Dañados" value={kpis.damaged} tone="red" />
        <ProblemKPI label="Mantenimiento" value={kpis.needsMaintenance} tone="amber" />
        <ProblemKPI label="Stock bajo" value={kpis.lowStock} tone="orange" />
        <ProblemKPI label="Agotados" value={kpis.depleted} tone="rose" />
        <ProblemKPI label="Sin reconciliar" value={openRecon.length} tone="slate" />
      </div>

      {totalUnreconciled > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3 text-xs text-rose-800">
          ⚠ Falta recuperar <strong>{formatCurrency(totalUnreconciled)}</strong> en daños cobrados de menos al huésped/plataforma.
        </div>
      )}

      {problemItems.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
              <tr>
                <th className="text-left py-1.5 px-2">Item</th>
                <th className="text-left py-1.5 px-2">Categoría</th>
                <th className="text-right py-1.5 px-2">Cantidad</th>
                <th className="text-left py-1.5 px-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {problemItems.map(it => (
                <tr key={it.id}>
                  <td className="py-1.5 px-2 font-medium text-slate-800">{it.name}</td>
                  <td className="py-1.5 px-2 text-slate-500">{it.location ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{STATUS_LABEL[it.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.section>
  );
}

function ProblemKPI({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'orange' | 'rose' | 'slate' }) {
  const toneClass = {
    red:    'bg-red-50 text-red-700 border-red-100',
    amber:  'bg-amber-50 text-amber-700 border-amber-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    rose:   'bg-rose-50 text-rose-700 border-rose-100',
    slate:  'bg-slate-50 text-slate-700 border-slate-200',
  }[tone];
  return (
    <div className={`border rounded-lg px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase font-semibold opacity-80">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
