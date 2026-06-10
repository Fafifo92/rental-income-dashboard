import { describe, it, expect } from 'vitest';
import { __testables, buildChannelBreakdown } from '@/services/financial';
import { addMoney } from '@/lib/money';
import type { Expense } from '@/types';

const { computeCore, buildMonthlyPnL, buildMonthlyPnLByBookings } = __testables;

const range = { from: new Date('2026-01-01T00:00:00'), to: new Date('2026-03-31T23:59:59') };

const bookings = [
  // Activa, Airbnb, con fee y neto
  { id: 'b1', start_date: '2026-01-05', end_date: '2026-01-10', num_nights: 5, revenue: 1_000_000, status: 'Completada', channel: 'Airbnb',  channel_fees: 30_000, net_payout: 970_000 },
  // Activa, Booking, con fee sin neto registrado
  { id: 'b2', start_date: '2026-02-01', end_date: '2026-02-04', num_nights: 3, revenue: 600_000.10, status: 'Completada', channel: 'Booking', channel_fees: 90_000.05, net_payout: null },
  // Activa, sin canal → Directo
  { id: 'b3', start_date: '2026-02-10', end_date: '2026-02-12', num_nights: 2, revenue: 400_000, status: 'Completada', channel: null, channel_fees: null, net_payout: null },
  // Cancelada con tarifa de cancelación cobrada (+)
  { id: 'b4', start_date: '2026-03-01', end_date: '2026-03-05', num_nights: 4, revenue: 150_000, status: 'Cancelada', channel: 'Airbnb', channel_fees: 0, net_payout: null },
  // Cancelada con multa al anfitrión (−)
  { id: 'b5', start_date: '2026-03-10', end_date: '2026-03-12', num_nights: 2, revenue: -50_000, status: 'Cancelada', channel: 'Airbnb', channel_fees: 0, net_payout: null },
];

const expenses: Expense[] = [
  { id: 'e1', category: 'Limpieza', type: 'variable', amount: 80_000.10, date: '2026-01-10', description: null, status: 'paid', booking_id: 'b1', property_id: null },
  { id: 'e2', category: 'Limpieza', type: 'variable', amount: 80_000.20, date: '2026-02-04', description: null, status: 'paid', booking_id: 'b2', property_id: null },
  { id: 'e3', category: 'Internet', type: 'fixed',    amount: 89_000,    date: '2026-01-01', description: null, status: 'paid', property_id: null },
  { id: 'e4', category: 'Internet', type: 'fixed',    amount: 89_000,    date: '2026-02-01', description: null, status: 'paid', property_id: null },
];

describe('computeCore — reconciliación de KPIs', () => {
  const k = computeCore(bookings, expenses, [], range, 1);

  it('Ingreso Bruto = hospedaje + cancelación cobrada + ajustes', () => {
    // hospedaje = 1.000.000 + 600.000,10 + 400.000 = 2.000.000,10 → bruto + 150.000
    expect(k.grossRevenue).toBe(Math.round(addMoney(2_000_000.10, 150_000)));
  });

  it('Multas de cancelación cuentan como gasto variable', () => {
    expect(k.cancelledFines).toBe(50_000);
    // variables = 80.000,10 + 80.000,20 + 50.000 = 210.000,30 → round 210.000
    expect(k.totalVariableExpenses).toBe(Math.round(210_000.30));
  });

  it('Utilidad Neta = Bruto − Total Gastos (sin drift de coma flotante)', () => {
    expect(k.netProfit).toBe(k.grossRevenue - k.totalExpenses);
    expect(Number.isInteger(k.netProfit)).toBe(true);
  });

  it('ADR y RevPAR usan solo ingresos por hospedaje', () => {
    const lodging = 2_000_000.10;
    expect(k.adr).toBe(Math.round(lodging / 10));     // 10 noches activas
    expect(k.totalNights).toBe(10);
    expect(k.revpar).toBe(Math.round(lodging / k.availableNights));
  });
});

describe('P&L mensual — Σ meses cuadra con los KPIs', () => {
  it('by-bookings: ingresos, gastos y utilidad mensual suman el total del período', () => {
    const k = computeCore(bookings, expenses, [], range, 1);
    const monthly = buildMonthlyPnLByBookings(bookings, expenses, [], range, 1);
    const rev = monthly.reduce((s, m) => s + m.revenue, 0);
    const exp = monthly.reduce((s, m) => s + m.expenses, 0);
    const net = monthly.reduce((s, m) => s + m.netProfit, 0);
    // Tolerancia 1 peso por mes por redondeo de bucket
    expect(Math.abs(rev - k.grossRevenue)).toBeLessThanOrEqual(monthly.length);
    expect(Math.abs(exp - k.totalExpenses)).toBeLessThanOrEqual(monthly.length);
    expect(Math.abs(net - k.netProfit)).toBeLessThanOrEqual(2 * monthly.length);
  });

  it('pro-rateado por noches: también incluye cancelaciones cobradas y multas', () => {
    const monthly = buildMonthlyPnL(bookings, expenses, [], range, 'month', 1);
    const mar = monthly.find(m => m.month.startsWith('Mar'));
    expect(mar).toBeDefined();
    expect(mar!.revenue).toBe(150_000);  // tarifa de cancelación cobrada
    expect(mar!.expenses).toBe(50_000);  // multa al anfitrión
  });

  it('ocupación mensual nunca supera 100%', () => {
    const dense = [{ id: 'x', start_date: '2026-01-01', end_date: '2026-01-31', num_nights: 60, revenue: 1, status: 'Completada' }];
    const m = buildMonthlyPnL(dense, [], [], { from: new Date('2026-01-01T00:00:00'), to: new Date('2026-01-31T00:00:00') }, 'month', 1);
    expect(m[0].occupancy).toBeLessThanOrEqual(100);
  });
});

describe('buildChannelBreakdown — desglose por canal', () => {
  const rows = buildChannelBreakdown(bookings, expenses, range);

  it('agrupa por canal y usa "Directo" cuando no hay canal', () => {
    expect(rows.map(r => r.channel).sort()).toEqual(['Airbnb', 'Booking', 'Directo']);
  });

  it('excluye reservas canceladas', () => {
    const airbnb = rows.find(r => r.channel === 'Airbnb')!;
    expect(airbnb.bookings).toBe(1);
    expect(airbnb.grossRevenue).toBe(1_000_000);
  });

  it('neto = net_payout registrado, o ingreso − fee como fallback', () => {
    const airbnb  = rows.find(r => r.channel === 'Airbnb')!;
    const booking = rows.find(r => r.channel === 'Booking')!;
    expect(airbnb.netPayout).toBe(970_000);
    expect(booking.netPayout).toBe(addMoney(600_000.10, -90_000.05)); // 510.000,05 exacto
  });

  it('atribuye gastos vinculados a reservas y calcula utilidades sin drift', () => {
    const airbnb  = rows.find(r => r.channel === 'Airbnb')!;
    const booking = rows.find(r => r.channel === 'Booking')!;
    expect(airbnb.bookingExpenses).toBe(80_000.10);
    expect(airbnb.grossProfit).toBe(919_999.90);
    expect(airbnb.netProfit).toBe(889_999.90);
    expect(booking.bookingExpenses).toBe(80_000.20);
    // 510.000,05 − 80.000,20 = 429.999,85 exacto (con float puro daría 429999.84999999997)
    expect(booking.netProfit).toBe(429_999.85);
  });

  it('Σ canales cuadra con los ingresos por hospedaje del período', () => {
    const totalGross = rows.reduce((s, r) => addMoney(s, r.grossRevenue), 0);
    expect(totalGross).toBe(addMoney(1_000_000, 600_000.10, 400_000));
  });
});
