import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';
import type { DisplayBooking } from './types';

interface KPI {
  label: string;
  value: string;
  color: string;
  bg: string;
  sub: string | null;
}

export function buildBookingKPIs(enrichedBookings: DisplayBooking[]): { kpis: KPI[]; incompleteCount: number } {
  const completed = enrichedBookings.filter(b => !b.status.toLowerCase().includes('cancel'));
  const totalRevenue = completed.reduce((s, b) => s + b.total_revenue, 0);
  const totalNights  = completed.reduce((s, b) => s + b.num_nights, 0);
  const payoutEligible = enrichedBookings.filter(b => {
    const isCancelled = b.status.toLowerCase().includes('cancel');
    return !isCancelled || b.total_revenue > 0;
  });
  const confirmed = payoutEligible.filter(b => b.payout_bank_account_id);
  const receivedPayout = confirmed.reduce((s, b) => s + (b.net_payout ?? b.total_revenue), 0);
  const expectedPayout = payoutEligible.filter(b => !b.payout_bank_account_id).reduce((s, b) => s + b.total_revenue, 0);
  const cancelledFinesTotal = enrichedBookings
    .filter(b => b.status.toLowerCase().includes('cancel') && b.total_revenue < 0)
    .reduce((s, b) => s + Math.abs(b.total_revenue), 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const incompleteCount = completed.filter(
    b => !b.payout_bank_account_id && b.end_date && new Date(b.end_date) < today,
  ).length;
  const kpis: KPI[] = [
    { label: 'Total Reservas', value: enrichedBookings.length.toString(), color: 'text-blue-600', bg: 'bg-blue-50', sub: null },
    {
      label: 'Payout confirmado',
      value: formatCurrency(receivedPayout),
      color: 'text-green-700',
      bg: 'bg-green-50',
      sub: expectedPayout > 0
        ? `Por cobrar: ${formatCurrency(expectedPayout)}`
        : cancelledFinesTotal > 0
          ? `Multas: −${formatCurrency(cancelledFinesTotal)}`
          : null,
    },
    { label: 'Noches Totales', value: totalNights.toString(), color: 'text-purple-600', bg: 'bg-purple-50', sub: null },
    { label: 'ADR (Tarifa Diaria)', value: totalNights > 0 ? formatCurrency(totalRevenue / totalNights) : '—', color: 'text-orange-600', bg: 'bg-orange-50', sub: null },
  ];
  return { kpis, incompleteCount };
}

export default function BookingsKPICards({
  kpis, incompleteCount,
}: { kpis: KPI[]; incompleteCount: number }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className={`p-5 border rounded-xl shadow-sm ${kpi.bg}`}
          >
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{kpi.label}</p>
            <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            {kpi.sub && (
              <p className="text-xs text-amber-600 font-medium mt-1">{kpi.sub}</p>
            )}
          </motion.div>
        ))}
      </div>
      {incompleteCount > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-amber-800">
            <strong>{incompleteCount}</strong> reserva{incompleteCount !== 1 ? 's' : ''} pasada{incompleteCount !== 1 ? 's' : ''} sin payout confirmado —{' '}
            asigna la cuenta bancaria desde el botón de payout en cada reserva para tener datos exactos.
          </span>
        </motion.div>
      )}
    </div>
  );
}
