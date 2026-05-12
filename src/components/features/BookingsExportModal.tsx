import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download } from 'lucide-react';
import {
  exportBookingsToCsv,
  exportBookingsToExcel,
  exportBookingsToPdf,
  type BookingExportRow,
} from '@/services/export';
import { listBookings, type BookingWithListingRow } from '@/services/bookings';
import { listAllBookingAdjustmentsForExport } from '@/services/bookingAdjustments';
import { getBookingStatus, type DerivedBookingStatus } from '@/lib/bookingStatus';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import type { PropertyRow, PropertyGroupRow, PropertyTagRow, PropertyTagAssignmentRow } from '@/types/database';
import PropertyMultiSelect from '@/components/PropertyMultiSelectFilter';
import { todayISO } from '@/lib/dateUtils';

type Format = 'csv' | 'excel' | 'pdf';

const STATUS_OPTIONS: { value: DerivedBookingStatus; label: string; emoji: string }[] = [
  { value: 'upcoming',        label: 'Próximas',       emoji: '🔵' },
  { value: 'in_progress',     label: 'En curso',       emoji: '🟣' },
  { value: 'completed',       label: 'Completadas',    emoji: '🟢' },
  { value: 'past_unverified', label: 'Sin verificar',  emoji: '🟡' },
  { value: 'cancelled',       label: 'Canceladas',     emoji: '🔴' },
];

interface Props {
  properties: PropertyRow[];
  groups?: PropertyGroupRow[];
  tags?: PropertyTagRow[];
  tagAssigns?: PropertyTagAssignmentRow[];
  defaultPropertyIds?: string[];
  defaultDateFrom?: string;
  defaultDateTo?: string;
  defaultStatusFilter?: DerivedBookingStatus | 'all';
  onClose: () => void;
}

function buildQuickPresets() {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');

  const monthStart  = `${y}-${pad(m)}-01`;
  const monthEnd    = today;

  let y3 = y, m3 = m - 2;
  while (m3 <= 0) { m3 += 12; y3 -= 1; }
  const last3Start = `${y3}-${pad(m3)}-01`;

  return [
    { label: 'Este mes',         from: monthStart,    to: monthEnd },
    { label: 'Últimos 3 meses',  from: last3Start,    to: today },
    { label: 'Este año',         from: `${y}-01-01`,  to: today },
    { label: 'Todo',             from: '',            to: '' },
  ];
}

export default function BookingsExportModal({
  properties, groups = [], tags = [], tagAssigns = [],
  defaultPropertyIds = [],
  defaultDateFrom = '',
  defaultDateTo = '',
  defaultStatusFilter = 'all',
  onClose,
}: Props) {
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(defaultPropertyIds);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo,   setDateTo]   = useState(defaultDateTo);

  const initialStatuses = new Set<DerivedBookingStatus>(
    defaultStatusFilter === 'all'
      ? STATUS_OPTIONS.map(s => s.value)
      : [defaultStatusFilter],
  );
  const [statuses, setStatuses] = useState<Set<DerivedBookingStatus>>(initialStatuses);
  const [includeAdjustments, setIncludeAdjustments] = useState(false);
  const [includeCalendar,    setIncludeCalendar]    = useState(true);
  const [format, setFormat] = useState<Format>('excel');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const presets = buildQuickPresets();

  const toggleStatus = (v: DerivedBookingStatus) => {
    setStatuses(prev => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  };

  const toggleAllStatuses = () => {
    setStatuses(prev =>
      prev.size === STATUS_OPTIONS.length
        ? new Set()
        : new Set(STATUS_OPTIONS.map(s => s.value)),
    );
  };

  const buildTitle = () => {
    if (dateFrom && dateTo) return `${dateFrom}_${dateTo}`;
    if (dateFrom) return `desde-${dateFrom}`;
    if (dateTo) return `hasta-${dateTo}`;
    return 'todo';
  };

  const handleExport = async () => {
    if (statuses.size === 0) { setError('Selecciona al menos un estado.'); return; }
    setError(null);
    setLoading(true);
    try {
      const bRes = await listBookings({
        propertyIds: selectedPropertyIds.length ? selectedPropertyIds : undefined,
        dateFrom:    dateFrom || undefined,
        dateTo:      dateTo   || undefined,
      });
      if (bRes.error || !bRes.data) throw new Error(bRes.error ?? 'Error al cargar reservas');

      const adjMap = new Map<string, number>();
      if (includeAdjustments) {
        const adjRes = await listAllBookingAdjustmentsForExport();
        if (!adjRes.error && adjRes.data) {
          const ids = new Set(bRes.data.map(b => b.id));
          for (const a of adjRes.data) {
            if (!ids.has(a.booking_id)) continue;
            const delta = a.kind === 'discount' ? -Number(a.amount) : Number(a.amount);
            adjMap.set(a.booking_id, (adjMap.get(a.booking_id) ?? 0) + delta);
          }
        }
      }

      const today = todayISO();
      const filtered = bRes.data.filter(b => {
        const ds = getBookingStatus({
          start_date:    b.start_date,
          end_date:      b.end_date,
          checkin_done:  b.checkin_done  ?? false,
          checkout_done: b.checkout_done ?? false,
          status:        b.status,
        }, today);
        return statuses.has(ds);
      });

      const rows: BookingExportRow[] = filtered.map((b: BookingWithListingRow) => ({
        confirmation_code: b.confirmation_code,
        guest_name:   b.guest_name,
        check_in:     b.start_date,
        check_out:    b.end_date,
        nights:       b.num_nights,
        revenue:      Number(b.total_revenue),
        net_payout:   b.net_payout !== null ? Number(b.net_payout) : null,
        status:       b.status ?? '',
        channel:      b.channel,
        property_name: (b.listings?.properties as { name: string } | null | undefined)?.name ?? null,
        net_adjustment: includeAdjustments ? (adjMap.get(b.id) ?? 0) : null,
      }));

      const title = buildTitle();
      if (format === 'csv')   exportBookingsToCsv(rows, title);
      if (format === 'excel') exportBookingsToExcel(rows, title);
      if (format === 'pdf')   exportBookingsToPdf(rows, title, { periodFrom: dateFrom || undefined, periodTo: dateTo || undefined, includeCalendar });

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
        <div className="px-6 py-5 border-b flex items-start justify-between bg-gradient-to-r from-blue-50 to-white">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-500">Exportar</p>
            <h2 className="text-xl font-extrabold text-slate-900 mt-0.5 flex items-center gap-2">
              <Download className="w-5 h-5 text-blue-600" />
              Informe de Reservas
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
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
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
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Hasta</label>
                <input
                  type="date" value={dateTo} min={dateFrom || undefined}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* 3. Estados */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Estados
              </label>
              <button
                type="button"
                onClick={toggleAllStatuses}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
              >
                {statuses.size === STATUS_OPTIONS.length ? 'Ninguno' : 'Todos'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-semibold transition-colors select-none ${
                    statuses.has(opt.value)
                      ? 'bg-blue-50 border-blue-300 text-blue-800'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={statuses.has(opt.value)}
                    onChange={() => toggleStatus(opt.value)}
                    className="sr-only"
                  />
                  {opt.emoji} {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 4. Contenido */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Contenido
            </label>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="mt-0.5">
                  <input
                    type="checkbox"
                    checked={includeAdjustments}
                    onChange={e => setIncludeAdjustments(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 accent-blue-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">
                    🔧 Incluir ajustes por reserva
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Daños cobrados, ingresos extra, descuentos dados
                  </p>
                </div>
              </label>

              {format === 'pdf' && (
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-0.5">
                    <input
                      type="checkbox"
                      checked={includeCalendar}
                      onChange={e => setIncludeCalendar(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 accent-blue-600"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">
                      🗓️ Incluir calendario de ocupación
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Vista visual mes a mes al final del informe PDF
                    </p>
                  </div>
                </label>
              )}
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
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-format-bookings"
                    value={f.value}
                    checked={format === f.value}
                    onChange={() => setFormat(f.value)}
                    className="sr-only"
                  />
                  <span className="text-xl">{f.icon}</span>
                  <span className={`text-xs font-bold ${format === f.value ? 'text-blue-700' : 'text-slate-700'}`}>
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
            disabled={loading || statuses.size === 0}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
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
