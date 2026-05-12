import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download } from 'lucide-react';
import {
  exportExpensesToCsv,
  exportExpensesToExcel,
  exportExpensesToPdf,
} from '@/services/export';
import { listExpenses } from '@/services/expenses';
import { listProperties } from '@/services/properties';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { EXPENSE_CATEGORIES, type PropertyRow, type PropertyGroupRow, type PropertyTagRow, type PropertyTagAssignmentRow } from '@/types/database';
import PropertyMultiSelect from '@/components/PropertyMultiSelectFilter';
import { todayISO } from '@/lib/dateUtils';
import type { Expense } from '@/types';

type Format = 'csv' | 'excel' | 'pdf';
type PayStatus = 'paid' | 'pending' | 'partial';

const PAY_STATUS_OPTIONS: { value: PayStatus; label: string; emoji: string }[] = [
  { value: 'paid',    label: 'Pagados',    emoji: '🟢' },
  { value: 'pending', label: 'Pendientes', emoji: '🟡' },
  { value: 'partial', label: 'Parciales',  emoji: '🟠' },
];

interface Props {
  properties: PropertyRow[];
  groups?: PropertyGroupRow[];
  tags?: PropertyTagRow[];
  tagAssigns?: PropertyTagAssignmentRow[];
  defaultPropertyIds?: string[];
  defaultDateFrom?: string;
  defaultDateTo?: string;
  onClose: () => void;
}

function buildQuickPresets() {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');

  const monthStart = `${y}-${pad(m)}-01`;

  let y3 = y, m3 = m - 2;
  while (m3 <= 0) { m3 += 12; y3 -= 1; }
  const last3Start = `${y3}-${pad(m3)}-01`;

  return [
    { label: 'Este mes',        from: monthStart,   to: today },
    { label: 'Últimos 3 meses', from: last3Start,   to: today },
    { label: 'Este año',        from: `${y}-01-01`, to: today },
    { label: 'Todo',            from: '',           to: '' },
  ];
}

export default function ExpensesExportModal({
  properties, groups = [], tags = [], tagAssigns = [],
  defaultPropertyIds = [],
  defaultDateFrom = '',
  defaultDateTo = '',
  onClose,
}: Props) {
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(defaultPropertyIds);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo,   setDateTo]   = useState(defaultDateTo);

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(EXPENSE_CATEGORIES),
  );
  const [selectedStatuses, setSelectedStatuses] = useState<Set<PayStatus>>(
    new Set<PayStatus>(['paid', 'pending', 'partial']),
  );
  const [format,  setFormat]  = useState<Format>('excel');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const presets = buildQuickPresets();

  const allCatsSelected = selectedCategories.size === EXPENSE_CATEGORIES.length;

  const toggleCategory = (c: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const toggleAllCategories = () => {
    setSelectedCategories(
      allCatsSelected ? new Set() : new Set(EXPENSE_CATEGORIES),
    );
  };

  const toggleStatus = (v: PayStatus) => {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  };

  const buildTitle = () => {
    if (dateFrom && dateTo) return `${dateFrom}_${dateTo}`;
    if (dateFrom) return `desde-${dateFrom}`;
    if (dateTo)   return `hasta-${dateTo}`;
    return 'todo';
  };

  const handleExport = async () => {
    if (selectedCategories.size === 0) { setError('Selecciona al menos una categoría.'); return; }
    if (selectedStatuses.size === 0)   { setError('Selecciona al menos un estado.'); return; }
    setError(null);
    setLoading(true);

    try {
      // Fetch all expenses for the selected properties + period (server-side filter)
      const eRes = await listExpenses(
        selectedPropertyIds.length ? selectedPropertyIds : undefined,
        {
          dateFrom: dateFrom || undefined,
          dateTo:   dateTo   || undefined,
        },
      );
      if (eRes.error || !eRes.data) throw new Error(eRes.error ?? 'Error al cargar gastos');

      // Client-side: category + status filter
      const filtered: Expense[] = eRes.data.filter(e =>
        selectedCategories.has(e.category) && selectedStatuses.has(e.status as PayStatus),
      );

      // Build property name map
      const propMapData = properties.length > 0
        ? properties
        : ((await listProperties()).data ?? []);
      const propMap = new Map(propMapData.map(p => [p.id, p.name]));

      const title = buildTitle();
      if (format === 'csv')   exportExpensesToCsv(filtered, propMap, title);
      if (format === 'excel') exportExpensesToExcel(filtered, propMap, title);
      if (format === 'pdf')   exportExpensesToPdf(filtered, propMap, title);

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 16 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b flex items-start justify-between bg-gradient-to-r from-emerald-50 to-white">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">Exportar</p>
            <h2 className="text-xl font-extrabold text-slate-900 mt-0.5 flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-600" />
              Informe de Gastos
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 1. Propiedades */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Propiedades
            </label>
            <PropertyMultiSelect
              properties={properties}
              value={selectedPropertyIds}
              onChange={setSelectedPropertyIds}
              groups={groups}
              tags={tags}
              tagAssigns={tagAssigns}
              placeholder="Todas las propiedades"
            />
          </div>

          {/* 2. Período */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Período
            </label>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presets.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    dateFrom === p.from && dateTo === p.to
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Desde</label>
                <input
                  type="date" value={dateFrom} max={dateTo || undefined}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Hasta</label>
                <input
                  type="date" value={dateTo} min={dateFrom || undefined}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* 3. Categorías */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Categorías
              </label>
              <button
                type="button"
                onClick={toggleAllCategories}
                className="text-[11px] text-emerald-600 hover:text-emerald-800 font-medium"
              >
                {allCatsSelected ? 'Ninguna' : 'Todas'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_CATEGORIES.map(cat => (
                <label
                  key={cat}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border cursor-pointer text-xs font-medium transition-colors select-none ${
                    selectedCategories.has(cat)
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(cat)}
                    onChange={() => toggleCategory(cat)}
                    className="sr-only"
                  />
                  {cat}
                </label>
              ))}
            </div>
          </div>

          {/* 4. Estado */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Estado de pago
            </label>
            <div className="flex gap-2">
              {PAY_STATUS_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-semibold transition-colors select-none ${
                    selectedStatuses.has(opt.value)
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedStatuses.has(opt.value)}
                    onChange={() => toggleStatus(opt.value)}
                    className="sr-only"
                  />
                  {opt.emoji} {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 5. Formato */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Formato
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'csv',   label: 'CSV',   icon: '📄', desc: 'Texto separado' },
                { value: 'excel', label: 'Excel', icon: '📊', desc: 'Hoja de cálculo' },
                { value: 'pdf',   label: 'PDF',   icon: '🖨️', desc: 'Imprimible' },
              ] as const).map(f => (
                <label
                  key={f.value}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 cursor-pointer transition-all select-none ${
                    format === f.value
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-format-expenses"
                    value={f.value}
                    checked={format === f.value}
                    onChange={() => setFormat(f.value)}
                    className="sr-only"
                  />
                  <span className="text-xl">{f.icon}</span>
                  <span className={`text-xs font-bold ${format === f.value ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {f.label}
                  </span>
                  <span className="text-[10px] text-slate-400 text-center">{f.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-slate-50 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleExport}
            disabled={loading || selectedCategories.size === 0 || selectedStatuses.size === 0}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
                Generando…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Generar informe
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
