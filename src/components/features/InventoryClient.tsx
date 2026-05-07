'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Download } from 'lucide-react';
import {
  listInventoryItems,
  ensureDefaultCategories,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  registerInventoryMovement,
  computeInventoryKpis,
  createInventoryCategory,
  type CreateInventoryItemInput,
} from '@/services/inventory';
import { listProperties } from '@/services/properties';
import type {
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryItemStatus,
  InventoryMovementType,
  MaintenanceScheduleRow,
  PropertyRow,
} from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import InventoryExportModal from '@/components/features/InventoryExportModal';
import ScheduleMaintenanceModal from '@/components/features/ScheduleMaintenanceModal';
import { toast } from '@/lib/toast';
import {
  listMaintenanceSchedules,
  getUpcomingAndOverdueSchedules,
  deleteMaintenanceSchedule,
  updateMaintenanceSchedule,
} from '@/services/maintenanceSchedules';
import { todayISO } from '@/lib/dateUtils';
import { CategorizedInventoryView } from './inventory/InventoryListView';
import { ItemFormModal } from './inventory/ItemFormModal';
import { QuickMovementModal, MovementsModal } from './inventory/InventoryMovementModals';
import {
  DamageReportModal,
  DamageReconciliationSection,
} from './inventory/InventoryDamageModals';
import { MaintenanceHistoryView } from './inventory/MaintenanceHistoryView';

type StatusFilter = 'all' | InventoryItemStatus | 'low_stock';

export default function InventoryClient(): JSX.Element {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryRow[]>([]);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  // filtros
  const [propertyFilter, setPropertyFilter] = useState<string | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  // modales
  const [editTarget, setEditTarget] = useState<InventoryItemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [movementsTarget, setMovementsTarget] = useState<InventoryItemRow | null>(null);
  const [quickAction, setQuickAction] = useState<{ item: InventoryItemRow; type: InventoryMovementType } | null>(null);
  const [damageTarget, setDamageTarget] = useState<InventoryItemRow | null>(null);
  const [showExport, setShowExport] = useState(false);

  // mantenimiento
  const [schedules, setSchedules] = useState<MaintenanceScheduleRow[]>([]);
  const [allSchedules, setAllSchedules] = useState<MaintenanceScheduleRow[]>([]);
  const [activeTab, setActiveTab] = useState<'items' | 'history'>('items');
  const [maintenanceTarget, setMaintenanceTarget] = useState<{
    item: InventoryItemRow;
    schedule: MaintenanceScheduleRow | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, iRes, sRes, allSRes] = await Promise.all([
        listProperties(),
        ensureDefaultCategories(),
        listInventoryItems(),
        getUpcomingAndOverdueSchedules(),
        listMaintenanceSchedules(),
      ]);
      if (pRes.data) setProperties(pRes.data);
      if (cRes.data) setCategories(cRes.data);
      if (iRes.data) setItems(iRes.data);
      if (sRes.data) setSchedules(sRes.data);
      if (!allSRes.error) setAllSchedules(allSRes.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredItems = useMemo(() => {
    return items.filter(it => {
      if (propertyFilter !== 'all' && it.property_id !== propertyFilter) return false;
      if (categoryFilter !== 'all' && it.category_id !== categoryFilter) return false;
      if (statusFilter === 'low_stock') {
        if (!it.is_consumable || it.min_stock === null) return false;
        if (Number(it.quantity) > Number(it.min_stock) || Number(it.quantity) === 0) return false;
      } else if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (!(`${it.name} ${it.description ?? ''} ${it.location ?? ''}`).toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, propertyFilter, categoryFilter, statusFilter, search]);

  const kpis = useMemo(() => computeInventoryKpis(items), [items]);

  const propMap = useMemo(() => {
    const m = new Map<string, PropertyRow>();
    for (const p of properties) m.set(p.id, p);
    return m;
  }, [properties]);

  const catMap = useMemo(() => {
    const m = new Map<string, InventoryCategoryRow>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // overdue = scheduled_date < today, upcoming = within notify_before_days
  const today = todayISO();

  // item_id -> count of pending maintenance schedules
  const pendingMaintMap = useMemo(() => {
    const m = new Map<string, MaintenanceScheduleRow[]>();
    const now = new Date(today + 'T12:00:00');
    for (const s of schedules) {
      if (s.status === 'pending') {
        // Only show badge for overdue or within the notify_before_days window
        const schedDate = new Date(s.scheduled_date + 'T12:00:00');
        const daysUntil = (schedDate.getTime() - now.getTime()) / 86_400_000;
        if (daysUntil <= (s.notify_before_days ?? 3)) {
          if (!m.has(s.item_id)) m.set(s.item_id, []);
          m.get(s.item_id)!.push(s);
        }
      }
    }
    return m;
  }, [schedules, today]);

  const overdueSchedules = useMemo(
    () => schedules.filter(s => s.status === 'pending' && s.scheduled_date < today),
    [schedules, today],
  );
  const upcomingSchedules = useMemo(
    () => schedules.filter(s => {
      if (s.status !== 'pending' || s.scheduled_date < today) return false;
      const diffMs = new Date(s.scheduled_date).getTime() - new Date(today).getTime();
      const diffDays = diffMs / 86_400_000;
      return diffDays <= s.notify_before_days;
    }),
    [schedules, today],
  );

  const handleSaveItem = async (id: string | null, payload: CreateInventoryItemInput) => {
    if (id) {
      const res = await updateInventoryItem(id, payload);
      if (res.error) return res.error;
    } else {
      const res = await createInventoryItem(payload);
      if (res.error) return res.error;
    }
    await load();
    return null;
  };

  const handleDelete = async (id: string) => {
    if (!confirm('┬┐Eliminar item del inventario? Esta acci├│n no se puede deshacer.')) return;
    await deleteInventoryItem(id);
    await load();
  };

  const handleQuickMovement = async (
    item: InventoryItemRow,
    type: InventoryMovementType,
    qtyDelta: number,
    newStatus: InventoryItemStatus | null,
    notes: string | null,
  ) => {
    const res = await registerInventoryMovement({
      item_id: item.id,
      type,
      quantity_delta: qtyDelta,
      new_status: newStatus,
      notes,
    });
    if (res.error) return res.error;
    await load();
    return null;
  };

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">­ƒôª Inventario</h1>
          <p className="text-sm text-slate-500">Muebles, electrodom├®sticos, lencer├¡a e insumos por propiedad.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 hover:border-slate-300 shadow-sm inline-flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-4 h-4" /> Exportar
          </button>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Nuevo item
          </button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <KPI label="Items" value={kpis.totalItems.toString()} tone="slate" />
        <KPI label="Da├▒ados" value={kpis.damaged.toString()} tone="red" highlight={kpis.damaged > 0} />
        <KPI label="Mantenimiento" value={kpis.needsMaintenance.toString()} tone="amber" highlight={kpis.needsMaintenance > 0} />
        <KPI label="Stock bajo" value={kpis.lowStock.toString()} tone="orange" highlight={kpis.lowStock > 0} />
        <KPI label="Agotados" value={kpis.depleted.toString()} tone="rose" highlight={kpis.depleted > 0} />
        <KPI label="Valor estimado" value={formatCurrency(kpis.estimatedValue)} tone="emerald" />
      </div>

      <DamageReconciliationSection />

      {/* Mantenimientos vencidos o pr├│ximos */}
      {(overdueSchedules.length > 0 || upcomingSchedules.length > 0) && (
        <div className="mb-4 space-y-2">
          {overdueSchedules.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-bold text-red-700 mb-2">
                ­ƒö┤ {overdueSchedules.length} mantenimiento{overdueSchedules.length > 1 ? 's' : ''} vencido{overdueSchedules.length > 1 ? 's' : ''}
              </p>
              <ul className="space-y-1">
                {overdueSchedules.map(s => {
                  const it = items.find(i => i.id === s.item_id);
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-red-700">
                        <span className="font-medium">{it?.name ?? 'ÔÇö'}</span> ┬À {s.title} ┬À <span className="font-mono">{s.scheduled_date}</span>
                      </span>
                      <button
                        onClick={() => it && setMaintenanceTarget({ item: it, schedule: s })}
                        className="text-[10px] font-semibold text-red-600 hover:bg-red-100 px-2 py-0.5 rounded"
                      >
                        Ver
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {upcomingSchedules.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-700 mb-2">
                ­ƒƒí {upcomingSchedules.length} mantenimiento{upcomingSchedules.length > 1 ? 's' : ''} pr├│ximo{upcomingSchedules.length > 1 ? 's' : ''}
              </p>
              <ul className="space-y-1">
                {upcomingSchedules.map(s => {
                  const it = items.find(i => i.id === s.item_id);
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-amber-700">
                        <span className="font-medium">{it?.name ?? 'ÔÇö'}</span> ┬À {s.title} ┬À <span className="font-mono">{s.scheduled_date}</span>
                      </span>
                      <button
                        onClick={() => it && setMaintenanceTarget({ item: it, schedule: s })}
                        className="text-[10px] font-semibold text-amber-700 hover:bg-amber-100 px-2 py-0.5 rounded"
                      >
                        Ver
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Tabs: Items / Historial de mantenimiento */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        <button
          onClick={() => setActiveTab('items')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'items'
              ? 'text-blue-700 border-blue-600'
              : 'text-slate-500 border-transparent hover:text-slate-700'
          }`}
        >
          ­ƒôª Inventario
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'history'
              ? 'text-amber-700 border-amber-600'
              : 'text-slate-500 border-transparent hover:text-slate-700'
          }`}
        >
          ­ƒöº Historial de mantenimiento
          {allSchedules.filter(s => s.status === 'done').length > 0 && (
            <span className="ml-1.5 text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">
              {allSchedules.filter(s => s.status === 'done').length}
            </span>
          )}
        </button>
      </div>

      {/* ÔöÇÔöÇ History Tab ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ */}
      {activeTab === 'history' && (
        <MaintenanceHistoryView
          schedules={allSchedules}
          items={items}
          properties={properties}
          propMap={propMap}
          onSetMaintTarget={(item, sched) => setMaintenanceTarget({ item, schedule: sched })}
          onDeleteSchedule={async (id) => {
            if (!confirm('┬┐Eliminar este registro de mantenimiento?')) return;
            const { error } = await deleteMaintenanceSchedule(id);
            if (error) { toast.error('Error al eliminar: ' + error); return; }
            setAllSchedules(prev => prev.filter(s => s.id !== id));
            toast.success('Registro eliminado');
          }}
          onResetExpense={async (id) => {
            const { error } = await updateMaintenanceSchedule(id, { expense_registered: false });
            if (error) { toast.error('Error al actualizar: ' + error); return; }
            setAllSchedules(prev => prev.map(s => s.id === id ? { ...s, expense_registered: false } : s));
            toast.success('Gasto desmarcado');
          }}
        />
      )}

      {/* ÔöÇÔöÇ Items Tab ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ */}
      {activeTab === 'items' && (
        <>
      {/* Filtros */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 grid grid-cols-1 md:grid-cols-4 gap-2">
        <select
          value={propertyFilter}
          onChange={e => setPropertyFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">Todas las propiedades</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">Todas las categor├¡as</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon ?? ''} {c.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">Todos los estados</option>
          <option value="good">Bueno</option>
          <option value="needs_maintenance">Mantenimiento</option>
          <option value="damaged">Da├▒ado</option>
          <option value="lost">Perdido</option>
          <option value="depleted">Agotado</option>
          <option value="low_stock">ÔÜá Stock bajo</option>
        </select>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, descripci├│n o ubicaci├│nÔÇª"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {loading ? (
        <p className="text-slate-500">Cargando inventarioÔÇª</p>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">­ƒôª</div>
          <p className="text-slate-600 font-medium mb-1">
            {items.length === 0 ? 'A├║n no has registrado items' : 'Sin resultados con los filtros actuales'}
          </p>
          <p className="text-xs text-slate-500 mb-4">
            Registra muebles, electrodom├®sticos e insumos de cada propiedad para llevar control de da├▒os y reposiciones.
          </p>
          <button onClick={() => setCreating(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            Agregar primer item
          </button>
        </div>
      ) : (
        <CategorizedInventoryView
          items={filteredItems}
          properties={properties}
          categories={categories}
          propMap={propMap}
          catMap={catMap}
          pendingMaintMap={pendingMaintMap}
          onQuick={(it, t) => {
            if (t === 'damaged') setDamageTarget(it);
            else setQuickAction({ item: it, type: t });
          }}
          onHistory={setMovementsTarget}
          onEdit={setEditTarget}
          onDelete={handleDelete}
          onScheduleMaintenance={(it, s) => setMaintenanceTarget({ item: it, schedule: s ?? null })}
        />
      )}
        </>
      )}

      <AnimatePresence>
        {(creating || editTarget) && (
          <ItemFormModal
            item={editTarget}
            properties={properties}
            categories={categories}
            items={items}
            onCreateCategory={async name => {
              const res = await createInventoryCategory(name);
              if (res.data) {
                setCategories(c => [...c, res.data!]);
                return res.data.id;
              }
              return null;
            }}
            onClose={() => { setCreating(false); setEditTarget(null); }}
            onSave={handleSaveItem}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {quickAction && (
          <QuickMovementModal
            item={quickAction.item}
            type={quickAction.type}
            onClose={() => setQuickAction(null)}
            onSave={async (qty, status, notes) => {
              const err = await handleQuickMovement(quickAction.item, quickAction.type, qty, status, notes);
              if (!err) setQuickAction(null);
              return err;
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {damageTarget && (
          <DamageReportModal
            item={damageTarget}
            propertyName={propMap.get(damageTarget.property_id)?.name ?? ''}
            onClose={() => setDamageTarget(null)}
            onSaved={async () => { setDamageTarget(null); await load(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {movementsTarget && (
          <MovementsModal
            item={movementsTarget}
            onClose={() => setMovementsTarget(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExport && (
          <InventoryExportModal
            items={items}
            properties={properties}
            categories={categories}
            schedules={allSchedules}
            onClose={() => setShowExport(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {maintenanceTarget && (
          <ScheduleMaintenanceModal
            item={maintenanceTarget.item}
            propertyName={propMap.get(maintenanceTarget.item.property_id)?.name ?? ''}
            schedule={maintenanceTarget.schedule}
            onClose={() => setMaintenanceTarget(null)}
            onSaved={async () => { setMaintenanceTarget(null); await load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function KPI({ label, value, tone, highlight }: {
  label: string;
  value: string;
  tone: 'slate' | 'red' | 'amber' | 'orange' | 'rose' | 'emerald';
  highlight?: boolean;
}) {
  const color = {
    slate: 'text-slate-800', red: 'text-red-600', amber: 'text-amber-600',
    orange: 'text-orange-600', rose: 'text-rose-600', emerald: 'text-emerald-600',
  }[tone];
  const ring = {
    slate: '', red: 'ring-1 ring-red-100 border-red-200', amber: 'ring-1 ring-amber-100 border-amber-200',
    orange: 'ring-1 ring-orange-100 border-orange-200', rose: 'ring-1 ring-rose-100 border-rose-200', emerald: '',
  }[tone];
  return (
    <div className={`bg-white rounded-xl p-3 border ${highlight ? ring : 'border-slate-200'}`}>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg lg:text-xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
