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
  listOverlappingBookings,
  listBookingsWithoutPayoutAccount,
  listInconsistentPayouts,
  listInvalidExpenses,
  listPaidCleaningsWithoutCleaner,
  listDoneCleaningsWithoutDate,
  listInvalidBookingDates,
  listDuplicateConfirmationCodes,
  assignBankAccountToExpenses,
  repairOrphanCleaningWithExpense,
  revertCleaningToPending,
  type DataIssuesSummary,
  type OrphanExpense,
  type OrphanCleaning,
  type OverlapPair,
  type BookingOrphanIncome,
  type InconsistentPayout,
  type InvalidExpense,
  type CleaningWithoutCleaner,
  type CleaningDoneWithoutDate,
  type InvalidBookingDates,
  type DuplicateCodeGroup,
} from '@/services/dataIssues';
import {
  SectionOverlaps,
  SectionOrphanIncomes,
  SectionInconsistentPayouts,
  SectionInvalidExpenses,
  SectionPaidCleaningsNoCleaner,
  SectionDoneCleaningsNoDate,
  SectionInvalidBookingDates,
  SectionDuplicateCodes,
} from './SectionsV2';

const BookingDetailModal = lazy(() => import('../BookingDetailModal'));

type TabKey = 'resumen' | 'reservas' | 'aseos' | 'gastos';

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
  const [overlaps, setOverlaps] = useState<OverlapPair[]>([]);
  const [orphanIncomes, setOrphanIncomes] = useState<BookingOrphanIncome[]>([]);
  const [inconsistentPayouts, setInconsistentPayouts] = useState<InconsistentPayout[]>([]);
  const [invalidExpenses, setInvalidExpenses] = useState<InvalidExpense[]>([]);
  const [paidCleaningsNoCleaner, setPaidCleaningsNoCleaner] = useState<CleaningWithoutCleaner[]>([]);
  const [doneCleaningsNoDate, setDoneCleaningsNoDate] = useState<CleaningDoneWithoutDate[]>([]);
  const [invalidBookingDates, setInvalidBookingDates] = useState<InvalidBookingDates[]>([]);
  const [duplicateCodes, setDuplicateCodes] = useState<DuplicateCodeGroup[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('resumen');

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
    const [s, b, e, c, p, ov, oi, ip, ie, pcnc, dcnd, ibd, dc] = await Promise.all([
      fetchDataIssuesSummary(),
      listBankAccounts(),
      listExpensesPaidWithoutAccount(),
      listOrphanPaidCleanings(),
      listProperties(),
      listOverlappingBookings(),
      listBookingsWithoutPayoutAccount(),
      listInconsistentPayouts(),
      listInvalidExpenses(),
      listPaidCleaningsWithoutCleaner(),
      listDoneCleaningsWithoutDate(),
      listInvalidBookingDates(),
      listDuplicateConfirmationCodes(),
    ]);
    const firstErr = [s, b, e, c, p, ov, oi, ip, ie, pcnc, dcnd, ibd, dc].find(r => r.error)?.error;
    if (firstErr) setError(firstErr);
    setSummary(s.data);
    setBanks((b.data ?? []).filter(x => x.is_active !== false));
    setProperties(p.data ?? []);
    setOrphanExpenses(e.data ?? []);
    setOrphanCleaningsPaid(c.data?.withPaidDate ?? []);
    setOrphanCleaningsNoDate(c.data?.withoutPaidDate ?? []);
    setOverlaps(ov.data ?? []);
    setOrphanIncomes(oi.data ?? []);
    setInconsistentPayouts(ip.data ?? []);
    setInvalidExpenses(ie.data ?? []);
    setPaidCleaningsNoCleaner(pcnc.data ?? []);
    setDoneCleaningsNoDate(dcnd.data ?? []);
    setInvalidBookingDates(ibd.data ?? []);
    setDuplicateCodes(dc.data ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // Overrides all count fields with the actual lengths of the loaded arrays so
  // that the badge, the summary banner, and the Resumen tab all agree — even
  // when the RPC rpc_data_issues_summary_v2 uses a different algorithm
  // (e.g. groups overlaps by listing_id instead of property_id).
  const effectiveSummary = useMemo((): DataIssuesSummary | null => {
    if (!summary) return null;
    return {
      ...summary,
      overlapping_bookings_count: overlaps.length,
      bookings_without_payout_account_count: orphanIncomes.length,
      inconsistent_payouts_count: inconsistentPayouts.length,
      invalid_booking_dates_count: invalidBookingDates.length,
      duplicate_codes_count: duplicateCodes.length,
      cleanings_paid_without_expense_count: orphanCleaningsPaid.length,
      cleanings_paid_without_date_count: orphanCleaningsNoDate.length,
      paid_cleanings_without_cleaner_count: paidCleaningsNoCleaner.length,
      done_cleanings_without_date_count: doneCleaningsNoDate.length,
      expenses_paid_without_account_count: orphanExpenses.length,
      invalid_expenses_count: invalidExpenses.length,
    };
  }, [
    summary, overlaps, orphanIncomes, inconsistentPayouts, invalidBookingDates,
    duplicateCodes, orphanCleaningsPaid, orphanCleaningsNoDate, paidCleaningsNoCleaner,
    doneCleaningsNoDate, orphanExpenses, invalidExpenses,
  ]);

  const allClean = useMemo(() => {
    if (!effectiveSummary) return false;
    return effectiveSummary.expenses_paid_without_account_count === 0
      && effectiveSummary.cleanings_paid_without_expense_count === 0
      && effectiveSummary.cleanings_paid_without_date_count === 0
      && effectiveSummary.overlapping_bookings_count === 0
      && effectiveSummary.bookings_without_payout_account_count === 0
      && effectiveSummary.inconsistent_payouts_count === 0
      && effectiveSummary.invalid_expenses_count === 0
      && effectiveSummary.paid_cleanings_without_cleaner_count === 0
      && effectiveSummary.done_cleanings_without_date_count === 0
      && effectiveSummary.invalid_booking_dates_count === 0
      && effectiveSummary.duplicate_codes_count === 0;
  }, [effectiveSummary]);

  const counts = {
    reservas: (effectiveSummary?.overlapping_bookings_count ?? 0)
      + (effectiveSummary?.bookings_without_payout_account_count ?? 0)
      + (effectiveSummary?.inconsistent_payouts_count ?? 0)
      + (effectiveSummary?.invalid_booking_dates_count ?? 0)
      + (effectiveSummary?.duplicate_codes_count ?? 0),
    aseos: (effectiveSummary?.cleanings_paid_without_expense_count ?? 0)
      + (effectiveSummary?.cleanings_paid_without_date_count ?? 0)
      + (effectiveSummary?.paid_cleanings_without_cleaner_count ?? 0)
      + (effectiveSummary?.done_cleanings_without_date_count ?? 0),
    gastos: (effectiveSummary?.expenses_paid_without_account_count ?? 0)
      + (effectiveSummary?.invalid_expenses_count ?? 0),
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">🛠️ Manejo de errores</h1>
        <p className="text-sm text-slate-500 max-w-3xl">
          Esta página detecta inconsistencias de datos que no pueden repararse
          desde la UI normal (reservas duplicadas, gastos sin cuenta,
          aseos huérfanos, etc.). Resuélvelas para que tus saldos y reportes
          sean confiables.
        </p>
      </header>

      <SummaryBanner summary={effectiveSummary} loading={loading} allClean={allClean} />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <TabsBar
        active={activeTab}
        onChange={setActiveTab}
        counts={counts}
      />

      {activeTab === 'resumen' && (
        <ResumenTab summary={effectiveSummary} loading={loading} onJump={setActiveTab} />
      )}

      {activeTab === 'reservas' && (
        <div className="space-y-6">
          <SectionOverlaps
            items={overlaps}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
          <SectionOrphanIncomes
            items={orphanIncomes}
            banks={banks}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
          <SectionInconsistentPayouts
            items={inconsistentPayouts}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
          <SectionInvalidBookingDates
            items={invalidBookingDates}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
          <SectionDuplicateCodes
            items={duplicateCodes}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
        </div>
      )}

      {activeTab === 'aseos' && (
        <div className="space-y-6">
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
          <SectionPaidCleaningsNoCleaner
            items={paidCleaningsNoCleaner}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
          <SectionDoneCleaningsNoDate
            items={doneCleaningsNoDate}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
        </div>
      )}

      {activeTab === 'gastos' && (
        <div className="space-y-6">
          <SectionExpensesWithoutAccount
            items={orphanExpenses}
            banks={banks}
            onReload={load}
            onOpenBooking={openBooking}
            openingBookingId={openingBookingId}
          />
          <SectionInvalidExpenses
            items={invalidExpenses}
            onReload={load}
          />
        </div>
      )}

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

function TabsBar({
  active, onChange, counts,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  counts: { reservas: number; aseos: number; gastos: number };
}) {
  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'resumen', label: 'Resumen' },
    { key: 'reservas', label: 'Reservas', count: counts.reservas },
    { key: 'aseos', label: 'Aseos', count: counts.aseos },
    { key: 'gastos', label: 'Gastos', count: counts.gastos },
  ];
  return (
    <div className="border-b border-slate-200 flex flex-wrap gap-1">
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              isActive
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && t.count > 0 && (
              <span className={`ml-2 px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
                isActive ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ResumenTab({
  summary, loading, onJump,
}: {
  summary: DataIssuesSummary | null;
  loading: boolean;
  onJump: (t: TabKey) => void;
}) {
  if (loading || !summary) {
    return <div className="text-sm text-slate-500">Cargando…</div>;
  }
  const cards: Array<{ tab: TabKey; title: string; rows: Array<{ label: string; count: number }> }> = [
    {
      tab: 'reservas',
      title: 'Reservas',
      rows: [
        { label: 'Solapadas', count: summary.overlapping_bookings_count },
        { label: 'Sin cuenta de pago', count: summary.bookings_without_payout_account_count },
        { label: 'Pagos parciales', count: summary.inconsistent_payouts_count },
        { label: 'Fechas inválidas', count: summary.invalid_booking_dates_count },
        { label: 'Códigos duplicados', count: summary.duplicate_codes_count },
      ],
    },
    {
      tab: 'aseos',
      title: 'Aseos',
      rows: [
        { label: 'Pagados sin gasto', count: summary.cleanings_paid_without_expense_count },
        { label: 'Pagados sin fecha', count: summary.cleanings_paid_without_date_count },
        { label: 'Pagados sin aseador', count: summary.paid_cleanings_without_cleaner_count },
        { label: 'Realizados sin fecha', count: summary.done_cleanings_without_date_count },
      ],
    },
    {
      tab: 'gastos',
      title: 'Gastos',
      rows: [
        { label: 'Pagados sin cuenta', count: summary.expenses_paid_without_account_count },
        { label: 'Monto inválido (≤ 0)', count: summary.invalid_expenses_count },
      ],
    },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map(c => {
        const total = c.rows.reduce((acc, r) => acc + r.count, 0);
        return (
          <button
            key={c.tab}
            type="button"
            onClick={() => onJump(c.tab)}
            className={`text-left rounded-xl border p-4 transition hover:shadow-sm ${
              total === 0
                ? 'border-emerald-200 bg-emerald-50/40'
                : 'border-rose-200 bg-rose-50/30 hover:border-rose-300'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-slate-700">{c.title}</h3>
              <span className={`text-xl font-bold ${total === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {total}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {c.rows.map(r => (
                <li key={r.label} className="flex justify-between">
                  <span>{r.label}</span>
                  <span className={r.count > 0 ? 'font-semibold text-rose-700' : 'text-slate-400'}>{r.count}</span>
                </li>
              ))}
            </ul>
          </button>
        );
      })}
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
        Sin inconsistencias detectadas. Reservas, aseos y gastos están limpios.
      </div>
    );
  }
  const totalReservas = summary.overlapping_bookings_count
    + summary.bookings_without_payout_account_count
    + summary.inconsistent_payouts_count
    + summary.invalid_booking_dates_count
    + summary.duplicate_codes_count;
  const totalAseos = summary.cleanings_paid_without_expense_count
    + summary.cleanings_paid_without_date_count
    + summary.paid_cleanings_without_cleaner_count
    + summary.done_cleanings_without_date_count;
  const totalGastos = summary.expenses_paid_without_account_count
    + summary.invalid_expenses_count;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Tile label="Reservas con problemas" count={totalReservas} tone={totalReservas > 0 ? 'rose' : 'emerald'} />
      <Tile label="Aseos con problemas" count={totalAseos} tone={totalAseos > 0 ? 'amber' : 'emerald'} />
      <Tile
        label="Gastos con problemas"
        count={totalGastos}
        amount={summary.expenses_paid_without_account_amount}
        tone={totalGastos > 0 ? 'rose' : 'emerald'}
      />
    </div>
  );
}

function Tile({ label, count, amount, tone }: {
  label: string; count: number; amount?: number;
  tone: 'rose' | 'amber' | 'emerald';
}) {
  const colors = tone === 'rose'
    ? 'border-rose-200 bg-rose-50/50 text-rose-700'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50/50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50/50 text-emerald-700';
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
        <table className="min-w-[760px] sm:min-w-full text-sm">
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
        <table className="min-w-[760px] sm:min-w-full text-sm">
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
        <table className="min-w-[760px] sm:min-w-full text-sm">
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
