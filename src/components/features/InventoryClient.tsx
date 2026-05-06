'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, History, Plus } from 'lucide-react';
import {
  listInventoryItems,
  ensureDefaultCategories,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  registerInventoryMovement,
  reportItemDamage,
  listInventoryMovements,
  computeInventoryKpis,
  createInventoryCategory,
  STATUS_LABEL,
  STATUS_STYLE,
  MOVEMENT_LABEL,
  getDamageReconciliations,
  recoverDamageAmount,
  type CreateInventoryItemInput,
  type DamageReconciliation,
} from '@/services/inventory';
import { listProperties } from '@/services/properties';
import { listBookings } from '@/services/bookings';
import { listBankAccounts } from '@/services/bankAccounts';
import type {
  BankAccountRow,
  BookingRow,
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryItemStatus,
  InventoryMovementRow,
  InventoryMovementType,
  PropertyRow,
} from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import MoneyInput from '@/components/MoneyInput';
import { useBackdropClose, makeBackdropHandlers } from '@/lib/useBackdropClose';
import { todayISO } from '@/lib/dateUtils';

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

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, cRes, iRes] = await Promise.all([
      listProperties(),
      ensureDefaultCategories(),
      listInventoryItems(),
    ]);
    if (pRes.data) setProperties(pRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (iRes.data) setItems(iRes.data);
    setLoading(false);
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
    if (!confirm('¿Eliminar item del inventario? Esta acción no se puede deshacer.')) return;
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
          <h1 className="text-3xl font-bold text-slate-800">📦 Inventario</h1>
          <p className="text-sm text-slate-500">Muebles, electrodomésticos, lencería e insumos por propiedad.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Nuevo item
        </button>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <KPI label="Items" value={kpis.totalItems.toString()} tone="slate" />
        <KPI label="Dañados" value={kpis.damaged.toString()} tone="red" highlight={kpis.damaged > 0} />
        <KPI label="Mantenimiento" value={kpis.needsMaintenance.toString()} tone="amber" highlight={kpis.needsMaintenance > 0} />
        <KPI label="Stock bajo" value={kpis.lowStock.toString()} tone="orange" highlight={kpis.lowStock > 0} />
        <KPI label="Agotados" value={kpis.depleted.toString()} tone="rose" highlight={kpis.depleted > 0} />
        <KPI label="Valor estimado" value={formatCurrency(kpis.estimatedValue)} tone="emerald" />
      </div>

      <DamageReconciliationSection />

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
          <option value="all">Todas las categorías</option>
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
          <option value="damaged">Dañado</option>
          <option value="lost">Perdido</option>
          <option value="depleted">Agotado</option>
          <option value="low_stock">⚠ Stock bajo</option>
        </select>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, descripción o ubicación…"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {loading ? (
        <p className="text-slate-500">Cargando inventario…</p>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-slate-600 font-medium mb-1">
            {items.length === 0 ? 'Aún no has registrado items' : 'Sin resultados con los filtros actuales'}
          </p>
          <p className="text-xs text-slate-500 mb-4">
            Registra muebles, electrodomésticos e insumos de cada propiedad para llevar control de daños y reposiciones.
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
          onQuick={(it, t) => {
            if (t === 'damaged') setDamageTarget(it);
            else setQuickAction({ item: it, type: t });
          }}
          onHistory={setMovementsTarget}
          onEdit={setEditTarget}
          onDelete={handleDelete}
        />
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
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Vista categorizada: Propiedad → Categoría → items en filas compactas
// ──────────────────────────────────────────────────────────────────────────
function CategorizedInventoryView({
  items, properties, categories, propMap, catMap,
  onQuick, onHistory, onEdit, onDelete,
}: {
  items: InventoryItemRow[];
  properties: PropertyRow[];
  categories: InventoryCategoryRow[];
  propMap: Map<string, PropertyRow>;
  catMap: Map<string, InventoryCategoryRow>;
  onQuick: (it: InventoryItemRow, type: InventoryMovementType) => void;
  onHistory: (it: InventoryItemRow) => void;
  onEdit: (it: InventoryItemRow) => void;
  onDelete: (id: string) => void;
}) {
  void properties; // reservado para futuras sub-vistas
  // Agrupamos: propertyId → categoryKey → items
  const groups = useMemo(() => {
    const byProp = new Map<string, Map<string, InventoryItemRow[]>>();
    for (const it of items) {
      const pid = it.property_id;
      if (!byProp.has(pid)) byProp.set(pid, new Map());
      const byCat = byProp.get(pid)!;
      const cKey = it.category_id ?? '__none__';
      if (!byCat.has(cKey)) byCat.set(cKey, []);
      byCat.get(cKey)!.push(it);
    }
    return byProp;
  }, [items]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed(c => ({ ...c, [key]: c[key] === false }));

  // Orden estable: por nombre de propiedad / categoría
  const sortedProps = useMemo(() => {
    return Array.from(groups.keys()).sort((a, b) => {
      const an = propMap.get(a)?.name ?? '';
      const bn = propMap.get(b)?.name ?? '';
      return an.localeCompare(bn);
    });
  }, [groups, propMap]);

  const catOrder = useMemo(() => {
    const m = new Map<string, number>();
    categories.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [categories]);

  return (
    <div className="space-y-5">
      {sortedProps.map(pid => {
        const prop = propMap.get(pid);
        const byCat = groups.get(pid)!;
        const catKeys = Array.from(byCat.keys()).sort((a, b) => {
          const ai = a === '__none__' ? 999 : (catOrder.get(a) ?? 500);
          const bi = b === '__none__' ? 999 : (catOrder.get(b) ?? 500);
          return ai - bi;
        });
        const totalItems = Array.from(byCat.values()).reduce((s, arr) => s + arr.length, 0);
        const propCollapsed = collapsed[`p:${pid}`] !== false;
        return (
          <div key={pid} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              onClick={() => toggle(`p:${pid}`)}
              className="w-full px-5 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100 border-b border-slate-200"
            >
              <div className="flex items-center gap-2 text-left">
                <span className="text-base">🏠</span>
                <span className="font-bold text-slate-800">{prop?.name ?? 'Sin propiedad'}</span>
                <span className="text-xs text-slate-500">· {totalItems} {totalItems === 1 ? 'item' : 'items'}</span>
              </div>
              <motion.span
                animate={{ rotate: propCollapsed ? -90 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-slate-400 text-sm inline-block"
              >▾</motion.span>
            </button>
            <AnimatePresence initial={false}>
              {!propCollapsed && (
                <motion.div
                  key="prop-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="divide-y divide-slate-100">
                    {catKeys.map(cKey => {
                      const cat = cKey === '__none__' ? null : catMap.get(cKey);
                      const arr = byCat.get(cKey)!;
                      const catKey = `${pid}:${cKey}`;
                      const catCollapsed = collapsed[catKey] !== false;
                      return (
                        <div key={cKey}>
                          <button
                            onClick={() => toggle(catKey)}
                            className="w-full px-5 py-2 flex items-center justify-between text-left hover:bg-slate-50"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-base">{cat?.icon ?? '📦'}</span>
                              <span className="font-semibold text-slate-700 text-sm">{cat?.name ?? 'Sin categoría'}</span>
                              <span className="text-[11px] text-slate-400">({arr.length})</span>
                            </div>
                            <motion.span
                              animate={{ rotate: catCollapsed ? -90 : 0 }}
                              transition={{ duration: 0.2 }}
                              className="text-slate-400 text-xs inline-block"
                            >▾</motion.span>
                          </button>
                          <AnimatePresence initial={false}>
                            {!catCollapsed && (
                              <motion.ul
                                key="cat-body"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: 'easeInOut' }}
                                style={{ overflow: 'hidden' }}
                                className="divide-y divide-slate-100"
                              >
                                {arr.map(it => (
                                  <ItemRow
                                    key={it.id}
                                    item={it}
                                    onQuick={onQuick}
                                    onHistory={onHistory}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                  />
                                ))}
                              </motion.ul>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function ItemRow({
  item, onQuick, onHistory, onEdit, onDelete,
}: {
  item: InventoryItemRow;
  onQuick: (it: InventoryItemRow, type: InventoryMovementType) => void;
  onHistory: (it: InventoryItemRow) => void;
  onEdit: (it: InventoryItemRow) => void;
  onDelete: (id: string) => void;
}) {
  const lowStock =
    item.is_consumable && item.min_stock !== null && Number(item.quantity) <= Number(item.min_stock) && Number(item.quantity) > 0;
  return (
    <li className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-800 text-sm truncate">{item.name}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[item.status]}`}>
            {STATUS_LABEL[item.status]}
          </span>
          {lowStock && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">⚠ Stock bajo</span>}
        </div>
        <p className="text-[11px] text-slate-500 truncate">
          {item.location ?? '—'}
          {item.description ? ` · ${item.description}` : ''}
        </p>
      </div>
      <div className="text-right whitespace-nowrap text-xs text-slate-600">
        <div className={`font-bold ${lowStock ? 'text-orange-600' : 'text-slate-800'}`}>
          {Number(item.quantity)} <span className="font-normal text-slate-400">{item.unit ?? ''}</span>
        </div>
        {item.purchase_price && <div className="text-[10px] text-slate-400">{formatCurrency(Number(item.purchase_price))}</div>}
      </div>
      <div className="flex items-center gap-0.5">
        {item.is_consumable && (
          <>
            <button
              onClick={() => onQuick(item, 'restocked')}
              className="px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 rounded"
              title="Reponer stock"
            >
              + Reponer
            </button>
            {Number(item.quantity) > 0 && (
              <button
                onClick={() => onQuick(item, 'used')}
                className="px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 rounded"
                title="Registrar consumo"
              >
                − Usar
              </button>
            )}
          </>
        )}
        {!item.is_consumable && (
          <button
            onClick={() => onQuick(item, 'damaged')}
            className="px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 rounded"
            title="Reportar daño"
          >
            ⚠ Daño
          </button>
        )}
        <button
          onClick={() => onHistory(item)}
          className="p-1.5 text-slate-400 hover:bg-slate-100 rounded"
          title="Historial"
          aria-label="Ver historial"
        >
          <History className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onEdit(item)}
          className="p-1.5 text-slate-400 hover:bg-slate-100 rounded"
          title="Editar"
          aria-label="Editar item"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(item.id)}
          className="p-1.5 text-rose-400 hover:bg-rose-50 rounded"
          title="Eliminar"
          aria-label="Eliminar item"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────
function ItemFormModal({
  item, properties, categories, items, onCreateCategory, onClose, onSave,
}: {
  item: InventoryItemRow | null;
  properties: PropertyRow[];
  categories: InventoryCategoryRow[];
  items: InventoryItemRow[];
  onCreateCategory: (name: string) => Promise<string | null>;
  onClose: () => void;
  onSave: (id: string | null, payload: CreateInventoryItemInput) => Promise<string | null>;
}) {
  const backdrop = useBackdropClose(onClose);
  const [name, setName] = useState(item?.name ?? '');
  const [propertyId, setPropertyId] = useState(item?.property_id ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.category_id ?? null);
  const [description, setDescription] = useState(item?.description ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [status, setStatus] = useState<InventoryItemStatus>(item?.status ?? 'good');
  const [quantity, setQuantity] = useState<number | null>(item ? Number(item.quantity) : 1);
  const [unit, setUnit] = useState(item?.unit ?? 'unidad');
  const [isConsumable, setIsConsumable] = useState(item?.is_consumable ?? false);
  const [minStock, setMinStock] = useState<number | null>(item?.min_stock !== null && item?.min_stock !== undefined ? Number(item.min_stock) : null);
  const [purchaseDate, setPurchaseDate] = useState(item?.purchase_date ?? '');
  const [purchasePrice, setPurchasePrice] = useState<number | null>(item?.purchase_price !== null && item?.purchase_price !== undefined ? Number(item.purchase_price) : null);
  const [lifetime, setLifetime] = useState<number | null>(item?.expected_lifetime_months ?? null);
  const [notes, setNotes] = useState(item?.notes ?? '');

  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  const [locationOpen, setLocationOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const locationSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) {
      if (it.location?.trim()) seen.add(it.location.trim());
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredLocations = useMemo(() => {
    const q = location.trim().toLowerCase();
    if (!q) return locationSuggestions;
    return locationSuggestions.filter(l => l.toLowerCase().includes(q));
  }, [location, locationSuggestions]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Nombre requerido'); return; }
    if (!propertyId) { setErr('Selecciona una propiedad'); return; }
    if (quantity === null || quantity < 0) { setErr('Cantidad inválida'); return; }
    setSaving(true);
    setErr(null);
    const payload: CreateInventoryItemInput = {
      property_id: propertyId,
      category_id: categoryId,
      name: name.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      status,
      quantity,
      unit: unit.trim() || null,
      min_stock: isConsumable ? minStock : null,
      is_consumable: isConsumable,
      purchase_date: purchaseDate || null,
      purchase_price: purchasePrice ?? null,
      expected_lifetime_months: lifetime ?? null,
      photo_url: null,
      notes: notes.trim() || null,
    };
    const error = await onSave(item?.id ?? null, payload);
    setSaving(false);
    if (error) setErr(error);
    else onClose();
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    const id = await onCreateCategory(newCatName.trim());
    setCreatingCat(false);
    if (id) {
      setCategoryId(id);
      setNewCatName('');
    }
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-slate-800">
            {item ? 'Editar item' : 'Nuevo item de inventario'}
          </h3>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
                placeholder="Ej: Sofá, Cafetera Oster, Detergente, Toallas blancas"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedad *</label>
              <select
                value={propertyId} onChange={e => setPropertyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {!propertyId && (
                  <option value="" disabled>— Selecciona una propiedad —</option>
                )}
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Categoría</label>
              <select
                value={categoryId ?? ''} onChange={e => setCategoryId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Sin categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon ?? ''} {c.name}</option>)}
              </select>
              <div className="flex gap-1 mt-1">
                <input
                  type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  placeholder="+ Crear categoría"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                  className="flex-1 px-2 py-1 text-xs border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button" onClick={addCategory} disabled={creatingCat || !newCatName.trim()}
                  className="px-2 py-1 text-[11px] font-semibold text-white bg-slate-700 rounded hover:bg-slate-800 disabled:opacity-50"
                >
                  Crear
                </button>
              </div>
            </div>

            <div className="relative">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ubicación</label>
              <input
                type="text"
                value={location}
                onChange={e => { setLocation(e.target.value); setLocationOpen(true); }}
                onFocus={() => setLocationOpen(true)}
                onBlur={() => setTimeout(() => setLocationOpen(false), 150)}
                placeholder="Ej: Cocina, Habitación principal, Baño 1"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <AnimatePresence>
                {locationOpen && filteredLocations.length > 0 && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-44 overflow-y-auto"
                  >
                    {filteredLocations.map(loc => (
                      <li key={loc}>
                        <button
                          type="button"
                          onMouseDown={() => { setLocation(loc); setLocationOpen(false); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700"
                        >
                          {loc}
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Estado *</label>
              <select
                value={status} onChange={e => setStatus(e.target.value as InventoryItemStatus)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="good">Bueno</option>
                <option value="needs_maintenance">Mantenimiento</option>
                <option value="damaged">Dañado</option>
                <option value="lost">Perdido</option>
                <option value="depleted">Agotado</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción</label>
              <textarea
                value={description} onChange={e => setDescription(e.target.value)} rows={2}
                placeholder="Marca, modelo, color, detalles relevantes…"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2 flex items-start gap-2 p-3 bg-sky-50 rounded-lg border border-sky-100">
              <input
                type="checkbox" id="is_consumable" checked={isConsumable}
                onChange={e => setIsConsumable(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-sky-300 text-sky-600 focus:ring-sky-500"
              />
              <label htmlFor="is_consumable" className="text-xs text-sky-900 cursor-pointer flex-1">
                <span className="font-semibold">Es un insumo consumible</span> (jabón, detergente, papel higiénico…). Se podrá registrar consumo y alertar cuando llegue al stock mínimo.
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Cantidad *</label>
              <input
                type="number" step="0.01" min="0" value={quantity ?? ''}
                onChange={e => setQuantity(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Unidad</label>
              <input
                type="text" value={unit} onChange={e => setUnit(e.target.value)}
                placeholder="unidad, litro, paquete, rollo"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {isConsumable && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Stock mínimo (alerta)</label>
                <input
                  type="number" step="0.01" min="0" value={minStock ?? ''}
                  onChange={e => setMinStock(e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="Ej: 2 (avisar cuando queden 2 o menos)"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de compra</label>
              <input
                type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Costo unitario</label>
              <MoneyInput value={purchasePrice} onChange={setPurchasePrice} />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Vida útil esperada (meses)</label>
              <input
                type="number" min="0" value={lifetime ?? ''}
                onChange={e => setLifetime(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="Informativo (Ej: nevera = 120 meses)"
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button
              type="submit" disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : item ? 'Guardar cambios' : 'Crear item'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function QuickMovementModal({
  item, type, onClose, onSave,
}: {
  item: InventoryItemRow;
  type: InventoryMovementType;
  onClose: () => void;
  onSave: (qtyDelta: number, newStatus: InventoryItemStatus | null, notes: string | null) => Promise<string | null>;
}) {
  const backdrop = useBackdropClose(onClose);
  const [qty, setQty] = useState<number | null>(1);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const labelByType: Record<InventoryMovementType, { title: string; help: string; sign: number; defaultStatus: InventoryItemStatus | null }> = {
    added:         { title: 'Agregar al inventario',     help: 'Suma cantidad al item.',                                              sign:  1, defaultStatus: null },
    used:          { title: 'Registrar consumo',         help: 'Resta cantidad. Si llega a 0 se marca como "Agotado" automáticamente.', sign: -1, defaultStatus: null },
    damaged:       { title: 'Reportar daño',             help: 'Marca el item como dañado. La cantidad no cambia (usa "Descartar" si lo botas).', sign: 0, defaultStatus: 'damaged' },
    repaired:      { title: 'Marcar como reparado',      help: 'Vuelve el estado a "Bueno".',                                          sign:  0, defaultStatus: 'good' },
    restocked:     { title: 'Reponer stock',             help: 'Suma cantidad. Útil tras compra de insumos.',                          sign:  1, defaultStatus: 'good' },
    discarded:     { title: 'Descartar (botar)',         help: 'Resta cantidad y marca dañado/perdido si aplica.',                     sign: -1, defaultStatus: null },
    lost:          { title: 'Marcar como perdido',       help: 'Marca el item como perdido.',                                          sign:  0, defaultStatus: 'lost' },
    status_change: { title: 'Cambiar estado',            help: 'Cambia el estado sin afectar cantidad.',                               sign:  0, defaultStatus: null },
  };
  const cfg = labelByType[type];
  const showQty = cfg.sign !== 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const delta = showQty ? cfg.sign * (qty ?? 0) : 0;
    const error = await onSave(delta, cfg.defaultStatus, notes.trim() || null);
    setSaving(false);
    if (error) setErr(error);
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-1">{cfg.title}</h3>
        <p className="text-xs text-slate-500 mb-1">{item.name} · stock actual: <strong>{Number(item.quantity)} {item.unit ?? ''}</strong></p>
        <p className="text-xs text-slate-500 mb-4 italic">{cfg.help}</p>

        <form onSubmit={submit} className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}
          {showQty && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Cantidad ({cfg.sign > 0 ? '+' : '−'})
              </label>
              <input
                type="number" step="0.01" min="0" value={qty ?? ''} autoFocus
                onChange={e => setQty(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Detalles del movimiento (opcional)"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Confirmar'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function MovementsModal({ item, onClose }: { item: InventoryItemRow; onClose: () => void }) {
  const backdrop = useBackdropClose(onClose);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInventoryMovements(item.id).then(res => {
      if (res.data) setMovements(res.data);
      setLoading(false);
    });
  }, [item.id]);

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">📜 Historial de "{item.name}"</h3>
          <p className="text-xs text-slate-500">Bitácora completa de movimientos.</p>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">Sin movimientos registrados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {movements.map(m => {
                const delta = Number(m.quantity_delta);
                return (
                  <li key={m.id} className="py-3 flex items-start gap-3">
                    <div className="text-xs text-slate-500 w-28 shrink-0">
                      {new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700">{MOVEMENT_LABEL[m.type]}</span>
                        {delta !== 0 && (
                          <span className={`text-xs font-mono ${delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {delta > 0 ? '+' : ''}{delta} {item.unit ?? ''}
                          </span>
                        )}
                        {m.new_status && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[m.new_status]}`}>
                            → {STATUS_LABEL[m.new_status]}
                          </span>
                        )}
                      </div>
                      {m.notes && <p className="text-xs text-slate-500 mt-0.5">{m.notes}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cerrar</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DamageReportModal
// Reporta daño + (opcional) atribuir a reserva + (opcional) cobrar al huésped.
// Crea automáticamente: gasto pendiente (Reparación inventario), ajuste de
// reserva damage_charge (si aplica) y movimiento de inventario, todo enlazado.
// ──────────────────────────────────────────────────────────────────────────
function DamageReportModal({
  item, propertyName, onClose, onSaved,
}: {
  item: InventoryItemRow;
  propertyName: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [listingSourceById, setListingSourceById] = useState<Map<string, string>>(new Map());
  const [bookingId, setBookingId] = useState<string>('');
  const [repairCost, setRepairCost] = useState<number | null>(
    item.purchase_price ? Number(item.purchase_price) : null,
  );
  const [chargeBack, setChargeBack] = useState(false);
  const [chargeAmount, setChargeAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await listBookings({ propertyIds: [item.property_id] });
      if (!res.data) return;
      const today = todayISO();
      const sorted = [...res.data].sort((a, b) => {
        const aActive = a.start_date <= today && a.end_date >= today ? 0 : 1;
        const bActive = b.start_date <= today && b.end_date >= today ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return b.start_date.localeCompare(a.start_date);
      });
      setBookings(sorted.slice(0, 50));
      // Cargar source de cada listing para distinguir directo vs plataforma
      const listingIds = Array.from(new Set(sorted.map(b => b.listing_id)));
      if (listingIds.length > 0) {
        const { supabase } = await import('@/lib/supabase/client');
        const lr = await supabase.from('listings').select('id,source').in('id', listingIds);
        if (lr.data) {
          const m = new Map<string, string>();
          for (const l of lr.data) m.set(l.id, l.source);
          setListingSourceById(m);
        }
      }
    })();
  }, [item.property_id]);

  const selectedBooking = useMemo(
    () => bookings.find(b => b.id === bookingId) ?? null,
    [bookings, bookingId],
  );
  const selectedSource = selectedBooking ? listingSourceById.get(selectedBooking.listing_id) : null;
  const chargeTargetLabel =
    !selectedSource ? 'huésped'
    : /direct|directo/i.test(selectedSource) ? 'huésped (reserva directa)'
    : `la plataforma (${selectedSource})`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const cost = repairCost ?? 0;
    const charge = chargeAmount;
    const res = await reportItemDamage({
      item_id: item.id,
      item_name: item.name,
      property_id: item.property_id,
      booking_id: bookingId,
      repair_cost: cost,
      description: description.trim() || null,
      charge_to_guest: chargeBack && !!bookingId,
      charge_amount: charge,
    });
    setSaving(false);
    if (res.error) { setErr(res.error); return; }
    await onSaved();
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">⚠ Reportar daño</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            <strong>{item.name}</strong> · {propertyName}{item.location ? ` · ${item.location}` : ''}
          </p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 space-y-1">
            <p className="font-semibold">Al guardar se hará automáticamente:</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>El item queda marcado como <strong>Dañado</strong>.</li>
              <li>Se crea un <strong>gasto pendiente</strong> "Reparación inventario" con el costo estimado.</li>
              <li>Si lo atribuyes a una reserva, queda <strong>vinculado</strong> a esa reserva.</li>
              <li>Si activas el cobro al huésped, se crea un <strong>cobro por daño</strong> en la reserva.</li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">¿Durante qué reserva ocurrió? *</label>
            <select
              required
              value={bookingId}
              onChange={e => setBookingId(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">— Selecciona la reserva —</option>
              {bookings.map(b => (
                <option key={b.id} value={b.id}>
                  {b.confirmation_code} · {b.guest_name ?? 'Huésped'} · {b.start_date} → {b.end_date}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              Todo daño debe estar asociado a una reserva (activas primero, luego más recientes).
              Si la reserva no está aquí, créala antes de registrar el daño.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Costo estimado de reparación / reposición *</label>
            <MoneyInput value={repairCost} onChange={setRepairCost} required placeholder="0" />
            <p className="text-[10px] text-slate-400 mt-1">
              Pre-cargado con el precio de compra si existe. Usa coma para centavos.
            </p>
          </div>

          {bookingId && (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chargeBack}
                  onChange={e => setChargeBack(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="font-semibold text-slate-700">
                  Cobrar este daño a {chargeTargetLabel}
                </span>
              </label>
              <p className="text-[10px] text-slate-500">
                Se registra un <strong>cobro por daño</strong> en la reserva. Si la reserva es de plataforma,
                lo cobra la plataforma; si es directa, lo cobras directo al huésped.
              </p>
              {chargeBack && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Monto a cobrar (vacío = igual al costo de reparación)
                  </label>
                  <MoneyInput value={chargeAmount} onChange={setChargeAmount} placeholder="0" />
                  {repairCost !== null && chargeAmount !== null && chargeAmount !== repairCost && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                      ⚠ Diferencia detectada: cobras {formatCurrency(chargeAmount)} pero el daño cuesta {formatCurrency(repairCost)}.
                      {chargeAmount < repairCost
                        ? ` Faltarían ${formatCurrency(repairCost - chargeAmount)} por cubrir (queda como ajuste pendiente).`
                        : ` Sobran ${formatCurrency(chargeAmount - repairCost)} (excedente a tu favor).`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción del daño</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="Ej: Pata partida tras checkout, taza fracturada, control remoto perdido…"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Reportar daño'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}



// ---------- Sección 14B: Reconciliación de daños ----------
function DamageReconciliationSection(): JSX.Element | null {
  const [rows, setRows] = useState<DamageReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [recovering, setRecovering] = useState<DamageReconciliation | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    getDamageReconciliations().then(res => {
      setRows(res.data ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const open = rows.filter(r =>
    r.status === 'pending_recovery' ||
    r.status === 'overpaid' ||
    r.status === 'no_charge' ||
    (r.status === 'pending_repair' && r.repair_cost > 0),
  );

  if (loading) return null;
  if (open.length === 0) return null;

  const totalPendingRecovery = open
    .filter(r => r.status === 'pending_recovery')
    .reduce((s, r) => s + Math.abs(r.diff), 0);
  const totalOverpaid = open
    .filter(r => r.status === 'overpaid')
    .reduce((s, r) => s + r.diff, 0);
  const totalNoCharge = open
    .filter(r => r.status === 'no_charge')
    .reduce((s, r) => s + r.repair_cost, 0);

  return (
    <section className="bg-white rounded-xl border-l-4 border-amber-400 border-y border-r border-amber-200 p-5 mb-6">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-bold text-amber-800 flex items-center gap-2">
            ⚠️ Daños sin reconciliar ({open.length})
          </h2>
          <p className="text-xs text-amber-700/80 mt-0.5">
            Diferencias entre lo que cobraste al huésped/plataforma y lo que costó realmente reparar.
          </p>
        </div>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded"
        >
          {collapsed ? 'Mostrar' : 'Ocultar'}
        </button>
      </header>

      {!collapsed && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
              <div className="text-[10px] uppercase font-semibold text-rose-700">Falta recuperar</div>
              <div className="text-lg font-bold text-rose-800">{formatCurrency(totalPendingRecovery)}</div>
              <div className="text-[11px] text-rose-700/80">Cobraste menos de lo que costó</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <div className="text-[10px] uppercase font-semibold text-emerald-700">Sobrante</div>
              <div className="text-lg font-bold text-emerald-800">{formatCurrency(totalOverpaid)}</div>
              <div className="text-[11px] text-emerald-700/80">Plataforma pagó de más</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] uppercase font-semibold text-slate-600">Asumido por el negocio</div>
              <div className="text-lg font-bold text-slate-800">{formatCurrency(totalNoCharge)}</div>
              <div className="text-[11px] text-slate-500">Sin cobro al huésped</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th className="text-left py-2 px-2">Item / Propiedad</th>
                  <th className="text-left py-2 px-2">Reserva</th>
                  <th className="text-right py-2 px-2">Costo</th>
                  <th className="text-right py-2 px-2">Cobrado</th>
                  <th className="text-right py-2 px-2">Diferencia</th>
                  <th className="text-left py-2 px-2">Estado</th>
                  <th className="text-right py-2 px-2">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {open.map(r => (
                  <tr key={r.movement_id} className="hover:bg-amber-50/30">
                    <td className="py-2 px-2">
                      <div className="font-medium text-slate-800">{r.item_name}</div>
                      <div className="text-[11px] text-slate-500">{r.property_name ?? '—'}</div>
                    </td>
                    <td className="py-2 px-2">
                      {r.booking_id ? (
                        <a
                          href={`/bookings?focus=${r.booking_id}`}
                          className="text-blue-600 hover:underline text-xs font-mono"
                        >
                          {r.booking_code ?? r.booking_id.slice(0, 8)}
                        </a>
                      ) : <span className="text-slate-400 text-xs">—</span>}
                      {r.guest_name && (
                        <div className="text-[11px] text-slate-500 truncate max-w-[160px]" title={r.guest_name}>
                          {r.guest_name}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-700">
                      {formatCurrency(r.repair_cost)}
                      {r.expense_status === 'pending' && (
                        <div className="text-[10px] text-amber-600">⏳ pendiente pago</div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-700">
                      {formatCurrency(r.charged_to_guest)}
                    </td>
                    <td className={`py-2 px-2 text-right font-bold ${
                      r.diff < 0 ? 'text-rose-700' : r.diff > 0 ? 'text-emerald-700' : 'text-slate-500'
                    }`}>
                      {r.diff < 0 ? '−' : r.diff > 0 ? '+' : ''}{formatCurrency(Math.abs(r.diff))}
                    </td>
                    <td className="py-2 px-2">
                      {r.status === 'pending_recovery' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">
                          Falta recuperar
                        </span>
                      )}
                      {r.status === 'overpaid' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                          Sobrante
                        </span>
                      )}
                      {r.status === 'no_charge' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          Sin cobro
                        </span>
                      )}
                      {r.status === 'pending_repair' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                          Pago pendiente
                        </span>
                      )}
                      {!r.is_repaired && r.expense_status === 'paid' && (
                        <div className="text-[10px] text-slate-400 mt-0.5">Item aún dañado</div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {(r.status === 'pending_recovery' || r.status === 'no_charge') && r.booking_id && r.expense_id ? (
                        <button
                          onClick={() => setRecovering(r)}
                          className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          💰 Registrar recuperación
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-500 mt-3 space-y-1">
            <p>
              💡 <strong>¿Cómo cierro una diferencia?</strong>
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Falta recuperar:</strong> usa "💰 Registrar recuperación" para indicar cuánto te dio la plataforma/huésped y a qué cuenta cayó.</li>
              <li><strong>Sobrante:</strong> recibiste más de lo que costó — la diferencia queda como ingreso adicional para el negocio.</li>
              <li><strong>Sin cobro:</strong> registra una recuperación cuando recibas la plata, o asume el costo como gasto del negocio.</li>
            </ul>
          </div>
        </>
      )}
      <AnimatePresence>
        {recovering && (
          <RecoverDamageModal
            row={recovering}
            onClose={() => setRecovering(null)}
            onSaved={() => { setRecovering(null); reload(); }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function RecoverDamageModal({
  row, onClose, onSaved,
}: {
  row: DamageReconciliation;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const missing = Math.max(0, row.repair_cost - row.charged_to_guest);
  const [amount, setAmount] = useState<number | null>(missing > 0 ? missing : null);
  const [bankId, setBankId] = useState<string>('');
  const [date, setDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState<string>('');
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdrop = makeBackdropHandlers(onClose);

  useEffect(() => {
    listBankAccounts().then(res => {
      const list = (res.data ?? []).filter(a => a.is_active);
      setAccounts(list);
      if (list.length > 0 && !bankId) setBankId(list[0].id);
    });
  }, []);

  const totalAfter = row.charged_to_guest + (Number(amount) || 0);
  const profit = totalAfter - row.repair_cost;

  const handleSave = async () => {
    if (!amount || amount <= 0) { setError('Indica el monto recuperado.'); return; }
    if (!bankId) { setError('Selecciona la cuenta donde cayó el dinero.'); return; }
    if (!row.expense_id || !row.booking_id) { setError('Daño sin reserva o gasto asociado.'); return; }
    setSaving(true);
    setError(null);
    const res = await recoverDamageAmount({
      expense_id: row.expense_id,
      booking_id: row.booking_id,
      amount: Number(amount),
      bank_account_id: bankId,
      date,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-800">💰 Registrar recuperación de daño</h3>
        <p className="text-xs text-slate-500 mt-1">
          {row.item_name} · {row.property_name ?? 'Sin propiedad'}
        </p>

        <div className="grid grid-cols-3 gap-2 mt-4 text-center text-xs">
          <div className="bg-slate-50 rounded-lg p-2">
            <div className="text-slate-500">Costó reparar</div>
            <div className="font-bold text-slate-800">{formatCurrency(row.repair_cost)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2">
            <div className="text-slate-500">Ya cobrado</div>
            <div className="font-bold text-slate-800">{formatCurrency(row.charged_to_guest)}</div>
          </div>
          <div className="bg-rose-50 rounded-lg p-2">
            <div className="text-rose-600">Falta</div>
            <div className="font-bold text-rose-700">{formatCurrency(missing)}</div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">Monto recuperado *</label>
            <MoneyInput value={amount} onChange={setAmount} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">¿A qué cuenta cayó? *</label>
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— selecciona —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.bank ? `(${a.bank})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Fecha</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Ej: Airbnb resolución #12345"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {amount && amount > 0 && (
            <div className={`rounded-lg p-3 text-xs ${
              profit > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
              profit < 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' :
              'bg-slate-50 text-slate-700 border border-slate-200'
            }`}>
              {profit > 0 && <>✨ <strong>Ganancia:</strong> +{formatCurrency(profit)} (recibiste más de lo que costó)</>}
              {profit < 0 && <>⚠️ Aún faltan {formatCurrency(Math.abs(profit))} por recuperar.</>}
              {profit === 0 && <>✅ Quedará balanceado exactamente.</>}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Registrar recuperación'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
