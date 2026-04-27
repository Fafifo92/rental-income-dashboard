import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
  listBookings, getDemoBookings, saveDemoBookings, insertBooking,
  updateBooking, deleteBooking,
  generateDirectBookingCode, type BookingFilters,
} from '@/services/bookings';
import { listProperties } from '@/services/properties';
import { findOrCreateListing } from '@/services/listings';
import { listBankAccounts } from '@/services/bankAccounts';
import { listListings } from '@/services/listings';
import type { BookingRow, PropertyRow, BankAccountRow, ListingRow } from '@/types/database';
import type { ParsedBooking } from '@/services/etl';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';
import DataTable from './DataTable';
import CSVUploader from './CSVUploader';
import PropertySelector from './PropertySelector';
import BookingPayoutModal from './BookingPayoutModal';
import BookingDetailModal from './BookingDetailModal';
import ConfirmDeleteChallenge from './ConfirmDeleteChallenge';

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
  listing_id?: string | null;
  channel?: string | null;
  gross_revenue?: number | null;
  channel_fees?: number | null;
  net_payout?: number | null;
  payout_bank_account_id?: string | null;
  payout_date?: string | null;
  notes?: string | null;
  checkin_done?: boolean;
  checkout_done?: boolean;
  inventory_checked?: boolean;
  operational_notes?: string | null;
  isDemo?: boolean;
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
  channel: string;
  num_adults: string;
  num_children: string;
  notes: string;
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
  channel: row.channel ?? null,
  gross_revenue: row.gross_revenue !== null && row.gross_revenue !== undefined ? Number(row.gross_revenue) : null,
  channel_fees: row.channel_fees !== null && row.channel_fees !== undefined ? Number(row.channel_fees) : null,
  net_payout: row.net_payout !== null && row.net_payout !== undefined ? Number(row.net_payout) : null,
  payout_bank_account_id: row.payout_bank_account_id ?? null,
  payout_date: row.payout_date ?? null,
  listing_id: row.listing_id ?? null,
  notes: row.notes ?? null,
  checkin_done: row.checkin_done ?? false,
  checkout_done: row.checkout_done ?? false,
  inventory_checked: row.inventory_checked ?? false,
  operational_notes: row.operational_notes ?? null,
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
  isDemo: true,
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
  channel: 'airbnb', num_adults: '1', num_children: '0', notes: '',
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
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DisplayBooking | null>(null);
  const [properties, setProperties]   = useState<PropertyRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [payoutTarget, setPayoutTarget] = useState<DisplayBooking | null>(null);
  const [detailTarget, setDetailTarget] = useState<DisplayBooking | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);

  // ESC cierra el modal abierto (sin cerrar por clic fuera — ver onClick del overlay)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget) setDeleteTarget(null);
      else if (showModal) { setShowModal(false); setEditingId(null); setForm(EMPTY_FORM); }
      else if (payoutTarget) setPayoutTarget(null);
      else if (detailTarget) setDetailTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal, deleteTarget, payoutTarget, detailTarget]);

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
      setBookings((result.data ?? []).map(fromRow));
      setIsDemo(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load({ ...filters, propertyId }); }, [filters, propertyId, load]);

  useEffect(() => {
    if (authStatus === 'authed') {
      listProperties().then(res => { if (!res.error) setProperties(res.data ?? []); });
      listBankAccounts().then(res => { if (!res.error) setBankAccounts((res.data ?? []).filter(a => a.is_active)); });
      listListings().then(res => { if (!res.error) setListings(res.data ?? []); });
    }
  }, [authStatus]);

  const applySearch = useCallback(
    () => setFilters(prev => ({ ...prev, search })),
    [search],
  );

  const handleFormChange = useCallback((field: keyof BookingForm, value: string) => {
    setForm(prev => {
      const updated = { ...prev, [field]: value };

      // ── Bidirectional date ↔ nights sync ─────────────────────────────
      if (field === 'start_date') {
        const s = value;
        // If end is before new start (or empty), reset end to start + current nights
        const nights = parseInt(updated.num_nights) || 0;
        if (s && (!updated.end_date || updated.end_date < s)) {
          if (nights > 0) {
            const end = new Date(s);
            end.setDate(end.getDate() + nights);
            updated.end_date = end.toISOString().split('T')[0];
          } else {
            updated.end_date = '';
          }
        } else if (s && updated.end_date) {
          const n = Math.max(0, Math.round(
            (new Date(updated.end_date).getTime() - new Date(s).getTime()) / 86_400_000,
          ));
          updated.num_nights = String(n);
        }
      } else if (field === 'end_date') {
        const e = value;
        // Guard: end cannot be before start. If user picks earlier, snap end = start + 1.
        if (e && updated.start_date && e < updated.start_date) {
          const snap = new Date(updated.start_date);
          snap.setDate(snap.getDate() + 1);
          updated.end_date = snap.toISOString().split('T')[0];
          updated.num_nights = '1';
        } else if (e && updated.start_date) {
          const n = Math.max(0, Math.round(
            (new Date(e).getTime() - new Date(updated.start_date).getTime()) / 86_400_000,
          ));
          updated.num_nights = String(n);
        }
      } else if (field === 'num_nights') {
        // User edits nights → move end_date = start + nights
        const n = Math.max(0, parseInt(value) || 0);
        updated.num_nights = String(n);
        if (updated.start_date && n > 0) {
          const end = new Date(updated.start_date);
          end.setDate(end.getDate() + n);
          updated.end_date = end.toISOString().split('T')[0];
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
    const code = form.confirmation_code
      || (form.channel === 'direct' ? generateDirectBookingCode() : `MANUAL-${Date.now()}`);

    try {
      if (editingId) {
        // ── UPDATE flow ───────────────────────────────────────────────
        const res = await updateBooking(editingId, {
          guest_name: form.guest_name || null,
          start_date: form.start_date,
          end_date: form.end_date,
          num_nights: nights,
          total_revenue: revenue,
          status: form.status || null,
          channel: form.channel || null,
          num_adults: parseInt(form.num_adults) || 1,
          num_children: parseInt(form.num_children) || 0,
          notes: form.notes || null,
        });
        if (res.error) { setFormError(res.error); setFormLoading(false); return; }
      } else if (authStatus !== 'authed') {
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
        if (listingRes.error || !listingRes.data) { setFormError(listingRes.error ?? 'No se pudo crear el listing'); setFormLoading(false); return; }
        const res = await insertBooking(listingRes.data.id, {
          confirmation_code: code,
          guest_name: form.guest_name || undefined,
          start_date: form.start_date,
          end_date: form.end_date,
          num_nights: nights,
          total_revenue: revenue,
          status: form.status,
          channel: form.channel || 'airbnb',
          num_adults: parseInt(form.num_adults) || 1,
          num_children: parseInt(form.num_children) || 0,
          notes: form.notes || undefined,
        });
        if (res.error) { setFormError(res.error); setFormLoading(false); return; }
      }
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load(filters);
    } catch {
      setFormError('Error inesperado al guardar.');
    }
    setFormLoading(false);
  }, [form, editingId, authStatus, properties, filters, load]);

  const handleEdit = useCallback((b: DisplayBooking) => {
    setEditingId(b.id);
    setForm({
      guest_name: b.guest_name === '—' ? '' : b.guest_name,
      confirmation_code: b.confirmation_code,
      start_date: b.start_date,
      end_date: b.end_date,
      num_nights: String(b.num_nights),
      total_revenue: String(b.total_revenue),
      status: b.status,
      listing_name: b.listing_name,
      property_id: '',
      channel: b.channel ?? 'airbnb',
      num_adults: '1',
      num_children: '0',
      notes: '',
    });
    setFormError('');
    setShowModal(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await deleteBooking(deleteTarget.id);
    if (res.error) { setFormError(res.error); return; }
    setDeleteTarget(null);
    await load(filters);
  }, [deleteTarget, filters, load]);

  const columns = useMemo<ColumnDef<DisplayBooking, any>[]>(() => [
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
      meta: { className: 'whitespace-nowrap' },
      cell: info => {
        const b = info.row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium text-slate-800">{b.guest_name}</span>
            <span className="font-mono text-[10px] text-slate-400">{b.confirmation_code}</span>
          </div>
        );
      },
    }),
    bookingHelper.accessor('start_date', {
      header: 'Estadía',
      meta: { className: 'whitespace-nowrap' },
      cell: info => {
        const b = info.row.original;
        const fmt = (d: string) => {
          if (!d) return '—';
          const date = new Date(d);
          return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getFullYear()).slice(2)}`;
        };
        return (
          <div className="flex flex-col text-xs">
            <span className="text-slate-700">{fmt(b.start_date)} → {fmt(b.end_date)}</span>
            <span className="text-slate-400">{b.num_nights} noche{b.num_nights !== 1 ? 's' : ''}</span>
          </div>
        );
      },
    }),
    bookingHelper.accessor('channel', {
      header: 'Canal',
      meta: { align: 'center' },
      cell: info => {
        const c = (info.getValue() || 'airbnb').toLowerCase();
        const styles: Record<string, string> = {
          airbnb:  'bg-rose-50 text-rose-700 border-rose-200',
          booking: 'bg-blue-50 text-blue-700 border-blue-200',
          vrbo:    'bg-amber-50 text-amber-700 border-amber-200',
          direct:  'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
        const label: Record<string, string> = { airbnb: 'Airbnb', booking: 'Booking', vrbo: 'Vrbo', direct: 'Directo', other: 'Otro' };
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[c] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {label[c] ?? c}
          </span>
        );
      },
    }),
    bookingHelper.accessor('total_revenue', {
      header: 'Bruto',
      meta: { align: 'right' },
      sortingFn: 'basic',
      cell: info => (
        <span className="font-semibold text-slate-800 whitespace-nowrap">{formatCurrency(info.getValue())}</span>
      ),
    }),
    bookingHelper.accessor('net_payout', {
      header: 'Neto al banco',
      meta: { align: 'right' },
      sortingFn: 'basic',
      cell: info => {
        const v = info.getValue();
        return v !== null && v !== undefined
          ? <span className="font-semibold text-emerald-700 whitespace-nowrap">{formatCurrency(Number(v))}</span>
          : <span className="text-slate-300 text-xs">—</span>;
      },
    }),
    bookingHelper.display({
      id: 'actions',
      header: '',
      cell: info => {
        const b = info.row.original;
        if (b.isDemo) return null;
        const hasPayout = b.net_payout !== null && b.net_payout !== undefined;
        return (
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <button
              onClick={() => setDetailTarget(b)}
              title="Ver detalle"
              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button
              onClick={() => handleEdit(b)}
              title="Editar reserva"
              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => setPayoutTarget(b)}
              title={hasPayout ? 'Editar payout real' : 'Registrar payout real'}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border transition-colors ${
                hasPayout
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-blue-300 hover:text-blue-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Payout
            </button>
            <button
              onClick={() => setDeleteTarget(b)}
              title="Eliminar reserva"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
        );
      },
    }),
  ], [handleEdit, setDetailTarget]);

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
    <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
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
            onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true); }}
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
        emptyIcon="" emptyTitle="Sin reservas importadas"
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
          const net    = comp.reduce((s, b) => s + (b.net_payout ?? 0), 0);
          const nights = comp.reduce((s, b) => s + b.num_nights, 0);
          return (
            <tr className="border-t bg-slate-50">
              <td colSpan={2} className="px-5 py-4 text-sm font-semibold text-slate-600">
                {filteredData.length} reserva{filteredData.length !== 1 ? 's' : ''}
              </td>
              <td className="px-5 py-4 text-xs font-semibold text-slate-600">{nights} noches</td>
              <td />
              <td className="px-5 py-4 text-right font-bold text-slate-900 whitespace-nowrap">{formatCurrency(rev)}</td>
              <td className="px-5 py-4 text-right font-bold text-emerald-700 whitespace-nowrap">{net > 0 ? formatCurrency(net) : '—'}</td>
              <td />
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
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h3 className="text-lg font-bold text-slate-900">{editingId ? 'Editar reserva' : 'Nueva reserva'}</h3>
                <button onClick={() => { setShowModal(false); setEditingId(null); setForm(EMPTY_FORM); }}
                  className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
              </div>

              {/* Modal body */}
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Row: Canal + Estado */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Canal</label>
                    <select value={form.channel} onChange={e => handleFormChange('channel', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="airbnb">Airbnb</option>
                      <option value="booking">Booking.com</option>
                      <option value="vrbo">Vrbo</option>
                      <option value="direct">Directo</option>
                      <option value="other">Otro</option>
                    </select>
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

                {/* Huésped */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Huésped</label>
                  <input type="text" value={form.guest_name}
                    onChange={e => handleFormChange('guest_name', e.target.value)}
                    placeholder="Nombre del huésped"
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Adultos + Niños */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Adultos</label>
                    <input type="number" min="0" value={form.num_adults}
                      onChange={e => handleFormChange('num_adults', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Niños</label>
                    <input type="number" min="0" value={form.num_children}
                      onChange={e => handleFormChange('num_children', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                {/* Stay section — fechas + noches sincronizadas */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estadía</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Check-in *</label>
                      <input type="date" value={form.start_date}
                        onChange={e => handleFormChange('start_date', e.target.value)}
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Check-out *</label>
                      <input type="date" value={form.end_date}
                        min={form.start_date || undefined}
                        onChange={e => handleFormChange('end_date', e.target.value)}
                        disabled={!form.start_date}
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Noches</label>
                      <input type="number" min="1" value={form.num_nights}
                        onChange={e => handleFormChange('num_nights', e.target.value)}
                        placeholder="0"
                        disabled={!form.start_date}
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                  {form.start_date && form.end_date && (
                    <p className="text-xs text-slate-500">
                      {new Date(form.start_date + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
                      {' → '}
                      {new Date(form.end_date + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>

                {/* Ingresos */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ingresos (COP) *</label>
                  <input type="number" value={form.total_revenue}
                    onChange={e => handleFormChange('total_revenue', e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
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
                    placeholder={form.channel === 'direct' ? 'Se genera DIR-YYYY-XXXXX' : 'Se genera automáticamente'}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Notas */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Notas <span className="font-normal text-slate-400">(opcional)</span>
                  </label>
                  <textarea value={form.notes}
                    onChange={e => handleFormChange('notes', e.target.value)}
                    rows={2}
                    placeholder="Info extra del huésped, canal, etc."
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
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

      {/* ── Payout Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {payoutTarget && (
          <BookingPayoutModal
            booking={payoutTarget}
            bankAccounts={bankAccounts}
            onClose={() => setPayoutTarget(null)}
            onSaved={() => { setPayoutTarget(null); load({ ...filters, propertyId }); }}
          />
        )}
      </AnimatePresence>

      {/* ── Detail Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {detailTarget && (
          <BookingDetailModal
            booking={detailTarget}
            properties={properties}
            bankAccounts={bankAccounts}
            onClose={() => setDetailTarget(null)}
            resolvePropertyId={(lid) => {
              if (!lid) return null;
              return listings.find(l => l.id === lid)?.property_id ?? null;
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Delete confirmation (reto BORRAR) ──────────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <ConfirmDeleteChallenge
            title="Eliminar reserva"
            description={
              <div className="space-y-3">
                <p>
                  Vas a eliminar la reserva{' '}
                  <span className="font-mono font-semibold">{deleteTarget.confirmation_code}</span>{' '}
                  de <span className="font-semibold">{deleteTarget.guest_name}</span>.
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                  <div>Estadía: {deleteTarget.start_date} → {deleteTarget.end_date}</div>
                  <div>Monto: <span className="font-semibold">{formatCurrency(deleteTarget.total_revenue)}</span></div>
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Los ajustes, aseos y gastos vinculados a esta reserva también se eliminarán en cascada.
                </p>
              </div>
            }
            onConfirm={handleConfirmDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}


