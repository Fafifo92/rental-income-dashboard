import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ExpensesList from './ExpensesList';
import ExpenseModal from './ExpenseModal';
import ExpenseDetailModal from './ExpenseDetailModal';
import BookingDetailModal from './BookingDetailModal';
import FilterBar from './FilterBar';
import PropertyMultiSelect from '@/components/PropertyMultiSelect';
import RecurringPendingPanel from './RecurringPendingPanel';
import SharedBillsPendingPanel from './SharedBillsPendingPanel';
import {
  listExpenses,
  createExpense,
  createSharedExpense,
  updateExpense,
  deleteExpense,
  type ExpenseFilters,
} from '@/services/expenses';
import { listBankAccounts } from '@/services/bankAccounts';
import { listListings } from '@/services/listings';
import { deleteBookingAdjustment } from '@/services/bookingAdjustments';
import { supabase } from '@/lib/supabase/client';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import type { Expense } from '@/types';
import type { BankAccountRow, BookingRow, ListingRow, ExpenseSection, ExpenseSubcategory } from '@/types/database';
import { EXPENSE_SUBCATEGORY_META } from '@/types/database';
import { classifyExpense } from '@/lib/expenseClassify';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';

// Shown while Supabase isn't connected yet
const dispatchRecurringChange = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('recurring-period-changed'));
  }
};

const DEMO_EXPENSES: Expense[] = [
  { id: '1', property_id: 'demo', category: 'Limpieza', type: 'variable', amount: 150000, date: '2024-03-01', description: 'Limpieza post-huésped', status: 'paid' },
  { id: '2', property_id: 'demo', category: 'Internet', type: 'fixed', amount: 89000, date: '2024-03-05', description: null, status: 'paid' },
  { id: '3', property_id: 'demo', category: 'Servicios Públicos', type: 'fixed', amount: 320000, date: '2024-03-10', description: 'Agua y luz', status: 'pending' },
  { id: '4', property_id: 'demo', category: 'Mantenimiento', type: 'variable', amount: 450000, date: '2024-03-12', description: 'Reparación de grifo', status: 'partial' },
  { id: '5', property_id: 'demo', category: 'Lavandería', type: 'variable', amount: 80000, date: '2024-03-15', description: null, status: 'paid' },
  { id: '6', property_id: 'demo', category: 'Administración', type: 'fixed', amount: 200000, date: '2024-03-20', description: 'Comisión plataforma', status: 'pending' },
];

const EMPTY_FILTERS: ExpenseFilters = {};

export default function ExpensesClient() {
  const authStatus = useAuth();
  const { properties, propertyIds, setPropertyIds } = usePropertyFilter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_FILTERS);
  const [saveError, setSaveError] = useState('');
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [viewingBooking, setViewingBooking] = useState<BookingRow | null>(null);
  const [tab, setTab] = useState<'all' | ExpenseSection | 'others'>('all');
  const [subFilter, setSubFilter] = useState<ExpenseSubcategory | null>(null);

  const loadExpenses = useCallback(async (f: ExpenseFilters, propIds?: string[]) => {
    setLoading(true);
    const result = await listExpenses(propIds, f);
    if (result.error) {
      let demo = DEMO_EXPENSES;
      if (f.category) demo = demo.filter(e => e.category === f.category);
      if (f.type) demo = demo.filter(e => e.type === f.type);
      if (f.status) demo = demo.filter(e => e.status === f.status);
      if (f.dateFrom) demo = demo.filter(e => e.date >= f.dateFrom!);
      if (f.dateTo) demo = demo.filter(e => e.date <= f.dateTo!);
      if (f.search) {
        const q = f.search.toLowerCase();
        demo = demo.filter(e => e.category.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q));
      }
      setExpenses(demo);
      setDbConnected(false);
    } else {
      setExpenses(result.data ?? []);
      setDbConnected(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadExpenses(filters, propertyIds); }, [filters, propertyIds, loadExpenses]);

  useEffect(() => {
    if (authStatus === 'authed') {
      listBankAccounts().then(res => {
        if (!res.error) setBankAccounts((res.data ?? []).filter(a => a.is_active));
      });
      listListings().then(res => { if (!res.error) setListings(res.data ?? []); });
    }
  }, [authStatus]);

  const handleViewBooking = useCallback(async (bookingId: string) => {
    const { data, error } = await supabase.from('bookings').select('*').eq('id', bookingId).single();
    if (!error && data) {
      setViewing(null);
      setViewingBooking(data as BookingRow);
    }
  }, []);

  // ── Clasificación Fase 16: sección + subcategoría (antes de cualquier early return) ──
  const classified = useMemo(
    () => expenses.map(e => ({ exp: e, ...classifyExpense(e) })),
    [expenses],
  );

  const visibleExpenses = useMemo(() => {
    if (tab === 'all') return expenses;
    if (tab === 'others') {
      // Fees de canal y cualquier gasto sin sección clasificable
      return classified
        .filter(c => c.exp.id.startsWith('fee-') || c.section === null)
        .map(c => c.exp);
    }
    return classified
      .filter(c => !c.exp.id.startsWith('fee-') && c.section === tab && (subFilter ? c.subcategory === subFilter : true))
      .map(c => c.exp);
  }, [tab, subFilter, expenses, classified]);

  // Auth guard (after all hooks)
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  const handleSave = async (data: Omit<Expense, 'id' | 'owner_id'>) => {
    setSaveError('');
    if (editing) {
      // EDITAR
      if (dbConnected) {
        const result = await updateExpense(editing.id, data);
        if (result.error || !result.data) { setSaveError(result.error ?? 'Error'); return; }
        setExpenses(prev => prev.map(e => e.id === editing.id ? result.data! : e));
      } else {
        setExpenses(prev => prev.map(e => e.id === editing.id ? { ...e, ...data } : e));
      }
      setEditing(null);
      setShowModal(false);
      return;
    }
    // CREAR
    if (dbConnected) {
      const result = await createExpense(data);
      if (result.error || !result.data) { setSaveError(result.error ?? 'Error'); return; }
      setExpenses(prev => [result.data!, ...prev]);
    } else {
      setExpenses(prev => [{ ...data, id: crypto.randomUUID() }, ...prev]);
    }
    setShowModal(false);
    dispatchRecurringChange();
  };

  /** Bloque 6: gasto compartido entre N propiedades. */
  const handleSaveShared = async (rows: Omit<Expense, 'id' | 'owner_id'>[]) => {
    setSaveError('');
    if (dbConnected) {
      const result = await createSharedExpense(rows);
      if (result.error || !result.data) { setSaveError(result.error ?? 'Error'); return; }
      setExpenses(prev => [...result.data!.expenses, ...prev]);
    } else {
      const groupId = crypto.randomUUID();
      const synthesized: Expense[] = rows.map(r => ({
        ...r,
        id: crypto.randomUUID(),
        expense_group_id: groupId,
      }));
      setExpenses(prev => [...synthesized, ...prev]);
    }
    setShowModal(false);
    dispatchRecurringChange();
  };

  const handleEdit = (expense: Expense) => {
    setViewing(null);
    setEditing(expense);
    setShowModal(true);
  };

  // Descarta un gasto pendiente JUNTO con su ajuste de reserva vinculado (si aplica).
  // Pensado para "Cobro por daño" cuando el usuario decide no proceder con la reparación.
  // No usa deleteTarget para evitar UX ambigua — muestra su propio flow dentro del ExpenseModal.
  const handleDiscardWithAdjustment = async (expense: Expense) => {
    setSaveError('');
    if (expense.adjustment_id) {
      const resAdj = await deleteBookingAdjustment(expense.adjustment_id);
      if (resAdj.error) { setSaveError(`No se pudo eliminar el ajuste: ${resAdj.error}`); return; }
    }
    if (dbConnected) {
      const res = await deleteExpense(expense.id);
      if (res.error) { setSaveError(res.error); return; }
    }
    setExpenses(prev => prev.filter(e => e.id !== expense.id));
    setEditing(null);
    setShowModal(false);
  };

  const handleDeleteRequest = (id: string) => {
    const target = expenses.find(e => e.id === id);
    if (target) setDeleteTarget(target);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (dbConnected) {
      const result = await deleteExpense(deleteTarget.id);
      if (result.error) return;
    }
    setExpenses(prev => prev.filter(e => e.id !== deleteTarget.id));
    setDeleteTarget(null);
    dispatchRecurringChange();
  };

  const totalFixed = expenses.filter(e => e.type === 'fixed').reduce((s, e) => s + e.amount, 0);
  const totalVariable = expenses.filter(e => e.type === 'variable').reduce((s, e) => s + e.amount, 0);
  const pendingExpenses = expenses.filter(e => e.status === 'pending');
  const totalPending = pendingExpenses.reduce((s, e) => s + e.amount, 0);

  // ── Clasificación Fase 16: sección + subcategoría ──
  // (classified y visibleExpenses ya calculados arriba antes del auth guard)

  // Detecta fees de canal por id legacy 'fee-…'. Estos quedan fuera del scope
  // property/booking — se muestran solo en "Todos" como info.
  const isFee = (e: Expense) => e.id.startsWith('fee-');

  const tabCounts = {
    all: expenses.length,
    property: classified.filter(c => !isFee(c.exp) && c.section === 'property').length,
    booking:  classified.filter(c => !isFee(c.exp) && c.section === 'booking').length,
    others:   classified.filter(c => isFee(c.exp) || c.section === null).length,
  };

  const subCountsBySection = (sec: ExpenseSection) => {
    const counts: Partial<Record<ExpenseSubcategory, number>> = {};
    for (const c of classified) {
      if (isFee(c.exp) || c.section !== sec || !c.subcategory) continue;
      counts[c.subcategory] = (counts[c.subcategory] ?? 0) + 1;
    }
    return counts;
  };

  const visibleTotal = visibleExpenses.reduce((s, e) => s + e.amount, 0);

  const kpis = [
    { label: 'Gastos Fijos', value: formatCurrency(totalFixed), color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Gastos Variables', value: formatCurrency(totalVariable), color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Pendiente de Pago', value: formatCurrency(totalPending), color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <>
      <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between"
        >
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Gastos</h2>
              {!dbConnected && (
                <span className="text-xs font-semibold px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                  Modo demo
                </span>
              )}
            </div>
            <p className="text-slate-500 mt-1">Control de gastos fijos y variables por propiedad.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <PropertyMultiSelect properties={properties} value={propertyIds} onChange={setPropertyIds} />
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              + Registrar Gasto
            </motion.button>
          </div>
        </motion.div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="p-6 bg-white border rounded-xl shadow-sm"
            >
              <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Facturas compartidas pendientes (vendors con N propiedades) */}
        <SharedBillsPendingPanel
          onChanged={() => {
            loadExpenses(filters, propertyIds);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('recurring-period-changed'));
            }
          }}
        />

        {/* Recurrentes pendientes (fuente única: tabla periods + auto-detección) */}
        <RecurringPendingPanel
          propertyFilter={propertyIds.length === 1 ? propertyIds[0] : null}
          onChanged={() => {
            loadExpenses(filters, propertyIds);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('recurring-period-changed'));
            }
          }}
        />

        {/* Cuentas por Pagar */}
        <AnimatePresence>
          {pendingExpenses.length > 0 && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border border-yellow-200 bg-yellow-50 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-yellow-900 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span> Cuentas por Pagar
                    <span className="text-xs font-semibold px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded-full">
                      {pendingExpenses.length}
                    </span>
                  </h3>
                  <span className="font-bold text-yellow-800">{formatCurrency(totalPending)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pendingExpenses.map((e, i) => (
                    <motion.button
                      key={e.id}
                      type="button"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => handleEdit(e)}
                      title="Clic para completar, pagar o descartar este gasto pendiente"
                      className="bg-white rounded-lg p-4 border border-yellow-100 shadow-sm text-left hover:border-yellow-300 hover:shadow transition focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-slate-800 text-sm truncate">{e.category}</p>
                            {e.adjustment_id && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-red-50 text-red-700 border-red-200 whitespace-nowrap">
                                🔗 DAÑO
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{e.date}</p>
                          {e.description && (
                            <p className="text-xs text-slate-600 mt-1 line-clamp-2">{e.description}</p>
                          )}
                        </div>
                        <p className="font-bold text-yellow-700 text-sm whitespace-nowrap">{formatCurrency(e.amount)}</p>
                      </div>
                      <p className="text-[10px] text-yellow-700/70 mt-2 font-medium uppercase tracking-wide">
                        Clic para resolver →
                      </p>
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Tabs por sección — taxonomía 4+3 */}
        <div>
          <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
            {([
              { key: 'all',      label: 'Todos',                 color: 'text-slate-700', hint: 'Vista consolidada de todos los gastos' },
              { key: 'property', label: 'Sobre propiedades',     color: 'text-blue-700',  hint: 'Operación del inmueble: servicios, admin, mantenimiento, stock' },
              { key: 'booking',  label: 'Sobre reservas',        color: 'text-rose-700',  hint: 'Atribuibles a un huésped: aseo del turn, daños, atenciones' },
              { key: 'others',   label: 'Otros gastos',          color: 'text-slate-700', hint: 'Comisiones de canal (Booking, Airbnb), fees y gastos sin clasificar' },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSubFilter(null); }}
                title={t.hint}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? `${t.color} border-current`
                    : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                {t.label} <span className="ml-1 text-xs text-slate-400">({tabCounts[t.key]})</span>
              </button>
            ))}
          </div>

          {/* Chips de subcategoría dentro de cada sección */}
          {tab !== 'all' && tab !== 'others' && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <button
                onClick={() => setSubFilter(null)}
                className={`px-2.5 py-1 text-xs rounded-full border transition ${
                  subFilter === null
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                Todas
              </button>
              {(Object.entries(EXPENSE_SUBCATEGORY_META) as [ExpenseSubcategory, typeof EXPENSE_SUBCATEGORY_META[ExpenseSubcategory]][])
                .filter(([, meta]) => meta.section === tab)
                .map(([sub, meta]) => {
                  const count = subCountsBySection(tab)[sub] ?? 0;
                  return (
                    <button
                      key={sub}
                      onClick={() => setSubFilter(sub)}
                      title={meta.description}
                      className={`px-2.5 py-1 text-xs rounded-full border transition ${
                        subFilter === sub
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {meta.icon} {meta.label} <span className="opacity-60">({count})</span>
                    </button>
                  );
                })}
            </div>
          )}

          {/* Resumen */}
          <div className="flex items-center justify-between mt-3 px-1 text-sm">
            <p className="text-slate-500">
              {tab === 'all' && 'Mostrando todas las fuentes de gasto combinadas.'}
              {tab === 'property' && 'Operación del inmueble: existen aunque no haya huésped.'}
              {tab === 'booking' && 'Atribuibles a un huésped específico.'}
              {tab === 'others' && 'Comisiones de canal y gastos sin sección (Booking/Airbnb fees, etc.).'}
            </p>
            <p className="font-semibold text-slate-800">
              Total: <span className="text-slate-900">{formatCurrency(visibleTotal)}</span>
            </p>
          </div>
        </div>

        {/* Filters — bajo las pestañas para que el filtro aplique siempre sobre la pestaña activa */}
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(EMPTY_FILTERS)}
          bankAccounts={bankAccounts}
        />

        {/* Table */}
        <ExpensesList
          expenses={visibleExpenses}
          loading={loading}
          onDelete={handleDeleteRequest}
          onEdit={handleEdit}
          onView={setViewing}
        />
      </main>

      <AnimatePresence>
        {showModal && (
          <ExpenseModal
            properties={properties}
            bankAccounts={bankAccounts}
            initial={editing ? {
              category: editing.category,
              type: editing.type,
              amount: editing.amount,
              date: editing.date,
              description: editing.description,
              status: editing.status,
              property_id: editing.property_id,
              bank_account_id: editing.bank_account_id ?? null,
              vendor: editing.vendor ?? null,
              person_in_charge: editing.person_in_charge ?? null,
              booking_id: editing.booking_id ?? null,
              adjustment_id: editing.adjustment_id ?? null,
            } : null}
            onClose={() => { setShowModal(false); setEditing(null); setSaveError(''); }}
            onSave={handleSave}
            onSaveShared={handleSaveShared}
            error={saveError}
            onDiscardLinked={editing?.adjustment_id ? () => handleDiscardWithAdjustment(editing) : undefined}
          />
        )}

        {viewing && (
          <ExpenseDetailModal
            expense={viewing}
            properties={properties}
            bankAccounts={bankAccounts}
            onClose={() => setViewing(null)}
            onEdit={handleEdit}
            onViewBooking={handleViewBooking}
          />
        )}

        {viewingBooking && (
          <BookingDetailModal
            booking={{
              id: viewingBooking.id,
              confirmation_code: viewingBooking.confirmation_code,
              guest_name: viewingBooking.guest_name ?? '—',
              start_date: viewingBooking.start_date,
              end_date: viewingBooking.end_date,
              num_nights: viewingBooking.num_nights,
              total_revenue: Number(viewingBooking.total_revenue),
              status: viewingBooking.status ?? '',
              channel: viewingBooking.channel ?? null,
              gross_revenue: viewingBooking.gross_revenue !== null && viewingBooking.gross_revenue !== undefined ? Number(viewingBooking.gross_revenue) : null,
              channel_fees: viewingBooking.channel_fees !== null && viewingBooking.channel_fees !== undefined ? Number(viewingBooking.channel_fees) : null,
              net_payout: viewingBooking.net_payout !== null && viewingBooking.net_payout !== undefined ? Number(viewingBooking.net_payout) : null,
              payout_date: viewingBooking.payout_date ?? null,
              listing_id: viewingBooking.listing_id ?? null,
              notes: viewingBooking.notes ?? null,
            }}
            properties={properties}
            bankAccounts={bankAccounts}
            onClose={() => setViewingBooking(null)}
            resolvePropertyId={(lid) => {
              if (!lid) return null;
              return listings.find(l => l.id === lid)?.property_id ?? null;
            }}
          />
        )}

        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            {...makeBackdropHandlers(() => setDeleteTarget(null))}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-2">¿Eliminar gasto?</h3>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-800">
                  <span className="font-semibold">{deleteTarget.category}</span> — {formatCurrency(deleteTarget.amount)}
                </p>
                <p className="text-xs text-red-600 mt-1">{deleteTarget.date}{deleteTarget.description ? ` · ${deleteTarget.description}` : ''}</p>
              </div>
              <p className="text-sm text-slate-500 mb-5">Esta acción es irreversible.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

