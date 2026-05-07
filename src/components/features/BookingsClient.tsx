import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getDemoBookings, saveDemoBookings, insertBooking,
  updateBooking, deleteBooking, checkBookingOverlap,
  generateDirectBookingCode, type BookingFilters,
} from '@/services/bookings';
import { findOrCreateListing } from '@/services/listings';
import { runAutoCheckins } from '@/services/creditPools';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';
import { useBookingsList } from '@/lib/hooks/useBookingsList';
import { useReferenceData } from '@/lib/hooks/useReferenceData';
import DataTable from './DataTable';
import CSVUploader from './CSVUploader';
import PropertyMultiSelect from '@/components/PropertyMultiSelectFilter';
import BookingPayoutModal from './BookingPayoutModal';
import ConfirmDeleteChallenge from './ConfirmDeleteChallenge';
import { parseMoney } from '@/lib/money';
import { getBookingStatus, inferOperationalFlags, type DerivedBookingStatus } from '@/lib/bookingStatus';
import { toast } from '@/lib/toast';

import {
  type DisplayBooking, type BookingForm,
  EMPTY_FORM, EMPTY_FILTERS,
} from './bookings/types';
import { fromDemo, todayISO, getSmartDefaultStartDate } from './bookings/helpers';
import { useBookingsColumns } from './bookings/useBookingsColumns';
import BookingsKPICards, { buildBookingKPIs } from './bookings/BookingsKPICards';
import BookingsFilterBar from './bookings/BookingsFilterBar';
import BookingFormModal from './bookings/BookingFormModal';

const BookingDetailModal = lazy(() => import('./BookingDetailModal'));

export default function BookingsClient() {
  // ── ALL HOOKS — must come before any conditional returns ──────────────────
  const authStatus = useAuth();
  const { properties: allProperties, propertyIds, setPropertyIds, groups, tags, tagAssigns } = usePropertyFilter();
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
  const [payoutTarget, setPayoutTarget] = useState<DisplayBooking | null>(null);
  const [detailTarget, setDetailTarget] = useState<DisplayBooking | null>(null);
  const [statusFilter, setStatusFilter] = useState<DerivedBookingStatus | 'all'>('all');

  const demoFallback = useCallback((f: BookingFilters): DisplayBooking[] => {
    let demo = getDemoBookings().map(fromDemo);
    if (f.search) {
      const q = f.search.toLowerCase();
      demo = demo.filter(
        b => b.guest_name.toLowerCase().includes(q) || b.confirmation_code.toLowerCase().includes(q),
      );
    }
    if (f.dateFrom) demo = demo.filter(b => b.start_date >= f.dateFrom!);
    if (f.dateTo)   demo = demo.filter(b => b.start_date <= f.dateTo!);
    return demo;
  }, []);

  const { bookings, setBookings, loading, isDemo, reload } = useBookingsList({
    filters, propertyIds, demoFallback,
  });

  const { properties, bankAccounts, listings } = useReferenceData({
    authStatus, withProperties: true, withBankAccounts: true, withListings: true,
  });

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

  useEffect(() => {
    if (authStatus === 'authed') {
      // Check-in automático "lazy": al cargar la app, busca reservas confirmadas
      // cuyo check-in ya pasó y no está marcado, las marca y consume créditos
      // del seguro activo. Recarga la lista al terminar si hubo cambios.
      runAutoCheckins().then(res => {
        if (res.processed > 0) reload();
      }).catch(() => { /* silent */ });
    }
  }, [authStatus, reload]);

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
      await reload();
    } catch {
      toast.error('Error inesperado al guardar.');
    }
    setFormLoading(false);
  }, [form, editingId, editingListingId, editingPropertyId, overlapAck, authStatus, properties, reload]);

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

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await deleteBooking(deleteTarget.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Reserva eliminada');
    setDeleteTarget(null);
    await reload();
  }, [deleteTarget, reload]);

  const handleViewDetail = useCallback((b: DisplayBooking) => setDetailTarget(b), []);
  const handlePayout = useCallback((b: DisplayBooking) => setPayoutTarget(b), []);
  const handleDelete = useCallback((b: DisplayBooking) => setDeleteTarget(b), []);

  const columns = useBookingsColumns({
    onView: handleViewDetail,
    onEdit: handleEdit,
    onPayout: handlePayout,
    onDelete: handleDelete,
  });

  // ── Derived values (must be before any early returns) ────────────────────
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

  const { kpis, incompleteCount } = useMemo(
    () => buildBookingKPIs(enrichedBookings),
    [enrichedBookings],
  );

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearch('');
    setStatusFilter('all');
  }, []);

  const handleCloseFormModal = useCallback(() => {
    setShowModal(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }, []);

  // ── EARLY RETURNS (after all hooks) ──────────────────────────────────────
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

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
        <BookingsKPICards kpis={kpis} incompleteCount={incompleteCount} />
      )}

      {/* Filters */}
      <BookingsFilterBar
        search={search}
        setSearch={setSearch}
        applySearch={applySearch}
        filters={filters}
        setFilters={setFilters}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        onClear={handleClearFilters}
      />

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
            onImport={() => { setShowImporter(false); reload(); }}
          />
        )}
      </AnimatePresence>

      {/* ── Nueva / Editar Reserva Modal ────────────────────────────────────── */}
      <BookingFormModal
        open={showModal}
        editingId={editingId}
        form={form}
        formLoading={formLoading}
        formWarning={formWarning}
        authStatus={authStatus}
        properties={properties}
        onChange={handleFormChange}
        onSubmit={handleSubmit}
        onClose={handleCloseFormModal}
      />

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
            onSaved={() => { setPayoutTarget(null); reload(); }}
          />
        )}
      </AnimatePresence>

      {/* ── Detail Modal ─────────────────────────────────────────────────── */}
      <Suspense fallback={null}>
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
      </Suspense>

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
