import { getDemoBookings, listBookings } from './bookings';
import { listExpenses } from './expenses';
import { listAllRecurringExpensesForOwner } from './recurringExpenses';
import { listAllBookingAdjustmentsForOwner } from './bookingAdjustments';
import { addMoney, subMoney } from '@/lib/money';
import type { Expense } from '@/types';
import type { PropertyRecurringExpenseRow } from '@/types/database';

// ─── Public types ─────────────────────────────────────────────────────────────

export type Period = 'current-month' | 'last-3-months' | 'this-year' | 'all' | 'custom';

/** How revenue is attributed in exports */
export type ReportMode = 'by-days' | 'by-bookings';

/** Granularity of the chart X-axis */
export type ChartGranularity = 'day' | 'week' | 'month';

/** Infer the best chart granularity from a date range */
export const inferGranularity = (from: Date, to: Date): ChartGranularity => {
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days <= 42)  return 'day';
  if (days <= 180) return 'week';
  return 'month';
};

export interface FinancialKPIs {
  grossRevenue: number;
  totalFixedExpenses: number;
  totalVariableExpenses: number;
  totalExpenses: number;
  contributionMargin: number;
  netProfit: number;
  occupancyRate: number; // 0-1
  adr: number;
  revpar: number;
  breakEvenNights: number;
  breakEvenOccupancy: number; // 0-100 %
  totalNights: number;
  availableNights: number;
  totalBookings: number;
  cancelledCount: number;
  /** Ingresos por cancelación (reservas canceladas con monto > 0, ej: tarifa de cancelación cobrada al huésped). */
  cancelledRevenue: number;
  /** Multas cobradas al anfitrión (reservas canceladas con monto negativo → se contabilizan como gasto). */
  cancelledFines: number;
  isDemo: boolean;
  /** Ingresos netos de ajustes de reserva (cobros de daños, ingresos extra, etc.) */
  netAdjustmentIncome: number;
  /** Fees cobrados por la plataforma (Airbnb, Booking…). Informativo — NO se restan de la utilidad. */
  totalChannelFees: number;
  /** Número de propiedades/listings distintos en el portafolio */
  propertyCount: number;
  vsLastPeriod: {
    grossRevenue: number | null;
    netProfit: number | null;
    occupancyRate: number | null;
  };
}

export interface MonthlyPnL {
  month: string; // label: "Ene 26" | "3 May" | "29/04–05/05"
  revenue: number;
  expenses: number;
  netProfit: number;
  nights: number;        // noches reservadas
  availableNights: number; // noches posibles (propiedades × días del bucket)
  occupancy: number; // 0-100
}

/** Detalle mensual de ingresos confirmados vs esperados */
export interface MonthlyPayoutData {
  month: string;
  received: number;  // net_payout de reservas con banco asignado
  expected: number;  // total_revenue de reservas sin banco (no canceladas)
  expenses: number;
  netConfirmed: number; // received - expenses
}

/**
 * Desglose de pagos:
 *  - received:        ingresos confirmados (payout_bank_account_id != null)
 *  - expected:        ingresos esperados (payout sin confirmar, no cancelados)
 *  - incompleteCount: reservas pasadas no canceladas con payout sin confirmar
 *  - monthlyBreakdown: desglose mes a mes
 */
export interface PayoutBreakdown {
  received: number;
  expected: number;
  incompleteCount: number;
  monthlyBreakdown: MonthlyPayoutData[];
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface BookingData {
  start_date: string;
  end_date: string;
  num_nights: number;
  revenue: number;
  status: string;
  listing_id?: string | null;
  payout_bank_account_id?: string | null;
  net_payout?: number | null;
}

/**
 * Ajuste de reserva reducido — solo los campos que necesita financial.ts.
 * Cargado vía `listAllBookingAdjustmentsForOwner` (RLS filtra por propietario).
 */
interface AdjData {
  kind: string;
  amount: number;
  date: string;
}

interface DateRange {
  from: Date;
  to: Date;
}

// ─── Demo seed (realistic Colombian STR data — Medellín 2026) ─────────────────
// Two properties: "Apto El Poblado 204" and "Suite Laureles 301"
// Prices already net of Airbnb 3% host fee, in COP

const DEMO_BOOKINGS_SEED: BookingData[] = [
  // ── Enero (temporada alta, Año Nuevo) ──────────────────────────────────────
  { status: 'Completada', start_date: '2026-01-02', end_date: '2026-01-05', num_nights: 3, revenue: 1_140_000 },
  { status: 'Completada', start_date: '2026-01-06', end_date: '2026-01-10', num_nights: 4, revenue: 1_520_000 },
  { status: 'Completada', start_date: '2026-01-11', end_date: '2026-01-16', num_nights: 5, revenue: 1_900_000 },
  { status: 'Cancelada',  start_date: '2026-01-18', end_date: '2026-01-20', num_nights: 2, revenue: 0 },
  { status: 'Completada', start_date: '2026-01-21', end_date: '2026-01-25', num_nights: 4, revenue: 1_520_000 },
  { status: 'Completada', start_date: '2026-01-25', end_date: '2026-01-28', num_nights: 3, revenue: 1_020_000 },
  { status: 'Completada', start_date: '2026-01-29', end_date: '2026-02-01', num_nights: 3, revenue: 1_020_000 },
  // ── Febrero (temporada alta, San Valentín) ─────────────────────────────────
  { status: 'Completada', start_date: '2026-02-02', end_date: '2026-02-07', num_nights: 5, revenue: 2_150_000 },
  { status: 'Completada', start_date: '2026-02-08', end_date: '2026-02-12', num_nights: 4, revenue: 1_680_000 },
  { status: 'Completada', start_date: '2026-02-13', end_date: '2026-02-17', num_nights: 4, revenue: 1_960_000 },
  { status: 'Completada', start_date: '2026-02-18', end_date: '2026-02-23', num_nights: 5, revenue: 2_150_000 },
  { status: 'Completada', start_date: '2026-02-24', end_date: '2026-02-28', num_nights: 4, revenue: 1_440_000 },
  // ── Marzo ──────────────────────────────────────────────────────────────────
  { status: 'Completada', start_date: '2026-03-01', end_date: '2026-03-04', num_nights: 3, revenue: 1_140_000 },
  { status: 'Completada', start_date: '2026-03-06', end_date: '2026-03-10', num_nights: 4, revenue: 1_520_000 },
  { status: 'Completada', start_date: '2026-03-11', end_date: '2026-03-16', num_nights: 5, revenue: 1_900_000 },
  { status: 'Completada', start_date: '2026-03-17', end_date: '2026-03-20', num_nights: 3, revenue: 1_140_000 },
  { status: 'Completada', start_date: '2026-03-21', end_date: '2026-03-26', num_nights: 5, revenue: 1_900_000 },
  { status: 'Cancelada',  start_date: '2026-03-28', end_date: '2026-03-30', num_nights: 2, revenue: 0 },
  // ── Abril (Semana Santa — tarifa premium) ──────────────────────────────────
  { status: 'Completada', start_date: '2026-04-01', end_date: '2026-04-06', num_nights: 5, revenue: 2_750_000 },
  { status: 'Completada', start_date: '2026-04-07', end_date: '2026-04-11', num_nights: 4, revenue: 2_200_000 },
  { status: 'Completada', start_date: '2026-04-12', end_date: '2026-04-15', num_nights: 3, revenue: 1_350_000 },
  { status: 'Reservada',  start_date: '2026-04-18', end_date: '2026-04-22', num_nights: 4, revenue: 1_760_000 },
  { status: 'Reservada',  start_date: '2026-04-24', end_date: '2026-04-28', num_nights: 4, revenue: 1_760_000 },
];

const DEMO_EXPENSES_SEED: Expense[] = [
  // ── Enero ──────────────────────────────────────────────────────────────────
  { id: 'ds01', property_id: 'demo', category: 'Internet',           type: 'fixed',    amount:  89_000, date: '2026-01-01', description: 'Claro Hogar 200Mbps', status: 'paid' },
  { id: 'ds02', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed',    amount: 385_000, date: '2026-01-05', description: 'Agua + Luz (EPM)', status: 'paid' },
  { id: 'ds03', property_id: 'demo', category: 'Administración',     type: 'fixed',    amount: 420_000, date: '2026-01-05', description: 'Cuota P.H. El Poblado', status: 'paid' },
  { id: 'ds04', property_id: 'demo', category: 'Seguro Hogar',       type: 'fixed',    amount: 185_000, date: '2026-01-05', description: 'Seguros Bolívar', status: 'paid' },
  { id: 'ds05', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-01-05', description: null, status: 'paid' },
  { id: 'ds06', property_id: 'demo', category: 'Lavandería',         type: 'variable', amount:  85_000, date: '2026-01-10', description: null, status: 'paid' },
  { id: 'ds07', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-01-16', description: null, status: 'paid' },
  { id: 'ds08', property_id: 'demo', category: 'Welcome Kit',        type: 'variable', amount:  95_000, date: '2026-01-21', description: 'Snacks + amenities', status: 'paid' },
  { id: 'ds09', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-01-25', description: null, status: 'paid' },
  { id: 'ds10', property_id: 'demo', category: 'Lavandería',         type: 'variable', amount:  85_000, date: '2026-01-28', description: null, status: 'paid' },
  // ── Febrero ────────────────────────────────────────────────────────────────
  { id: 'ds11', property_id: 'demo', category: 'Internet',           type: 'fixed',    amount:  89_000, date: '2026-02-01', description: 'Claro Hogar 200Mbps', status: 'paid' },
  { id: 'ds12', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed',    amount: 410_000, date: '2026-02-05', description: 'Agua + Luz (EPM)', status: 'paid' },
  { id: 'ds13', property_id: 'demo', category: 'Administración',     type: 'fixed',    amount: 420_000, date: '2026-02-05', description: 'Cuota P.H. El Poblado', status: 'paid' },
  { id: 'ds14', property_id: 'demo', category: 'Seguro Hogar',       type: 'fixed',    amount: 185_000, date: '2026-02-05', description: 'Seguros Bolívar', status: 'paid' },
  { id: 'ds15', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-02-07', description: null, status: 'paid' },
  { id: 'ds16', property_id: 'demo', category: 'Lavandería',         type: 'variable', amount:  85_000, date: '2026-02-12', description: null, status: 'paid' },
  { id: 'ds17', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-02-17', description: null, status: 'paid' },
  { id: 'ds18', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-02-23', description: null, status: 'paid' },
  { id: 'ds19', property_id: 'demo', category: 'Welcome Kit',        type: 'variable', amount:  95_000, date: '2026-02-24', description: 'Snacks + amenities', status: 'paid' },
  // ── Marzo ──────────────────────────────────────────────────────────────────
  { id: 'ds20', property_id: 'demo', category: 'Internet',           type: 'fixed',    amount:  89_000, date: '2026-03-01', description: 'Claro Hogar 200Mbps', status: 'paid' },
  { id: 'ds21', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed',    amount: 390_000, date: '2026-03-05', description: 'Agua + Luz (EPM)', status: 'paid' },
  { id: 'ds22', property_id: 'demo', category: 'Administración',     type: 'fixed',    amount: 420_000, date: '2026-03-05', description: 'Cuota P.H. El Poblado', status: 'paid' },
  { id: 'ds23', property_id: 'demo', category: 'Seguro Hogar',       type: 'fixed',    amount: 185_000, date: '2026-03-05', description: 'Seguros Bolívar', status: 'paid' },
  { id: 'ds24', property_id: 'demo', category: 'Mantenimiento',      type: 'variable', amount: 480_000, date: '2026-03-03', description: 'Plomero — grifo cocina', status: 'paid' },
  { id: 'ds25', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-03-04', description: null, status: 'paid' },
  { id: 'ds26', property_id: 'demo', category: 'Lavandería',         type: 'variable', amount:  85_000, date: '2026-03-10', description: null, status: 'paid' },
  { id: 'ds27', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-03-16', description: null, status: 'paid' },
  { id: 'ds28', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-03-20', description: null, status: 'paid' },
  { id: 'ds29', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-03-26', description: null, status: 'paid' },
  { id: 'ds30', property_id: 'demo', category: 'Welcome Kit',        type: 'variable', amount:  95_000, date: '2026-03-21', description: 'Snacks + amenities', status: 'paid' },
  // ── Abril ──────────────────────────────────────────────────────────────────
  { id: 'ds31', property_id: 'demo', category: 'Internet',           type: 'fixed',    amount:  89_000, date: '2026-04-01', description: 'Claro Hogar 200Mbps', status: 'paid' },
  { id: 'ds32', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed',    amount: 395_000, date: '2026-04-05', description: 'Agua + Luz (EPM)', status: 'pending' },
  { id: 'ds33', property_id: 'demo', category: 'Administración',     type: 'fixed',    amount: 420_000, date: '2026-04-05', description: 'Cuota P.H. El Poblado', status: 'pending' },
  { id: 'ds34', property_id: 'demo', category: 'Seguro Hogar',       type: 'fixed',    amount: 185_000, date: '2026-04-05', description: 'Seguros Bolívar', status: 'paid' },
  { id: 'ds35', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-04-06', description: 'Salida Semana Santa', status: 'paid' },
  { id: 'ds36', property_id: 'demo', category: 'Lavandería',         type: 'variable', amount:  85_000, date: '2026-04-06', description: null, status: 'paid' },
  { id: 'ds37', property_id: 'demo', category: 'Welcome Kit',        type: 'variable', amount: 120_000, date: '2026-04-07', description: 'Kit Semana Santa especial', status: 'paid' },
  { id: 'ds38', property_id: 'demo', category: 'Limpieza',           type: 'variable', amount: 180_000, date: '2026-04-11', description: null, status: 'paid' },
  { id: 'ds39', property_id: 'demo', category: 'Mantenimiento',      type: 'variable', amount: 320_000, date: '2026-04-14', description: 'Cambio cerradura inteligente', status: 'paid' },
];

// ─── Period helpers ───────────────────────────────────────────────────────────

const getPeriodRange = (period: Period): DateRange => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'current-month':  return { from: new Date(y, m, 1),     to: new Date(y, m + 1, 0) };
    case 'last-3-months':  return { from: new Date(y, m - 2, 1), to: new Date(y, m + 1, 0) };
    case 'this-year':      return { from: new Date(y, 0, 1),     to: new Date(y, 11, 31) };
    case 'all':            return { from: new Date(2000, 0, 1),  to: new Date(2099, 11, 31) };
    case 'custom':         return { from: new Date(y, m, 1),     to: new Date(y, m + 1, 0) }; // fallback; overridden in computeFinancials
  }
};

/**
 * Resolves a Period (+ optional custom range) to ISO date strings.
 * Exported so other services (e.g. transactions.ts) can use the same logic.
 */
export const resolvePeriodRange = (
  period: Period,
  customRange?: { from: string; to: string },
): { from: string; to: string } => {
  if (period === 'custom' && customRange?.from && customRange?.to) {
    return { from: customRange.from, to: customRange.to };
  }
  const r = getPeriodRange(period);
  const pad = (d: Date) => d.toISOString().slice(0, 10);
  return { from: pad(r.from), to: pad(r.to) };
};

const getPriorRange = (period: Period): DateRange => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (period) {
    case 'current-month':  return { from: new Date(y, m - 1, 1),     to: new Date(y, m, 0) };
    case 'last-3-months':  return { from: new Date(y, m - 5, 1),     to: new Date(y, m - 2, 0) };
    // YTD comparison: compare Jan 1 – today vs Jan 1 – same day last year (apples-to-apples)
    case 'this-year':      return { from: new Date(y - 1, 0, 1),     to: new Date(y - 1, m, d) };
    case 'all':            return { from: new Date(2000, 0, 1),       to: new Date(2099, 11, 31) };
    case 'custom':         return { from: new Date(y, m - 1, 1),     to: new Date(y, m, 0) }; // fallback; overridden in computeFinancials
  }
};

const daysInRange = (r: DateRange): number =>
  Math.max(1, Math.ceil((r.to.getTime() - r.from.getTime()) / 86_400_000) + 1);

// ─── Core KPI computation ─────────────────────────────────────────────────────

const computeCore = (
  bookings: BookingData[],
  expenses: Expense[],
  adjustments: AdjData[],
  range: DateRange,
  propertyCount = 1,
): Omit<FinancialKPIs, 'vsLastPeriod' | 'isDemo' | 'propertyCount' | 'totalChannelFees'> => {
  const inRange = (d: string) => { const t = new Date(d + 'T12:00:00'); return t >= range.from && t <= range.to; };

  const filtered  = bookings.filter(b => b.start_date && inRange(b.start_date));
  const completed = filtered.filter(b => !b.status.toLowerCase().includes('cancel'));
  const cancelled = filtered.filter(b =>  b.status.toLowerCase().includes('cancel'));

  const bookingRevenue = completed.reduce((s, b) => s + b.revenue, 0);
  const totalNights    = completed.reduce((s, b) => s + b.num_nights, 0);

  // Cancelled bookings with positive revenue: cancellation fee earned (counts as income)
  const cancelledRevenue = cancelled
    .filter(b => b.revenue > 0)
    .reduce((s, b) => s + b.revenue, 0);
  // Cancelled bookings with negative revenue: host was fined (counts as variable expense)
  const cancelledFines = cancelled
    .filter(b => b.revenue < 0)
    .reduce((s, b) => s + Math.abs(b.revenue), 0);

  // Ajustes de reserva en el rango: cobros de daños, ingresos extra, descuentos dados
  const adjInRange = adjustments.filter(a => a.date && inRange(a.date));
  const incomeFromAdj  = adjInRange.filter(a => a.kind !== 'discount').reduce((s, a) => addMoney(s, Number(a.amount)), 0);
  const discountsGiven = adjInRange.filter(a => a.kind === 'discount').reduce((s, a) => addMoney(s, Number(a.amount)), 0);
  const netAdjustmentIncome = subMoney(incomeFromAdj, discountsGiven);

  // grossRevenue includes cancelled-with-revenue (cancellation fees earned)
  const grossRevenue = bookingRevenue + netAdjustmentIncome + cancelledRevenue;

  const expInRange          = expenses.filter(e => e.date && inRange(e.date));
  const totalFixedExpenses  = expInRange.filter(e => e.type === 'fixed').reduce((s, e) => s + e.amount, 0);
  // cancelledFines are multas charged to the host — treated as variable expense
  const totalVariableExpenses = expInRange.filter(e => e.type === 'variable').reduce((s, e) => s + e.amount, 0) + cancelledFines;
  const totalExpenses       = totalFixedExpenses + totalVariableExpenses;
  const contributionMargin  = grossRevenue - totalVariableExpenses;
  const netProfit           = contributionMargin - totalFixedExpenses;

  // availableNights = días del período × número de propiedades en el portafolio
  const availableNights = daysInRange(range) * Math.max(1, propertyCount);
  const occupancyRate   = availableNights > 0 ? Math.min(1, totalNights / availableNights) : 0;
  const adr    = totalNights > 0 ? bookingRevenue / totalNights : 0; // ADR = solo tarifa, sin ajustes
  const revpar = availableNights > 0 ? bookingRevenue / availableNights : 0;

  // Break-even: §2.2 FINANCIAL_MODEL
  const varCostPerNight  = totalNights > 0 ? totalVariableExpenses / totalNights : 0;
  const marginPerNight   = adr - varCostPerNight;
  const breakEvenNights  = marginPerNight > 0 ? Math.ceil(totalFixedExpenses / marginPerNight) : 0;
  const breakEvenOccupancy = availableNights > 0 ? Math.round((breakEvenNights / availableNights) * 100) : 0;

  return {
    grossRevenue:           Math.round(grossRevenue),
    totalFixedExpenses:     Math.round(totalFixedExpenses),
    totalVariableExpenses:  Math.round(totalVariableExpenses),
    totalExpenses:          Math.round(totalExpenses),
    contributionMargin:     Math.round(contributionMargin),
    netProfit:              Math.round(netProfit),
    netAdjustmentIncome:    Math.round(netAdjustmentIncome),
    occupancyRate,
    adr:                    Math.round(adr),
    revpar:                 Math.round(revpar),
    breakEvenNights,
    breakEvenOccupancy,
    totalNights,
    availableNights,
    totalBookings:   completed.length,
    cancelledCount:  cancelled.length,
    cancelledRevenue: Math.round(cancelledRevenue),
    cancelledFines:   Math.round(cancelledFines),
  };
};

// ─── Chart data builders ─────────────────────────────────────────────────────

const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
/** Monday of the ISO week containing `d` */
const weekStart = (d: Date): Date => {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const day = dt.getDay(); // 0=Sun … 6=Sat
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
  return dt;
};

const dateFmt  = (d: Date) => d.toISOString().slice(0, 10);
const pad2     = (n: number) => String(n).padStart(2, '0');
const monthFmt = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

const weekLabel = (ws: Date): string => {
  const we = new Date(ws);
  we.setDate(we.getDate() + 6);
  if (ws.getMonth() === we.getMonth()) {
    return `${ws.getDate()}–${we.getDate()} ${MONTHS_ES[ws.getMonth()]}`;
  }
  return `${ws.getDate()} ${MONTHS_ES[ws.getMonth()]}–${we.getDate()} ${MONTHS_ES[we.getMonth()]}`;
};

const buildMonthlyPnL = (
  bookings: BookingData[],
  expenses: Expense[],
  adjustments: AdjData[],
  range: DateRange,
  granularity: ChartGranularity,
  propertyCount = 1,
): MonthlyPnL[] => {
  const revMap    = new Map<string, number>();
  const nightsMap = new Map<string, number>();
  const expMap    = new Map<string, number>();

  const add = (map: Map<string, number>, key: string, val: number) =>
    map.set(key, (map.get(key) ?? 0) + val);

  const keyFn: (d: Date) => string =
    granularity === 'day'  ? dateFmt :
    granularity === 'week' ? (d) => dateFmt(weekStart(d)) :
    monthFmt;

  // Pro-rate booking revenue night-by-night into the appropriate bucket
  for (const b of bookings) {
    if (b.status.toLowerCase().includes('cancel') || !b.start_date || !b.end_date || b.num_nights === 0) continue;
    const ratePerNight = b.revenue / b.num_nights;
    const cur = new Date(b.start_date + 'T12:00:00');
    const end = new Date(b.end_date + 'T12:00:00');
    while (cur < end) {
      const k = keyFn(cur);
      add(revMap, k, ratePerNight);
      add(nightsMap, k, 1);
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Booking adjustments bucketed by their own date (not pro-rated)
  for (const a of adjustments) {
    if (!a.date) continue;
    const sign = a.kind === 'discount' ? -1 : 1;
    add(revMap, keyFn(new Date(a.date + 'T12:00:00')), sign * Number(a.amount));
  }

  for (const e of expenses) {
    if (!e.date) continue;
    add(expMap, keyFn(new Date(e.date + 'T12:00:00')), e.amount);
  }

  const pc = Math.max(1, propertyCount);
  const result: MonthlyPnL[] = [];

  if (granularity === 'month') {
    const cur = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
    const end = new Date(range.to.getFullYear(), range.to.getMonth() + 1, 1);
    while (cur < end) {
      const k              = monthFmt(cur);
      const yr2            = String(cur.getFullYear() % 100).padStart(2, '0');
      const revenue        = Math.round(revMap.get(k) ?? 0);
      const expense        = Math.round(expMap.get(k) ?? 0);
      const nights         = nightsMap.get(k) ?? 0;
      const daysInMo       = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      const availableNights = daysInMo * pc;
      result.push({ month: `${MONTHS_ES[cur.getMonth()]} ${yr2}`, revenue, expenses: expense, netProfit: revenue - expense, nights, availableNights, occupancy: Math.round(nights / availableNights * 100) });
      cur.setMonth(cur.getMonth() + 1);
    }
  } else if (granularity === 'week') {
    const cur = weekStart(range.from);
    while (cur <= range.to) {
      const k              = dateFmt(cur);
      const revenue        = Math.round(revMap.get(k) ?? 0);
      const expense        = Math.round(expMap.get(k) ?? 0);
      const nights         = nightsMap.get(k) ?? 0;
      const availableNights = 7 * pc;
      result.push({ month: weekLabel(cur), revenue, expenses: expense, netProfit: revenue - expense, nights, availableNights, occupancy: Math.min(100, Math.round(nights / availableNights * 100)) });
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    // day
    const cur = new Date(range.from);
    cur.setHours(0, 0, 0, 0);
    while (cur <= range.to) {
      const k              = dateFmt(cur);
      const revenue        = Math.round(revMap.get(k) ?? 0);
      const expense        = Math.round(expMap.get(k) ?? 0);
      const nights         = nightsMap.get(k) ?? 0;
      const availableNights = pc; // 1 día × N propiedades
      result.push({ month: `${cur.getDate()} ${MONTHS_ES[cur.getMonth()]}`, revenue, expenses: expense, netProfit: revenue - expense, nights, availableNights, occupancy: Math.min(100, Math.round(nights / availableNights * 100)) });
      cur.setDate(cur.getDate() + 1);
    }
  }

  return result;
};

/**
 * Monthly P&L where booking revenue is attributed in full to the check-in
 * date's bucket (month/week/day), rather than being pro-rated night-by-night.
 * A booking that starts Dec 28 and ends Jan 3 → all revenue counted in December.
 */
const buildMonthlyPnLByBookings = (
  bookings: BookingData[],
  expenses: Expense[],
  adjustments: AdjData[],
  range: DateRange,
  propertyCount = 1,
): MonthlyPnL[] => {
  const revMap    = new Map<string, number>();
  const nightsMap = new Map<string, number>();
  const expMap    = new Map<string, number>();

  const add = (map: Map<string, number>, key: string, val: number) =>
    map.set(key, (map.get(key) ?? 0) + val);

  // Revenue attributed to check-in month in full (no pro-rating)
  for (const b of bookings) {
    if (b.status.toLowerCase().includes('cancel') || !b.start_date || b.num_nights === 0) continue;
    const k = monthFmt(new Date(b.start_date + 'T12:00:00'));
    add(revMap, k, b.revenue);
    add(nightsMap, k, b.num_nights);
  }

  for (const a of adjustments) {
    if (!a.date) continue;
    const sign = a.kind === 'discount' ? -1 : 1;
    add(revMap, monthFmt(new Date(a.date + 'T12:00:00')), sign * Number(a.amount));
  }

  for (const e of expenses) {
    if (!e.date) continue;
    add(expMap, monthFmt(new Date(e.date + 'T12:00:00')), e.amount);
  }

  const pc = Math.max(1, propertyCount);
  const result: MonthlyPnL[] = [];
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const end = new Date(range.to.getFullYear(), range.to.getMonth() + 1, 1);
  while (cur < end) {
    const k              = monthFmt(cur);
    const yr2            = String(cur.getFullYear() % 100).padStart(2, '0');
    const revenue        = Math.round(revMap.get(k) ?? 0);
    const expense        = Math.round(expMap.get(k) ?? 0);
    const nights         = nightsMap.get(k) ?? 0;
    const daysInMo       = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const availableNights = daysInMo * pc;
    result.push({ month: `${MONTHS_ES[cur.getMonth()]} ${yr2}`, revenue, expenses: expense, netProfit: revenue - expense, nights, availableNights, occupancy: Math.round(nights / availableNights * 100) });
    cur.setMonth(cur.getMonth() + 1);
  }
  return result;
};

// ─── Payout Breakdown (confirmed vs expected) ─────────────────────────────────
const buildPayoutBreakdown = (
  bookings: BookingData[],
  expenses: Expense[],
  range: DateRange,
  granularity: ChartGranularity,
): PayoutBreakdown => {
  const inRange = (d: string) => { const t = new Date(d + 'T12:00:00'); return t >= range.from && t <= range.to; };
  const today   = new Date();
  today.setHours(0, 0, 0, 0);

  const keyFn: (d: Date) => string =
    granularity === 'day'  ? dateFmt :
    granularity === 'week' ? (d) => dateFmt(weekStart(d)) :
    monthFmt;

  const activeBkgs = bookings.filter(b => !b.status.toLowerCase().includes('cancel') && b.start_date && inRange(b.start_date));

  let received = 0;
  let expected = 0;
  let incompleteCount = 0;

  const recvMap: Map<string, number> = new Map();
  const exptMap: Map<string, number> = new Map();
  const expMap:  Map<string, number> = new Map();

  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const b of activeBkgs) {
    const key = keyFn(new Date(b.start_date + 'T12:00:00'));
    const isConfirmed = b.payout_bank_account_id != null;
    const isPast      = new Date(b.end_date + 'T12:00:00') < today;

    if (isConfirmed) {
      received += b.net_payout ?? b.revenue;
      add(recvMap, key, b.net_payout ?? b.revenue);
    } else {
      expected += b.revenue;
      add(exptMap, key, b.revenue);
      if (isPast) incompleteCount++;
    }
  }

  for (const e of expenses) {
    if (!e.date || !inRange(e.date)) continue;
    add(expMap, keyFn(new Date(e.date + 'T12:00:00')), e.amount);
  }

  const monthlyBreakdown: MonthlyPayoutData[] = [];

  if (granularity === 'month') {
    const cur = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
    const end = new Date(range.to.getFullYear(), range.to.getMonth() + 1, 1);
    while (cur < end) {
      const k    = monthFmt(cur);
      const yr2  = String(cur.getFullYear() % 100).padStart(2, '0');
      const recv = Math.round(recvMap.get(k) ?? 0);
      const expt = Math.round(exptMap.get(k) ?? 0);
      const exp  = Math.round(expMap.get(k)  ?? 0);
      monthlyBreakdown.push({ month: `${MONTHS_ES[cur.getMonth()]} ${yr2}`, received: recv, expected: expt, expenses: exp, netConfirmed: recv - exp });
      cur.setMonth(cur.getMonth() + 1);
    }
  } else if (granularity === 'week') {
    const cur = weekStart(range.from);
    while (cur <= range.to) {
      const k    = dateFmt(cur);
      const recv = Math.round(recvMap.get(k) ?? 0);
      const expt = Math.round(exptMap.get(k) ?? 0);
      const exp  = Math.round(expMap.get(k)  ?? 0);
      monthlyBreakdown.push({ month: weekLabel(cur), received: recv, expected: expt, expenses: exp, netConfirmed: recv - exp });
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    // day
    const cur = new Date(range.from);
    cur.setHours(0, 0, 0, 0);
    while (cur <= range.to) {
      const k    = dateFmt(cur);
      const recv = Math.round(recvMap.get(k) ?? 0);
      const expt = Math.round(exptMap.get(k) ?? 0);
      const exp  = Math.round(expMap.get(k)  ?? 0);
      monthlyBreakdown.push({ month: `${cur.getDate()} ${MONTHS_ES[cur.getMonth()]}`, received: recv, expected: expt, expenses: exp, netConfirmed: recv - exp });
      cur.setDate(cur.getDate() + 1);
    }
  }

  return { received: Math.round(received), expected: Math.round(expected), incompleteCount, monthlyBreakdown };
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Calculates period-over-period change ratio.
 * Returns null when prior data is zero or too sparse to produce a meaningful
 * comparison (prior < 5% of current absolute value). Caps at ±5.0 (±500%)
 * so isolated early-stage data doesn't produce absurd figures.
 */
const delta = (cur: number, prior: number): number | null => {
  if (prior === 0) return null;
  // If prior period had negligible data relative to current, comparison is not meaningful
  if (Math.abs(prior) < Math.abs(cur) * 0.05 && Math.abs(cur) > 0) return null;
  const ratio = (cur - prior) / Math.abs(prior);
  // Cap at ±500% to avoid misleading badges when early-stage data is used as baseline
  return Math.max(-5, Math.min(5, ratio));
};

/**
 * Expand active recurring expenses into synthetic monthly Expense entries
 * covering [from, to]. One entry per recurring row per month, dated to its
 * `day_of_month` (clamped to the month length).
 */
const expandRecurringExpenses = (
  recurring: PropertyRecurringExpenseRow[],
  from: Date,
  to: Date,
): Expense[] => {
  if (recurring.length === 0) return [];
  const out: Expense[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth() + 1, 1);
  while (cur < end) {
    const daysInMo = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    for (const r of recurring) {
      const day = Math.min(Math.max(Number(r.day_of_month) || 1, 1), daysInMo);
      const date = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      // Respeta vigencia (SCD type 2)
      if (r.valid_from && date < r.valid_from) continue;
      if (r.valid_to && date > r.valid_to) continue;
      out.push({
        id: `rec-${r.id}-${date}`,
        property_id: r.property_id,
        category: r.category,
        type: 'fixed',
        amount: Number(r.amount),
        date,
        description: r.description ?? `Recurrente: ${r.category}`,
        status: 'paid',
      });
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
};

export const computeFinancials = async (
  period: Period,
  isAuthenticated = false,
  propertyIdOrIds?: string | string[],
  customDateRange?: { from: string; to: string },
): Promise<{ kpis: FinancialKPIs; monthlyPnL: MonthlyPnL[]; exportMonthly: MonthlyPnL[]; exportMonthlyByBookings: MonthlyPnL[]; payoutBreakdown: PayoutBreakdown; granularity: ChartGranularity; expensesInPeriod: Expense[] }> => {
  const propertyIds: string[] | undefined = Array.isArray(propertyIdOrIds)
    ? (propertyIdOrIds.length > 0 ? propertyIdOrIds : undefined)
    : (propertyIdOrIds ? [propertyIdOrIds] : undefined);
  let bookings: BookingData[] = [];
  let isDemo = false;
  const bookingFilters = propertyIds ? { propertyIds } : undefined;

  let rawBookingFees: Array<{ start_date: string | null; channel_fees: number }> = [];

  if (isAuthenticated) {
    const bookingRes = await listBookings(bookingFilters);
    if (!bookingRes.error && bookingRes.data) {
      bookings = bookingRes.data.map(r => ({
        start_date: r.start_date,
        end_date:   r.end_date,
        num_nights: r.num_nights,
        revenue:    Number(r.total_revenue),
        status:     r.status ?? '',
        listing_id: r.listing_id ?? null,
        payout_bank_account_id: r.payout_bank_account_id ?? null,
        net_payout: r.net_payout !== null && r.net_payout !== undefined ? Number(r.net_payout) : null,
      }));
      rawBookingFees = bookingRes.data.map(r => ({
        start_date: r.start_date ?? null,
        channel_fees: Number(r.channel_fees ?? 0),
      }));
    }
  } else {
    const bookingRes = await listBookings(bookingFilters);
    if (bookingRes.error || !bookingRes.data || bookingRes.data.length === 0) {
      const stored = getDemoBookings();
      bookings = stored.length > 0
        ? stored.map(b => ({ start_date: b.start_date, end_date: b.end_date, num_nights: b.num_nights, revenue: b.revenue, status: b.status, listing_id: null, payout_bank_account_id: null, net_payout: null }))
        : DEMO_BOOKINGS_SEED.map(b => ({ ...b, listing_id: null, payout_bank_account_id: null, net_payout: null }));
      isDemo = true;
    } else {
      bookings = (bookingRes.data ?? []).map(r => ({
        start_date: r.start_date,
        end_date:   r.end_date,
        num_nights: r.num_nights,
        revenue:    Number(r.total_revenue),
        status:     r.status ?? '',
        listing_id: r.listing_id ?? null,
        payout_bank_account_id: r.payout_bank_account_id ?? null,
        net_payout: r.net_payout !== null && r.net_payout !== undefined ? Number(r.net_payout) : null,
      }));
    }
  }

  // Load expenses (filtered by property if set).
  // Disable synthetic injection here; computeFinancials does its own injection.
  const expenseRes = await listExpenses(propertyIds, {
    includeRecurring: false,
    includeChannelFees: false,
    includeCancelledFines: false, // Already summed from bookings directly in computeCore
  });
  let expenses: Expense[] = [];
  if (isAuthenticated) {
    expenses = expenseRes.error ? [] : (expenseRes.data ?? []);
  } else {
    expenses = (expenseRes.error || !expenseRes.data || expenseRes.data.length === 0)
      ? DEMO_EXPENSES_SEED
      : expenseRes.data;
  }

  // Expand active recurring expenses into synthetic monthly entries.
  // Only for authenticated users; demo data already includes fixed expenses.
  if (isAuthenticated) {
    const recRes = await listAllRecurringExpensesForOwner();
    if (!recRes.error && recRes.data && recRes.data.length > 0) {
      const filtered = propertyIds
        ? recRes.data.filter(r => propertyIds.includes(r.property_id))
        : recRes.data;

      // Expansion window: from earliest data point (or 24 months ago) to today.
      const dates: number[] = [];
      for (const b of bookings) if (b.start_date) dates.push(new Date(b.start_date).getTime());
      for (const e of expenses) if (e.date) dates.push(new Date(e.date).getTime());
      const now = new Date();
      const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1);
      const earliest = dates.length > 0 ? new Date(Math.min(...dates)) : twoYearsAgo;
      const fromDate = earliest < twoYearsAgo ? earliest : twoYearsAgo;

      const synthetic = expandRecurringExpenses(filtered, fromDate, now);
      expenses = [...expenses, ...synthetic];
    }
  }

  // Load booking adjustments(authenticated only; RLS ensures owner scope).
  // Demo mode skips this — no adjustments in seed data.
  let adjustments: AdjData[] = [];
  if (isAuthenticated && !isDemo) {
    const adjRes = await listAllBookingAdjustmentsForOwner();
    if (!adjRes.error && adjRes.data) {
      adjustments = adjRes.data.map(a => ({
        kind:   a.kind,
        amount: Number(a.amount),
        date:   a.date,
      }));
    }
  }

  // Compute KPIs for current + prior period
  // For 'custom', override range with the user-supplied date range
  const range: DateRange = (period === 'custom' && customDateRange)
    ? { from: new Date(customDateRange.from + 'T00:00:00'), to: new Date(customDateRange.to + 'T00:00:00') }
    : getPeriodRange(period);

  // Compute channel fees scoped to the selected period (was summing all-time before)
  const totalChannelFees = rawBookingFees
    .filter(b => {
      if (!b.start_date) return false;
      const d = new Date(b.start_date + 'T00:00:00');
      return d >= range.from && d <= range.to;
    })
    .reduce((s, b) => s + b.channel_fees, 0);

  const priorRange: DateRange = (() => {
    if (period === 'custom' && customDateRange) {
      // Shift back by the same duration
      const ms = range.to.getTime() - range.from.getTime();
      return { from: new Date(range.from.getTime() - ms - 86_400_000), to: new Date(range.from.getTime() - 86_400_000) };
    }
    return getPriorRange(period);
  })();

  // Compute propertyCount: number of distinct listings in the loaded set.
  // If propertyIds is explicitly provided, use that count; otherwise count unique listing_ids.
  const propertyCount = propertyIds
    ? propertyIds.length
    : new Set(bookings.map(b => b.listing_id).filter(Boolean)).size || 1;

  const core  = computeCore(bookings, expenses, adjustments, range, propertyCount);
  const prior = computeCore(bookings, expenses, adjustments, priorRange, propertyCount);

  const kpis: FinancialKPIs = {
    ...core,
    isDemo,
    propertyCount,
    totalChannelFees: Math.round(totalChannelFees),
    vsLastPeriod: {
      grossRevenue:  delta(core.grossRevenue,  prior.grossRevenue),
      netProfit:     delta(core.netProfit,     prior.netProfit),
      occupancyRate: delta(core.occupancyRate, prior.occupancyRate),
    },
  };

  // Chart range — don't expand current-month anymore; each period shows its own data
  const chartRange: DateRange = (() => {
    if (period === 'custom' && customDateRange) return range;
    if (period === 'all') {
      const dates = [
        ...bookings.map(b => b.start_date),
        ...expenses.map(e => e.date),
      ].filter(Boolean).sort();
      if (dates.length === 0) {
        const today = new Date();
        return { from: new Date(today.getFullYear(), today.getMonth() - 11, 1), to: today };
      }
      return {
        from: new Date(dates[0] + 'T00:00:00'),
        to: new Date(dates[dates.length - 1] + 'T00:00:00'),
      };
    }
    return range;
  })();

  const granularity: ChartGranularity = (() => {
    if (period === 'current-month') return 'day';
    if (period === 'last-3-months') return 'week';
    if (period === 'custom')        return inferGranularity(chartRange.from, chartRange.to);
    return 'month'; // this-year, all
  })();

  const monthlyPnL = buildMonthlyPnL(bookings, expenses, adjustments, chartRange, granularity, propertyCount);

  // Export range: always monthly for export (PDF/Excel readability)
  const exportRange = (() => {
    const today = new Date();
    if (period === 'this-year') {
      return { from: range.from, to: today < range.to ? today : range.to };
    }
    if (period === 'all') {
      const dates = [
        ...bookings.map(b => b.start_date),
        ...expenses.map(e => e.date),
      ].filter(Boolean).sort();
      if (dates.length === 0) return range;
      return {
        from: new Date(dates[0] + 'T00:00:00'),
        to: new Date(dates[dates.length - 1] + 'T00:00:00'),
      };
    }
    return range;
  })();
  const exportMonthly   = buildMonthlyPnL(bookings, expenses, adjustments, exportRange, 'month', propertyCount);
  const exportMonthlyByBookings = buildMonthlyPnLByBookings(bookings, expenses, adjustments, exportRange, propertyCount);
  const payoutBreakdown = buildPayoutBreakdown(bookings, expenses, chartRange, granularity);

  const inPeriod = (d: string) => { const t = new Date(d + 'T12:00:00'); return t >= range.from && t <= range.to; };
  const expensesInPeriod = expenses.filter(e => e.date && inPeriod(e.date));

  return { kpis, monthlyPnL, exportMonthly, exportMonthlyByBookings, payoutBreakdown, granularity, expensesInPeriod };
};
