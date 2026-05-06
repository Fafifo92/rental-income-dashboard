import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';
import { listBookings, type BookingWithListingRow } from '@/services/bookings';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';
import { getBookingStatus, statusUI, inferOperationalFlags } from '@/lib/bookingStatus';
import { formatCurrency } from '@/lib/utils';
import BookingDetailModal from './BookingDetailModal';
import type { PropertyRow, BankAccountRow } from '@/types/database';

interface ActiveBooking {
  id: string;
  confirmation_code: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string;
  listing_name: string;
  property_name: string;
  listing_id: string | null;
  property_id: string | null;
  channel: string | null;
  checkin_done: boolean;
  checkout_done: boolean;
  gross_revenue: number | null;
  channel_fees: number | null;
  net_payout: number | null;
  payout_date: string | null;
  notes: string | null;
  num_adults: number | null;
  num_children: number | null;
  inventory_checked: boolean;
  operational_notes: string | null;
}

function fromRow(row: BookingWithListingRow): ActiveBooking {
  return {
    id: row.id,
    confirmation_code: row.confirmation_code,
    guest_name: row.guest_name ?? '—',
    start_date: row.start_date ?? '',
    end_date: row.end_date ?? '',
    num_nights: row.num_nights,
    total_revenue: Number(row.total_revenue),
    status: row.status ?? '',
    listing_name: row.listings?.external_name ?? '',
    property_name: row.listings?.properties?.name ?? '',
    listing_id: row.listing_id ?? null,
    property_id: row.listings?.property_id ?? null,
    channel: row.channel ?? null,
    checkin_done: row.checkin_done ?? false,
    checkout_done: row.checkout_done ?? false,
    gross_revenue: row.gross_revenue !== null && row.gross_revenue !== undefined ? Number(row.gross_revenue) : null,
    channel_fees: row.channel_fees !== null && row.channel_fees !== undefined ? Number(row.channel_fees) : null,
    net_payout: row.net_payout !== null && row.net_payout !== undefined ? Number(row.net_payout) : null,
    payout_date: row.payout_date ?? null,
    notes: row.notes ?? null,
    num_adults: row.num_adults ?? null,
    num_children: row.num_children ?? null,
    inventory_checked: row.inventory_checked ?? false,
    operational_notes: row.operational_notes ?? null,
  };
}

const fmt = (d: string) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
};

interface Props {
  propertyIds?: string[];
}

export default function ActiveBookingsWidget({ propertyIds }: Props) {
  const [bookings, setBookings] = useState<ActiveBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailTarget, setDetailTarget] = useState<ActiveBooking | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);

  useEffect(() => {
    listProperties().then(res => { if (!res.error) setProperties(res.data ?? []); });
    listBankAccounts().then(res => { if (!res.error) setBankAccounts((res.data ?? []).filter(a => a.is_active)); });
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listBookings({ propertyIds }).then(res => {
      if (!mounted) return;
      setBookings((res.data ?? []).map(fromRow));
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [propertyIds]);

  const active = useMemo(() => bookings.filter(b => {
    const derived = getBookingStatus({
      start_date: b.start_date,
      end_date: b.end_date,
      checkin_done: b.checkin_done,
      checkout_done: b.checkout_done,
      status: b.status,
    });
    return derived === 'in_progress';
  }), [bookings]);

  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 text-center py-16 bg-white border border-slate-200 rounded-2xl"
      >
        <div className="text-4xl mb-3">🏠</div>
        <p className="font-semibold text-slate-700 text-lg">Sin reservas en curso</p>
        <p className="text-slate-400 text-sm mt-1">Cuando una reserva esté activa aparecerá aquí.</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800">
          Reservas en curso
          <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
            {active.length}
          </span>
        </h3>
        <p className="text-sm text-slate-400">{active.length} activa{active.length !== 1 ? 's' : ''}</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Estado', 'Huésped', 'Estadía', 'Canal', 'Bruto', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {active.map((b, i) => {
                const info = inferOperationalFlags({
                  checkin_done: b.checkin_done,
                  checkout_done: b.checkout_done,
                  status: b.status,
                });
                const derived = getBookingStatus({
                  start_date: b.start_date,
                  end_date: b.end_date,
                  checkin_done: b.checkin_done,
                  checkout_done: b.checkout_done,
                  status: b.status,
                });
                const ui = statusUI[derived];
                const channel = (b.channel || 'airbnb').toLowerCase();
                const channelStyles: Record<string, string> = {
                  airbnb: 'bg-rose-50 text-rose-700 border-rose-200',
                  booking: 'bg-blue-50 text-blue-700 border-blue-200',
                  vrbo: 'bg-amber-50 text-amber-700 border-amber-200',
                  direct: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                };
                const channelLabel: Record<string, string> = {
                  airbnb: 'Airbnb', booking: 'Booking', vrbo: 'Vrbo', direct: 'Directo',
                };
                return (
                  <motion.tr
                    key={b.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${ui.className}`}>
                        {ui.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-slate-800 truncate max-w-[160px]">{b.guest_name}</span>
                        <span className="font-mono text-[10px] text-slate-400 truncate max-w-[160px]">
                          {b.confirmation_code}{(b.property_name || b.listing_name) ? ` · ${b.property_name || b.listing_name}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col text-xs">
                        <span className="text-slate-700 whitespace-nowrap">{fmt(b.start_date)} → {fmt(b.end_date)}</span>
                        <span className="text-slate-400">{b.num_nights} noche{b.num_nights !== 1 ? 's' : ''}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${channelStyles[channel] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {channelLabel[channel] ?? channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">
                      {formatCurrency(b.total_revenue)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDetailTarget(b)}
                        title="Ver detalles de la reserva"
                        aria-label="Ver detalles"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {detailTarget && (
        <BookingDetailModal
          booking={detailTarget}
          properties={properties}
          bankAccounts={bankAccounts}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  );
}
