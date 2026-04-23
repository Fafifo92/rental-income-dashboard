import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listExpenses, createExpense, deleteExpense, updateExpense } from '@/services/expenses';
import {
  listBookingAdjustments, createBookingAdjustment, deleteBookingAdjustment, netAdjustment,
} from '@/services/bookingAdjustments';
import type { Expense } from '@/types';
import type {
  PropertyRow, BankAccountRow, BookingAdjustmentRow, BookingAdjustmentKind,
} from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import ExpenseModal from './ExpenseModal';

interface BookingLite {
  id: string;
  confirmation_code: string;
  guest_name: string;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string;
  channel?: string | null;
  gross_revenue?: number | null;
  channel_fees?: number | null;
  net_payout?: number | null;
  payout_date?: string | null;
  listing_id?: string | null;
  notes?: string | null;
}

interface Props {
  booking: BookingLite;
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  /** Resuelve property_id a partir de listing_id (BookingsClient se lo pasa). */
  resolvePropertyId?: (listingId: string | null | undefined) => string | null;
}

export default function BookingDetailModal({
  booking, properties, bankAccounts, onClose, resolvePropertyId,
}: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showLinkExisting, setShowLinkExisting] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bloque C — ajustes
  const [adjustments, setAdjustments] = useState<BookingAdjustmentRow[]>([]);
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [deletingAdjId, setDeletingAdjId] = useState<string | null>(null);

  const propertyId = resolvePropertyId?.(booking.listing_id) ?? null;
  const property = propertyId ? properties.find(p => p.id === propertyId) : null;

  const load = useCallback(async () => {
    setLoading(true);
    const [resE, resA] = await Promise.all([
      listExpenses(undefined, {
        bookingId: booking.id,
        includeRecurring: false,
        includeChannelFees: false,
      }),
      listBookingAdjustments(booking.id),
    ]);
    if (!resE.error) setExpenses(resE.data);
    if (!resA.error) setAdjustments(resA.data);
    setLoading(false);
  }, [booking.id]);

  useEffect(() => { load(); }, [load]);

  // ESC cierra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netAdj = netAdjustment(adjustments);
  const gross = Number(booking.gross_revenue ?? booking.total_revenue ?? 0);
  const fees = Number(booking.channel_fees ?? 0);
  const netPayout = booking.net_payout !== null && booking.net_payout !== undefined
    ? Number(booking.net_payout)
    : gross - fees;
  const realProfit = netPayout + netAdj - totalExpenses;

  const handleSaveExpense = useCallback(async (data: Omit<Expense, 'id' | 'owner_id'>) => {
    const res = await createExpense({ ...data, booking_id: booking.id });
    if (res.error) { setSaveError(res.error); return; }
    setSaveError(undefined);
    setShowAddExpense(false);
    await load();
  }, [booking.id, load]);

  const handleLinkExisting = useCallback(async (expenseId: string) => {
    const res = await updateExpense(expenseId, { booking_id: booking.id });
    if (!res.error) {
      setShowLinkExisting(false);
      await load();
    }
  }, [booking.id, load]);

  const handleUnlinkExpense = useCallback(async (id: string) => {
    const res = await updateExpense(id, { booking_id: null });
    if (!res.error) { setDeletingId(null); await load(); }
  }, [load]);

  const handleDeleteExpense = useCallback(async (id: string) => {
    if (id.startsWith('rec-') || id.startsWith('fee-')) return;
    const res = await deleteExpense(id);
    if (!res.error) {
      setDeletingId(null);
      await load();
    }
  }, [load]);

  const handleDeleteAdjustment = useCallback(async (id: string) => {
    const res = await deleteBookingAdjustment(id);
    if (!res.error) { setDeletingAdjId(null); await load(); }
  }, [load]);

  const handleCreateAdjustment = useCallback(async (
    payload: {
      kind: BookingAdjustmentKind; amount: number; description: string | null; date: string;
      createPendingExpense?: boolean; pendingCategory?: string;
    },
  ) => {
    const { createPendingExpense, pendingCategory, ...adjPayload } = payload;
    const res = await createBookingAdjustment({ ...adjPayload, booking_id: booking.id });
    if (res.error || !res.data) return;

    // Cobro por daño → auto-crear gasto pendiente de reparación vinculado a la reserva
    // Y VINCULADO AL AJUSTE vía adjustment_id (FK robusta, no convención textual).
    // Permite "descartar ambos" atómicamente más adelante.
    if (payload.kind === 'damage_charge' && createPendingExpense && propertyId) {
      await createExpense({
        property_id: propertyId,
        category: pendingCategory || 'Reparación daño',
        type: 'variable',
        amount: payload.amount,
        date: payload.date,
        description: payload.description
          ? `[Daño reserva ${booking.confirmation_code}] ${payload.description}`
          : `[Daño reserva ${booking.confirmation_code}] Reparación pendiente`,
        status: 'pending',
        bank_account_id: null,
        vendor: null,
        person_in_charge: null,
        booking_id: booking.id,
        adjustment_id: res.data.id,
      });
    }
    setShowAddAdjustment(false);
    await load();
  }, [booking.id, booking.confirmation_code, propertyId, load]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-7 py-5 bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest opacity-80">Reserva</p>
              <h2 className="text-2xl font-bold mt-0.5">{booking.guest_name || 'Sin nombre'}</h2>
              <p className="text-xs opacity-90 mt-1 font-mono">
                #{booking.confirmation_code} · {booking.channel?.toUpperCase() ?? 'AIRBNB'}
              </p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white p-1">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1">
            {/* Datos principales */}
            <div className="px-7 py-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-b border-slate-100">
              <InfoRow label="Check-in" value={booking.start_date} />
              <InfoRow label="Check-out" value={booking.end_date} />
              <InfoRow label="Noches" value={String(booking.num_nights)} />
              <InfoRow label="Estado" value={booking.status} />
              <InfoRow label="Propiedad" value={property?.name ?? '—'} />
              <InfoRow label="Payout real" value={booking.payout_date ?? 'Pendiente'} />
            </div>

            {/* Resumen financiero */}
            <div className="px-7 py-5 bg-slate-50 border-b border-slate-100">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
                Ganancia real de la estadía
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Metric label="Bruto" value={gross} tone="slate" />
                <Metric label="Fees canal" value={-fees} tone="rose" />
                <Metric label="Ajustes" value={netAdj} tone={netAdj >= 0 ? 'emerald' : 'rose'} />
                <Metric label="Gastos vinculados" value={-totalExpenses} tone="amber" />
                <Metric label="Ganancia real" value={realProfit} tone={realProfit >= 0 ? 'emerald' : 'rose'} bold />
              </div>
              <p className="text-xs text-slate-500 mt-3">
                <strong>Ganancia real</strong> = payout neto + ajustes (ingresos extra / cargos por daño − descuentos) − gastos atribuibles.
                No incluye gastos fijos de la propiedad.
              </p>
            </div>

            {/* Notas */}
            {booking.notes && (
              <div className="px-7 py-4 border-b border-slate-100">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Notas</p>
                <p className="text-sm text-slate-700 whitespace-pre-line">{booking.notes}</p>
              </div>
            )}

            {/* Gastos vinculados */}
            <div className="px-7 py-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Gastos vinculados a esta reserva</h3>
                  <p className="text-xs text-slate-500">Daños, reparaciones, amenities extra, etc.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLinkExisting(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition"
                  >
                    🔗 Vincular existente
                  </button>
                  <button
                    onClick={() => setShowAddExpense(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Nuevo gasto
                  </button>
                </div>
              </div>

              {loading ? (
                <p className="text-sm text-slate-400 text-center py-4">Cargando…</p>
              ) : expenses.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  Sin gastos vinculados todavía.
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                        <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                        <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
                        <th className="px-3 py-2 text-right font-semibold">Monto</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map(e => (
                        <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{e.date}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{e.category}</div>
                            {e.description && <div className="text-xs text-slate-500">{e.description}</div>}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{e.vendor ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-rose-600 tabular-nums whitespace-nowrap">
                            {formatCurrency(Number(e.amount))}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {deletingId === e.id ? (
                              <span className="inline-flex gap-2 text-xs">
                                <span className="text-slate-500">¿Desvincular?</span>
                                <button onClick={() => handleUnlinkExpense(e.id)} className="text-blue-600 hover:underline font-semibold">Sí</button>
                                <button onClick={() => setDeletingId(null)} className="text-slate-500 hover:underline">No</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setDeletingId(e.id)}
                                className="text-slate-400 hover:text-blue-600 p-1"
                                title="Desvincular de esta reserva"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-rose-700 tabular-nums">{formatCurrency(totalExpenses)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Ajustes de reserva (Bloque C) */}
            <div className="px-7 py-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Ajustes de reserva</h3>
                  <p className="text-xs text-slate-500">Ingresos extra, descuentos y cargos por daño al huésped.</p>
                </div>
                <button
                  onClick={() => setShowAddAdjustment(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Nuevo ajuste
                </button>
              </div>

              {adjustments.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  Sin ajustes registrados.
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                        <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                        <th className="px-3 py-2 text-left font-semibold">Descripción</th>
                        <th className="px-3 py-2 text-right font-semibold">Impacto</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map(a => {
                        const sign = a.kind === 'discount' ? -1 : 1;
                        const impact = sign * Number(a.amount);
                        return (
                          <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                            <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{a.date}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ADJ_KIND_STYLE[a.kind]}`}>
                                {ADJ_KIND_LABEL[a.kind]}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-700">{a.description ?? '—'}</td>
                            <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${impact >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {impact >= 0 ? '+' : ''}{formatCurrency(impact)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {deletingAdjId === a.id ? (
                                <span className="inline-flex gap-2 text-xs">
                                  <span className="text-slate-500">¿Eliminar?</span>
                                  <button onClick={() => handleDeleteAdjustment(a.id)} className="text-red-600 hover:underline font-semibold">Sí</button>
                                  <button onClick={() => setDeletingAdjId(null)} className="text-slate-500 hover:underline">No</button>
                                </span>
                              ) : (
                                <button onClick={() => setDeletingAdjId(a.id)} className="text-slate-400 hover:text-red-600 p-1" title="Eliminar ajuste">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
                                  </svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Neto</td>
                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${netAdj >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {netAdj >= 0 ? '+' : ''}{formatCurrency(netAdj)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-7 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cerrar</button>
          </div>
        </motion.div>

        {/* Modal para agregar gasto — pre-llena booking_id + property_id */}
        <AnimatePresence>
          {showAddExpense && (
            <ExpenseModal
              properties={properties}
              bankAccounts={bankAccounts}
              onClose={() => { setShowAddExpense(false); setSaveError(undefined); }}
              onSave={handleSaveExpense}
              error={saveError}
              prefill={{
                booking_id: booking.id,
                property_id: propertyId,
                category: 'Mantenimiento',
                type: 'variable',
                date: booking.end_date || new Date().toISOString().split('T')[0],
              }}
            />
          )}
        </AnimatePresence>

        {/* Link existing expense picker */}
        <AnimatePresence>
          {showLinkExisting && (
            <LinkExistingExpenseModal
              propertyId={propertyId}
              onClose={() => setShowLinkExisting(false)}
              onLink={handleLinkExisting}
            />
          )}
        </AnimatePresence>

        {/* Add adjustment modal */}
        <AnimatePresence>
          {showAddAdjustment && (
            <AdjustmentFormModal
              defaultDate={booking.end_date || new Date().toISOString().split('T')[0]}
              onClose={() => setShowAddAdjustment(false)}
              onSave={handleCreateAdjustment}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

const ADJ_KIND_LABEL: Record<BookingAdjustmentKind, string> = {
  extra_income:  'Ingreso extra',
  discount:      'Descuento',
  damage_charge: 'Cobro por daño',
};
const ADJ_KIND_STYLE: Record<BookingAdjustmentKind, string> = {
  extra_income:  'bg-emerald-100 text-emerald-700',
  discount:      'bg-rose-100 text-rose-700',
  damage_charge: 'bg-amber-100 text-amber-700',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

function Metric({
  label, value, tone, bold,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'rose' | 'amber';
  bold?: boolean;
}) {
  const toneClass = {
    slate:   'text-slate-800',
    emerald: 'text-emerald-700',
    rose:    'text-rose-700',
    amber:   'text-amber-700',
  }[tone];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`mt-0.5 tabular-nums ${toneClass} ${bold ? 'text-lg font-bold' : 'font-semibold'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

// ─── Sub-modal: Vincular gasto existente ──────────────────────────────
function LinkExistingExpenseModal({
  propertyId, onClose, onLink,
}: {
  propertyId: string | null;
  onClose: () => void;
  onLink: (expenseId: string) => void;
}) {
  const [candidates, setCandidates] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Carga gastos reales SIN booking asignado (prioriza la propiedad)
    listExpenses(propertyId ?? undefined, {
      includeRecurring: false,
      includeChannelFees: false,
    }).then(res => {
      if (!res.error) {
        setCandidates(res.data.filter(e => !e.booking_id && !e.id.startsWith('rec-') && !e.id.startsWith('fee-')));
      }
      setLoading(false);
    });
  }, [propertyId]);

  const q = search.toLowerCase().trim();
  const filtered = q
    ? candidates.filter(e =>
        e.category.toLowerCase().includes(q)
        || e.description?.toLowerCase().includes(q)
        || e.vendor?.toLowerCase().includes(q)
        || e.date.includes(q),
      )
    : candidates;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">Vincular gasto existente</h3>
          <p className="text-xs text-slate-500 mt-0.5">Solo se muestran gastos reales sin reserva asignada {propertyId ? '(de esta propiedad)' : ''}.</p>
          <input
            type="text"
            placeholder="Buscar por categoría, proveedor, fecha…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mt-3 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No hay gastos disponibles para vincular.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map(e => (
                <li key={e.id}>
                  <button
                    onClick={() => onLink(e.id)}
                    className="w-full text-left px-3 py-3 hover:bg-blue-50 rounded-lg transition flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate">{e.category}</span>
                        {e.vendor && <span className="text-xs text-slate-500 truncate">· {e.vendor}</span>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {e.date}{e.description ? ` — ${e.description}` : ''}
                      </div>
                    </div>
                    <span className="font-semibold text-rose-600 tabular-nums whitespace-nowrap">
                      {formatCurrency(Number(e.amount))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Sub-modal: Crear ajuste de reserva ──────────────────────────────
function AdjustmentFormModal({
  defaultDate, onClose, onSave,
}: {
  defaultDate: string;
  onClose: () => void;
  onSave: (p: {
    kind: BookingAdjustmentKind; amount: number; description: string | null; date: string;
    createPendingExpense?: boolean; pendingCategory?: string;
  }) => void;
}) {
  const [kind, setKind] = useState<BookingAdjustmentKind>('extra_income');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [createPendingExpense, setCreatePendingExpense] = useState(true);
  const [pendingCategory, setPendingCategory] = useState('Reparación daño');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    setSaving(true);
    await onSave({
      kind, amount: n, description: description.trim() || null, date,
      createPendingExpense: kind === 'damage_charge' ? createPendingExpense : false,
      pendingCategory: kind === 'damage_charge' ? pendingCategory : undefined,
    });
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">Nuevo ajuste</h3>
          <p className="text-xs text-slate-500 mt-0.5">Registra ingresos extra, descuentos o cargos por daño al huésped.</p>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo *</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value as BookingAdjustmentKind)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="extra_income">Ingreso extra (suma)</option>
              <option value="discount">Descuento al huésped (resta)</option>
              <option value="damage_charge">Cobro por daño (suma)</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {kind === 'extra_income'  && 'Ej: huésped paga persona adicional, late check-out, mascota.'}
              {kind === 'discount'      && 'Ej: compensación al huésped por problema durante la estadía.'}
              {kind === 'damage_charge' && 'Ej: cobro al huésped por daño al inventario. El gasto de reparar se registra aparte.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Monto *</label>
              <input
                type="number" step="1000" required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha *</label>
              <input
                type="date" required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: 2 personas adicionales, se dañó espejo baño…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          {kind === 'damage_charge' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createPendingExpense}
                  onChange={e => setCreatePendingExpense(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    Crear gasto pendiente de reparación
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Se registrará un gasto <span className="font-mono bg-amber-100 px-1 rounded">pending</span> vinculado
                    a esta reserva por el mismo monto. Cuando compres/repares, editas el monto real y lo marcas como pagado.
                    Esto permite calcular el neto real del daño: <span className="italic">cobro − costo real</span>.
                  </p>
                </div>
              </label>
              {createPendingExpense && (
                <div className="pl-6">
                  <label className="block text-xs font-medium text-amber-900 mb-1">Categoría del gasto</label>
                  <select
                    value={pendingCategory}
                    onChange={e => setPendingCategory(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-md bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    <option value="Reparación daño">Reparación daño</option>
                    <option value="Mantenimiento">Mantenimiento</option>
                    <option value="Reposición inventario">Reposición inventario</option>
                    <option value="Limpieza especial">Limpieza especial</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving || !amount}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
