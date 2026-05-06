import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
  listBookings, getDemoBookings, saveDemoBookings, insertBooking,
  updateBooking, deleteBooking, checkBookingOverlap,
  generateDirectBookingCode, type BookingFilters, type BookingWithListingRow,
} from '@/services/bookings';
import { listProperties } from '@/services/properties';
import { findOrCreateListing } from '@/services/listings';
import { listBankAccounts } from '@/services/bankAccounts';
import { listListings } from '@/services/listings';
import { runAutoCheckins } from '@/services/creditPools';
import type { BookingRow, PropertyRow, BankAccountRow, ListingRow } from '@/types/database';
import type { ParsedBooking } from '@/services/etl';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';
import DataTable from './DataTable';
import CSVUploader from './CSVUploader';
import PropertyMultiSelect from '@/components/PropertyMultiSelectFilter';
import BookingPayoutModal from './BookingPayoutModal';
import BookingDetailModal from './BookingDetailModal';
import ConfirmDeleteChallenge from './ConfirmDeleteChallenge';
import MoneyInput from '@/components/MoneyInput';
import { parseMoney } from '@/lib/money';
import { getBookingStatus, statusUI, inferOperationalFlags, type DerivedBookingStatus } from '@/lib/bookingStatus';
import { todayISO as todayISOFromUtils } from '@/lib/dateUtils';
import { toast } from '@/lib/toast';
import { CalendarCheck, Pencil, HandCoins, Trash2 } from 'lucide-react';

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
  property_name?: string | null;
  listing_id?: string | null;
  /** Resolved from listings join — available without needing the separate listings cache. */
  property_id?: string | null;
  channel?: string | null;
  gross_revenue?: number | null;
  channel_fees?: number | null;
  net_payout?: number | null;
  payout_bank_account_id?: string | null;
  payout_date?: string | null;
  notes?: string | null;
  num_adults?: number | null;
  num_children?: number | null;
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

const fromRow = (row: BookingWithListingRow): DisplayBooking => ({
  id: row.id,
  confirmation_code: row.confirmation_code,
  guest_name: row.guest_name ?? '—',
  start_date: row.start_date,
  end_date: row.end_date,
  num_nights: row.num_nights,
  total_revenue: Number(row.total_revenue),
  status: row.status ?? '',
  listing_name: row.listings?.external_name ?? '',
  property_name: row.listings?.properties?.name ?? null,
  listing_id: row.listing_id ?? null,
  property_id: row.listings?.property_id ?? null,
  channel: row.channel ?? null,
  gross_revenue: row.gross_revenue !== null && row.gross_revenue !== undefined ? Number(row.gross_revenue) : null,
  channel_fees: row.channel_fees !== null && row.channel_fees !== undefined ? Number(row.channel_fees) : null,
  net_payout: row.net_payout !== null && row.net_payout !== undefined ? Number(row.net_payout) : null,
  payout_bank_account_id: row.payout_bank_account_id ?? null,
  payout_date: row.payout_date ?? null,
  notes: row.notes ?? null,
  num_adults: row.num_adults ?? null,
  num_children: row.num_children ?? null,
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

const EMPTY_FILTERS: BookingFilters = {};

// Usa la timezone configurada por el usuario (desde localStorage / dateUtils).
const todayISO = (): string => todayISOFromUtils();

// Formatea una fecha arbitraria como YYYY-MM-DD usando componentes locales.
const localISO = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Calcula el primer día de check-in según la hora local actual.
// Si es después de las 6 PM, sugiere mañana; si no, hoy.
const getSmartDefaultStartDate = (): { start_date: string; end_date: string; num_nights: string } => {
  const now = new Date();
  const hour = now.getHours(); // hora local ✓

  let startDate: string;
  if (hour >= 18) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    startDate = localISO(tomorrow); // fecha local de mañana ✓
  } else {
    startDate = localISO(now);
  }

  // Calcular check-out usando constructor local (no UTC string) para evitar offset
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const endD = new Date(sy, sm - 1, sd + 2);
  const endDate = localISO(endD);

  return { start_date: startDate, end_date: endDate, num_nights: '2' };
};

const EMPTY_FORM: BookingForm = {
  guest_name: '', confirmation_code: '', start_date: '', end_date: '',
  num_nights: '', total_revenue: '', status: 'Reservada', listing_name: '', property_id: '',
  channel: '', num_adults: '1', num_children: '0', notes: '',
};

const bookingHelper = createColumnHelper<DisplayBooking>();

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingsClient() {
  // ── ALL HOOKS — must come before any conditional returns ──────────────────
  const authStatus = useAuth();
  const { properties: allProperties, propertyIds, setPropertyIds, groups, tags, tagAssigns } = usePropertyFilter();
  const [bookings, setBookings]     = useState<DisplayBooking[]>([]);
  const [loading, setLoading]       = useState(true);
  const [isDemo, setIsDemo]         = useState(false);
  const [filters, setFilters]       = useState<BookingFilters>(EMPTY_FILTERS);
  const [search, setSearch]         = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [form, setForm]               = useState<BookingForm>(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [formWarning, setFormWarning] = useState('');
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [overlapAck, setOverlapAck] = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DisplayBooking | null>(null);
  const [properties, setProperties]   = useState<PropertyRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [payoutTarget, setPayoutTarget] = useState<DisplayBooking | null>(null);
  const [detailTarget, setDetailTarget] = useState<DisplayBooking | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<DerivedBookingStatus | 'all'>('all');

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

  useEffect(() => { load({ ...filters, propertyIds }); }, [filters, propertyIds, load]);

  useEffect(() => {
    if (authStatus === 'authed') {
      listProperties().then(res => { if (!res.error) setProperties(res.data ?? []); });
      listBankAccounts().then(res => { if (!res.error) setBankAccounts((res.data ?? []).filter(a => a.is_active)); });
      listListings().then(res => { if (!res.error) setListings(res.data ?? []); });
      // Check-in automático "lazy": al cargar la app, busca reservas confirmadas
      // cuyo check-in ya pasó y no está marcado, las marca y consume créditos
      // del seguro activo. Recarga la lista al terminar si hubo cambios.
      runAutoCheckins().then(res => {
        if (res.processed > 0) load({ ...filters, propertyIds });
      }).catch(() => { /* silent */ });
    }
  }, [authStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySearch = useCallback(
    () => setFilters(prev => ({ ...prev, search })),
    [search],
  );

  const handleFormChange = useCallback((field: keyof BookingForm, value: string) => {
    if (field === 'start_date' || field === 'end_date') {
      setOverlapAck(false);
      setFormWarning('');
    }
    setForm(prev => {
      const updated = { ...prev, [field]: value };

      // Si pasa a "Inicia hoy" → fija check-in a hoy y lo bloquea.
      if (field === 'status' && value === 'Inicia hoy') {
        const today = todayISO();
        updated.start_date = today;
        const nights = parseInt(updated.num_nights) || 0;
        if (!updated.end_date || updated.end_date <= today) {
          if (nights > 0) {
            const end = new Date(today);
            end.setDate(end.getDate() + nights);
            updated.end_date = end.toISOString().split('T')[0];
          }
        } else {
          const n = Math.max(0, Math.round(
            (new Date(updated.end_date).getTime() - new Date(today).getTime()) / 86_400_000,
          ));
          updated.num_nights = String(n);
        }
        return updated;
      }
      // Si pasa a "Completada" → limpia fechas futuras.
      if (field === 'status' && value === 'Completada') {
        const today = todayISO();
        if (updated.end_date && updated.end_date > today) {
          updated.end_date = '';
          updated.num_nights = '';
        }
        if (updated.start_date && updated.start_date > today) {
          updated.start_date = '';
          updated.end_date = '';
          updated.num_nights = '';
        }
        return updated;
      }
      // Si pasa a "Reservada" → limpia fechas pasadas.
      if (field === 'status' && value === 'Reservada') {
        const today = todayISO();
        if (updated.start_date && updated.start_date < today) {
          updated.start_date = '';
          updated.end_date = '';
          updated.num_nights = '';
        }
        return updated;
      }
      // Si está en "Inicia hoy", bloquear cambios manuales del check-in.
      if (field === 'start_date' && prev.status === 'Inicia hoy') {
        return prev;
      }

      // ── Bidirectional date ↔ nights sync (with status-based clamping) ──────
      if (field === 'start_date') {
        let s = value;
        const today = todayISO();
        // Clamp start_date según estado
        if (updated.status === 'Reservada' && s && s < today) s = today;
        if (updated.status === 'Completada' && s && s > today) s = today;
        updated.start_date = s;
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
        // Si después del sync end_date viola la restricción, limpiarla
        if (updated.status === 'Completada' && updated.end_date && updated.end_date > today) {
          updated.end_date = '';
          updated.num_nights = '';
        }
      } else if (field === 'end_date') {
        let e = value;
        const today = todayISO();
        // Clamp end_date según estado
        if (updated.status === 'Completada' && e && e > today) e = today;
        updated.end_date = e;
        if (e && updated.start_date && e < updated.start_date) {
          const snap = new Date(updated.start_date);
          snap.setDate(snap.getDate() + 1);
          updated.end_date = snap.toISOString().split('T')[0];
          updated.num_nights = '1';
        } else if (e && updated.start_date) {
          const n = Math.max(0, Math.round(
            (new Date(updated.end_date).getTime() - new Date(updated.start_date).getTime()) / 86_400_000,
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
      toast.error('Completa los campos obligatorios: Check-in, Check-out e Ingresos.');
      return;
    }
    if (form.end_date <= form.start_date) {
      toast.error('El check-out debe ser posterior al check-in.');
      return;
    }
    // Validaciones de coherencia status ↔ fechas
    const today = todayISO();
    if (form.status === 'Completada' && form.end_date > today) {
      toast.error('Una reserva Completada debe tener fecha de check-out igual o anterior a hoy.');
      return;
    }
    if (form.status === 'Completada' && form.start_date > today) {
      toast.error('Una reserva Completada debe tener fecha de check-in en el pasado.');
      return;
    }
    if (form.status === 'Reservada' && form.start_date < today) {
      toast.error('Una reserva Reservada debe tener fecha de check-in igual o posterior a hoy.');
      return;
    }
    setFormLoading(true);
    setFormWarning('');
    const nights  = parseInt(form.num_nights) || 0;
    const revenue = parseMoney(form.total_revenue) ?? 0;
    const code = form.confirmation_code
      || (form.channel === 'direct' ? generateDirectBookingCode() : `MANUAL-${Date.now()}`);

    try {
      if (editingId) {
        // ── UPDATE flow ───────────────────────────────────────────────
        // Determine target listing: if property changed, find/create new listing
        let targetListingId = editingListingId;
        if (form.property_id && form.property_id !== editingPropertyId) {
          const listingRes = await findOrCreateListing(form.property_id, form.listing_name || 'Manual');
          if (listingRes.error || !listingRes.data) {
            toast.error(listingRes.error ?? 'No se pudo cambiar el anuncio');
            setFormLoading(false);
            return;
          }
          targetListingId = listingRes.data.id;
        }
        // Validar solape contra otras reservas del listing destino
        if (targetListingId) {
          const overlap = await checkBookingOverlap(targetListingId, form.start_date, form.end_date, editingId);
          if (!overlap.ok) {
            toast.error(overlap.error);
            setFormLoading(false);
            return;
          }
          if (overlap.warning && !overlapAck) {
            setFormWarning(overlap.warning + ' Vuelve a guardar para confirmar.');
            setOverlapAck(true);
            setFormLoading(false);
            return;
          }
        }
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
          ...(targetListingId !== editingListingId ? { listing_id: targetListingId } : {}),
        });
        if (res.error) { toast.error(res.error); setFormLoading(false); return; }
        toast.success('Reserva actualizada');
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
        toast.success('Reserva guardada (demo)');
      } else {
        const propertyId = form.property_id;
        if (!propertyId) {
          toast.error(properties.length === 0
            ? 'Crea una propiedad primero desde la sección Propiedades.'
            : 'Selecciona una propiedad para esta reserva.');
          setFormLoading(false);
          return;
        }
        const listingRes = await findOrCreateListing(propertyId, form.listing_name || 'Manual');
        if (listingRes.error || !listingRes.data) { toast.error(listingRes.error ?? 'No se pudo crear el listing'); setFormLoading(false); return; }
        // Validar solape antes de insertar
        const overlap = await checkBookingOverlap(listingRes.data.id, form.start_date, form.end_date);
        if (!overlap.ok) {
          toast.error(overlap.error);
          setFormLoading(false);
          return;
        }
        if (overlap.warning && !overlapAck) {
          setFormWarning(overlap.warning + ' Vuelve a guardar para confirmar.');
          setOverlapAck(true);
          setFormLoading(false);
          return;
        }
        const opFlags = inferOperationalFlags(form.start_date, form.end_date);
        const res = await insertBooking(listingRes.data.id, {
          confirmation_code: code,
          guest_name: form.guest_name || undefined,
          start_date: form.start_date,
          end_date: form.end_date,
          num_nights: nights,
          total_revenue: revenue,
          status: form.status,
          channel: form.channel || undefined,
          num_adults: parseInt(form.num_adults) || 1,
          num_children: parseInt(form.num_children) || 0,
          notes: form.notes || undefined,
          checkin_done: opFlags.checkin_done,
          checkout_done: opFlags.checkout_done,
        });
        if (res.error) { toast.error(res.error); setFormLoading(false); return; }
        toast.success('Reserva creada');
      }
      setShowModal(false);
      setEditingId(null);
      setEditingListingId(null);
      setEditingPropertyId(null);
      setOverlapAck(false);
      setForm(EMPTY_FORM);
      await load({ ...filters, propertyIds });
    } catch {
      toast.error('Error inesperado al guardar.');
    }
    setFormLoading(false);
  }, [form, editingId, editingListingId, editingPropertyId, overlapAck, authStatus, properties, listings, filters, propertyIds, load]);

  const handleEdit = useCallback((b: DisplayBooking) => {
    setEditingId(b.id);
    setEditingListingId(b.listing_id ?? null);
    setEditingPropertyId(b.property_id ?? null);
    setForm({
      guest_name: b.guest_name === '—' ? '' : b.guest_name,
      confirmation_code: b.confirmation_code,
      start_date: b.start_date,
      end_date: b.end_date,
      num_nights: String(b.num_nights),
      total_revenue: String(b.total_revenue),
      status: b.status,
      listing_name: b.listing_name,
      property_id: b.property_id ?? '',
      channel: b.channel ?? '',
      num_adults: '1',
      num_children: '0',
      notes: '',
    });
    setShowModal(true);
  }, []);

  const openNewBookingModal = useCallback(() => {
    setEditingId(null);
    setEditingListingId(null);
    setEditingPropertyId(null);
    setOverlapAck(false);
    setFormWarning('');
    const smartDates = getSmartDefaultStartDate();
    setForm({
      ...EMPTY_FORM,
      ...smartDates,
      // Auto-select the only property if there's just one; otherwise require explicit choice
      property_id: properties.length === 1 ? properties[0].id : '',
    });
    setShowModal(true);
  }, [properties]);

  const handleConfirmDelete= useCallback(async () => {
    if (!deleteTarget) return;
    const res = await deleteBooking(deleteTarget.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Reserva eliminada');
    setDeleteTarget(null);
    await load({ ...filters, propertyIds });
  }, [deleteTarget, filters, propertyIds, load]);

  const columns = useMemo<ColumnDef<DisplayBooking, any>[]>(() => [
    bookingHelper.accessor('status', {
      header: 'Estado',
      cell: info => {
        const row = info.row.original;
        const derived = getBookingStatus({
          start_date: row.start_date,
          end_date: row.end_date,
          checkin_done: (row as any).checkin_done,
          checkout_done: (row as any).checkout_done,
          status: row.status,
        });
        const ui = statusUI[derived];
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${ui.className}`}
            title={info.getValue() || ui.label}
          >
            {ui.label}
          </span>
        );
      },
    }),
    bookingHelper.accessor('guest_name', {
      header: 'Huésped',
      cell: info => {
        const b = info.row.original;
        return (
          <div className="flex flex-col min-w-0 max-w-[180px] sm:max-w-[220px]">
            <span className="font-medium text-slate-800 truncate" title={b.guest_name}>{b.guest_name}</span>
            <span className="font-mono text-[10px] text-slate-400 truncate">
              {b.confirmation_code}{(b.property_name ?? b.listing_name) ? ` · ${b.property_name ?? b.listing_name}` : ''}
            </span>
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
          const [y, m, day] = d.split('-');
          return `${day}/${m}/${y.slice(2)}`;
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
        if (v === null || v === undefined) return <span className="text-slate-300 text-xs">—</span>;
        const n = Number(v);
        return n < 0
          ? <span className="font-semibold text-rose-600 whitespace-nowrap">−{formatCurrency(Math.abs(n))}</span>
          : <span className="font-semibold text-emerald-700 whitespace-nowrap">{formatCurrency(n)}</span>;
      },
    }),
    bookingHelper.display({
      id: 'actions',
      header: '',
      cell: info => {
        const b = info.row.original;
        if (b.isDemo) return null;
        const hasPayout = b.net_payout !== null && b.net_payout !== undefined;
        const isCancelledNegative = b.status.toLowerCase().includes('cancel') && b.total_revenue < 0;
        return (
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <button
              onClick={() => setDetailTarget(b)}
              title="Ver detalle de reserva"
              aria-label="Ver detalle"
              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
            >
              <CalendarCheck className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleEdit(b)}
              title="Editar reserva"
              aria-label="Editar reserva"
              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
            {isCancelledNegative ? (
              <button
                onClick={() => setPayoutTarget(b)}
                title="Registrar cuenta de débito de multa"
                aria-label="Cuenta de débito"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border transition-colors bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
              >
                <HandCoins className="w-3.5 h-3.5" />
                Débito
              </button>
            ) : (
              <button
                onClick={() => setPayoutTarget(b)}
                title={hasPayout ? 'Editar payout real' : 'Registrar payout real'}
                aria-label="Payout de reserva"
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border transition-colors ${
                  hasPayout
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                <HandCoins className="w-3.5 h-3.5" />
                Payout
              </button>
            )}
            <button
              onClick={() => setDeleteTarget(b)}
              title="Eliminar reserva"
              aria-label="Eliminar reserva"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      },
    }),
  ], [handleEdit, setDetailTarget]);

  // ── Derived values (must be before any early returns) ────────────────────
  // listing_name and property_id are already populated from the DB join in fromRow
  const enrichedBookings = useMemo(() => {
    if (statusFilter === 'all') return bookings;
    return bookings.filter(b => {
      const derived = getBookingStatus({
        start_date: b.start_date,
        end_date: b.end_date,
        checkin_done: b.checkin_done,
        checkout_done: b.checkout_done,
        status: b.status,
      });
      return derived === statusFilter;
    });
  }, [bookings, statusFilter]);

  // ── EARLY RETURNS (after all hooks) ──────────────────────────────────────
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  const completed    = enrichedBookings.filter(b => !b.status.toLowerCase().includes('cancel'));
  const totalRevenue = completed.reduce((s, b) => s + b.total_revenue, 0);
  const totalNights  = completed.reduce((s, b) => s + b.num_nights, 0);

  // Payout eligible: reservas completadas + canceladas con ingreso positivo (tarifa de cancelación cobrada)
  const payoutEligible = enrichedBookings.filter(b => {
    const isCancelled = b.status.toLowerCase().includes('cancel');
    return !isCancelled || b.total_revenue > 0;
  });
  // Ingresos confirmados: reservas con banco de payout asignado
  const confirmed = payoutEligible.filter(b => b.payout_bank_account_id);
  const receivedPayout = confirmed.reduce((s, b) => s + (b.net_payout ?? b.total_revenue), 0);
  // Ingresos por cobrar: sin banco asignado aún
  const expectedPayout = payoutEligible.filter(b => !b.payout_bank_account_id).reduce((s, b) => s + b.total_revenue, 0);
  // Multas por cancelación (ingresos negativos en canceladas)
  const cancelledFinesTotal = enrichedBookings
    .filter(b => b.status.toLowerCase().includes('cancel') && b.total_revenue < 0)
    .reduce((s, b) => s + Math.abs(b.total_revenue), 0);
  // Reservas pasadas sin payout confirmado (datos incompletos)
  const today = new Date(); today.setHours(0,0,0,0);
  const incompleteCount = completed.filter(b => !b.payout_bank_account_id && b.end_date && new Date(b.end_date) < today).length;

  const kpis = [
    { label: 'Total Reservas', value: enrichedBookings.length.toString(), color: 'text-blue-600', bg: 'bg-blue-50', sub: null },
    {
      label: 'Payout confirmado',
      value: formatCurrency(receivedPayout),
      color: 'text-green-700',
      bg: 'bg-green-50',
      sub: expectedPayout > 0
        ? `Por cobrar: ${formatCurrency(expectedPayout)}`
        : cancelledFinesTotal > 0
          ? `Multas: −${formatCurrency(cancelledFinesTotal)}`
          : null,
    },
    { label: 'Noches Totales', value: totalNights.toString(), color: 'text-purple-600', bg: 'bg-purple-50', sub: null },
    { label: 'ADR (Tarifa Diaria)', value: totalNights > 0 ? formatCurrency(totalRevenue / totalNights) : '—', color: 'text-orange-600', bg: 'bg-orange-50', sub: null },
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
          <PropertyMultiSelect properties={allProperties} value={propertyIds} onChange={setPropertyIds} groups={groups} tags={tags} tagAssigns={tagAssigns} />
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={openNewBookingModal}
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
      {!loading && enrichedBookings.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {kpis.map((kpi, i) => (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
                className={`p-5 border rounded-xl shadow-sm ${kpi.bg}`}
              >
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{kpi.label}</p>
                <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                {kpi.sub && (
                  <p className="text-xs text-amber-600 font-medium mt-1">{kpi.sub}</p>
                )}
              </motion.div>
            ))}
          </div>
          {incompleteCount > 0 && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span className="text-amber-800">
                <strong>{incompleteCount}</strong> reserva{incompleteCount !== 1 ? 's' : ''} pasada{incompleteCount !== 1 ? 's' : ''} sin payout confirmado —{' '}
                asigna la cuenta bancaria desde el botón de payout en cada reserva para tener datos exactos.
              </span>
            </motion.div>
          )}
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
        {(filters.dateFrom || filters.dateTo || filters.search || statusFilter !== 'all') && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
            onClick={() => { setFilters(EMPTY_FILTERS); setSearch(''); setStatusFilter('all'); }}
            className="self-end px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            ✕ Limpiar
          </motion.button>
        )}
      </motion.div>

      {/* Table */}
      <DataTable<DisplayBooking>
        columns={columns} data={enrichedBookings} loading={loading}
        showSearch={false} defaultPageSize={25} skeletonRows={8}
        emptyIcon="" emptyTitle="Sin reservas importadas"
        emptyDescription={
          <span>
            <button onClick={openNewBookingModal} className="text-blue-600 hover:underline font-medium mr-2">
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
            onImport={() => { setShowImporter(false); load({ ...filters, propertyIds }); }}
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
                      <option value="">— Selecciona canal —</option>
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
                      <option value="Reservada">Reservada</option>
                      <option value="Inicia hoy">Inicia hoy</option>
                      <option value="Completada">Completada</option>
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
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Check-in *{form.status === 'Inicia hoy' && <span className="ml-1 text-emerald-600">🔒 Hoy</span>}
                      </label>
                      <input type="date" value={form.start_date}
                        onChange={e => handleFormChange('start_date', e.target.value)}
                        disabled={form.status === 'Inicia hoy'}
                        min={form.status === 'Reservada' ? todayISO() : undefined}
                        max={(form.status === 'Completada' || form.status === 'En curso') ? todayISO() : undefined}
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-emerald-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Check-out *</label>
                      <input type="date" value={form.end_date}
                        min={form.status === 'En curso'
                          ? (() => { const t = new Date(todayISO()); t.setDate(t.getDate() + 1); return t.toISOString().split('T')[0]; })()
                          : (form.start_date || undefined)}
                        max={form.status === 'Completada' ? todayISO() : undefined}
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
                  <MoneyInput
                    value={parseMoney(form.total_revenue)}
                    onChange={(v) => handleFormChange('total_revenue', v == null ? '' : String(v))}
                    placeholder="0"
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
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedad *</label>
                    <select value={form.property_id} onChange={e => handleFormChange('property_id', e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      {!form.property_id && (
                        <option value="" disabled>— Selecciona una propiedad —</option>
                      )}
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

                {formWarning && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {formWarning}
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
            booking={{
              ...payoutTarget,
              channel: payoutTarget.channel ?? null,
              start_date: payoutTarget.start_date ?? null,
              checkin_done: payoutTarget.checkin_done ?? false,
            }}
            bankAccounts={bankAccounts}
            onClose={() => setPayoutTarget(null)}
            onSaved={() => { setPayoutTarget(null); load({ ...filters, propertyIds }); }}
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


