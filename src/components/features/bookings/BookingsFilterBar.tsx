import { motion } from 'framer-motion';
import type { BookingFilters } from '@/services/bookings';

interface Props {
  search: string;
  setSearch: (v: string) => void;
  applySearch: () => void;
  filters: BookingFilters;
  setFilters: React.Dispatch<React.SetStateAction<BookingFilters>>;
  onClear: () => void;
  cleaningFilter: 'all' | 'unassigned' | 'pending' | 'done' | 'paid';
  setCleaningFilter: (v: 'all' | 'unassigned' | 'pending' | 'done' | 'paid') => void;
}

export default function BookingsFilterBar({
  search, setSearch, applySearch, filters, setFilters, onClear, cleaningFilter, setCleaningFilter,
}: Props) {
  const hasFilters = !!(filters.dateFrom || filters.dateTo || filters.search || filters.channel || cleaningFilter !== 'all');

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="bg-white border rounded-xl px-4 py-3 shadow-sm"
    >
      {/* Desktop: single row | Mobile: stacked */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        {/* Search */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-medium text-slate-500 mb-1">Buscar huésped / código</label>
          <div className="flex gap-2">
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applySearch()}
              placeholder="Buscar…"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button onClick={applySearch}
              className="px-3 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap">
              Buscar
            </button>
          </div>
        </div>

        {/* Desde */}
        <div className="lg:w-36">
          <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
          <input type="date" value={filters.dateFrom ?? ''}
            max={filters.dateTo || undefined}
            onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Hasta */}
        <div className="lg:w-36">
          <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
          <input type="date" value={filters.dateTo ?? ''}
            min={filters.dateFrom || undefined}
            onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Canal */}
        <div className="lg:w-36">
          <label className="block text-xs font-medium text-slate-500 mb-1">Canal</label>
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

        {/* Aseo */}
        <div className="lg:w-40">
          <label className="block text-xs font-medium text-slate-500 mb-1">🧹 Aseo</label>
          <select
            value={cleaningFilter}
            onChange={e => setCleaningFilter(e.target.value as typeof cleaningFilter)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">Todos</option>
            <option value="unassigned">Sin asignar</option>
            <option value="pending">Pendiente</option>
            <option value="done">Hecho (sin pagar)</option>
            <option value="paid">Pagado</option>
          </select>
        </div>

        {/* Clear */}
        {hasFilters && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
            onClick={onClear}
            className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap self-end"
          >
            ✕ Limpiar
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
