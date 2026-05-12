import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ExpensesList from './ExpensesList';
import DamageExpenseEditModal from './DamageExpenseEditModal';
import ExpenseDetailModal from './ExpenseDetailModal';
import FilterBar from './FilterBar';
import { type ExpenseTypeChoice } from './ExpenseTypeChooser';
import PropertyMultiSelect from '@/components/PropertyMultiSelectFilter';
import ExpensesExportModal from './ExpensesExportModal';

const BookingDetailModal = lazy(() => import('./BookingDetailModal'));
import RecurringPendingPanel from './RecurringPendingPanel';
import SharedBillsPendingPanel from './SharedBillsPendingPanel';
import { toast } from '@/lib/toast';
import {
  createExpense,
  createSharedExpense,
  updateExpense,
  updateExpenseGroup,
  deleteExpense,
  type ExpenseFilters,
} from '@/services/expenses';
import { deleteBookingAdjustment } from '@/services/bookingAdjustments';
import { getUpcomingAndOverdueSchedules, getSchedulesDoneNeedingExpense, completeMaintenanceSchedule } from '@/services/maintenanceSchedules';
import { listInventoryItems } from '@/services/inventory';
import { listProperties } from '@/services/properties';
import { getBooking } from '@/services/bookings';
import type { Expense } from '@/types';
import { type BookingRow, type ExpenseSection, type ExpenseSubcategory, type MaintenanceScheduleRow, type InventoryItemRow } from '@/types/database';
import { useAuth } from '@/lib/useAuth';
import { usePropertyFilter } from '@/lib/usePropertyFilter';
import { useExpensesList } from '@/lib/hooks/useExpensesList';
import { useReferenceData } from '@/lib/hooks/useReferenceData';

import { EMPTY_FILTERS, DEMO_EXPENSES, dispatchRecurringChange } from './expenses/constants';
import { useExpensesDerivedStats } from './expenses/useExpensesDerivedStats';
import MaintenancePanels from './expenses/MaintenancePanels';
import PendingPayablesPanel from './expenses/PendingPayablesPanel';
import ExpensesTabsBar from './expenses/ExpensesTabsBar';
import DeleteExpenseConfirm from './expenses/DeleteExpenseConfirm';
import ExpensesFormsModals from './expenses/ExpensesFormsModals';

export default function ExpensesClient() {
  const authStatus = useAuth();
  const { properties, propertyIds, setPropertyIds, groups, tags, tagAssigns } = usePropertyFilter();
  const [showModal, setShowModal] = useState(false);
  const [showChooser, setShowChooser] = useState(false);
  const [showDamageFlow, setShowDamageFlow] = useState(false);
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [showSuppliesForm, setShowSuppliesForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showInventoryMaintenanceForm, setShowInventoryMaintenanceForm] = useState(false);
  const [invMaintPrefillSchedule, setInvMaintPrefillSchedule] = useState<MaintenanceScheduleRow | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_FILTERS);
  const [saveError, setSaveError] = useState('');
  const [viewingBooking, setViewingBooking] = useState<BookingRow | null>(null);
  const [tab, setTab] = useState<'all' | ExpenseSection | 'others'>('all');
  const [subFilter, setSubFilter] = useState<ExpenseSubcategory | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  // Deep-link: capture ?recurring=<id>&ym=<ym> at mount and clear from URL immediately
  const [deepLinkRecurring] = useState<{ id: string; ym: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('recurring');
    const ym = params.get('ym');
    if (id && ym) {
      const url = new URL(window.location.href);
      url.searchParams.delete('recurring');
      url.searchParams.delete('ym');
      window.history.replaceState({}, '', url.toString());
      return { id, ym };
    }
    return null;
  });

  // Deep-link: capture ?damage_expense=<id> at mount and clear from URL immediately
  const [deepLinkDamageExpenseId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('damage_expense');
    if (id) {
      const url = new URL(window.location.href);
      url.searchParams.delete('damage_expense');
      window.history.replaceState({}, '', url.toString());
      return id;
    }
    return null;
  });

  // Maintenance due panel
  const [maintenanceSchedules, setMaintenanceSchedules] = useState<MaintenanceScheduleRow[]>([]);
  const [doneNeedingExpense, setDoneNeedingExpense] = useState<MaintenanceScheduleRow[]>([]);
  const [inventoryItemsMap, setInventoryItemsMap] = useState<Map<string, InventoryItemRow>>(new Map());
  const [linkedMaintScheduleId, setLinkedMaintScheduleId] = useState<string | null>(null);
  const [unreportedDamageItems, setUnreportedDamageItems] = useState<Array<{ id: string; name: string; propertyName: string }>>([]);

  const demoFallback = useCallback((f: ExpenseFilters): Expense[] => {
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
    return demo;
  }, []);

  const { expenses, setExpenses, loading, dbConnected, reload: reloadExpenses } = useExpensesList({
    filters, propertyIds, demoFallback,
  });

  const { bankAccounts, listings } = useReferenceData({
    authStatus, withBankAccounts: true, withListings: true,
  });

  const vendorSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const PROP_SUBS = new Set(['utilities', 'administration', 'maintenance', 'stock']);
    for (const e of expenses) {
      if (e.vendor?.trim() && e.subcategory && PROP_SUBS.has(e.subcategory)) {
        seen.add(e.vendor.trim());
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, 'es'));
  }, [expenses]);

  const loadMaintenancePanel = useCallback(async () => {
    const [schedRes, doneRes, itemsRes] = await Promise.all([
      getUpcomingAndOverdueSchedules(),
      getSchedulesDoneNeedingExpense(),
      listInventoryItems(),
    ]);
    if (!schedRes.error) setMaintenanceSchedules(schedRes.data);
    if (!doneRes.error) setDoneNeedingExpense(doneRes.data);
    if (!itemsRes.error && itemsRes.data) {
      setInventoryItemsMap(new Map(itemsRes.data.map(it => [it.id, it])));
    }
  }, []);

  useEffect(() => {
    if (authStatus === 'authed') loadMaintenancePanel();
  }, [authStatus, loadMaintenancePanel]);

  // Deep-link: auto-open DamageExpenseEditModal when ?damage_expense=<id> is in URL
  useEffect(() => {
    if (!deepLinkDamageExpenseId || loading) return;
    const expense = expenses.find(e => e.id === deepLinkDamageExpenseId);
    if (expense) {
      setEditing(expense);
      setShowModal(true);
    }
  }, [deepLinkDamageExpenseId, loading, expenses]);

  // Compute unreported damage items (damaged inventory with no linked pending expense)
  useEffect(() => {
    if (authStatus !== 'authed') return;
    Promise.all([
      listInventoryItems({ status: 'damaged' }),
      listProperties(),
    ]).then(([itemsRes, propsRes]) => {
      const damagedItems = itemsRes.data ?? [];
      const propNameMap = new Map((propsRes.data ?? []).map(p => [p.id, p.name]));
      const linkedItemIds = new Set<string>();
      for (const e of expenses) {
        if ((e.subcategory ?? '') === 'damage' && e.status === 'pending' && e.description) {
          const m = e.description.match(/__item:([a-zA-Z0-9-]+)/);
          if (m) linkedItemIds.add(m[1]);
        }
      }
      const unlinked = damagedItems
        .filter(it => !linkedItemIds.has(it.id))
        .map(it => ({ id: it.id, name: it.name, propertyName: propNameMap.get(it.property_id) ?? 'Propiedad' }));
      setUnreportedDamageItems(unlinked);
    });
  }, [authStatus, expenses]);

  const handleViewBooking = useCallback(async (bookingId: string) => {
    const { data, error } = await getBooking(bookingId);
    if (!error && data) {
      setViewing(null);
      setViewingBooking(data as BookingRow);
    }
  }, []);

  // ── Clasificación Fase 16: sección + subcategoría (antes de cualquier early return) ──
  const {
    visibleExpenses,
    expenseStats,
    maintenanceStats,
    tabStats,
    subCountsBySection,
  } = useExpensesDerivedStats({ expenses, tab, subFilter, maintenanceSchedules });

  const onRegisterMaintenance = useCallback((s: MaintenanceScheduleRow) => {
    setInvMaintPrefillSchedule(s);
    setShowInventoryMaintenanceForm(true);
  }, []);

  // Auth guard (after all hooks)
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full" />
      </div>
    );
  }

  const handleSave = async (data: Omit<Expense, 'id' | 'owner_id'>): Promise<boolean> => {
    setSaveError('');
    if (editing) {
      // EDITAR
      if (dbConnected) {
        const result = await updateExpense(editing.id, data);
        if (result.error || !result.data) { setSaveError(result.error ?? 'Error'); toast.error(result.error ?? 'Error al guardar'); return false; }
        setExpenses(prev => prev.map(e => e.id === editing.id ? result.data! : e));
      } else {
        setExpenses(prev => prev.map(e => e.id === editing.id ? { ...e, ...data } : e));
      }
      setEditing(null);
      setShowModal(false);
      toast.success('Gasto actualizado');
      return true;
    }
    // CREAR
    if (dbConnected) {
      const result = await createExpense(data);
      if (result.error || !result.data) { setSaveError(result.error ?? 'Error'); toast.error(result.error ?? 'Error al guardar'); return false; }
      setExpenses(prev => [result.data!, ...prev]);
    } else {
      setExpenses(prev => [{ ...data, id: crypto.randomUUID() }, ...prev]);
    }
    // Complete linked maintenance schedule if applicable
    if (linkedMaintScheduleId) {
      await completeMaintenanceSchedule(linkedMaintScheduleId, { expenseRegistered: true });
      setLinkedMaintScheduleId(null);
      loadMaintenancePanel();
    }
    setShowModal(false);
    dispatchRecurringChange();
    toast.success('Gasto registrado');
    return true;
  };

  /** Bloque 6: gasto compartido entre N propiedades. */
  const handleSaveShared = async (rows: Omit<Expense, 'id' | 'owner_id'>[]): Promise<boolean> => {
    setSaveError('');
    if (dbConnected) {
      const result = await createSharedExpense(rows);
      if (result.error || !result.data) { setSaveError(result.error ?? 'Error'); toast.error(result.error ?? 'Error al guardar'); return false; }
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
    toast.success('Gasto compartido registrado');
    return true;
  };

  const handleEdit = (expense: Expense) => {
    setViewing(null);
    setEditing(expense);
    // Damage uses DamageExpenseEditModal (via showModal); all others go through ExpensesFormsModals
    if ((expense.subcategory ?? '') === 'damage') {
      setShowModal(true);
    }
  };

  /**
   * Routing inteligente para "Cuentas por Pagar".
   * - Aseo / Insumos pendientes → /aseo (liquidación canónica).
   * - Daño pendiente → modal de edición (para registrar costo real y marcarlo pagado).
   * - Resto → modal de edición legacy.
   */
  const handlePendingClick = (expense: Expense) => {
    const cat = (expense.category ?? '').toLowerCase();
    const sub = (expense.subcategory ?? '').toLowerCase();
    const isCleaning = sub === 'cleaning' || cat === 'aseo' || cat === 'insumos de aseo' || cat === 'cleaning';
    if (isCleaning) {
      if (typeof window !== 'undefined') window.location.href = '/aseo';
      return;
    }
    handleEdit(expense);
  };

  // Descarta un gasto pendiente JUNTO con su ajuste de reserva vinculado (si aplica).
  // Pensado para "Cobro por daño" cuando el usuario decide no proceder con la reparación.
  // No usa deleteTarget para evitar UX ambigua — muestra su propio flow dentro del ExpenseModal.
  const handleDiscardWithAdjustment = async (expense: Expense) => {
    setSaveError('');
    if (expense.adjustment_id) {
      const resAdj = await deleteBookingAdjustment(expense.adjustment_id);
      if (resAdj.error) { setSaveError(`No se pudo eliminar el ajuste: ${resAdj.error}`); toast.error(`No se pudo eliminar el ajuste: ${resAdj.error}`); return; }
    }
    if (dbConnected) {
      const res = await deleteExpense(expense.id);
      if (res.error) { setSaveError(res.error); toast.error(res.error); return; }
    }
    setExpenses(prev => prev.filter(e => e.id !== expense.id));
    setEditing(null);
    setShowModal(false);
    toast.success('Gasto descartado');
  };

  const handleDeleteRequest = (id: string) => {
    const target = expenses.find(e => e.id === id);
    if (target) setDeleteTarget(target);
  };

  // Encamina la elección del chooser al flujo correspondiente.
  const handleChooserChoice = (choice: ExpenseTypeChoice) => {
    setShowChooser(false);
    setSaveError('');
    if (choice === 'cleaning_payout') {
      // Liquidación: redirigir a la pantalla de Aseo (donde está el flujo dedicado).
      if (typeof window !== 'undefined') window.location.href = '/aseo';
      return;
    }
    if (choice === 'damage') {
      setShowDamageFlow(true);
      return;
    }
    if (choice === 'cleaning_supplies') {
      setShowSuppliesForm(true);
      return;
    }
    if (choice === 'vendor') {
      setShowVendorForm(true);
      return;
    }
    if (choice === 'inventory_maintenance') {
      setInvMaintPrefillSchedule(null);
      setShowInventoryMaintenanceForm(true);
      return;
    }
    // 'property' → formulario dedicado de gasto sobre propiedad.
    setShowPropertyForm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (dbConnected) {
      const result = await deleteExpense(deleteTarget.id);
      if (result.error) { toast.error(result.error); return; }
    }
    setExpenses(prev => prev.filter(e => e.id !== deleteTarget.id));
    setDeleteTarget(null);
    dispatchRecurringChange();
    toast.success('Gasto eliminado');
  };

  const { pendingExpenses, totalPending, kpis } = expenseStats;
  const { today, overdueMaintenance, upcomingMaintenance } = maintenanceStats;
  const { tabCounts, visibleTotal, visibleFees } = tabStats;

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
            <PropertyMultiSelect properties={properties} value={propertyIds} onChange={setPropertyIds} groups={groups} tags={tags} tagAssigns={tagAssigns} />
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowExportModal(true)}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowChooser(true)}
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
              {kpi.sub && <p className="text-xs text-slate-400 mt-1">{kpi.sub}</p>}
            </motion.div>
          ))}
        </div>

        {/* Facturas compartidas pendientes (vendors con N propiedades) */}
        <SharedBillsPendingPanel
          onChanged={() => {
            reloadExpenses();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('recurring-period-changed'));
            }
          }}
        />

        {/* Recurrentes pendientes (fuente única: tabla periods + auto-detección) */}
        <RecurringPendingPanel
          propertyFilter={propertyIds.length === 1 ? propertyIds[0] : null}
          autoOpenRecurringId={deepLinkRecurring?.id ?? null}
          autoOpenYm={deepLinkRecurring?.ym ?? null}
          onChanged={() => {
            reloadExpenses();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('recurring-period-changed'));
            }
          }}
        />

        <MaintenancePanels
          today={today}
          overdueMaintenance={overdueMaintenance}
          upcomingMaintenance={upcomingMaintenance}
          doneNeedingExpense={doneNeedingExpense}
          inventoryItemsMap={inventoryItemsMap}
          properties={properties}
          onRegisterMaintenance={onRegisterMaintenance}
        />

        <PendingPayablesPanel
          pendingExpenses={pendingExpenses}
          totalPending={totalPending}
          onPendingClick={handlePendingClick}
          unreportedDamageItems={unreportedDamageItems}
        />

        <ExpensesTabsBar
          tab={tab}
          setTab={setTab}
          subFilter={subFilter}
          setSubFilter={setSubFilter}
          tabCounts={tabCounts}
          visibleTotal={visibleTotal}
          visibleFees={visibleFees}
          subCountsBySection={subCountsBySection}
        />

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

      <ExpensesFormsModals
        flags={{
          showChooser,
          showDamageFlow,
          showPropertyForm,
          showSuppliesForm,
          showVendorForm,
          showInventoryMaintenanceForm,
          invMaintPrefillSchedule,
          defaultPropertyId: propertyIds.length === 1 ? propertyIds[0] : invMaintPrefillSchedule?.property_id ?? null,
        }}
        handlers={{
          onChooserChoose: handleChooserChoice,
          closeChooser: () => setShowChooser(false),
          closeDamageFlow: () => setShowDamageFlow(false),
          onDamageSaved: () => { setShowDamageFlow(false); reloadExpenses(); },
          closePropertyForm: () => { setShowPropertyForm(false); setSaveError(""); },
          closeSuppliesForm: () => { setShowSuppliesForm(false); setSaveError(""); },
          closeVendorForm: () => { setShowVendorForm(false); setSaveError(""); },
          closeInventoryMaintenanceForm: () => { setShowInventoryMaintenanceForm(false); setInvMaintPrefillSchedule(null); setSaveError(""); },
          onSave: handleSave,
          onSaveShared: handleSaveShared,
          onSaveInventoryMaintenance: async (data) => {
            const ok = await handleSave(data);
            if (ok) {
              setShowInventoryMaintenanceForm(false);
              setInvMaintPrefillSchedule(null);
              loadMaintenancePanel();
            }
            return ok;
          },
        }}
        properties={properties}
        bankAccounts={bankAccounts}
        vendorSuggestions={vendorSuggestions}
        saveError={saveError}
        editingExpense={editing && !showModal ? editing : null}
        onEditSave={handleSave}
        onEditClose={() => { setEditing(null); setSaveError(''); }}
      />

      <AnimatePresence>

        {showModal && editing && (editing.subcategory ?? '').toLowerCase() === 'damage' && (
          <DamageExpenseEditModal
            expense={editing}
            properties={properties}
            bankAccounts={bankAccounts}
            onClose={() => { setShowModal(false); setEditing(null); setSaveError(''); }}
            onSave={async (patch) => {
              if (dbConnected) {
                const res = await updateExpense(editing.id, patch);
                if (res.error || !res.data) { toast.error(res.error ?? 'Error al guardar'); return; }
                setExpenses(prev => prev.map(e => e.id === editing.id ? res.data! : e));
              } else {
                setExpenses(prev => prev.map(e => e.id === editing.id ? { ...e, ...patch } as Expense : e));
              }
              setShowModal(false);
              setEditing(null);
              toast.success('Daño actualizado');
            }}
            onDiscard={editing.adjustment_id ? () => handleDiscardWithAdjustment(editing) : undefined}
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
          <Suspense fallback={null}>
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
          </Suspense>
        )}

        {deleteTarget && (
          <DeleteExpenseConfirm
            target={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleConfirmDelete}
          />
        )}

        {showExportModal && (
          <ExpensesExportModal
            properties={properties}
            groups={groups}
            tags={tags}
            tagAssigns={tagAssigns}
            defaultPropertyIds={propertyIds}
            defaultDateFrom={filters.dateFrom}
            defaultDateTo={filters.dateTo}
            onClose={() => setShowExportModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}


