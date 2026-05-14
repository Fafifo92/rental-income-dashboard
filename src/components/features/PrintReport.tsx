import { useState, useEffect, type ReactNode } from 'react';
import { computeFinancials, resolvePeriodRange, type FinancialKPIs, type MonthlyPnL, type PayoutBreakdown, type Period } from '@/services/financial';
import { listProperties } from '@/services/properties';
import { listBookings, type BookingWithListingRow } from '@/services/bookings';
import { listAllBookingAdjustmentsForExport } from '@/services/bookingAdjustments';
import type { PropertyRow } from '@/types/database';
import type { Expense } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay, todayISO } from '@/lib/dateUtils';

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


// ─── Booking types for report ──────────────────────────────────────────────────

interface BookingForReport {
  id: string;
  confirmation_code: string;
  guest_name: string | null;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  net_payout: number | null;
  status: string;
  channel: string | null;
  property_name: string | null;
}

interface AdjForReport {
  booking_id: string;
  kind: string;
  amount: number;
  date: string;
  description: string | null;
}

// ─── Calendar colors (inline styles — safe for Tailwind purging) ───────────────

const BOOKING_PALETTE = [
  { bg: '#dbeafe', color: '#1e40af', dot: '#2563eb', border: '#93c5fd' }, // blue
  { bg: '#d1fae5', color: '#065f46', dot: '#059669', border: '#6ee7b7' }, // emerald
  { bg: '#ede9fe', color: '#4c1d95', dot: '#7c3aed', border: '#c4b5fd' }, // violet
  { bg: '#fef3c7', color: '#78350f', dot: '#d97706', border: '#fcd34d' }, // amber
  { bg: '#ccfbf1', color: '#134e4a', dot: '#0d9488', border: '#5eead4' }, // teal
  { bg: '#ffe4e6', color: '#9f1239', dot: '#e11d48', border: '#fda4af' }, // rose
  { bg: '#e0e7ff', color: '#312e81', dot: '#4f46e5', border: '#a5b4fc' }, // indigo
  { bg: '#fce7f3', color: '#831843', dot: '#db2777', border: '#f9a8d4' }, // pink
];

const CANCELLED_STYLE = { bg: '#f1f5f9', color: '#94a3b8', dot: '#cbd5e1', border: '#e2e8f0' };

function getBookingStatusLabel(b: BookingForReport): string {
  if (b.status.toLowerCase().includes('cancel')) return 'Cancelada';
  const t = todayISO();
  if (b.start_date && b.start_date > t) return 'Reservada';
  if (b.start_date && b.end_date && b.start_date <= t && t < b.end_date) return 'En curso';
  if (b.end_date && b.end_date <= t) return 'Completada';
  return 'Reservada';
}

function isCancelledStatus(s: string) { return s.toLowerCase().includes('cancel'); }

// ─── Month calendar ─────────────────────────────────────────────────────────────

interface CalBooking {
  id: string;
  confirmationCode: string;
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD exclusive (check-out date)
  cancelled: boolean;
  colorIndex: number;
  guest: string | null;
  nights: number;
  revenue: number;
  propertyName: string | null;
}

function MonthTimeline({ year, month, bookings }: { year: number; month: number; bookings: CalBooking[] }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const pad2        = (n: number) => String(n).padStart(2, '0');
  const isoDay      = (d: number) => `${year}-${pad2(month)}-${pad2(d)}`;
  const DOW_LETTER  = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // Sun=0

  const days    = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const LABEL_W = 168; // px

  // Active first (by start date), then cancelled
  const sorted = [...bookings].sort((a, b) => {
    if (a.cancelled !== b.cancelled) return a.cancelled ? 1 : -1;
    return a.start.localeCompare(b.start);
  });

  const activeCount = sorted.filter(b => !b.cancelled).length;

  return (
    // month-cal class lets the print CSS override overflow so thead can repeat across pages.
    // border-radius on the outer div still shows the rounded border; the gradient header
    // has its own border-radius so it clips correctly without needing parent overflow:hidden.
    <div
      className="month-cal"
      style={{
        border: '1.5px solid #cbd5e1', borderRadius: 12, overflow: 'hidden',
        background: 'white', marginBottom: 16,
      }}
    >
      {/* Month header — own border-radius so it still looks rounded when print overrides overflow */}
      <div style={{
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        color: 'white', padding: '9px 14px',
        fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em',
        display: 'flex', alignItems: 'center', gap: 10,
        borderRadius: '10px 10px 0 0',
      }}>
        {MONTHS_ES[month - 1]} {year}
        <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.75, marginLeft: 'auto' }}>
          {activeCount} reserva{activeCount !== 1 ? 's' : ''} activa{activeCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Calendar grid as proper <table> so <thead> auto-repeats on print page breaks ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: LABEL_W }} />
          {days.map(d => <col key={d} />)}
        </colgroup>

        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
            <th style={{
              padding: '5px 8px',
              fontSize: 8, fontWeight: 700, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              borderRight: '2px solid #e2e8f0', textAlign: 'left', verticalAlign: 'middle',
            }}>
              Huésped · Propiedad
            </th>
            {days.map(d => {
              const dow       = new Date(year, month - 1, d).getDay();
              const isWeekend = dow === 0 || dow === 6;
              return (
                <th key={d} style={{
                  textAlign: 'center', padding: '3px 0',
                  borderRight: d < daysInMonth ? '1px solid #e8edf2' : 'none',
                  background: isWeekend ? '#f1f5f9' : 'transparent',
                  fontWeight: 'normal',
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: isWeekend ? '#94a3b8' : '#374151', lineHeight: 1 }}>{d}</div>
                  <div style={{ fontSize: 7, color: '#cbd5e1', lineHeight: 1, marginTop: 1 }}>{DOW_LETTER[dow]}</div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={daysInMonth + 1} style={{ padding: '14px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>
                Sin reservas este mes
              </td>
            </tr>
          ) : sorted.map((bk, rowIdx) => {
            const palette = bk.cancelled
              ? CANCELLED_STYLE
              : BOOKING_PALETTE[bk.colorIndex % BOOKING_PALETTE.length];
            const isLast = rowIdx === sorted.length - 1;

            return (
              <tr key={bk.id} style={{ borderBottom: isLast ? 'none' : '1px solid #f1f5f9', height: 36 }}>

                {/* ── Label cell ── */}
                <td style={{
                  padding: '4px 8px',
                  background: bk.cancelled ? '#f8fafc' : palette.bg,
                  borderRight: `3px solid ${palette.dot}`,
                  verticalAlign: 'middle',
                  opacity: bk.cancelled ? 0.6 : 1,
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: palette.color, lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: bk.cancelled ? 'line-through' : 'none',
                  }}>
                    {bk.guest ?? '—'}
                  </div>
                  {bk.propertyName && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      fontSize: 8, fontWeight: 600, color: palette.dot,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: palette.dot, display: 'inline-block',
                      }} />
                      {bk.propertyName}
                    </div>
                  )}
                  <div style={{
                    fontSize: 8, fontFamily: 'monospace', color: palette.color, opacity: 0.75,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1,
                  }}>
                    {bk.cancelled ? '✕ ' : ''}{bk.confirmationCode}
                    {!bk.cancelled && bk.nights > 0 && ` · ${bk.nights}n`}
                  </div>
                  {!bk.cancelled && bk.revenue > 0 && (
                    <div style={{ fontSize: 9, fontWeight: 800, color: palette.dot, lineHeight: 1 }}>
                      {formatCurrency(bk.revenue)}
                    </div>
                  )}
                </td>

                {/* ── Day cells ── */}
                {days.map(d => {
                  const iso           = isoDay(d);
                  const inStay        = iso >= bk.start && iso < bk.end;
                  const isCheckIn     = iso === bk.start;
                  const nextIso       = isoDay(d + 1);
                  const isLastOcc     = inStay && nextIso === bk.end;
                  const isCheckOutDay = iso === bk.end;
                  const dow           = new Date(year, month - 1, d).getDay();
                  const isWeekend     = dow === 0 || dow === 6;

                  if (!inStay) {
                    return (
                      <td key={d} style={{
                        background: isWeekend ? '#f8fafc' : 'white',
                        borderRight: d < daysInMonth ? '1px solid #f1f5f9' : 'none',
                        borderLeft: isCheckOutDay ? `2px solid ${palette.dot}33` : 'none',
                      }} />
                    );
                  }

                  return (
                    <td key={d} style={{
                      background: bk.cancelled ? palette.bg + 'aa' : palette.bg,
                      borderRight: d < daysInMonth ? `1px solid ${palette.border}44` : 'none',
                      borderLeft: isCheckIn ? `3px solid ${palette.dot}` : 'none',
                      position: 'relative',
                    }}>
                      {isCheckIn && (
                        <div style={{
                          position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)',
                          width: 5, height: 5, borderRadius: '50%', background: palette.dot,
                        }} />
                      )}
                      {isLastOcc && (
                        <div style={{
                          position: 'absolute', bottom: 3, right: 3,
                          width: 4, height: 4, borderRadius: '50%', background: palette.dot, opacity: 0.55,
                        }} />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function now() {
  const d = new Date();
  return `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Formats "2026-01-01" → "01-01-2026" */
function fmtDate(iso: string): string {
  return formatDateDisplay(iso);
}

/** Builds a human-readable date range string from two ISO dates */
function buildDateRangeLabel(from: string, to: string): string {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);

  // Same month and year → "Mayo 2026"
  if (fy === ty && fm === tm) {
    return `${MONTHS_ES[fm - 1]} ${fy}`;
  }
  // Different months/years → range in DD-MM-YYYY
  return `${fmtDate(from)} — ${fmtDate(to)}`;
}

interface PropertyKPIs {
  property: PropertyRow;
  kpis: FinancialKPIs;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const absPercent = Math.abs(value * 100);
  const isCapped = absPercent >= 499.9;
  const displayVal = isCapped ? '>500' : absPercent.toFixed(1);
  const up = value >= 0;
  return (
    <span
      title={isCapped ? 'Variación muy alta: período anterior con datos insuficientes.' : undefined}
      className={`text-xs font-semibold ${up ? 'text-green-600' : 'text-red-600'}`}
    >
      {up ? '▲' : '▼'} {displayVal}%
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
  const [expensesInPeriod, setExpensesInPeriod] = useState<Expense[]>([]);

  // Booking detail state
  const [includeBookings, setIncludeBookings]       = useState(false);
  const [includeAdjustments, setIncludeAdjustments] = useState(false);
  const [reportBookings, setReportBookings]         = useState<BookingForReport[]>([]);
  const [reportAdjustments, setReportAdjustments]   = useState<AdjForReport[]>([]);
  const [periodFrom, setPeriodFrom]                 = useState('');
  const [periodTo, setPeriodTo]                     = useState('');

  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    const period    = (params.get('period') as Period) || 'last-3-months';
    const fromParam = params.get('from');
    const toParam   = params.get('to');
    const idsParam  = params.get('propertyIds');
    const inclBk    = params.get('includeBookings') === 'true';
    const inclAdj   = params.get('includeAdjustments') === 'true';
    setIncludeBookings(inclBk);
    setIncludeAdjustments(inclAdj);

    const customRange = (period === 'custom' && fromParam && toParam)
      ? { from: fromParam, to: toParam }
      : undefined;
    const propertyIds = idsParam ? idsParam.split(',').filter(Boolean) : undefined;

    // Resolve actual date range (always real dates, regardless of period type)
    const { from, to } = resolvePeriodRange(period, customRange);
    setDateRangeLabel(buildDateRangeLabel(from, to));
    setPeriodFrom(from);
    setPeriodTo(to);

    // Short label only for non-custom periods (used as subtitle)
    if (period !== 'custom') {
      setPeriodShortLabel(PERIOD_LABELS[period as Exclude<Period, 'custom'>]);
    }

    const loadAll = async () => {
      const [main, propsRes] = await Promise.all([
        computeFinancials(period, true, propertyIds, customRange),
        listProperties(),
      ]);

      setKpis(main.kpis);
      setMonthly(main.exportMonthly);
      setPayout(main.payoutBreakdown);
      setExpensesInPeriod(main.expensesInPeriod);

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

      // Load booking detail if requested
      if (inclBk) {
        const bRes = await listBookings({
          propertyIds: propertyIds?.length ? propertyIds : undefined,
          dateFrom: from,
          dateTo: to,
        });
        if (!bRes.error && bRes.data) {
          const mapped: BookingForReport[] = bRes.data.map((b: BookingWithListingRow) => ({
            id: b.id,
            confirmation_code: b.confirmation_code,
            guest_name: b.guest_name,
            start_date: b.start_date,
            end_date: b.end_date,
            num_nights: b.num_nights,
            total_revenue: Number(b.total_revenue),
            net_payout: b.net_payout !== null ? Number(b.net_payout) : null,
            status: b.status ?? '',
            channel: b.channel,
            property_name: (b.listings?.properties as { name: string } | null | undefined)?.name ?? null,
          }));
          setReportBookings(mapped);

          if (inclAdj) {
            const adjRes = await listAllBookingAdjustmentsForExport();
            if (!adjRes.error && adjRes.data) {
              const bookingIdSet = new Set(mapped.map(b => b.id));
              setReportAdjustments(
                adjRes.data.filter(a => bookingIdSet.has(a.booking_id)),
              );
            }
          }
        }
      }

      setLoading(false);
    };

    loadAll();
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
            <p className="text-xs mt-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">
                {includeBookings ? '📅 Con detalle de reservas' : 'Resumen financiero'}
              </span>
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

        {/* ── S3: DESGLOSE DE GASTOS POR CATEGORÍA ──────────────────────── */}
        {expensesInPeriod.length > 0 && (() => {
          const catMap = new Map<string, { category: string; fixed: number; variable: number }>();
          for (const e of expensesInPeriod) {
            const entry = catMap.get(e.category) ?? { category: e.category, fixed: 0, variable: 0 };
            if (e.type === 'fixed') entry.fixed += e.amount;
            else entry.variable += e.amount;
            catMap.set(e.category, entry);
          }
          const rows = Array.from(catMap.values())
            .sort((a, b) => (b.fixed + b.variable) - (a.fixed + a.variable));
          const cleaningCategories = ['limpieza', 'aseo', 'lavandera', 'lavandería', 'aseo y lavandería'];
          return (
            <Section num={S()} title="Desglose de Gastos por Categoría">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    {['Categoría', 'Tipo', 'Monto', '% del Total'].map(h => (
                      <th key={h} className="pb-2 pr-2 text-left font-semibold text-slate-500 text-[10px] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ category, fixed, variable }) => {
                    const total = fixed + variable;
                    const pct = kpis.totalExpenses > 0 ? ((total / kpis.totalExpenses) * 100).toFixed(1) : '0';
                    const isCleaning = cleaningCategories.some(k => category.toLowerCase().includes(k));
                    return (
                      <tr key={category} className={`border-b border-slate-100 ${isCleaning ? 'bg-blue-50' : ''}`}>
                        <td className={`py-1.5 pr-2 font-medium ${isCleaning ? 'text-blue-800' : 'text-slate-700'}`}>
                          {isCleaning && <span className="mr-1">🧹</span>}{category}
                        </td>
                        <td className="py-1.5 pr-2">
                          {fixed > 0 && variable > 0 ? (
                            <span className="inline-flex gap-1">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-orange-100 text-orange-700">Fijo</span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-700">Variable</span>
                            </span>
                          ) : fixed > 0 ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-orange-100 text-orange-700">Fijo</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-700">Variable</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono text-red-600 font-semibold">
                          {formatCurrency(total)}
                        </td>
                        <td className="py-1.5 text-right font-mono text-slate-500">{pct}%</td>
                      </tr>
                    );
                  })}
                  <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
                    <td colSpan={2} className="py-2 text-slate-700 text-[10px]">TOTAL GASTOS</td>
                    <td className="py-2 text-right font-mono text-red-700">{formatCurrency(kpis.totalExpenses)}</td>
                    <td className="py-2 text-right font-mono text-slate-500">100%</td>
                  </tr>
                </tbody>
              </table>
            </Section>
          );
        })()}

        {/* ── LIQUIDACIONES DE ASEO ─────────────────────────────────────── */}
        {expensesInPeriod.filter(e => e.subcategory === 'cleaning' || e.category === 'Aseo' || e.category === 'Insumos de aseo').length > 0 && (() => {
          const cleaningExpenses = expensesInPeriod.filter(e => e.subcategory === 'cleaning' || e.category === 'Aseo' || e.category === 'Insumos de aseo');

          // Group by expense_group_id — each group = one payout session
          const groupMap = new Map<string, Expense[]>();
          for (const e of cleaningExpenses) {
            const gid = e.expense_group_id ?? e.id;
            const arr = groupMap.get(gid) ?? [];
            arr.push(e);
            groupMap.set(gid, arr);
          }

          const payoutGroups = Array.from(groupMap.values())
            .map(members => ({
              cleanerName: members[0].vendor ?? 'Desconocido',
              payoutDate:  members[0].date,
              total:       members.reduce((s, e) => s + e.amount, 0),
              bookingCount: Math.max(new Set(members.map(m => m.booking_id).filter(Boolean)).size, 1),
              members,
            }))
            .sort((a, b) => b.payoutDate.localeCompare(a.payoutDate));

          // Cleaner summary cards
          const byCleanerMap = new Map<string, { name: string; total: number; bookings: number; payouts: number }>();
          for (const g of payoutGroups) {
            const e = byCleanerMap.get(g.cleanerName) ?? { name: g.cleanerName, total: 0, bookings: 0, payouts: 0 };
            e.total += g.total; e.bookings += g.bookingCount; e.payouts += 1;
            byCleanerMap.set(g.cleanerName, e);
          }
          const cleanerCards = Array.from(byCleanerMap.values()).sort((a, b) => b.total - a.total);
          const grandTotal = payoutGroups.reduce((s, g) => s + g.total, 0);

          // Helper: parse description → { propName, code, doneDate, isSupplies }
          // Uses indexOf('Reserva ') to avoid dependency on separator character.
          const parseDsc = (desc: string | null, cat: string) => {
            const isSupplies = cat === 'Insumos de aseo';
            if (!desc) return { propName: '—', code: '—', doneDate: '', isSupplies };
            const reservaIdx = desc.indexOf('Reserva ');
            if (reservaIdx === -1) return { propName: desc, code: '—', doneDate: '', isSupplies };
            const beforeReserva = desc.slice(0, reservaIdx).trim();
            const propMatch = beforeReserva.match(/^(?:Insumos de aseo|Aseo)\s*[–\-]\s*(.+?)[\s·•|,]*$/i);
            const propName = propMatch ? propMatch[1].trim() : beforeReserva || '—';
            const afterReserva = desc.slice(reservaIdx + 'Reserva '.length);
            const m = afterReserva.match(/^([^\s(·•]+)\s*\(([^)]+)\)/);
            return { propName, code: m?.[1] ?? '—', doneDate: m?.[2] ?? '', isSupplies };
          };

          return (
            <Section num={S()} title="🧹 Liquidaciones de Aseo">
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {cleanerCards.map(cs => (
                  <div key={cs.name} className="p-3 rounded-xl border bg-sky-50 border-sky-200">
                    <p className="text-xs font-bold text-sky-800 truncate">{cs.name}</p>
                    <p className="text-sm font-extrabold text-sky-900 mt-1">{formatCurrency(cs.total)}</p>
                    <p className="text-[10px] text-sky-600 mt-0.5">
                      {cs.bookings} aseo{cs.bookings !== 1 ? 's' : ''}
                      <span className="ml-1 text-slate-400">· {cs.payouts} liquidación{cs.payouts !== 1 ? 'es' : ''}</span>
                    </p>
                  </div>
                ))}
              </div>

              {/* Per-payout detail tables */}
              {payoutGroups.map((g, gi) => (
                <div key={gi} className="mb-5">
                  <div className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-2">
                    <div>
                      <span className="font-bold text-sky-800 text-xs">{g.cleanerName}</span>
                      <span className="text-slate-500 text-xs ml-2">· Liquidación del {formatDateDisplay(g.payoutDate)}</span>
                      <span className="text-slate-400 text-xs ml-2">({g.bookingCount} aseo{g.bookingCount !== 1 ? 's' : ''})</span>
                    </div>
                    <span className="font-extrabold font-mono text-red-700 text-sm">{formatCurrency(g.total)}</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-slate-200">
                        {['Tipo', 'Cód. reserva', 'Propiedad', 'Fecha aseo', 'Monto'].map(h => (
                          <th key={h} className="pb-1.5 pr-2 text-left font-semibold text-slate-500 text-[10px] uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.members.map((e, i) => {
                        const pd = parseDsc(e.description, e.category);
                        return (
                          <tr key={e.id} className={`border-b border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                            <td className="py-1.5 pr-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${pd.isSupplies ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                {pd.isSupplies ? 'Insumos' : 'Aseo'}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 font-mono text-[10px] text-slate-700">{pd.code}</td>
                            <td className="py-1.5 pr-2 text-slate-600 max-w-[110px]">
                              <span className="truncate block">{pd.propName}</span>
                            </td>
                            <td className="py-1.5 pr-2 font-mono text-slate-500">{formatDateDisplay(pd.doneDate)}</td>
                            <td className="py-1.5 text-right font-mono text-red-600 font-semibold">{formatCurrency(e.amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              <div className="mt-2 border-t-2 border-slate-300 pt-2 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Total liquidaciones de aseo</span>
                <span className="text-sm font-extrabold font-mono text-red-700">{formatCurrency(grandTotal)}</span>
              </div>
            </Section>
          );
        })()}

        {/* ── S4 (dyn): OCUPACIÓN Y EFICIENCIA ─────────────────────────── */}
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

        {/* ── RESERVAS: CALENDARIO + TABLA ──────────────────────────────── */}
        {includeBookings && reportBookings.length > 0 && (() => {
          const active = reportBookings
            .filter(b => !isCancelledStatus(b.status))
            .sort((a, b) => a.start_date.localeCompare(b.start_date));
          const cancelled = reportBookings.filter(b => isCancelledStatus(b.status));

          // ── Color by property (not by booking order) ──────────────────────
          const propertyColorMap = new Map<string, number>();
          let nextPropColor = 0;
          for (const b of [...active, ...cancelled]) {
            const key = b.property_name ?? '';
            if (!propertyColorMap.has(key)) {
              propertyColorMap.set(key, nextPropColor % BOOKING_PALETTE.length);
              nextPropColor++;
            }
          }

          const calBookings: CalBooking[] = [
            ...active.map(b => ({
              id: b.id,
              confirmationCode: b.confirmation_code,
              start: b.start_date,
              end: b.end_date,
              cancelled: false,
              colorIndex: propertyColorMap.get(b.property_name ?? '') ?? 0,
              guest: b.guest_name,
              nights: b.num_nights,
              revenue: b.total_revenue,
              propertyName: b.property_name,
            })),
            ...cancelled.map(b => ({
              id: b.id,
              confirmationCode: b.confirmation_code,
              start: b.start_date,
              end: b.end_date,
              cancelled: true,
              colorIndex: propertyColorMap.get(b.property_name ?? '') ?? 0,
              guest: b.guest_name,
              nights: b.num_nights,
              revenue: 0,
              propertyName: b.property_name,
            })),
          ];

          // Generate ALL months in the selected period range (not just months with check-ins)
          const months: { year: number; month: number }[] = [];
          if (periodFrom && periodTo) {
            const cur = new Date(periodFrom + 'T12:00:00');
            const end = new Date(periodTo   + 'T12:00:00');
            while (cur <= end) {
              months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
              cur.setMonth(cur.getMonth() + 1);
            }
          } else {
            // Fallback: derive from booking start dates
            const seen = new Set<string>();
            for (const b of reportBookings) {
              const d = new Date(b.start_date + 'T12:00:00');
              const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
              if (!seen.has(key)) { seen.add(key); months.push({ year: d.getFullYear(), month: d.getMonth() + 1 }); }
            }
            months.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
          }

          // Build adj map per booking
          const adjMap = new Map<string, number>();
          for (const a of reportAdjustments) {
            const delta = a.kind === 'discount' ? -Number(a.amount) : Number(a.amount);
            adjMap.set(a.booking_id, (adjMap.get(a.booking_id) ?? 0) + delta);
          }

          // ── Property legend (one entry per unique property) ───────────────
          const propertyLegend = Array.from(propertyColorMap.entries()).map(([name, colorIndex]) => ({
            name: name || 'Sin propiedad',
            colorIndex,
          }));

          const totalRevenue = active.reduce((s, b) => s + b.total_revenue, 0);
          const totalNights  = active.reduce((s, b) => s + b.num_nights, 0);

          return (
            <Section num={S()} title="Cronograma de Reservas">

              {/* KPI summary row */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Reservas activas',   value: String(active.length),          color: 'bg-blue-50 border-blue-200',    tc: 'text-blue-700' },
                  { label: 'Noches totales',      value: String(totalNights),            color: 'bg-slate-50 border-slate-200',  tc: 'text-slate-700' },
                  { label: 'Ingresos reservas',   value: formatCurrency(totalRevenue),   color: 'bg-green-50 border-green-200',  tc: 'text-green-700' },
                  { label: 'Canceladas',          value: String(cancelled.length),       color: cancelled.length > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200', tc: cancelled.length > 0 ? 'text-red-600' : 'text-slate-500' },
                ].map(item => (
                  <div key={item.label} className={`p-3 rounded-xl border ${item.color}`}>
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider leading-tight">{item.label}</p>
                    <p className={`text-sm font-extrabold mt-1 ${item.tc}`}>{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Property color legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', alignSelf: 'center' }}>
                  Propiedades:
                </span>
                {propertyLegend.map(p => {
                  const c = BOOKING_PALETTE[p.colorIndex % BOOKING_PALETTE.length];
                  return (
                    <div key={p.name} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '3px 10px', borderRadius: 999,
                      background: c.bg, color: c.color,
                      border: `1.5px solid ${c.border}`,
                      fontSize: 10, fontWeight: 700,
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, display: 'inline-block', flexShrink: 0 }} />
                      {p.name}
                    </div>
                  );
                })}
                {cancelled.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 999,
                    background: CANCELLED_STYLE.bg, color: CANCELLED_STYLE.color,
                    border: `1.5px solid ${CANCELLED_STYLE.border}`,
                    fontSize: 10, fontWeight: 600,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: CANCELLED_STYLE.dot, display: 'inline-block', flexShrink: 0 }} />
                    {cancelled.length} cancelada{cancelled.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Swimlane timelines — one full-width per month */}
              {months.map(({ year, month }) => (
                <MonthTimeline
                  key={`${year}-${month}`}
                  year={year}
                  month={month}
                  bookings={calBookings.filter(b => {
                    const mStart = new Date(year, month - 1, 1);
                    const mEnd   = new Date(year, month, 0);
                    const st     = new Date(b.start + 'T12:00:00');
                    const en     = new Date(b.end   + 'T12:00:00');
                    return st <= mEnd && en >= mStart;
                  })}
                />
              ))}

              {/* Bookings detail table */}
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 mt-5">Detalle de reservas</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    {[
                      '#', 'Código', 'Huésped', 'Propiedad',
                      'Check-in', 'Check-out', 'Noches',
                      'Ingresos', 'Neto pago', 'Estado',
                      ...(includeAdjustments ? ['Ajustes'] : []),
                    ].map(h => (
                      <th key={h} className="pb-2 pr-1 text-left font-semibold text-slate-500 text-[10px] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportBookings
                    .sort((a, b) => a.start_date.localeCompare(b.start_date))
                    .map((b, i) => {
                      const cancelled = isCancelledStatus(b.status);
                      const statusLabel = getBookingStatusLabel(b);
                      const netAdj = adjMap.get(b.id) ?? 0;
                      const propColorIdx = propertyColorMap.get(b.property_name ?? '') ?? 0;
                      const dot = cancelled
                        ? CANCELLED_STYLE.dot
                        : BOOKING_PALETTE[propColorIdx % BOOKING_PALETTE.length].dot;
                      return (
                        <tr key={b.id} className={`border-b border-slate-100 ${cancelled ? 'opacity-60' : ''}`}>
                          <td className="py-1.5 pr-1 text-slate-400">{i + 1}</td>
                          <td className="py-1.5 pr-1 font-mono text-[10px]">
                            <span className="flex items-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                              {b.confirmation_code}
                            </span>
                          </td>
                          <td className="py-1.5 pr-1 text-slate-700 max-w-[80px]">
                            <span className="block truncate">{b.guest_name ?? '—'}</span>
                          </td>
                          <td className="py-1.5 pr-1 text-slate-500 max-w-[70px]">
                            <span className="block truncate">{b.property_name ?? '—'}</span>
                          </td>
                          <td className="py-1.5 pr-1 font-mono text-slate-700 whitespace-nowrap">
                            {fmtDate(b.start_date)}
                          </td>
                          <td className="py-1.5 pr-1 font-mono text-slate-700 whitespace-nowrap">
                            {fmtDate(b.end_date)}
                          </td>
                          <td className="py-1.5 pr-1 text-right text-slate-600">{b.num_nights}</td>
                          <td className="py-1.5 pr-1 text-right font-mono text-blue-700 font-semibold">
                            {cancelled ? '—' : formatCurrency(b.total_revenue)}
                          </td>
                          <td className="py-1.5 pr-1 text-right font-mono text-slate-600">
                            {b.net_payout !== null ? formatCurrency(b.net_payout) : '—'}
                          </td>
                          <td className="py-1.5 pr-1">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              cancelled
                                ? 'bg-red-100 text-red-700'
                                : statusLabel === 'Completada'
                                  ? 'bg-green-100 text-green-700'
                                  : statusLabel === 'En curso'
                                    ? 'bg-violet-100 text-violet-700'
                                    : 'bg-blue-100 text-blue-700'
                            }`}>
                              {statusLabel}
                            </span>
                          </td>
                          {includeAdjustments && (
                            <td className={`py-1.5 text-right font-mono text-[10px] font-semibold ${netAdj > 0 ? 'text-emerald-600' : netAdj < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                              {netAdj !== 0 ? formatCurrency(netAdj) : '—'}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  }
                  {/* Totals */}
                  <tr className="font-bold bg-slate-50 border-t-2 border-slate-300">
                    <td colSpan={6} className="py-2 text-slate-700 text-[10px]">TOTAL ({active.length} activas)</td>
                    <td className="py-2 text-right text-slate-700">{totalNights}</td>
                    <td className="py-2 text-right font-mono text-blue-800">{formatCurrency(totalRevenue)}</td>
                    <td className="py-2 text-right font-mono text-slate-600">
                      {formatCurrency(active.reduce((s, b) => s + (b.net_payout ?? b.total_revenue), 0))}
                    </td>
                    <td />
                    {includeAdjustments && (
                      <td className="py-2 text-right font-mono text-emerald-700">
                        {formatCurrency(active.reduce((s, b) => s + (adjMap.get(b.id) ?? 0), 0))}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>

              {/* Adjustments detail — only if enabled and there are any */}
              {includeAdjustments && reportAdjustments.length > 0 && (
                <div className="mt-5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Detalle de ajustes por reserva</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-slate-200">
                        {['Reserva', 'Tipo', 'Descripción', 'Fecha', 'Monto'].map(h => (
                          <th key={h} className="pb-2 pr-2 text-left font-semibold text-slate-500 text-[10px] uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportAdjustments.map((a, i) => {
                        const bk = reportBookings.find(b => b.id === a.booking_id);
                        const sign = a.kind === 'discount' ? -1 : 1;
                        const val = sign * Number(a.amount);
                        const kindLabel: Record<string, string> = {
                          damage: 'Daño', extra: 'Extra', discount: 'Descuento', other: 'Otro',
                        };
                        return (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="py-1.5 pr-2 font-mono text-[10px] text-slate-600">{bk?.confirmation_code ?? '—'}</td>
                            <td className="py-1.5 pr-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                a.kind === 'discount' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {kindLabel[a.kind] ?? a.kind}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-slate-600">{a.description ?? '—'}</td>
                            <td className="py-1.5 pr-2 font-mono text-slate-500 whitespace-nowrap">{fmtDate(a.date)}</td>
                            <td className={`py-1.5 text-right font-mono font-semibold ${val >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {formatCurrency(Math.abs(val))}
                              {val < 0 && ' (−)'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          );
        })()}

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <div className="border-t pt-4 text-xs text-slate-400 flex justify-between items-center">
          <span>STR Analytics — Plataforma de gestión financiera</span>
          <span>{formatDateDisplay(todayISO())}</span>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 1.2cm; size: A4; }
          .print\\:hidden { display: none !important; }
          /* Allow the calendar tables to break across pages so thead repeats */
          .month-cal { overflow: visible !important; }
          /* Ensure thead is treated as a repeating header group */
          .month-cal thead { display: table-header-group; }
        }
      `}</style>
    </>
  );
}
