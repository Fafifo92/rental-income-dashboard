import { useState, useEffect, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Eye, LogIn, LogOut } from 'lucide-react';
import { listTodayActivity } from '@/services/bookings';
import type { BookingWithListingRow } from '@/services/bookings';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';
import { getBookingStatus, statusUI } from '@/lib/bookingStatus';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay, todayISO } from '@/lib/dateUtils';
import type { PropertyRow, BankAccountRow } from '@/types/database';

const BookingDetailModal = lazy(() => import('./BookingDetailModal'));
const BookingPayoutModal = lazy(() => import('./BookingPayoutModal'));

// ─── Row shape ────────────────────────────────────────────────────────────────

interface BookingRow {
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

function fromRow(row: BookingWithListingRow): BookingRow {
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
    gross_revenue: row.gross_revenue != null ? Number(row.gross_revenue) : null,
    channel_fees: row.channel_fees != null ? Number(row.channel_fees) : null,
    net_payout: row.net_payout != null ? Number(row.net_payout) : null,
    payout_date: row.payout_date ?? null,
    notes: row.notes ?? null,
    num_adults: row.num_adults ?? null,
    num_children: row.num_children ?? null,
    inventory_checked: row.inventory_checked ?? false,
    operational_notes: row.operational_notes ?? null,
  };
}

// ─── Section table ────────────────────────────────────────────────────────────

const channelStyles: Record<string, string> = {
  airbnb:  'bg-rose-50 text-rose-700 border-rose-200',
  booking: 'bg-blue-50 text-blue-700 border-blue-200',
  vrbo:    'bg-amber-50 text-amber-700 border-amber-200',
  direct:  'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const channelLabel: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking', vrbo: 'Vrbo', direct: 'Directo',
};

function BookingsTable({
  rows,
  onDetail,
}: {
  rows: BookingRow[];
  onDetail: (b: BookingRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {['Estado', 'Huésped', 'Propiedad', 'Estadía', 'Canal', 'Ingreso', ''].map(h => (
                <th
                  key={h}
                  className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((b, i) => {
              const derived = getBookingStatus({
                start_date: b.start_date,
                end_date: b.end_date,
                checkin_done: b.checkin_done,
                checkout_done: b.checkout_done,
                status: b.status,
              });
              const ui = statusUI[derived];
              const ch = (b.channel || 'airbnb').toLowerCase();
              return (
                <motion.tr
                  key={b.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${ui.className}`}
                    >
                      {ui.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-slate-800 truncate max-w-[160px]">{b.guest_name}</span>
                      <span className="font-mono text-[10px] text-slate-400 truncate max-w-[160px]">
                        {b.confirmation_code}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">
                    {b.property_name || b.listing_name || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col text-xs">
                      <span className="text-slate-700 whitespace-nowrap">
                        {formatDateDisplay(b.start_date)} → {formatDateDisplay(b.end_date)}
                      </span>
                      <span className="text-slate-400">
                        {b.num_nights} noche{b.num_nights !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${channelStyles[ch] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}
                    >
                      {channelLabel[ch] ?? ch}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">
                    {formatCurrency(b.total_revenue)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onDetail(b)}
                      title="Ver detalles"
                      aria-label="Ver detalles de la reserva"
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
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  count,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${accent}`}>
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-800">
        {title}
        <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold">
          {count}
        </span>
      </h3>
    </div>
  );
}

// ─── Empty section ────────────────────────────────────────────────────────────

function EmptySection({ label }: { label: string }) {
  return (
    <p className="text-sm text-slate-400 italic pl-2">{label}</p>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

interface Props {
  propertyIds?: string[];
}

export default function TodayCheckInOutWidget({ propertyIds }: Props) {
  const [checkins, setCheckins]   = useState<BookingRow[]>([]);
  const [checkouts, setCheckouts] = useState<BookingRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [detailTarget, setDetailTarget] = useState<BookingRow | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<BookingRow | null>(null);
  const [properties, setProperties]     = useState<PropertyRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);

  useEffect(() => {
    listProperties().then(res => { if (!res.error) setProperties(res.data ?? []); });
    listBankAccounts().then(res => { if (!res.error) setBankAccounts((res.data ?? []).filter(a => a.is_active)); });
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listTodayActivity(propertyIds && propertyIds.length > 0 ? propertyIds : undefined).then(res => {
      if (!mounted) return;
      setCheckins((res.data?.checkins ?? []).map(fromRow));
      setCheckouts((res.data?.checkouts ?? []).map(fromRow));
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [propertyIds]);

  const today = formatDateDisplay(todayISO());

  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8 mt-4">
      {/* Date badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-500">Actividad de hoy ·</span>
        <span className="px-3 py-1 bg-blue-50 text-blue-700 text-sm font-bold rounded-full border border-blue-200">
          {today}
        </span>
      </div>

      {/* Check-ins */}
      <section className="space-y-3">
        <SectionHeader
          icon={<LogIn className="w-5 h-5 text-emerald-600" />}
          title="Check-ins de hoy"
          count={checkins.length}
          accent="bg-emerald-50"
        />
        {checkins.length === 0
          ? <EmptySection label="Sin check-ins programados para hoy." />
          : <BookingsTable rows={checkins} onDetail={setDetailTarget} />
        }
      </section>

      {/* Check-outs */}
      <section className="space-y-3">
        <SectionHeader
          icon={<LogOut className="w-5 h-5 text-amber-600" />}
          title="Check-outs de hoy"
          count={checkouts.length}
          accent="bg-amber-50"
        />
        {checkouts.length === 0
          ? <EmptySection label="Sin check-outs programados para hoy." />
          : <BookingsTable rows={checkouts} onDetail={setDetailTarget} />
        }
      </section>

      {/* Modals */}
      {detailTarget && (
        <Suspense fallback={null}>
          <BookingDetailModal
            booking={detailTarget}
            properties={properties}
            bankAccounts={bankAccounts}
            onClose={() => setDetailTarget(null)}
            onPayout={() => {
              const target = detailTarget;
              setDetailTarget(null);
              setPayoutTarget(target);
            }}
          />
        </Suspense>
      )}
      {payoutTarget && (
        <Suspense fallback={null}>
          <BookingPayoutModal
            booking={{
              ...payoutTarget,
              channel: payoutTarget.channel ?? null,
              start_date: payoutTarget.start_date ?? null,
              checkin_done: payoutTarget.checkin_done ?? false,
            }}
            bankAccounts={bankAccounts}
            onClose={() => setPayoutTarget(null)}
            onSaved={() => setPayoutTarget(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
