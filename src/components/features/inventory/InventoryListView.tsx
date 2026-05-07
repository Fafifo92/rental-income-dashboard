'use client';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, History, Wrench } from 'lucide-react';
import {
  STATUS_LABEL,
  STATUS_STYLE,
} from '@/services/inventory';
import type {
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryMovementType,
  MaintenanceScheduleRow,
  PropertyRow,
} from '@/types/database';
import { formatCurrency } from '@/lib/utils';
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// Vista categorizada: Propiedad ÔåÆ Categor├¡a ÔåÆ items en filas compactas
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
export function CategorizedInventoryView({
  items, properties, categories, propMap, catMap,
  pendingMaintMap, onQuick, onHistory, onEdit, onDelete, onScheduleMaintenance,
}: {
  items: InventoryItemRow[];
  properties: PropertyRow[];
  categories: InventoryCategoryRow[];
  propMap: Map<string, PropertyRow>;
  catMap: Map<string, InventoryCategoryRow>;
  pendingMaintMap: Map<string, MaintenanceScheduleRow[]>;
  onQuick: (it: InventoryItemRow, type: InventoryMovementType) => void;
  onHistory: (it: InventoryItemRow) => void;
  onEdit: (it: InventoryItemRow) => void;
  onDelete: (id: string) => void;
  onScheduleMaintenance: (it: InventoryItemRow, schedule?: MaintenanceScheduleRow) => void;
}) {
  void properties; // reservado para futuras sub-vistas
  // Agrupamos: propertyId ÔåÆ categoryKey ÔåÆ items
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

  // Orden estable: por nombre de propiedad / categor├¡a
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
                <span className="text-base">­ƒÅá</span>
                <span className="font-bold text-slate-800">{prop?.name ?? 'Sin propiedad'}</span>
                <span className="text-xs text-slate-500">┬À {totalItems} {totalItems === 1 ? 'item' : 'items'}</span>
              </div>
              <motion.span
                animate={{ rotate: propCollapsed ? -90 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-slate-400 text-sm inline-block"
              >Ôû¥</motion.span>
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
                              <span className="text-base">{cat?.icon ?? '­ƒôª'}</span>
                              <span className="font-semibold text-slate-700 text-sm">{cat?.name ?? 'Sin categor├¡a'}</span>
                              <span className="text-[11px] text-slate-400">({arr.length})</span>
                            </div>
                            <motion.span
                              animate={{ rotate: catCollapsed ? -90 : 0 }}
                              transition={{ duration: 0.2 }}
                              className="text-slate-400 text-xs inline-block"
                            >Ôû¥</motion.span>
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
                                    pendingSchedules={pendingMaintMap.get(it.id) ?? []}
                                    onQuick={onQuick}
                                    onHistory={onHistory}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                    onScheduleMaintenance={onScheduleMaintenance}
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

export function ItemRow({
  item, pendingSchedules, onQuick, onHistory, onEdit, onDelete, onScheduleMaintenance,
}: {
  item: InventoryItemRow;
  pendingSchedules: MaintenanceScheduleRow[];
  onQuick: (it: InventoryItemRow, type: InventoryMovementType) => void;
  onHistory: (it: InventoryItemRow) => void;
  onEdit: (it: InventoryItemRow) => void;
  onDelete: (id: string) => void;
  onScheduleMaintenance: (it: InventoryItemRow, schedule?: MaintenanceScheduleRow) => void;
}) {
  const lowStock =
    item.is_consumable && item.min_stock !== null && Number(item.quantity) <= Number(item.min_stock) && Number(item.quantity) > 0;
  const hasPendingMaint = pendingSchedules.length > 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const hasOverdueMaint = pendingSchedules.some(s => s.scheduled_date <= todayStr);
  return (
    <li className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-800 text-sm truncate">{item.name}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[item.status]}`}>
            {STATUS_LABEL[item.status]}
          </span>
          {lowStock && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">ÔÜá Stock bajo</span>}
          {hasPendingMaint && (
            <button
              onClick={() => onScheduleMaintenance(item, pendingSchedules[0])}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                hasOverdueMaint
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              }`}
              title={`${pendingSchedules.length} mantenimiento(s) programado(s)`}
            >
              {hasOverdueMaint ? '­ƒö┤ Mantenimiento vencido' : '­ƒƒí Mantenimiento pr├│ximo'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-500 truncate">
          {item.location ?? 'ÔÇö'}
          {item.description ? ` ┬À ${item.description}` : ''}
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
                ÔêÆ Usar
              </button>
            )}
          </>
        )}
        {!item.is_consumable && (
          <button
            onClick={() => onQuick(item, 'damaged')}
            className="px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 rounded"
            title="Reportar da├▒o"
          >
            ÔÜá Da├▒o
          </button>
        )}
        <button
          onClick={() => onScheduleMaintenance(item)}
          className="p-1.5 text-amber-500 hover:bg-amber-50 rounded"
          title="Agendar mantenimiento"
          aria-label="Agendar mantenimiento"
        >
          <Wrench className="w-3.5 h-3.5" />
        </button>
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

