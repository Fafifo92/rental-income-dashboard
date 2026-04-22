import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { listBookings, getDemoBookings, type BookingFilters } from '@/services/bookings';
import type { BookingRow } from '@/types/database';
import type { ParsedBooking } from '@/services/etl';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import DataTable from './DataTable';

// Unified display model — works for both DB rows and demo localStorage rows
interface DisplayBooking {
  id: string;
  confirmation_code: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string;
  listing_name: string;
}

const fromRow = (row: BookingRow): DisplayBooking => ({
  id: row.id,
  confirmation_code: row.confirmation_code,
  guest_name: row.guest_name ?? '—',
  start_date: row.start_date,
  end_date: row.end_date,
  num_nights: row.num_nights,
  total_revenue: Number(row.total_revenue),
  status: row.status ?? '',
  listing_name: '', // listing name not joined here
});

const fromDemo = (b: ParsedBooking, i: number): DisplayBooking => ({
  id: `demo-${i}`,
  confirmation_code: b.confirmation_code,
  guest_name: b.guest_name || '—',
  start_date: b.start_date,
  end_date: b.end_date,
  num_nights: b.num_nights,
  total_revenue: b.revenue,
  status: b.status,
  listing_name: b.listing_name,
});

const statusColor = (s: string) => {
  const lower = s.toLowerCase();
  if (lower.includes('cancel')) return 'bg-red-100 text-red-700';
  if (lower.includes('complet') || lower.includes('reserv')) return 'bg-green-100 text-green-700';
  return 'bg-yellow-100 text-yellow-700';
};

const EMPTY_FILTERS: BookingFilters = {};

const bookingHelper = createColumnHelper<DisplayBooking>();

export default function BookingsClient() {
  const authStatus = useAuth();
  const [bookings, setBookings] = useState<DisplayBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [filters, setFilters] = useState<BookingFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');  const load = useCallback(async (f: BookingFilters) => {
    setLoading(true);
    const result = await listBookings(f);
    if (result.error) {
      // Demo mode: read from localStorage
      let demo = getDemoBookings().map(fromDemo);
      if (f.search) {
        const q = f.search.toLowerCase();
        demo = demo.filter(
          b => b.guest_name.toLowerCase().includes(q) || b.confirmation_code.toLowerCase().includes(q),
        );
      }
      if (f.dateFrom) demo = demo.filter(b => b.start_date >= f.dateFrom!);
      if (f.dateTo) demo = demo.filter(b => b.start_date <= f.dateTo!);
      setBookings(demo);
      setIsDemo(true);
    } else {
      setBookings(result.data.map(fromRow));
      setIsDemo(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  // Auth guard (after all hooks)
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  // Compute KPIs from displayed bookings
  const completed = bookings.filter(b => !b.status.toLowerCase().includes('cancel'));
  const totalRevenue = completed.reduce((s, b) => s + b.total_revenue, 0);
  const totalNights = completed.reduce((s, b) => s + b.num_nights, 0);
  const kpis = [
    { label: 'Total Reservas', value: bookings.length.toString(), color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Ingresos (completadas)', value: formatCurrency(totalRevenue), color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Noches Totales', value: totalNights.toString(), color: 'text-purple-600', bg: 'bg-purple-50' },
    {
      label: 'ADR (Tarifa Diaria)',
      value: totalNights > 0 ? formatCurrency(totalRevenue / totalNights) : '—',
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
  ];

  const applySearch = () => setFilters(prev => ({ ...prev, search }));

  const columns = useMemo<ColumnDef<DisplayBooking, any>[]>(() => [
    bookingHelper.accessor('confirmation_code', {
      header: 'Código',
      enableSorting: false,
      meta: { className: 'font-mono text-xs text-slate-500' },
    }),
    bookingHelper.accessor('status', {
      header: 'Estado',
      cell: info => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor(info.getValue())}`}>
          {info.getValue() || '—'}
        </span>
      ),
    }),
    bookingHelper.accessor('guest_name', {
      header: 'Huésped',
      meta: { className: 'font-medium text-slate-800 whitespace-nowrap' },
    }),
    bookingHelper.accessor('start_date', {
      header: 'Check-in',
      meta: { className: 'text-slate-500 whitespace-nowrap' },
    }),
    bookingHelper.accessor('end_date', {
      header: 'Check-out',
      meta: { className: 'text-slate-500 whitespace-nowrap' },
    }),
    bookingHelper.accessor('num_nights', {
      header: 'Noches',
      meta: { align: 'center', className: 'font-medium text-slate-700' },
    }),
    bookingHelper.accessor('listing_name', {
      header: 'Anuncio',
      enableSorting: false,
      meta: { className: 'text-slate-500 max-w-[180px] truncate' },
      cell: info => info.getValue() || '—',
    }),
    bookingHelper.accessor('total_revenue', {
      header: 'Ingresos',
      meta: { align: 'right' },
      sortingFn: 'basic',
      cell: info => (
        <span className="font-semibold text-slate-800">{formatCurrency(info.getValue())}</span>
      ),
    }),
  ], []);

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between"
      >
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Reservas</h2>
            {isDemo && (
              <span className="text-xs font-semibold px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                Modo demo
              </span>
            )}
          </div>
          <p className="text-slate-500 mt-1">Historial de reservas importadas desde Airbnb.</p>
        </div>
        <motion.a
          href="/dashboard"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          + Importar datos
        </motion.a>
      </motion.div>

      {/* KPI Cards */}
      {!loading && bookings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className={`p-5 border rounded-xl shadow-sm ${kpi.bg}`}
            >
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white border rounded-xl p-4 shadow-sm flex flex-wrap gap-3 items-end"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Buscar huésped / código</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applySearch()}
              placeholder="Buscar…"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              onClick={applySearch}
              className="px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              🔍
            </button>
          </div>
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Desde</label>
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Hasta</label>
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        {(filters.dateFrom || filters.dateTo || filters.search) && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => { setFilters(EMPTY_FILTERS); setSearch(''); }}
            className="self-end px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            ✕ Limpiar
          </motion.button>
        )}
      </motion.div>

      {/* Table */}
      <DataTable<DisplayBooking>
        columns={columns}
        data={bookings}
        loading={loading}
        showSearch={false}
        defaultPageSize={25}
        skeletonRows={8}
        emptyIcon="📋"
        emptyTitle="Sin reservas importadas"
        emptyDescription={
          <a href="/dashboard" className="text-blue-600 hover:underline font-medium">
            Ir al Dashboard →
          </a>
        }
        renderFooter={filteredData => {
          const comp = filteredData.filter(b => !b.status.toLowerCase().includes('cancel'));
          const rev = comp.reduce((s, b) => s + b.total_revenue, 0);
          const nights = comp.reduce((s, b) => s + b.num_nights, 0);
          return (
            <tr className="border-t bg-slate-50">
              <td colSpan={5} className="px-5 py-4 text-sm font-semibold text-slate-600">
                {filteredData.length} reserva{filteredData.length !== 1 ? 's' : ''}
              </td>
              <td className="px-5 py-4 text-center font-bold text-slate-700">{nights}</td>
              <td />
              <td className="px-5 py-4 text-right font-bold text-slate-900">{formatCurrency(rev)}</td>
            </tr>
          );
        }}
      />
    </main>
  );
}
