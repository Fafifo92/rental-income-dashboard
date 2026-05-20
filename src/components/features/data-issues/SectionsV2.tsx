'use client';
/**
 * Secciones V2 de /data-issues — detectores nuevos (A–H sin contar los 3
 * originales que viven en DataIssuesClient.tsx).
 *
 * Estas secciones se renderizan condicionalmente desde DataIssuesClient
 * según el tab activo. Cada una incluye su propio "ExplainerCard" interno
 * para que el usuario entienda qué es el error y cómo se origina.
 */
import { useState } from 'react';
import { toast } from '@/lib/toast';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import type { BankAccountRow } from '@/types/database';
import {
  cancelBooking,
  deleteBookingCascade,
  assignBookingPayoutAccount,
  clearBookingPayout,
  setBookingPayoutDate,
  setCleaningDoneDate,
  deleteExpenseById,
  revertCleaningToPending,
  ignoreDataIssue,
  type OverlapPair,
  type BookingOrphanIncome,
  type InconsistentPayout,
  type InvalidExpense,
  type CleaningWithoutCleaner,
  type CleaningDoneWithoutDate,
  type InvalidBookingDates,
  type DuplicateCodeGroup,
} from '@/services/dataIssues';

// ─── Helpers compartidos ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? '').toLowerCase();
  let cls = 'bg-slate-100 text-slate-600';
  if (s.includes('cancel')) cls = 'bg-rose-100 text-rose-700';
  else if (s.includes('complet') || s.includes('paid')) cls = 'bg-emerald-100 text-emerald-700';
  else if (s.includes('pend')) cls = 'bg-amber-100 text-amber-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status ?? '—'}
    </span>
  );
}

interface BookingMini {
  id: string;
  confirmation_code: string | null;
  guest_name: string | null;
  start_date: string;
  end_date: string;
  num_nights: number | null;
  status: string | null;
  channel: string | null;
  net_payout: number | null;
}

function BookingMiniCard({
  booking, onOpen, opening,
}: {
  booking: BookingMini;
  onOpen: (id: string) => void;
  opening: boolean;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40 text-sm space-y-1">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(booking.id)}
          disabled={opening}
          className="font-mono text-xs text-blue-600 hover:underline disabled:opacity-50"
          title="Ver detalles"
        >
          {opening ? '…' : (booking.confirmation_code ?? booking.id.slice(0, 8))}
        </button>
        <StatusBadge status={booking.status} />
      </div>
      <div className="text-slate-700 font-medium truncate" title={booking.guest_name ?? ''}>
        {booking.guest_name ?? '—'}
      </div>
      <div className="text-xs text-slate-500">
        {formatDateDisplay(booking.start_date)} → {formatDateDisplay(booking.end_date)}
        <span className="ml-1 text-slate-400">({booking.num_nights ?? 0}n)</span>
      </div>
      <div className="text-xs text-slate-500 flex justify-between">
        <span>{booking.channel ?? '—'}</span>
        <span className="tabular-nums">{formatCurrency(Number(booking.net_payout ?? 0))}</span>
      </div>
    </div>
  );
}

function ExplainerCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 leading-relaxed">
      {children}
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
      {message}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// A) Reservas solapadas
// ════════════════════════════════════════════════════════════════════════════
export function SectionOverlaps({
  items, onReload, onOpenBooking, openingBookingId,
}: {
  items: OverlapPair[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [workingId, setWorkingId] = useState<string | null>(null);

  const doCancel = async (id: string) => {
    if (!confirm('¿Marcar esta reserva como cancelada?')) return;
    setWorkingId(id);
    const res = await cancelBooking(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Reserva cancelada.');
    await onReload();
  };

  const doDelete = async (id: string, code: string | null) => {
    const label = code ?? id.slice(0, 8);
    if (!confirm(`Vas a BORRAR la reserva ${label} y todas sus dependencias (aseos, gastos, pagos, depósitos). ¿Confirmar?`)) return;
    setWorkingId(id);
    const res = await deleteBookingCascade(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`Reserva ${label} borrada (aseos ${res.data!.cleanings_deleted}, gastos ${res.data!.expenses_deleted}).`);
    await onReload();
  };

  const doIgnore = async (key: string) => {
    const note = prompt('Nota opcional (por qué no es un duplicado):') ?? undefined;
    const res = await ignoreDataIssue('overlap_booking', key, note);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Par marcado como "no es duplicado".');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Reservas solapadas
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Dos o más reservas activas que comparten una misma propiedad en fechas
          que se cruzan. Suelen ser duplicados de canal (la misma reserva
          importada dos veces). Si es un duplicado, cancela o borra una. Si
          son reservas legítimas (ej. una llegó tarde el día de salida),
          márcalo como &ldquo;no es duplicado&rdquo;.
        </p>
      </header>
      <div className="p-5 space-y-4">
        {items.length === 0 && <EmptySection message="Sin solapamientos detectados." />}
        {items.map(pair => (
          <div key={pair.ignore_key} className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{pair.property_name ?? '—'}</span>
              <button
                onClick={() => doIgnore(pair.ignore_key)}
                className="text-slate-500 hover:text-slate-800 hover:underline"
              >
                No es duplicado
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[pair.a, pair.b].map(b => (
                <div key={b.id} className="space-y-2">
                  <BookingMiniCard
                    booking={b}
                    onOpen={onOpenBooking}
                    opening={openingBookingId === b.id}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => doCancel(b.id)}
                      disabled={workingId === b.id}
                      className="flex-1 px-2 py-1.5 text-xs font-semibold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => doDelete(b.id, b.confirmation_code)}
                      disabled={workingId === b.id}
                      className="flex-1 px-2 py-1.5 text-xs font-semibold rounded bg-rose-100 text-rose-800 hover:bg-rose-200 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// B) Ingresos huérfanos (booking con net_payout > 0 sin cuenta)
// ════════════════════════════════════════════════════════════════════════════
export function SectionOrphanIncomes({
  items, banks, onReload, onOpenBooking, openingBookingId,
}: {
  items: BookingOrphanIncome[];
  banks: BankAccountRow[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [bankByRow, setBankByRow] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  const assignOne = async (id: string) => {
    const bid = bankByRow[id];
    if (!bid) { toast.error('Selecciona la cuenta.'); return; }
    setWorkingId(id);
    const res = await assignBookingPayoutAccount(id, bid);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Cuenta asignada.');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Ingresos sin cuenta bancaria
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Reservas con <span className="font-mono">net_payout &gt; 0</span> que
          no tienen cuenta de depósito asignada. La plata entró pero no
          sabemos a qué cuenta. Selecciona la cuenta destino para cada una.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="p-5"><EmptySection message="Todos los ingresos cobrados tienen cuenta asignada." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Reserva</th>
                <th className="px-3 py-2 text-left">Huésped</th>
                <th className="px-3 py-2 text-left">Propiedad</th>
                <th className="px-3 py-2 text-left">Fechas</th>
                <th className="px-3 py-2 text-left">Fecha pago</th>
                <th className="px-3 py-2 text-right">Net payout</th>
                <th className="px-3 py-2 text-left">Cuenta</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(b => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenBooking(b.id)}
                      disabled={openingBookingId === b.id}
                      className="font-mono text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {openingBookingId === b.id ? '…' : (b.confirmation_code ?? b.id.slice(0, 8))}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-700 truncate max-w-[160px]" title={b.guest_name ?? ''}>{b.guest_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{b.property_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {formatDateDisplay(b.start_date)} → {formatDateDisplay(b.end_date)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {b.payout_date ? formatDateDisplay(b.payout_date) : <span className="text-slate-300">sin fecha</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(b.net_payout ?? 0))}</td>
                  <td className="px-3 py-2">
                    <select
                      value={bankByRow[b.id] ?? ''}
                      onChange={e => setBankByRow(prev => ({ ...prev, [b.id]: e.target.value }))}
                      className="px-2 py-1.5 text-xs border rounded bg-white min-w-[140px]"
                    >
                      <option value="">— Cuenta —</option>
                      {banks.map(ba => (
                        <option key={ba.id} value={ba.id}>
                          {ba.name}{ba.bank ? ` — ${ba.bank}` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => assignOne(b.id)}
                      disabled={workingId === b.id || !bankByRow[b.id]}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {workingId === b.id ? '…' : 'Asignar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// C) Pagos parciales (solo fecha o solo cuenta)
// ════════════════════════════════════════════════════════════════════════════
export function SectionInconsistentPayouts({
  items, onReload, onOpenBooking, openingBookingId,
}: {
  items: InconsistentPayout[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [dateByRow, setDateByRow] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  const completeDate = async (id: string) => {
    const d = dateByRow[id];
    if (!d) { toast.error('Selecciona la fecha.'); return; }
    setWorkingId(id);
    const res = await setBookingPayoutDate(id, d);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Fecha de pago asignada.');
    await onReload();
  };

  const clearPayout = async (id: string) => {
    if (!confirm('¿Limpiar el payout completo (cuenta y fecha)? Vuelve a quedar como no cobrado.')) return;
    setWorkingId(id);
    const res = await clearBookingPayout(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Payout limpiado.');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Pagos parciales
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Estos bookings tienen cuenta pero no fecha, o viceversa. Para que el
          ingreso sea contable necesitamos ambos campos. Completa el dato
          faltante o limpia el payout entero.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="p-5"><EmptySection message="Sin pagos parciales." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Reserva</th>
                <th className="px-3 py-2 text-left">Propiedad</th>
                <th className="px-3 py-2 text-left">Falta</th>
                <th className="px-3 py-2 text-right">Net payout</th>
                <th className="px-3 py-2 text-left">Acción</th>
              </tr>
            </thead>
            <tbody>
              {items.map(b => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenBooking(b.id)}
                      disabled={openingBookingId === b.id}
                      className="font-mono text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {openingBookingId === b.id ? '…' : (b.confirmation_code ?? b.id.slice(0, 8))}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{b.property_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold">
                      {b.missing === 'date' ? 'Fecha' : 'Cuenta'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(b.net_payout ?? 0))}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 items-center flex-wrap">
                      {b.missing === 'date' && (
                        <>
                          <input
                            type="date"
                            value={dateByRow[b.id] ?? ''}
                            onChange={e => setDateByRow(prev => ({ ...prev, [b.id]: e.target.value }))}
                            className="px-2 py-1 text-xs border rounded"
                          />
                          <button
                            onClick={() => completeDate(b.id)}
                            disabled={workingId === b.id || !dateByRow[b.id]}
                            className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Completar
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => clearPayout(b.id)}
                        disabled={workingId === b.id}
                        className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-xs font-semibold hover:bg-slate-300 disabled:opacity-50"
                      >
                        Limpiar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// D) Gastos con monto inválido
// ════════════════════════════════════════════════════════════════════════════
export function SectionInvalidExpenses({
  items, onReload,
}: {
  items: InvalidExpense[];
  onReload: () => Promise<void>;
}) {
  const [workingId, setWorkingId] = useState<string | null>(null);

  const doDelete = async (id: string) => {
    if (!confirm('¿Borrar este gasto?')) return;
    setWorkingId(id);
    const res = await deleteExpenseById(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Gasto borrado.');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Gastos con monto inválido
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Gastos con monto cero o negativo (basura de imports antiguos). Bórralos.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="p-5"><EmptySection message="Sin gastos con monto inválido." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Categoría</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateDisplay(i.date)}</td>
                  <td className="px-3 py-2 text-slate-700">{i.category}{i.subcategory ? ` · ${i.subcategory}` : ''}</td>
                  <td className="px-3 py-2 text-slate-600 truncate max-w-md" title={i.description ?? ''}>{i.description ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-700">{formatCurrency(i.amount)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{i.status}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => doDelete(i.id)}
                      disabled={workingId === i.id}
                      className="px-3 py-1.5 bg-rose-100 text-rose-800 rounded text-xs font-semibold hover:bg-rose-200 disabled:opacity-50"
                    >
                      {workingId === i.id ? '…' : 'Borrar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// E) Aseos paid sin cleaner
// ════════════════════════════════════════════════════════════════════════════
export function SectionPaidCleaningsNoCleaner({
  items, onReload, onOpenBooking, openingBookingId,
}: {
  items: CleaningWithoutCleaner[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [workingId, setWorkingId] = useState<string | null>(null);

  const revert = async (id: string) => {
    if (!confirm('¿Revertir este aseo a pendiente?')) return;
    setWorkingId(id);
    const res = await revertCleaningToPending(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Aseo revertido a pendiente.');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Aseos pagados sin aseador
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Aseos marcados como pagados pero sin persona asignada. No se puede
          generar gasto contable sin un cleaner. Lo más sano es revertirlos a
          pendiente y volver a procesarlos desde /aseo.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="p-5"><EmptySection message="Sin aseos pagados sin aseador." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Fecha pago</th>
                <th className="px-3 py-2 text-left">Fecha aseo</th>
                <th className="px-3 py-2 text-left">Propiedad</th>
                <th className="px-3 py-2 text-left">Reserva</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">{i.paid_date ? formatDateDisplay(i.paid_date) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">{i.done_date ? formatDateDisplay(i.done_date) : '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{i.property_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenBooking(i.booking_id)}
                      disabled={openingBookingId === i.booking_id}
                      className="font-mono text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {openingBookingId === i.booking_id ? '…' : (i.confirmation_code ?? i.booking_id.slice(0, 8))}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(i.fee)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => revert(i.id)}
                      disabled={workingId === i.id}
                      className="px-3 py-1.5 bg-slate-700 text-white rounded text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                    >
                      {workingId === i.id ? '…' : 'Revertir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// F) Aseos done sin done_date
// ════════════════════════════════════════════════════════════════════════════
export function SectionDoneCleaningsNoDate({
  items, onReload, onOpenBooking, openingBookingId,
}: {
  items: CleaningDoneWithoutDate[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [dateByRow, setDateByRow] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  const setDate = async (id: string) => {
    const d = dateByRow[id];
    if (!d) { toast.error('Selecciona la fecha.'); return; }
    setWorkingId(id);
    const res = await setCleaningDoneDate(id, d);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Fecha de aseo asignada.');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Aseos realizados sin fecha
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Aseos en estado &ldquo;done&rdquo; pero sin fecha real de realización.
          Indícala (usualmente coincide con la salida del huésped).
        </p>
      </header>
      {items.length === 0 ? (
        <div className="p-5"><EmptySection message="Sin aseos realizados sin fecha." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Propiedad</th>
                <th className="px-3 py-2 text-left">Reserva</th>
                <th className="px-3 py-2 text-left">Salida</th>
                <th className="px-3 py-2 text-left">Aseador</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2 text-left">Fecha aseo</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{i.property_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenBooking(i.booking_id)}
                      disabled={openingBookingId === i.booking_id}
                      className="font-mono text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {openingBookingId === i.booking_id ? '…' : (i.confirmation_code ?? i.booking_id.slice(0, 8))}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{i.booking_end_date ? formatDateDisplay(i.booking_end_date) : '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{i.cleaner_name ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(i.fee)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={dateByRow[i.id] ?? (i.booking_end_date ?? '')}
                      onChange={e => setDateByRow(prev => ({ ...prev, [i.id]: e.target.value }))}
                      className="px-2 py-1 text-xs border rounded"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setDate(i.id)}
                      disabled={workingId === i.id}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {workingId === i.id ? '…' : 'Asignar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// G) Fechas de reserva inválidas
// ════════════════════════════════════════════════════════════════════════════
export function SectionInvalidBookingDates({
  items, onOpenBooking, openingBookingId,
}: {
  items: InvalidBookingDates[];
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Reservas con fechas inválidas
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Reservas con <span className="font-mono">end_date ≤ start_date</span>
          o <span className="font-mono">num_nights ≤ 0</span>. Probablemente
          imports rotos. Abre cada una y corrige las fechas (o cancélala si no
          aplica).
        </p>
      </header>
      {items.length === 0 ? (
        <div className="p-5"><EmptySection message="Sin reservas con fechas inválidas." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Reserva</th>
                <th className="px-3 py-2 text-left">Propiedad</th>
                <th className="px-3 py-2 text-left">Huésped</th>
                <th className="px-3 py-2 text-left">Start</th>
                <th className="px-3 py-2 text-left">End</th>
                <th className="px-3 py-2 text-right">Noches</th>
                <th className="px-3 py-2 text-left">Problema</th>
              </tr>
            </thead>
            <tbody>
              {items.map(b => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenBooking(b.id)}
                      disabled={openingBookingId === b.id}
                      className="font-mono text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {openingBookingId === b.id ? '…' : (b.confirmation_code ?? b.id.slice(0, 8))}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{b.property_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700 truncate max-w-[160px]" title={b.guest_name ?? ''}>{b.guest_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDateDisplay(b.start_date)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDateDisplay(b.end_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.num_nights ?? 0}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs font-semibold">
                      {b.reason === 'end_le_start' ? 'end ≤ start' : 'noches inválidas'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// H) Códigos de confirmación duplicados
// ════════════════════════════════════════════════════════════════════════════
export function SectionDuplicateCodes({
  items, onReload, onOpenBooking, openingBookingId,
}: {
  items: DuplicateCodeGroup[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [workingId, setWorkingId] = useState<string | null>(null);

  const doCancel = async (id: string) => {
    if (!confirm('¿Marcar esta reserva como cancelada?')) return;
    setWorkingId(id);
    const res = await cancelBooking(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Reserva cancelada.');
    await onReload();
  };

  const doDelete = async (id: string, code: string | null) => {
    const label = code ?? id.slice(0, 8);
    if (!confirm(`Vas a BORRAR la reserva ${label} y todas sus dependencias. ¿Confirmar?`)) return;
    setWorkingId(id);
    const res = await deleteBookingCascade(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`Reserva ${label} borrada.`);
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          Códigos de confirmación duplicados
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Dos o más reservas comparten el mismo código en el mismo canal.
          Suele ser la misma reserva importada dos veces. Cancela o borra
          las copias sobrantes.
        </p>
      </header>
      <div className="p-5 space-y-4">
        {items.length === 0 && <EmptySection message="Sin códigos duplicados." />}
        {items.map(group => (
          <div key={`${group.confirmation_code}_${group.channel ?? ''}`} className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="text-xs text-slate-500">
              Código <span className="font-mono font-semibold text-slate-800">{group.confirmation_code}</span>
              {group.channel && <> · canal <span className="font-semibold">{group.channel}</span></>}
              {' '}· {group.bookings.length} copias
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.bookings.map(b => (
                <div key={b.id} className="space-y-2">
                  <BookingMiniCard
                    booking={b}
                    onOpen={onOpenBooking}
                    opening={openingBookingId === b.id}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => doCancel(b.id)}
                      disabled={workingId === b.id}
                      className="flex-1 px-2 py-1.5 text-xs font-semibold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => doDelete(b.id, b.confirmation_code)}
                      disabled={workingId === b.id}
                      className="flex-1 px-2 py-1.5 text-xs font-semibold rounded bg-rose-100 text-rose-800 hover:bg-rose-200 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

void ExplainerCard;
