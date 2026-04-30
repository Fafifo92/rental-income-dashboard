'use client';
/**
 * Flujo de registro de daño cuando el usuario entra desde "Gastos".
 *
 * Paso 1: filtrar por propiedad + buscar reserva (código, huésped); reservas
 *         ordenadas de más reciente a menos reciente.
 * Paso 2: `DamageReportModal` con la reserva y propiedad derivada.
 *
 * Sin reserva no se puede continuar — los daños NO pueden ser huérfanos.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { listBookings } from '@/services/bookings';
import { listListings } from '@/services/listings';
import type { BookingRow, ListingRow, PropertyRow } from '@/types/database';
import DamageReportModal from './DamageReportModal';

interface Props {
  properties: PropertyRow[];
  onClose: () => void;
  onSaved: () => void;
}

export default function DamageFromExpensesFlow({ properties, onClose, onSaved }: Props) {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [filterPropertyId, setFilterPropertyId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [bookingId, setBookingId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    Promise.all([listBookings(), listListings()]).then(([bRes, lRes]) => {
      if (!bRes.error) setBookings(bRes.data ?? []);
      if (!lRes.error) setListings(lRes.data ?? []);
      setLoading(false);
    });
  }, []);

  const listingToPropertyId = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of listings) m.set(l.id, l.property_id);
    return m;
  }, [listings]);

  const propertyById = useMemo(() => {
    const m = new Map<string, PropertyRow>();
    for (const p of properties) m.set(p.id, p);
    return m;
  }, [properties]);

  // Reservas filtradas + ordenadas (más recientes primero por start_date desc)
  const visibleBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings
      .filter(b => {
        if (filterPropertyId) {
          const pid = listingToPropertyId.get(b.listing_id);
          if (pid !== filterPropertyId) return false;
        }
        if (q) {
          const code = (b.confirmation_code ?? '').toLowerCase();
          const guest = (b.guest_name ?? '').toLowerCase();
          if (!code.includes(q) && !guest.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))
      .slice(0, 200);
  }, [bookings, filterPropertyId, search, listingToPropertyId]);

  const selectedBooking = useMemo(
    () => bookings.find(b => b.id === bookingId) ?? null,
    [bookings, bookingId],
  );
  const derivedProperty = useMemo(() => {
    if (!selectedBooking) return null;
    const pid = listingToPropertyId.get(selectedBooking.listing_id);
    return pid ? propertyById.get(pid) ?? null : null;
  }, [selectedBooking, listingToPropertyId, propertyById]);

  if (confirmed && selectedBooking && derivedProperty) {
    return (
      <DamageReportModal
        propertyId={derivedProperty.id}
        propertyName={derivedProperty.name}
        booking={selectedBooking}
        presetItem={null}
        onClose={onClose}
        onSaved={() => { onSaved(); onClose(); }}
      />
    );
  }

  return (
    <motion.div
      {...makeBackdropHandlers(onClose)}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-100 bg-rose-50">
          <h3 className="text-lg font-bold text-rose-800">⚠ Registrar daño</h3>
          <p className="text-xs text-rose-700 mt-0.5">
            Todo daño está atado a una reserva. Filtra por propiedad y busca la reserva donde ocurrió.
          </p>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Propiedad</label>
              <select
                value={filterPropertyId}
                onChange={e => { setFilterPropertyId(e.target.value); setBookingId(''); }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-rose-500 outline-none"
              >
                <option value="">— Todas las propiedades —</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Buscar (código o huésped)</label>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="HMXXXXX o nombre…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-slate-600">Reserva *</label>
              <span className="text-[10px] text-slate-400">
                {loading ? 'Cargando…' : `${visibleBookings.length} resultado${visibleBookings.length === 1 ? '' : 's'} (recientes primero)`}
              </span>
            </div>
            <div className="border border-slate-200 rounded-lg max-h-72 overflow-y-auto bg-slate-50">
              {visibleBookings.length === 0 && !loading && (
                <p className="text-xs text-slate-500 p-4 text-center">
                  No hay reservas con esos filtros.
                </p>
              )}
              {visibleBookings.map(b => {
                const pid = listingToPropertyId.get(b.listing_id);
                const propName = pid ? propertyById.get(pid)?.name ?? '—' : '—';
                const isSelected = bookingId === b.id;
                return (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => setBookingId(b.id)}
                    className={`w-full text-left px-3 py-2 border-b border-slate-100 last:border-0 hover:bg-white transition ${
                      isSelected ? 'bg-rose-100/60 border-rose-200' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          <code className="font-mono font-semibold text-slate-800">
                            {b.confirmation_code ?? b.id.slice(0, 8)}
                          </code>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-700 truncate">{b.guest_name ?? 'Huésped'}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {propName} · {b.start_date} → {b.end_date}
                        </div>
                      </div>
                      {isSelected && <span className="text-rose-600 text-sm flex-shrink-0">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedBooking && !derivedProperty && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                No pude derivar la propiedad de esta reserva. Verifica el listing asociado.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            disabled={!selectedBooking || !derivedProperty}
            className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg font-semibold disabled:opacity-50"
            onClick={() => setConfirmed(true)}
          >
            Continuar →
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
