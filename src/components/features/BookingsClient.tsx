import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
  listBookings, getDemoBookings, saveDemoBookings, insertBooking, type BookingFilters,
} from '@/services/bookings';
import { listProperties } from '@/services/properties';
import { findOrCreateListing } from '@/services/listings';
import type { BookingRow, PropertyRow } from '@/types/database';
import type { ParsedBooking } from '@/services/etl';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';
import DataTable from './DataTable';
import CSVUploader from './CSVUploader';
import PropertySelector from './PropertySelector';

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface BookingForm {
  guest_name: string;
  confirmation_code: string;
  start_date: string;
  end_date: string;
  num_nights: string;
  total_revenue: string;
  status: string;
  listing_name: string;
  property_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fromRow = (row: BookingRow): DisplayBooking => ({
  id: row.id,
  confirmation_code: row.confirmation_code,
  guest_name: row.guest_name ?? '—',
  start_date: row.start_date,
  end_date: row.end_date,
  num_nights: row.num_nights,
  total_revenue: Number(row.total_revenue),
  status: row.status ?? '',
  listing_name: '',
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
const EMPTY_FORM: BookingForm = {
  guest_name: '', confirmation_code: '', start_date: '', end_date: '',
  num_nights: '', total_revenue: '', status: 'Completada', listing_name: '', property_id: '',
};

const bookingHelper = createColumnHelper<DisplayBooking>();

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingsClient() {
  // ── ALL HOOKS — must come before any conditional returns ──────────────────
  const authStatus = useAuth();
  const { properties: allProperties, propertyId, setPropertyId } = usePropertyFilter();
  const [bookings, setBookings]     = useState<DisplayBooking[]>([]);
  const [loading, setLoading]       = useState(true);
  const [isDemo, setIsDemo]         = useState(false);
  const [filters, setFilters]       = useState<BookingFilters>(EMPTY_FILTERS);
  const [search, setSearch]         = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [form, setForm]               = useState<BookingForm>(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError]     = useState('');
  const [properties, setProperties]   = useState<PropertyRow[]>([]);

  const load = useCallback(async (f: BookingFilters) => {
    setLoading(true);
    const result = await listBookings(f);
    if (result.error) {
      let demo = getDemoBookings().map(fromDemo);
      if (f.search) {
        const q = f.search.toLowerCase();
        demo = demo.filter(
          b => b.guest_name.toLowerCase().includes(q) || b.confirmation_code.toLowerCase().includes(q),
        );
      }
      if (f.dateFrom) demo = demo.filter(b => b.start_date >= f.dateFrom!);
      if (f.dateTo)   demo = demo.filter(b => b.start_date <= f.dateTo!);
      setBookings(demo);
      setIsDemo(true);
    } else {
      setBookings(result.data.map(fromRow));
      setIsDemo(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load({ ...filters, propertyId }); }, [filters, propertyId, load]);

  useEffect(() => {
    if (authStatus === 'authed') {
      listProperties().then(res => { if (!res.error) setProperties(res.data); });
    }
  }, [authStatus]);

  const applySearch = useCallback(
    () => setFilters(prev => ({ ...prev, search })),
    [search],
  );

  const handleFormChange = useCallback((field: keyof BookingForm, value: string) => {
    setForm(prev => {
      const updated = { ...prev, [field]: value };
      if (field === 'start_date' || field === 'end_date') {
        const s = field === 'start_date' ? value : updated.start_date;
        const e = field === 'end_date'   ? value : updated.end_date;
        if (s && e) {
          const nights = Math.max(0, Math.round(
            (new Date(e).getTime() - new Date(s).getTime()) / 86_400_000,
          ));
          updated.num_nights = String(nights);
        }
      }
      return updated;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.start_date || !form.end_date || !form.total_revenue) {
      setFormError('Completa los campos obligatorios: Check-in, Check-out e Ingresos.');
      return;
    }
    setFormLoading(true);
    setFormError('');
    const nights  = parseInt(form.num_nights) || 0;
    const revenue = parseFloat(form.total_revenue.replace(/[^0-9.]/g, '')) || 0;
    const code    = form.confirmation_code || `MANUAL-${Date.now()}`;

    try {
      if (authStatus !== 'authed') {
        saveDemoBookings([{
          confirmation_code: code,
          status: form.status,
          guest_name: form.guest_name,
          start_date: form.start_date,
          end_date: form.end_date,
          num_nights: nights,
          listing_name: form.listing_name || 'Manual',
          revenue,
        }]);
      } else {
        const propertyId = form.property_id || properties[0]?.id;
        if (!propertyId) {
          setFormError('Crea una propiedad primero desde la sección Propiedades.');
          setFormLoading(false);
          return;
        }
        const listingRes = await findOrCreateListing(propertyId, form.listing_name || 'Manual');
        if (listingRes.error) { setFormError(listingRes.error); setFormLoading(false); return; }
        const res = await insertBooking(listingRes.data.id, {
          confirmation_code: code,
          guest_name: form.guest_name || undefined,
          start_date: form.start_date,
          end_date: form.end_date,
          num_nights: nights,
          total_revenue: revenue,
          status: form.status,
        });
        if (res.error) { setFormError(res.error); setFormLoading(false); return; }
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      await load(filters);
    } catch {
      setFormError('Error inesperado al guardar.');
    }
    setFormLoading(false);
  }, [form, authStatus, properties, filters, load]);

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

  // ── EARLY RETURNS (after all hooks) ──────────────────────────────────────
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const completed    = bookings.filter(b => !b.status.toLowerCase().includes('cancel'));
  const totalRevenue = completed.reduce((s, b) => s + b.total_revenue, 0);
  const totalNights  = completed.reduce((s, b) => s + b.num_nights, 0);
  const kpis = [
    { label: 'Total Reservas',      value: bookings.length.toString(),                             color: 'text-blue-600',   bg: 'bg-blue-50'   },
    { label: 'Ingresos (completadas)', value: formatCurrency(totalRevenue),                        color: 'text-green-600',  bg: 'bg-green-50'  },
    { label: 'Noches Totales',      value: totalNights.toString(),                                 color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'ADR (Tarifa Diaria)', value: totalNights > 0 ? formatCurrency(totalRevenue / totalNights) : '—', color: 'text-orange-600', bg: 'bg-orange-50' },
  ];

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <main className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
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
        <div className="flex flex-wrap gap-2 items-center">
          <PropertySelector properties={allProperties} value={propertyId} onChange={setPropertyId} />
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowModal(true); }}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            + Nueva reserva
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowImporter(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Importar CSV / XLSX
          </motion.button>
        </div>
      </motion.div>

      {/* KPI Cards */}
      {!loading && bookings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
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
              className="px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              🔍
            </button>
          </div>
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Desde</label>
          <input type="date" value={filters.dateFrom ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Hasta</label>
          <input type="date" value={filters.dateTo ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        {(filters.dateFrom || filters.dateTo || filters.search) && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
            onClick={() => { setFilters(EMPTY_FILTERS); setSearch(''); }}
            className="self-end px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            ✕ Limpiar
          </motion.button>
        )}
      </motion.div>

      {/* Table */}
      <DataTable<DisplayBooking>
        columns={columns} data={bookings} loading={loading}
        showSearch={false} defaultPageSize={25} skeletonRows={8}
        emptyIcon="📋" emptyTitle="Sin reservas importadas"
        emptyDescription={
          <span>
            <button onClick={() => setShowModal(true)} className="text-blue-600 hover:underline font-medium mr-2">
              + Añadir manualmente
            </button>
            o{' '}
            <a href="/dashboard" className="text-blue-600 hover:underline font-medium">importar desde Airbnb →</a>
          </span>
        }
        renderFooter={filteredData => {
          const comp   = filteredData.filter(b => !b.status.toLowerCase().includes('cancel'));
          const rev    = comp.reduce((s, b) => s + b.total_revenue, 0);
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

      {/* ── CSVUploader modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showImporter && (
          <CSVUploader
            onClose={() => setShowImporter(false)}
            onImport={() => { setShowImporter(false); load(filters); }}
          />
        )}
      </AnimatePresence>

      {/* ── Nueva Reserva Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h3 className="text-lg font-bold text-slate-900">Nueva reserva</h3>
                <button onClick={() => setShowModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
              </div>

              {/* Modal body */}
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Row: Huésped + Estado */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Huésped</label>
                    <input type="text" value={form.guest_name}
                      onChange={e => handleFormChange('guest_name', e.target.value)}
                      placeholder="Nombre del huésped"
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Estado</label>
                    <select value={form.status} onChange={e => handleFormChange('status', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="Completada">Completada</option>
                      <option value="Reservada">Reservada</option>
                      <option value="Cancelada">Cancelada</option>
                    </select>
                  </div>
                </div>

                {/* Row: Check-in + Check-out */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Check-in *</label>
                    <input type="date" value={form.start_date}
                      onChange={e => handleFormChange('start_date', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Check-out *</label>
                    <input type="date" value={form.end_date}
                      onChange={e => handleFormChange('end_date', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                {/* Row: Noches (readonly) + Ingresos */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Noches</label>
                    <input type="number" value={form.num_nights}
                      onChange={e => handleFormChange('num_nights', e.target.value)}
                      placeholder="Auto"
                      className="w-full px-3 py-2 text-sm border rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Ingresos (COP) *</label>
                    <input type="number" value={form.total_revenue}
                      onChange={e => handleFormChange('total_revenue', e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                {/* Anuncio */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Anuncio / Propiedad</label>
                  <input type="text" value={form.listing_name}
                    onChange={e => handleFormChange('listing_name', e.target.value)}
                    placeholder="Ej: Apto El Poblado 204"
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Property picker — only in auth mode */}
                {authStatus === 'authed' && properties.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedad (Supabase)</label>
                    <select value={form.property_id} onChange={e => handleFormChange('property_id', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Confirmation code (optional) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Código de confirmación <span className="font-normal text-slate-400">(opcional)</span>
                  </label>
                  <input type="text" value={form.confirmation_code}
                    onChange={e => handleFormChange('confirmation_code', e.target.value)}
                    placeholder="Se genera automáticamente"
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {formError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {formError}
                  </p>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t bg-slate-50">
                <button onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button onClick={handleSubmit} disabled={formLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  {formLoading ? 'Guardando…' : 'Guardar reserva'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}


