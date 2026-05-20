'use client';
/**
 * /data-issues — "Manejo de errores".
 *
 * Muestra inconsistencias de datos heredadas (que no pueden prevenirse
 * desde la UI normal) y permite repararlas:
 *
 *   1. Gastos status='paid' sin bank_account_id  →  asignar cuenta.
 *   2. Aseos status='paid' sin expense respaldatorio:
 *      a) con paid_date  →  generar el expense faltante (pide cuenta).
 *      b) sin paid_date  →  revertir a status='pending'.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import { listBankAccounts } from '@/services/bankAccounts';
import { listProperties } from '@/services/properties';
import { getBooking } from '@/services/bookings';
import type { BankAccountRow, PropertyRow } from '@/types/database';
import {
  fetchDataIssuesSummary,
  listExpensesPaidWithoutAccount,
  listOrphanPaidCleanings,
  assignBankAccountToExpenses,
  repairOrphanCleaningWithExpense,
  revertCleaningToPending,
  type DataIssuesSummary,
  type OrphanExpense,
  type OrphanCleaning,
} from '@/services/dataIssues';

const BookingDetailModal = lazy(() => import('../BookingDetailModal'));

// Forma mínima que el BookingDetailModal necesita (subset de BookingLite).
interface BookingForModal {
  id: string;
  confirmation_code: string;
  guest_name: string | null;
  start_date: string;
  end_date: string;
  num_nights: number;
  total_revenue: number;
  status: string | null;
  channel: string | null;
  gross_revenue: number | null;
  channel_fees: number | null;
  net_payout: number | null;
  payout_date: string | null;
  listing_id: string | null;
  property_id: string | null;
  notes: string | null;
}

export default function DataIssuesClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DataIssuesSummary | null>(null);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [orphanExpenses, setOrphanExpenses] = useState<OrphanExpense[]>([]);
  const [orphanCleaningsPaid, setOrphanCleaningsPaid] = useState<OrphanCleaning[]>([]);
  const [orphanCleaningsNoDate, setOrphanCleaningsNoDate] = useState<OrphanCleaning[]>([]);

  // Estado del modal de detalle de reserva
  const [viewingBooking, setViewingBooking] = useState<BookingForModal | null>(null);
  const [openingBookingId, setOpeningBookingId] = useState<string | null>(null);

  const openBooking = async (bookingId: string) => {
    setOpeningBookingId(bookingId);
    const res = await getBooking(bookingId);
    setOpeningBookingId(null);
    if (res.error || !res.data) {
      toast.error(res.error ?? 'No se encontró la reserva.');
      return;
    }
    const b = res.data;
    const listing = (b as { listings?: { id: string; property_id: string | null } | null }).listings ?? null;
    setViewingBooking({
      id: b.id,
      confirmation_code: b.confirmation_code ?? '',
      guest_name: b.guest_name ?? null,
      start_date: b.start_date,
      end_date: b.end_date,
      num_nights: b.num_nights ?? 0,
      total_revenue: Number(b.total_revenue ?? 0),
      status: b.status ?? null,
      channel: (b as { channel?: string | null }).channel ?? null,
      gross_revenue: b.gross_revenue !== null && b.gross_revenue !== undefined ? Number(b.gross_revenue) : null,
      channel_fees: b.channel_fees !== null && b.channel_fees !== undefined ? Number(b.channel_fees) : null,
      net_payout: b.net_payout !== null && b.net_payout !== undefined ? Number(b.net_payout) : null,
      payout_date: (b as { payout_date?: string | null }).payout_date ?? null,
      listing_id: b.listing_id ?? null,
      property_id: listing?.property_id ?? null,
      notes: (b as { notes?: string | null }).notes ?? null,
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    const [s, b, e, c, p] = await Promise.all([
      fetchDataIssuesSummary(),
      listBankAccounts(),
      listExpensesPaidWithoutAccount(),
      listOrphanPaidCleanings(),
      listProperties(),
    ]);
    if (s.error) setError(s.error);
    if (b.error) setError(prev => prev ?? b.error);
    if (e.error) setError(prev => prev ?? e.error);
    if (c.error) setError(prev => prev ?? c.error);
    if (p.error) setError(prev => prev ?? p.error);
    setSummary(s.data);
    setBanks((b.data ?? []).filter(x => x.is_active !== false));
    setProperties(p.data ?? []);
    setOrphanExpenses(e.data ?? []);
    setOrphanCleaningsPaid(c.data?.withPaidDate ?? []);
    setOrphanCleaningsNoDate(c.data?.withoutPaidDate ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const allClean = useMemo(() => {
    if (!summary) return false;
    return summary.expenses_paid_without_account_count === 0
      && summary.cleanings_paid_without_expense_count === 0
      && summary.cleanings_paid_without_date_count === 0;
  }, [summary]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-800">🛠️ Manejo de errores</h1>
        <p className="text-sm text-slate-500 max-w-3xl">
          Esta página detecta inconsistencias de datos heredadas que no pueden
          repararse desde la UI normal. Resuélvelas para que tus saldos y
          reportes sean confiables.
        </p>
      </header>

      <SummaryBanner summary={summary} loading={loading} allClean={allClean} />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <SectionExpensesWithoutAccount
        items={orphanExpenses}
        banks={banks}
        onReload={load}
        onOpenBooking={openBooking}
        openingBookingId={openingBookingId}
      />

      <SectionOrphanCleaningsPaid
        items={orphanCleaningsPaid}
        banks={banks}
        onReload={load}
        onOpenBooking={openBooking}
        openingBookingId={openingBookingId}
      />

      <SectionOrphanCleaningsNoDate
        items={orphanCleaningsNoDate}
        onReload={load}
        onOpenBooking={openBooking}
        openingBookingId={openingBookingId}
      />

      {viewingBooking && (
        <Suspense fallback={null}>
          <BookingDetailModal
            booking={viewingBooking}
            properties={properties}
            bankAccounts={banks}
            onClose={() => setViewingBooking(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SummaryBanner({
  summary, loading, allClean,
}: { summary: DataIssuesSummary | null; loading: boolean; allClean: boolean }) {
  if (loading || !summary) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Cargando diagnóstico…
      </div>
    );
  }
  if (allClean) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-800">
        ✅ ¡Sin inconsistencias detectadas! Todos los gastos pagados están
        atribuidos a una cuenta y todos los aseos pagados tienen su gasto
        contable.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Tile
        label="Gastos pagados sin cuenta"
        count={summary.expenses_paid_without_account_count}
        amount={summary.expenses_paid_without_account_amount}
        tone="rose"
      />
      <Tile
        label="Aseos pagados sin respaldo"
        count={summary.cleanings_paid_without_expense_count}
        tone="amber"
      />
      <Tile
        label="Aseos paid sin fecha"
        count={summary.cleanings_paid_without_date_count}
        tone="amber"
      />
    </div>
  );
}

function Tile({ label, count, amount, tone }: {
  label: string; count: number; amount?: number;
  tone: 'rose' | 'amber';
}) {
  const colors = tone === 'rose'
    ? 'border-rose-200 bg-rose-50/50 text-rose-700'
    : 'border-amber-200 bg-amber-50/50 text-amber-700';
  return (
    <div className={`rounded-xl border p-4 ${colors}`}>
      <div className="text-xs uppercase tracking-wide font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{count}</div>
      {amount != null && amount > 0 && (
        <div className="text-xs mt-0.5 opacity-70">{formatCurrency(amount)}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper compartido: celda clickeable que abre el modal de la reserva.
// ─────────────────────────────────────────────────────────────────────────────
function BookingCell({
  bookingId, code, onOpen, opening,
}: {
  bookingId: string | null;
  code: string | null;
  onOpen: (id: string) => void;
  opening: boolean;
}) {
  if (!bookingId) return <span className="text-slate-400">—</span>;
  const label = code ?? bookingId.slice(0, 8);
  return (
    <button
      type="button"
      onClick={() => onOpen(bookingId)}
      disabled={opening}
      className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
      title="Ver detalles de la reserva"
    >
      {opening ? '…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Gastos pagados sin cuenta
// ─────────────────────────────────────────────────────────────────────────────
function SectionExpensesWithoutAccount({
  items, banks, onReload, onOpenBooking, openingBookingId,
}: {
  items: OrphanExpense[];
  banks: BankAccountRow[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBank, setBulkBank] = useState<string>('');
  const [working, setWorking] = useState(false);

  if (items.length === 0) return null;

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(items.map(i => i.id)));
  const clear = () => setSelected(new Set());

  const groupIds = Array.from(new Set(items.map(i => i.expense_group_id).filter(Boolean) as string[]));

  const selectGroup = (gid: string) => {
    setSelected(new Set(items.filter(i => i.expense_group_id === gid).map(i => i.id)));
  };

  const applyBulk = async () => {
    if (selected.size === 0) { toast.error('No has seleccionado nada.'); return; }
    if (!bulkBank) { toast.error('Selecciona la cuenta a asignar.'); return; }
    setWorking(true);
    const res = await assignBankAccountToExpenses(Array.from(selected), bulkBank);
    setWorking(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`${res.data} gasto(s) actualizados.`);
    clear();
    await onReload();
  };

  const total = items.filter(i => selected.has(i.id)).reduce((acc, i) => acc + i.amount, 0);

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          1. Gastos pagados sin cuenta bancaria
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Estos gastos figuran como pagados pero no sabemos de qué cuenta salió la
          plata. Selecciona uno o varios (o un grupo de liquidación completo) y
          asigna la cuenta correcta.
        </p>
      </header>

      <div className="px-5 py-3 bg-slate-50/60 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={selectAll} className="text-blue-600 hover:underline font-medium">Seleccionar todos</button>
        <span className="text-slate-300">·</span>
        <button onClick={clear} className="text-slate-600 hover:underline">Limpiar selección</button>
        {groupIds.length > 0 && (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">Por grupo de liquidación:</span>
            {groupIds.map(gid => (
              <button
                key={gid}
                onClick={() => selectGroup(gid)}
                className="px-2 py-0.5 rounded border border-slate-200 bg-white hover:border-blue-300 hover:text-blue-700 font-mono"
                title={gid}
              >
                {gid.slice(0, 8)}…
              </button>
            ))}
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 w-10"></th>
              <th className="px-3 py-2 text-left" title="Fecha registrada en el gasto (paid_date cuando aplica)">Fecha gasto</th>
              <th className="px-3 py-2 text-left" title="Para gastos de aseo: fecha en que se realizó el turno (done_date)">Fecha aseo</th>
              <th className="px-3 py-2 text-left">Reserva</th>
              <th className="px-3 py-2 text-left">Propiedad</th>
              <th className="px-3 py-2 text-left">Concepto</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-left">Grupo</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(i.id)}
                    onChange={() => toggle(i.id)}
                  />
                </td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatDateDisplay(i.date)}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                  {i.cleaning_done_date
                    ? formatDateDisplay(i.cleaning_done_date)
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <BookingCell
                    bookingId={i.booking_id}
                    code={i.confirmation_code}
                    onOpen={onOpenBooking}
                    opening={openingBookingId === i.booking_id}
                  />
                </td>
                <td className="px-3 py-2 text-slate-700">{i.property_name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600 max-w-md truncate" title={i.description ?? ''}>
                  <span className="font-medium text-slate-800">{i.category}</span>
                  {i.vendor && <span className="text-slate-400"> · {i.vendor}</span>}
                  {i.description && <span className="block text-xs text-slate-400 truncate">{i.description}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(i.amount)}</td>
                <td className="px-3 py-2 text-xs font-mono text-slate-400">
                  {i.expense_group_id ? i.expense_group_id.slice(0, 8) + '…' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="px-5 py-4 border-t border-slate-100 bg-slate-50/40 flex flex-wrap items-end gap-3">
        <div className="grow min-w-[200px]">
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Asignar a cuenta <span className="text-rose-500">*</span>
          </label>
          <select
            value={bulkBank}
            onChange={e => setBulkBank(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
          >
            <option value="">— Selecciona cuenta —</option>
            {banks.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.bank ? ` — ${b.bank}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs text-slate-600 self-center">
          <div>Seleccionados: <span className="font-semibold">{selected.size}</span></div>
          <div>Total: <span className="font-semibold tabular-nums">{formatCurrency(total)}</span></div>
        </div>
        <button
          onClick={applyBulk}
          disabled={working || selected.size === 0 || !bulkBank}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {working ? 'Aplicando…' : `Asignar a ${selected.size || 0}`}
        </button>
      </footer>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2a) Aseos paid CON paid_date pero SIN expense → crear expense
// ─────────────────────────────────────────────────────────────────────────────
function SectionOrphanCleaningsPaid({
  items, banks, onReload, onOpenBooking, openingBookingId,
}: {
  items: OrphanCleaning[];
  banks: BankAccountRow[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [bankByRow, setBankByRow] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const repair = async (id: string) => {
    const bid = bankByRow[id] ?? '';
    if (!bid) { toast.error('Selecciona la cuenta de salida.'); return; }
    setWorkingId(id);
    const res = await repairOrphanCleaningWithExpense(id, bid);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Gasto faltante creado.');
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          2. Aseos pagados sin gasto contable
          <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Estos aseos quedaron marcados como pagados pero nunca se les creó el
          gasto respaldatorio. Indica la cuenta de salida para generar el
          expense que falta.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Fecha pago</th>
              <th className="px-3 py-2 text-left">Propiedad</th>
              <th className="px-3 py-2 text-left">Reserva</th>
              <th className="px-3 py-2 text-left">Aseador</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-left">Cuenta</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => {
              const total = i.fee + (i.reimburse_to_cleaner ? i.supplies_amount : 0);
              return (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{i.paid_date ? formatDateDisplay(i.paid_date) : '—'}</td>
                  <td className="px-3 py-2">{i.property_name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <BookingCell
                      bookingId={i.booking_id}
                      code={i.confirmation_code}
                      onOpen={onOpenBooking}
                      opening={openingBookingId === i.booking_id}
                    />
                  </td>
                  <td className="px-3 py-2">{i.cleaner_name ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total)}</td>
                  <td className="px-3 py-2">
                    <select
                      value={bankByRow[i.id] ?? ''}
                      onChange={e => setBankByRow(prev => ({ ...prev, [i.id]: e.target.value }))}
                      className="px-2 py-1.5 text-xs border rounded bg-white min-w-[140px]"
                    >
                      <option value="">— Cuenta —</option>
                      {banks.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}{b.bank ? ` — ${b.bank}` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => repair(i.id)}
                      disabled={workingId === i.id || !bankByRow[i.id]}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {workingId === i.id ? '…' : 'Crear gasto'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b) Aseos paid SIN paid_date → revertir a pending
// ─────────────────────────────────────────────────────────────────────────────
function SectionOrphanCleaningsNoDate({
  items, onReload, onOpenBooking, openingBookingId,
}: {
  items: OrphanCleaning[];
  onReload: () => Promise<void>;
  onOpenBooking: (id: string) => void;
  openingBookingId: string | null;
}) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);

  if (items.length === 0) return null;

  const revertOne = async (id: string) => {
    setWorkingId(id);
    const res = await revertCleaningToPending(id);
    setWorkingId(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Aseo revertido a pendiente.');
    await onReload();
  };

  const revertAll = async () => {
    if (!confirm(`¿Revertir los ${items.length} aseos a estado pendiente?`)) return;
    setBulkWorking(true);
    let okCount = 0;
    for (const i of items) {
      const res = await revertCleaningToPending(i.id);
      if (!res.error) okCount++;
    }
    setBulkWorking(false);
    toast.success(`${okCount} aseo(s) revertidos a pendiente.`);
    await onReload();
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            3. Aseos &ldquo;pagados&rdquo; sin fecha de pago
            <span className="ml-2 text-sm font-normal text-slate-500">({items.length})</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Estos aseos están marcados como pagados pero no tienen ni fecha de
            pago ni gasto contable. Lo más sano es revertirlos a pendiente
            para que entren en una próxima liquidación normal desde /aseo.
          </p>
        </div>
        <button
          onClick={revertAll}
          disabled={bulkWorking}
          className="shrink-0 px-3 py-2 bg-slate-700 text-white rounded text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {bulkWorking ? 'Revirtiendo…' : 'Revertir todos'}
        </button>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Propiedad</th>
              <th className="px-3 py-2 text-left">Reserva</th>
              <th className="px-3 py-2 text-left">Aseador</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => {
              const total = i.fee + (i.reimburse_to_cleaner ? i.supplies_amount : 0);
              return (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{i.property_name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <BookingCell
                      bookingId={i.booking_id}
                      code={i.confirmation_code}
                      onOpen={onOpenBooking}
                      opening={openingBookingId === i.booking_id}
                    />
                  </td>
                  <td className="px-3 py-2">{i.cleaner_name ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => revertOne(i.id)}
                      disabled={workingId === i.id || bulkWorking}
                      className="px-3 py-1.5 bg-slate-700 text-white rounded text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                    >
                      {workingId === i.id ? '…' : 'Revertir'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
