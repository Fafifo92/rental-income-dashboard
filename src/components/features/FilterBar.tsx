import { motion } from 'framer-motion';
import type { ExpenseFilters } from '@/services/expenses';

const CATEGORIES = [
  'Limpieza', 'Lavandería', 'Internet', 'Servicios Públicos',
  'Mantenimiento', 'Administración', 'Welcome Kit', 'Seguros', 'Impuestos', 'Otro',
];

interface Props {
  filters: ExpenseFilters;
  onChange: (filters: ExpenseFilters) => void;
  onReset: () => void;
}

const activeCount = (f: ExpenseFilters) =>
  [f.category, f.type, f.status, f.dateFrom, f.dateTo, f.search].filter(Boolean).length;

export default function FilterBar({ filters, onChange, onReset }: Props) {
  const set = <K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K]) =>
    onChange({ ...filters, [key]: value || undefined });

  const count = activeCount(filters);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border rounded-xl p-4 shadow-sm"
    >
      <div className="flex flex-wrap gap-3 items-end">

        {/* Search */}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Buscar</label>
          <input
            type="text"
            placeholder="Categoría o descripción…"
            value={filters.search ?? ''}
            onChange={e => set('search', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        {/* Category */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Categoría</label>
          <select
            value={filters.category ?? ''}
            onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Todas</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Type */}
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Tipo</label>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {[
              { value: '', label: 'Todos' },
              { value: 'fixed', label: 'Fijo' },
              { value: 'variable', label: 'Variable' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('type', opt.value as ExpenseFilters['type'])}
                className={`flex-1 py-2 font-medium transition-colors whitespace-nowrap px-2 ${
                  (filters.type ?? '') === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Estado</label>
          <select
            value={filters.status ?? ''}
            onChange={e => set('status', e.target.value as ExpenseFilters['status'])}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
            <option value="partial">Parcial</option>
          </select>
        </div>

        {/* Date from */}
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Desde</label>
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={e => set('dateFrom', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        {/* Date to */}
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Hasta</label>
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={e => set('dateTo', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        {/* Reset */}
        {count > 0 && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={onReset}
            className="self-end px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            ✕ Limpiar <span className="bg-slate-200 text-slate-600 text-xs font-bold px-1.5 py-0.5 rounded-full">{count}</span>
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
