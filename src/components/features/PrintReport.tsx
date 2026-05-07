import { useState, useEffect, type ReactNode } from 'react';
import { computeFinancials, resolvePeriodRange, type FinancialKPIs, type MonthlyPnL, type PayoutBreakdown, type Period } from '@/services/financial';
import { listProperties } from '@/services/properties';
import type { PropertyRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';

const PERIOD_LABELS: Record<Exclude<Period, 'custom'>, string> = {
  'current-month': 'Este mes',
  'last-3-months': 'Últimos 3 meses',
  'this-year':     'Este año',
  'all':           'Todo',
};

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function now() {
  const d = new Date();
  return `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Formats "2026-01-01" → "1 ene 2026" */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** Builds a human-readable date range string from two ISO dates */
function buildDateRangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);

  // Same month and year → "Mayo 2026"
  if (fy === ty && fm === tm) {
    return `${MONTHS_ES[fm - 1]} ${fy}`;
  }
  // Same year → "1 ene — 31 abr 2026"
  if (fy === ty) {
    return `${fd} ${MONTHS_SHORT[fm - 1]} — ${td} ${MONTHS_SHORT[tm - 1]} ${ty}`;
  }
  // Different years → "1 ene 2025 — 31 mar 2026"
  return `${fmtDate(from)} — ${fmtDate(to)}`;
}

interface PropertyKPIs {
  property: PropertyRow;
  kpis: FinancialKPIs;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = (value * 100).toFixed(1);
  const up  = value >= 0;
  return (
    <span className={`text-xs font-semibold ${up ? 'text-green-600' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {Math.abs(Number(pct))}%
    </span>
  );
}

function Section({ num, title, children }: { num: number; title: string; children: ReactNode }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-slate-200">
        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {num}
        </span>
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function PrintReport() {
  const [kpis, setKpis]                   = useState<FinancialKPIs | null>(null);
  const [monthly, setMonthly]             = useState<MonthlyPnL[]>([]);
  const [payout, setPayout]               = useState<PayoutBreakdown | null>(null);
  const [propertyKPIs, setPropertyKPIs]   = useState<PropertyKPIs[]>([]);
  const [propertyNames, setPropertyNames] = useState<string[]>([]);
  const [loading, setLoading]             = useState(true);
  const [dateRangeLabel, setDateRangeLabel] = useState('');
  const [periodShortLabel, setPeriodShortLabel] = useState('');

  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    const period    = (params.get('period') as Period) || 'last-3-months';
    const fromParam = params.get('from');
    const toParam   = params.get('to');
    const idsParam  = params.get('propertyIds');

    const customRange = (period === 'custom' && fromParam && toParam)
      ? { from: fromParam, to: toParam }
      : undefined;
    const propertyIds = idsParam ? idsParam.split(',').filter(Boolean) : undefined;

    // Resolve actual date range (always real dates, regardless of period type)
    const { from, to } = resolvePeriodRange(period, customRange);
    setDateRangeLabel(buildDateRangeLabel(from, to));

    // Short label only for non-custom periods (used as subtitle)
    if (period !== 'custom') {
      setPeriodShortLabel(PERIOD_LABELS[period as Exclude<Period, 'custom'>]);
    }

    Promise.all([
      computeFinancials(period, true, propertyIds, customRange),
      listProperties(),
    ]).then(async ([main, propsRes]) => {
      setKpis(main.kpis);
      setMonthly(main.exportMonthly);
      setPayout(main.payoutBreakdown);

      const allProps    = propsRes.data ?? [];
      const targetProps = propertyIds && propertyIds.length > 0
        ? allProps.filter(p => propertyIds.includes(p.id))
        : allProps;

      setPropertyNames(targetProps.map(p => p.name));

      if (targetProps.length > 1) {
        const perProp = await Promise.all(
          targetProps.map(async (p) => {
            const r = await computeFinancials(period, true, [p.id], customRange);
            return { property: p, kpis: r.kpis };
          }),
        );
        setPropertyKPIs(perProp.filter(p => p.kpis.totalBookings > 0 || p.kpis.grossRevenue > 0));
      }

      setLoading(false);
    });
  }, []);

  if (loading || !kpis) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Generando reporte…</p>
        </div>
      </div>
    );
  }

  const margin         = kpis.grossRevenue > 0 ? (kpis.netProfit / kpis.grossRevenue * 100).toFixed(1) : '0';
  const occupancyPct   = (kpis.occupancyRate * 100).toFixed(1);
  const aboveBreakEven = kpis.occupancyRate * 100 >= kpis.breakEvenOccupancy;
  const cancelRate     = kpis.totalBookings > 0
    ? ((kpis.cancelledCount / kpis.totalBookings) * 100).toFixed(1)
    : '0';
  const bookingRevenue = kpis.grossRevenue - (kpis.netAdjustmentIncome ?? 0) - (kpis.cancelledRevenue ?? 0);

  // Dynamic section numbering
  let sec = 0;
  const S  = () => ++sec;

  return (
    <>
      {/* Print controls — hidden on print */}
      <div className="print:hidden fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow hover:bg-blue-700 transition-colors"
        >
          🖨️ Imprimir / Guardar PDF
        </button>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300 transition-colors"
        >
          ✕ Cerrar
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-10 font-sans text-slate-900 text-[13px]">

        {/* ── ENCABEZADO ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-blue-600">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">A</div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">STR Analytics</h1>
            </div>
            <h2 className="text-base font-bold text-slate-700">
              Reporte Financiero
            </h2>
            <p className="text-lg font-extrabold text-blue-700 mt-0.5">
              {dateRangeLabel}
            </p>
            {periodShortLabel && (
              <span className="inline-block text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5 mt-1">
                {periodShortLabel}
              </span>
            )}
            {propertyNames.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                {propertyNames.length === 1
                  ? propertyNames[0]
                  : `${propertyNames.length} propiedades: ${propertyNames.join(' · ')}`}
              </p>
            )}
            <p className="text-xs text-slate-400 mt-1">
              Generado: {now()}{kpis.isDemo && ' · Modo demo'}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-extrabold ${kpis.netProfit >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
              {formatCurrency(kpis.netProfit)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">Utilidad Neta</p>
            <p className={`text-sm font-semibold mt-1 ${Number(margin) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              Margen: {margin}%
            </p>
            <div className="mt-1">
              <DeltaBadge value={kpis.vsLastPeriod.netProfit} />
            </div>
          </div>
        </div>

        {/* ── S1: INDICADORES CLAVE ──────────────────────────────────────── */}
        <Section num={S()} title="Indicadores Clave del Período">
          <div className="grid grid-cols-4 gap-3 mb-3">
            {[
              {
                label: 'Ingreso Bruto',
                value: formatCurrency(kpis.grossRevenue),
                sub: <DeltaBadge value={kpis.vsLastPeriod.grossRevenue} />,
                color: 'bg-blue-50 border-blue-200',
              },
              {
                label: 'Total Gastos',
                value: formatCurrency(kpis.totalExpenses),
                sub: null,
                color: 'bg-red-50 border-red-200',
              },
              {
                label: 'Margen Contribución',
                value: formatCurrency(kpis.contributionMargin),
                sub: null,
                color: 'bg-teal-50 border-teal-200',
              },
              {
                label: 'Utilidad Neta',
                value: formatCurrency(kpis.netProfit),
                sub: <DeltaBadge value={kpis.vsLastPeriod.netProfit} />,
                color: kpis.netProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200',
              },
            ].map(item => (
              <div key={item.label} className={`p-3 rounded-xl border ${item.color}`}>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider leading-tight">{item.label}</p>
                <p className="text-sm font-extrabold text-slate-800 mt-1">{item.value}</p>
                {item.sub && <div className="mt-0.5">{item.sub}</div>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Gastos Fijos',       value: formatCurrency(kpis.totalFixedExpenses),    color: 'bg-orange-50 border-orange-200' },
              { label: 'Gastos Variables',   value: formatCurrency(kpis.totalVariableExpenses), color: 'bg-amber-50 border-amber-200' },
              { label: 'Fees de Canal ⓘ',   value: formatCurrency(kpis.totalChannelFees),      color: 'bg-slate-50 border-slate-200', note: 'referencial' },
              { label: 'Ajustes (daños, extras)', value: formatCurrency(kpis.netAdjustmentIncome), color: kpis.netAdjustmentIncome >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200' },
            ].map(item => (
              <div key={item.label} className={`p-3 rounded-xl border ${item.color}`}>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider leading-tight">{item.label}</p>
                <p className="text-sm font-extrabold text-slate-800 mt-1">{item.value}</p>
                {'note' in item && item.note && <p className="text-xs text-slate-400 italic">{item.note}</p>}
              </div>
            ))}
          </div>
        </Section>

        {/* ── S2: ESTADO DE RESULTADOS (P&L WATERFALL) ──────────────────── */}
        <Section num={S()} title="Estado de Resultados">
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-1.5 text-slate-600">(+) Ingresos por reservas</td>
                <td className="py-1.5 text-right font-mono text-blue-700 font-semibold">{formatCurrency(bookingRevenue)}</td>
              </tr>
              {kpis.cancelledRevenue > 0 && (
                <tr className="border-b border-slate-50">
                  <td className="py-1 pl-5 text-slate-500 italic">(+) Ingresos por cancelación cobrada</td>
                  <td className="py-1 text-right font-mono text-emerald-700">{formatCurrency(kpis.cancelledRevenue)}</td>
                </tr>
              )}
              {kpis.netAdjustmentIncome !== 0 && (
                <tr className="border-b border-slate-50">
                  <td className="py-1 pl-5 text-slate-500 italic">(+/−) Ajustes (daños, extras, descuentos)</td>
                  <td className={`py-1 text-right font-mono ${kpis.netAdjustmentIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatCurrency(kpis.netAdjustmentIncome)}
                  </td>
                </tr>
              )}
              <tr className="bg-blue-50 font-bold border-b border-blue-100">
                <td className="py-2 px-2 text-blue-800">(=) Ingreso Bruto Total</td>
                <td className="py-2 px-2 text-right font-mono text-blue-800">{formatCurrency(kpis.grossRevenue)}</td>
              </tr>
              {kpis.totalChannelFees > 0 && (
                <tr className="border-b border-slate-50">
                  <td className="py-1 pl-5 text-slate-400 italic">(↳) Fees de canal — solo referencial, no resta</td>
                  <td className="py-1 text-right font-mono text-slate-400">{formatCurrency(kpis.totalChannelFees)}</td>
                </tr>
              )}
              <tr className="border-b border-slate-100">
                <td className="py-1.5 text-slate-600">(−) Gastos Variables</td>
                <td className="py-1.5 text-right font-mono text-red-600 font-semibold">{formatCurrency(kpis.totalVariableExpenses)}</td>
              </tr>
              {kpis.cancelledFines > 0 && (
                <tr className="border-b border-slate-50">
                  <td className="py-1 pl-5 text-slate-500 italic">(−) Multas por cancelación al anfitrión</td>
                  <td className="py-1 text-right font-mono text-rose-600">{formatCurrency(kpis.cancelledFines)}</td>
                </tr>
              )}
              <tr className="bg-teal-50 font-bold border-b border-teal-100">
                <td className="py-2 px-2 text-teal-800">(=) Margen de Contribución</td>
                <td className="py-2 px-2 text-right font-mono text-teal-800">{formatCurrency(kpis.contributionMargin)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-1.5 text-slate-600">(−) Gastos Fijos</td>
                <td className="py-1.5 text-right font-mono text-red-600 font-semibold">{formatCurrency(kpis.totalFixedExpenses)}</td>
              </tr>
              <tr className={`font-bold border-t-2 ${kpis.netProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <td className={`py-2 px-2 ${kpis.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>(=) Utilidad Neta</td>
                <td className={`py-2 px-2 text-right font-mono text-base ${kpis.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                  {formatCurrency(kpis.netProfit)}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* ── S3: OCUPACIÓN Y EFICIENCIA ─────────────────────────────────── */}
        <Section num={S()} title="Ocupación y Eficiencia Operativa">
          <div className="grid grid-cols-2 gap-6 mb-4">
            {/* Columna izquierda: métricas de ocupación */}
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-slate-100 font-bold">
                  <td className="py-1.5 text-slate-700">Tasa de Ocupación</td>
                  <td className="py-1.5 text-right font-mono text-blue-700 text-base">{occupancyPct}%</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-1.5 pl-4 text-slate-500">Noches reservadas</td>
                  <td className="py-1.5 text-right font-mono text-slate-700">{kpis.totalNights}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 pl-4 text-slate-500">Noches disponibles</td>
                  <td className="py-1.5 text-right font-mono text-slate-700">{kpis.availableNights}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">ADR (Tarifa Diaria Prom.)</td>
                  <td className="py-1.5 text-right font-mono text-slate-800 font-semibold">{formatCurrency(kpis.adr)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">RevPAR</td>
                  <td className="py-1.5 text-right font-mono text-slate-800 font-semibold">{formatCurrency(kpis.revpar)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-500">Comparativo ocu. vs período ant.</td>
                  <td className="py-1.5 text-right"><DeltaBadge value={kpis.vsLastPeriod.occupancyRate} /></td>
                </tr>
              </tbody>
            </table>
            {/* Columna derecha: reservas y break-even */}
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">Total reservas</td>
                  <td className="py-1.5 text-right font-mono text-slate-800">{kpis.totalBookings}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">Reservas canceladas</td>
                  <td className={`py-1.5 text-right font-mono ${kpis.cancelledCount > 0 ? 'text-amber-600' : 'text-slate-600'}`}>
                    {kpis.cancelledCount} ({cancelRate}%)
                  </td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">Propiedades en portafolio</td>
                  <td className="py-1.5 text-right font-mono text-slate-800">{kpis.propertyCount}</td>
                </tr>
                <tr className="border-b border-dashed border-slate-200"><td colSpan={2} className="py-1" /></tr>
                <tr className="border-b border-slate-100 font-bold">
                  <td className="py-1.5 text-orange-700">Break-even — Noches mín.</td>
                  <td className="py-1.5 text-right font-mono text-orange-700">{kpis.breakEvenNights} noches</td>
                </tr>
                <tr className="border-b border-slate-100 font-bold">
                  <td className="py-1.5 text-orange-700">Break-even — Ocupación mín.</td>
                  <td className="py-1.5 text-right font-mono text-orange-700">{kpis.breakEvenOccupancy}%</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-700">Estado</td>
                  <td className={`py-1.5 text-right font-semibold ${aboveBreakEven ? 'text-green-700' : 'text-amber-600'}`}>
                    {aboveBreakEven ? '✅ Sobre break-even' : '⚠️ Bajo break-even'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Barra visual de ocupación */}
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Ocupación real: <strong className={aboveBreakEven ? 'text-green-700' : 'text-amber-600'}>{occupancyPct}%</strong></span>
              <span>Obj. break-even: <strong className="text-orange-600">{kpis.breakEvenOccupancy}%</strong></span>
              <span>Disponible: <strong className="text-slate-600">100%</strong></span>
            </div>
            <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className={`h-full rounded-full ${aboveBreakEven ? 'bg-green-400' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(kpis.occupancyRate * 100, 100)}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-10"
                style={{ left: `${Math.min(kpis.breakEvenOccupancy, 100)}%` }}
                title={`Break-even: ${kpis.breakEvenOccupancy}%`}
              />
            </div>
          </div>
        </Section>

        {/* ── S4: DESGLOSE POR PROPIEDAD (solo si hay múltiples) ─────────── */}
        {propertyKPIs.length > 0 && (
          <Section num={S()} title="Desglose por Propiedad">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  {['Propiedad','Ingresos','Gastos','Utilidad','Ocu. %','Noches','Disp.','ADR','RevPAR','Reservas'].map(h => (
                    <th key={h} className="pb-2 pr-2 text-left font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {propertyKPIs.map(({ property, kpis: pk }) => {
                  const propOcc = (pk.occupancyRate * 100).toFixed(1);
                  const propAboveBE = pk.occupancyRate * 100 >= pk.breakEvenOccupancy;
                  return (
                    <tr key={property.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-semibold text-slate-800 max-w-[110px]">
                        <span title={property.name} className="block truncate">{property.name}</span>
                        {property.address && (
                          <span className="block text-slate-400 font-normal truncate">{property.address}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right font-mono text-blue-700">{formatCurrency(pk.grossRevenue)}</td>
                      <td className="py-2 pr-2 text-right font-mono text-red-600">{formatCurrency(pk.totalExpenses)}</td>
                      <td className={`py-2 pr-2 text-right font-mono font-bold ${pk.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatCurrency(pk.netProfit)}
                      </td>
                      <td className={`py-2 pr-2 text-right font-semibold ${propAboveBE ? 'text-green-700' : 'text-amber-600'}`}>
                        {propOcc}%
                      </td>
                      <td className="py-2 pr-2 text-right text-slate-600">{pk.totalNights}</td>
                      <td className="py-2 pr-2 text-right text-slate-400">{pk.availableNights}</td>
                      <td className="py-2 pr-2 text-right font-mono text-slate-600">{formatCurrency(pk.adr)}</td>
                      <td className="py-2 pr-2 text-right font-mono text-slate-600">{formatCurrency(pk.revpar)}</td>
                      <td className="py-2 text-right text-slate-600">{pk.totalBookings}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        )}

        {/* ── S5: DESGLOSE MENSUAL ───────────────────────────────────────── */}
        <Section num={S()} title="Desglose Mensual de P&L">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {['Período','Ingresos','Gastos','Utilidad Neta','Noches','Disp.','Ocupación %'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-slate-500 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map((row, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 font-medium text-slate-700">{row.month}</td>
                  <td className="py-1.5 text-right font-mono text-blue-700">{formatCurrency(row.revenue)}</td>
                  <td className="py-1.5 text-right font-mono text-red-600">{formatCurrency(row.expenses)}</td>
                  <td className={`py-1.5 text-right font-mono font-bold ${row.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(row.netProfit)}
                  </td>
                  <td className="py-1.5 text-right text-slate-600">{row.nights}</td>
                  <td className="py-1.5 text-right text-slate-400">{row.availableNights}</td>
                  <td className="py-1.5 text-right font-semibold text-slate-700">{row.occupancy}%</td>
                </tr>
              ))}
              {/* Totals row */}
              {monthly.length > 1 && (() => {
                const tot = monthly.reduce(
                  (acc, r) => ({
                    revenue:  acc.revenue  + r.revenue,
                    expenses: acc.expenses + r.expenses,
                    netProfit: acc.netProfit + r.netProfit,
                    nights:   acc.nights   + r.nights,
                  }),
                  { revenue: 0, expenses: 0, netProfit: 0, nights: 0 },
                );
                return (
                  <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
                    <td className="py-2 text-slate-700">TOTAL</td>
                    <td className="py-2 text-right font-mono text-blue-800">{formatCurrency(tot.revenue)}</td>
                    <td className="py-2 text-right font-mono text-red-700">{formatCurrency(tot.expenses)}</td>
                    <td className={`py-2 text-right font-mono ${tot.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {formatCurrency(tot.netProfit)}
                    </td>
                    <td className="py-2 text-right text-slate-700">{tot.nights}</td>
                    <td className="py-2 text-right text-slate-500">{kpis.availableNights}</td>
                    <td className="py-2 text-right text-slate-700">{occupancyPct}%</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </Section>

        {/* ── S6: ESTADO DE PAGOS ────────────────────────────────────────── */}
        {payout && (payout.received > 0 || payout.expected > 0) && (
          <Section num={S()} title="Estado de Pagos (Payout)">
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Confirmado recibido', value: formatCurrency(payout.received), color: 'bg-green-50 border-green-200', tc: 'text-green-700' },
                { label: 'Pendiente por confirmar', value: formatCurrency(payout.expected), color: 'bg-amber-50 border-amber-200', tc: 'text-amber-700' },
                {
                  label: 'Reservas sin payout registrado',
                  value: `${payout.incompleteCount} reservas`,
                  color: payout.incompleteCount > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200',
                  tc:    payout.incompleteCount > 0 ? 'text-red-700' : 'text-slate-600',
                },
              ].map(item => (
                <div key={item.label} className={`p-3 rounded-xl border ${item.color}`}>
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider leading-tight">{item.label}</p>
                  <p className={`text-sm font-extrabold mt-1 ${item.tc}`}>{item.value}</p>
                </div>
              ))}
            </div>
            {payout.monthlyBreakdown.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    {['Período','Recibido','Esperado','Gastos','Neto Confirmado'].map(h => (
                      <th key={h} className="pb-2 text-left font-semibold text-slate-500 text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payout.monthlyBreakdown.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1.5 font-medium text-slate-700">{row.month}</td>
                      <td className="py-1.5 text-right font-mono text-green-700">{formatCurrency(row.received)}</td>
                      <td className="py-1.5 text-right font-mono text-amber-600">{formatCurrency(row.expected)}</td>
                      <td className="py-1.5 text-right font-mono text-red-600">{formatCurrency(row.expenses)}</td>
                      <td className={`py-1.5 text-right font-mono font-bold ${row.netConfirmed >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatCurrency(row.netConfirmed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        )}

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <div className="border-t pt-4 text-xs text-slate-400 flex justify-between items-center">
          <span>STR Analytics — Plataforma de gestión financiera</span>
          <span>{new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 1.2cm; size: A4; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </>
  );
}
