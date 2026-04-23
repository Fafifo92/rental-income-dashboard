import { getDemoBookings, listBookings } from './bookings';
import { listExpenses } from './expenses';
import { listAllRecurringExpensesForOwner } from './recurringExpenses';
import type { Expense } from '@/types';
import type { PropertyRecurringExpenseRow } from '@/types/database';

// ─── Public types ─────────────────────────────────────────────────────────────

export type Period = 'current-month' | 'last-3-months' | 'this-year' | 'all';

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
  isDemo: boolean;
  vsLastPeriod: {
    grossRevenue: number | null;
    netProfit: number | null;
    occupancyRate: number | null;
  };
}

export interface MonthlyPnL {
  month: string; // "Ene 26"
  revenue: number;
  expenses: number;
  netProfit: number;
  nights: number;
  occupancy: number; // 0-100
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface BookingData {
  start_date: string;
  end_date: string;
  num_nights: number;
  revenue: number;
  status: string;
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
  }
};

const getPriorRange = (period: Period): DateRange => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'current-month':  return { from: new Date(y, m - 1, 1),     to: new Date(y, m, 0) };
    case 'last-3-months':  return { from: new Date(y, m - 5, 1),     to: new Date(y, m - 2, 0) };
    case 'this-year':      return { from: new Date(y - 1, 0, 1),     to: new Date(y - 1, 11, 31) };
    case 'all':            return { from: new Date(2000, 0, 1),       to: new Date(2099, 11, 31) };
  }
};

const daysInRange = (r: DateRange): number =>
  Math.max(1, Math.ceil((r.to.getTime() - r.from.getTime()) / 86_400_000) + 1);

// ─── Core KPI computation ─────────────────────────────────────────────────────

const computeCore = (
  bookings: BookingData[],
  expenses: Expense[],
  range: DateRange,
): Omit<FinancialKPIs, 'vsLastPeriod' | 'isDemo'> => {
  const inRange = (d: string) => { const t = new Date(d); return t >= range.from && t <= range.to; };

  const filtered  = bookings.filter(b => b.start_date && inRange(b.start_date));
  const completed = filtered.filter(b => !b.status.toLowerCase().includes('cancel'));
  const cancelled = filtered.filter(b =>  b.status.toLowerCase().includes('cancel'));

  const grossRevenue = completed.reduce((s, b) => s + b.revenue, 0);
  const totalNights  = completed.reduce((s, b) => s + b.num_nights, 0);

  const expInRange          = expenses.filter(e => e.date && inRange(e.date));
  const totalFixedExpenses  = expInRange.filter(e => e.type === 'fixed').reduce((s, e) => s + e.amount, 0);
  const totalVariableExpenses = expInRange.filter(e => e.type === 'variable').reduce((s, e) => s + e.amount, 0);
  const totalExpenses       = totalFixedExpenses + totalVariableExpenses;
  const contributionMargin  = grossRevenue - totalVariableExpenses;
  const netProfit           = contributionMargin - totalFixedExpenses;

  const availableNights = daysInRange(range);
  const occupancyRate   = Math.min(1, totalNights / availableNights);
  const adr    = totalNights > 0 ? grossRevenue / totalNights : 0;
  const revpar = availableNights > 0 ? grossRevenue / availableNights : 0;

  // Break-even: §2.2 FINANCIAL_MODEL
  const varCostPerNight  = totalNights > 0 ? totalVariableExpenses / totalNights : 0;
  const marginPerNight   = adr - varCostPerNight;
  const breakEvenNights  = marginPerNight > 0 ? Math.ceil(totalFixedExpenses / marginPerNight) : 0;
  const breakEvenOccupancy = Math.round((breakEvenNights / availableNights) * 100);

  return {
    grossRevenue:           Math.round(grossRevenue),
    totalFixedExpenses:     Math.round(totalFixedExpenses),
    totalVariableExpenses:  Math.round(totalVariableExpenses),
    totalExpenses:          Math.round(totalExpenses),
    contributionMargin:     Math.round(contributionMargin),
    netProfit:              Math.round(netProfit),
    occupancyRate,
    adr:                    Math.round(adr),
    revpar:                 Math.round(revpar),
    breakEvenNights,
    breakEvenOccupancy,
    totalNights,
    availableNights,
    totalBookings:   completed.length,
    cancelledCount:  cancelled.length,
  };
};

// ─── Monthly P&L (pro-rated per FINANCIAL_MODEL §2.1) ─────────────────────────

const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const buildMonthlyPnL = (
  bookings: BookingData[],
  expenses: Expense[],
  range: DateRange,
): MonthlyPnL[] => {
  const revMap  = new Map<string, number>();
  const nightsMap = new Map<string, number>();
  const expMap  = new Map<string, number>();

  const add = (map: Map<string, number>, key: string, val: number) =>
    map.set(key, (map.get(key) ?? 0) + val);

  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  // Pro-rate revenue night-by-night
  for (const b of bookings) {
    if (b.status.toLowerCase().includes('cancel') || !b.start_date || !b.end_date || b.num_nights === 0) continue;
    const ratePerNight = b.revenue / b.num_nights;
    const cur = new Date(b.start_date);
    const end = new Date(b.end_date);
    while (cur < end) {
      const k = monthKey(cur);
      add(revMap, k, ratePerNight);
      add(nightsMap, k, 1);
      cur.setDate(cur.getDate() + 1);
    }
  }

  for (const e of expenses) {
    if (!e.date) continue;
    add(expMap, monthKey(new Date(e.date)), e.amount);
  }

  const result: MonthlyPnL[] = [];
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const end = new Date(range.to.getFullYear(), range.to.getMonth() + 1, 1);

  while (cur < end) {
    const k = monthKey(cur);
    const yr2 = String(cur.getFullYear() % 100).padStart(2, '0');
    const revenue  = Math.round(revMap.get(k) ?? 0);
    const expense  = Math.round(expMap.get(k) ?? 0);
    const nights   = nightsMap.get(k) ?? 0;
    const daysInMo = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();

    result.push({
      month:     `${MONTHS_ES[cur.getMonth()]} ${yr2}`,
      revenue,
      expenses:  expense,
      netProfit: revenue - expense,
      nights,
      occupancy: Math.round((nights / daysInMo) * 100),
    });

    cur.setMonth(cur.getMonth() + 1);
  }
  return result;
};

// ─── Main export ──────────────────────────────────────────────────────────────

const delta = (cur: number, prior: number): number | null =>
  prior === 0 ? null : (cur - prior) / Math.abs(prior);

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
  propertyId?: string,
): Promise<{ kpis: FinancialKPIs; monthlyPnL: MonthlyPnL[]; exportMonthly: MonthlyPnL[] }> => {
  let bookings: BookingData[] = [];
  let isDemo = false;
  const bookingFilters = propertyId ? { propertyId } : undefined;

  // Channel fees → tratados como gasto sintético para que impacten netProfit
  const channelFeeExpenses: Expense[] = [];

  if (isAuthenticated) {
    const bookingRes = await listBookings(bookingFilters);
    if (!bookingRes.error) {
      bookings = bookingRes.data.map(r => ({
        start_date: r.start_date,
        end_date:   r.end_date,
        num_nights: r.num_nights,
        revenue:    Number(r.total_revenue),
        status:     r.status ?? '',
      }));
      for (const r of bookingRes.data) {
        const fees = Number(r.channel_fees ?? 0);
        if (fees > 0) {
          channelFeeExpenses.push({
            id: `fee-${r.id}`,
            property_id: null,
            category: 'Comisiones de canal',
            type: 'variable',
            amount: fees,
            date: r.start_date,
            description: `Comisión ${r.channel ?? 'canal'} — ${r.confirmation_code}`,
            status: 'paid',
          });
        }
      }
    }
  } else {
    const bookingRes = await listBookings(bookingFilters);
    if (bookingRes.error || bookingRes.data.length === 0) {
      const stored = getDemoBookings();
      bookings = stored.length > 0
        ? stored.map(b => ({ start_date: b.start_date, end_date: b.end_date, num_nights: b.num_nights, revenue: b.revenue, status: b.status }))
        : DEMO_BOOKINGS_SEED;
      isDemo = true;
    } else {
      bookings = bookingRes.data.map(r => ({
        start_date: r.start_date,
        end_date:   r.end_date,
        num_nights: r.num_nights,
        revenue:    Number(r.total_revenue),
        status:     r.status ?? '',
      }));
    }
  }

  // Load expenses (filtered by property if set).
  // Disable synthetic injection here; computeFinancials does its own injection.
  const expenseRes = await listExpenses(propertyId, {
    includeRecurring: false,
    includeChannelFees: false,
  });
  let expenses: Expense[] = [];
  if (isAuthenticated) {
    expenses = expenseRes.error ? [] : expenseRes.data;
  } else {
    expenses = (expenseRes.error || expenseRes.data.length === 0)
      ? DEMO_EXPENSES_SEED
      : expenseRes.data;
  }

  // Expand active recurring expenses into synthetic monthly entries.
  // Only for authenticated users; demo data already includes fixed expenses.
  if (isAuthenticated) {
    const recRes = await listAllRecurringExpensesForOwner();
    if (!recRes.error && recRes.data.length > 0) {
      const filtered = propertyId
        ? recRes.data.filter(r => r.property_id === propertyId)
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

  // Add channel fee synthetic expenses (authenticated only)
  if (channelFeeExpenses.length > 0) {
    expenses = [...expenses, ...channelFeeExpenses];
  }

  // Compute KPIs for current + prior period
  const range      = getPeriodRange(period);
  const priorRange = getPriorRange(period);
  const core  = computeCore(bookings, expenses, range);
  const prior = computeCore(bookings, expenses, priorRange);

  const kpis: FinancialKPIs = {
    ...core,
    isDemo,
    vsLastPeriod: {
      grossRevenue:  delta(core.grossRevenue,  prior.grossRevenue),
      netProfit:     delta(core.netProfit,     prior.netProfit),
      occupancyRate: delta(core.occupancyRate, prior.occupancyRate),
    },
  };

  // Chart range: acota al rango real de datos cuando se elige 'all',
  // y amplía a last-3-months cuando es un solo mes (para contexto visual).
  const chartRange: DateRange = (() => {
    if (period === 'current-month') return getPeriodRange('last-3-months');
    if (period === 'all') {
      const dates = [
        ...bookings.map(b => b.start_date),
        ...expenses.map(e => e.date),
      ].filter(Boolean).sort();
      if (dates.length === 0) {
        // Sin datos: últimos 12 meses
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
  const monthlyPnL = buildMonthlyPnL(bookings, expenses, chartRange);

  // Export range: always accurate to the selected period.
  // For 'this-year': cap end to today (avoid empty future months).
  // For 'all': derive from actual data range (avoid ~1200 empty months).
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
    return range; // current-month and last-3-months are exact
  })();
  const exportMonthly = buildMonthlyPnL(bookings, expenses, exportRange);

  return { kpis, monthlyPnL, exportMonthly };
};
