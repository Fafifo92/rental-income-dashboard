import { motion } from 'framer-motion';
import type { BookingFilters } from '@/services/bookings';
import type { DerivedBookingStatus } from '@/lib/bookingStatus';

interface Props {
  search: string;
  setSearch: (v: string) => void;
  applySearch: () => void;
  filters: BookingFilters;
  setFilters: React.Dispatch<React.SetStateAction<BookingFilters>>;
  statusFilter: DerivedBookingStatus | 'all';
  setStatusFilter: (v: DerivedBookingStatus | 'all') => void;
  onClear: () => void;
}

export default function BookingsFilterBar({
  search, setSearch, applySearch, filters, setFilters, statusFilter, setStatusFilter, onClear,
}: Props) {
  const hasFilters = !!(filters.dateFrom || filters.dateTo || filters.search || filters.channel || statusFilter !== 'all');

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="bg-white border rounded-xl p-4 shadow-sm flex flex-wrap gap-3 items-end"
    >
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Buscar huésped / código</label>
        <div className="flex gap-2">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applySearch()}
            placeholder="Buscar…"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button onClick={applySearch}
            className="px-3 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            Buscar
          </button>
        </div>
      </div>
      <div className="min-w-[140px]">
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Desde</label>
        <input type="date" value={filters.dateFrom ?? ''}
          max={filters.dateTo || undefined}
          onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>
      <div className="min-w-[140px]">
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Hasta</label>
        <input type="date" value={filters.dateTo ?? ''}
          min={filters.dateFrom || undefined}
          onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>
      <div className="min-w-[140px]">
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Canal</label>
        <select
          value={filters.channel ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, channel: e.target.value || undefined }))}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todos</option>
          <option value="airbnb">Airbnb</option>
          <option value="booking">Booking.com</option>
          <option value="vrbo">Vrbo</option>
          <option value="direct">Directo</option>
          <option value="other">Otro</option>
        </select>
      </div>
      <div className="min-w-[140px]">
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Estado</label>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as DerivedBookingStatus | 'all')}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">Todas</option>
          <option value="upcoming">Próximas</option>
          <option value="in_progress">En curso</option>
          <option value="completed">Completadas</option>
          <option value="past_unverified">Sin verificar</option>
          <option value="cancelled">Canceladas</option>
        </select>
      </div>
      {hasFilters && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          onClick={onClear}
          className="self-end px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          ✕ Limpiar
        </motion.button>
      )}
    </motion.div>
  );
}
