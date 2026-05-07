'use client';
import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Download, FileText, Table2, CheckSquare, Square, Minus } from 'lucide-react';
import { makeBackdropHandlers } from '@/lib/useBackdropClose';
import { STATUS_LABEL } from '@/services/inventory';
import {
  INVENTORY_COLUMN_GROUPS,
  DEFAULT_INVENTORY_COLUMNS,
  exportInventoryToCsv,
  exportInventoryToExcel,
  type InventoryExportColumn,
  type InventoryMaintInfo,
} from '@/services/export';
import type { InventoryCategoryRow, InventoryItemRow, MaintenanceScheduleRow, PropertyRow } from '@/types/database';

type Format = 'csv' | 'excel';

interface Props {
  items:      InventoryItemRow[];
  properties: PropertyRow[];
  categories: InventoryCategoryRow[];
  schedules?: MaintenanceScheduleRow[];
  onClose:    () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ALL_COLUMNS: InventoryExportColumn[] = INVENTORY_COLUMN_GROUPS.flatMap(g => g.columns);

function triState(total: number, selected: number): 'all' | 'some' | 'none' {
  if (selected === 0) return 'none';
  if (selected === total) return 'all';
  return 'some';
}

function TriCheckbox({
  state,
  onChange,
  label,
  className = '',
}: {
  state: 'all' | 'some' | 'none';
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const Icon = state === 'all' ? CheckSquare : state === 'some' ? Minus : Square;
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 ${className}`}
    >
      <Icon className={`w-3.5 h-3.5 ${state !== 'none' ? 'text-blue-500' : 'text-slate-400'}`} />
      {label}
    </button>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function InventoryExportModal({ items, properties, categories, schedules = [], onClose }: Props) {
  // ── state ──────────────────────────────────────────────────────────────────
  const [selectedProps, setSelectedProps] = useState<Set<string>>(
    () => new Set(properties.map(p => p.id)),
  );
  const [selectedCols, setSelectedCols] = useState<Set<string>>(
    () => new Set(DEFAULT_INVENTORY_COLUMNS),
  );
  const [format, setFormat] = useState<Format>('csv');
  const [exporting, setExporting] = useState(false);

  // ── resolvers ──────────────────────────────────────────────────────────────
  const propNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, p.name);
    return m;
  }, [properties]);

  const catNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, `${c.icon ?? ''} ${c.name}`.trim());
    return m;
  }, [categories]);

  const resolvers = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    // Build per-item schedule maps
    const doneByItem = new Map<string, MaintenanceScheduleRow[]>();
    const pendingByItem = new Map<string, MaintenanceScheduleRow[]>();
    for (const s of schedules) {
      if (s.status === 'done') {
        if (!doneByItem.has(s.item_id)) doneByItem.set(s.item_id, []);
        doneByItem.get(s.item_id)!.push(s);
      } else if (s.status === 'pending') {
        if (!pendingByItem.has(s.item_id)) pendingByItem.set(s.item_id, []);
        pendingByItem.get(s.item_id)!.push(s);
      }
    }

    const getMaintInfo = (itemId: string): InventoryMaintInfo => {
      const done = (doneByItem.get(itemId) ?? []).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
      const pending = (pendingByItem.get(itemId) ?? []).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
      const last = done[0] ?? null;
      const next = pending[0] ?? null;
      let statusLabel = 'Sin mantenimiento';
      if (next) {
        statusLabel = next.scheduled_date <= today ? 'Vencido' : 'Próximo programado';
      } else if (last) {
        statusLabel = 'Al día';
      }
      return {
        lastDate:    last?.scheduled_date ?? '',
        lastTitle:   last?.title ?? '',
        nextDate:    next?.scheduled_date ?? '',
        nextTitle:   next?.title ?? '',
        isRecurring: next?.is_recurring ?? last?.is_recurring ?? false,
        statusLabel,
      };
    };

    return {
      getPropertyName: (id: string) => propNameMap.get(id) ?? id,
      getCategoryName: (id: string) => catNameMap.get(id) ?? id,
      getStatusLabel:  (s: string)  => (STATUS_LABEL as Record<string, string>)[s] ?? s,
      getMaintInfo,
    };
  }, [propNameMap, catNameMap, schedules]);

  // ── derived ────────────────────────────────────────────────────────────────
  const filteredItems = useMemo(
    () => items.filter(it => selectedProps.has(it.property_id)),
    [items, selectedProps],
  );

  const orderedColumns = useMemo(
    () => ALL_COLUMNS.filter(c => selectedCols.has(c.key)),
    [selectedCols],
  );

  // ── property toggles ───────────────────────────────────────────────────────
  const allPropsSelected = selectedProps.size === properties.length;
  const somePropsSelected = selectedProps.size > 0 && !allPropsSelected;

  const toggleAllProps = useCallback(() => {
    setSelectedProps(
      allPropsSelected ? new Set() : new Set(properties.map(p => p.id)),
    );
  }, [allPropsSelected, properties]);

  const toggleProp = useCallback((id: string) => {
    setSelectedProps(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── column toggles ─────────────────────────────────────────────────────────
  const toggleCol = useCallback((key: string) => {
    if (key === 'name') return; // nombre siempre incluido
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    const group = INVENTORY_COLUMN_GROUPS.find(g => g.id === groupId);
    if (!group) return;
    const keys = group.columns.map(c => c.key).filter(k => k !== 'name');
    const allOn = keys.every(k => selectedCols.has(k));
    setSelectedCols(prev => {
      const next = new Set(prev);
      if (allOn) keys.forEach(k => next.delete(k));
      else       keys.forEach(k => next.add(k));
      return next;
    });
  }, [selectedCols]);

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (orderedColumns.length === 0 || filteredItems.length === 0) return;
    setExporting(true);
    await new Promise(r => setTimeout(r, 50)); // allow spinner to render
    try {
      if (format === 'csv') {
        exportInventoryToCsv(filteredItems, orderedColumns, resolvers);
      } else {
        exportInventoryToExcel(filteredItems, orderedColumns, resolvers);
      }
    } finally {
      setExporting(false);
      onClose();
    }
  }, [filteredItems, orderedColumns, format, resolvers, onClose]);

  // ── backdrop ───────────────────────────────────────────────────────────────
  const backdrop = makeBackdropHandlers(onClose);

  const canExport = filteredItems.length > 0 && orderedColumns.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      {...backdrop}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1,    opacity: 1, y: 0 }}
        exit={{ scale: 0.95,    opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]"
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <Download className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Exportar inventario</h2>
              <p className="text-xs text-slate-400">Configura propiedades, campos y formato</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

          {/* ── Section 1: Propiedades ──────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Propiedades a incluir
              </h3>
              <TriCheckbox
                state={allPropsSelected ? 'all' : somePropsSelected ? 'some' : 'none'}
                onChange={toggleAllProps}
                label={allPropsSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
              />
            </div>
            {properties.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No hay propiedades registradas.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {properties.map(p => {
                  const on = selectedProps.has(p.id);
                  const count = items.filter(it => it.property_id === p.id).length;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProp(p.id)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                        on
                          ? 'border-blue-300 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {on
                        ? <CheckSquare className="w-4 h-4 text-blue-500 shrink-0" />
                        : <Square      className="w-4 h-4 text-slate-300 shrink-0" />
                      }
                      <span className="text-sm font-medium truncate flex-1">{p.name}</span>
                      <span className={`text-xs shrink-0 ${on ? 'text-blue-500' : 'text-slate-400'}`}>
                        {count} items
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Section 2: Campos ──────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Campos a exportar
              </h3>
              <TriCheckbox
                state={triState(
                  ALL_COLUMNS.filter(c => c.key !== 'name').length,
                  orderedColumns.filter(c => c.key !== 'name').length,
                )}
                onChange={() => {
                  const allKeys = ALL_COLUMNS.filter(c => c.key !== 'name').map(c => c.key);
                  const allOn = allKeys.every(k => selectedCols.has(k));
                  setSelectedCols(prev => {
                    const next = new Set(prev);
                    if (allOn) allKeys.forEach(k => next.delete(k));
                    else       allKeys.forEach(k => next.add(k));
                    return next;
                  });
                }}
                label="Todos los campos"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INVENTORY_COLUMN_GROUPS.map(group => {
                const groupKeys = group.columns.map(c => c.key).filter(k => k !== 'name');
                const onCount   = groupKeys.filter(k => selectedCols.has(k)).length;
                const state     = triState(groupKeys.length, onCount);
                return (
                  <div key={group.id} className="border border-slate-200 rounded-xl overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-600">{group.label}</span>
                      {groupKeys.length > 0 && (
                        <TriCheckbox
                          state={state}
                          onChange={() => toggleGroup(group.id)}
                          label={state === 'all' ? 'Quitar todos' : 'Todos'}
                          className="text-[11px]"
                        />
                      )}
                    </div>
                    {/* Columns list */}
                    <div className="divide-y divide-slate-100">
                      {group.columns.map(col => {
                        const isName   = col.key === 'name';
                        const on       = selectedCols.has(col.key);
                        return (
                          <button
                            key={col.key}
                            type="button"
                            onClick={() => toggleCol(col.key)}
                            disabled={isName}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                              isName
                                ? 'cursor-default'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            {isName ? (
                              <CheckSquare className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                            ) : on ? (
                              <CheckSquare className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            ) : (
                              <Square      className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                            )}
                            <span className={`text-xs ${on || isName ? 'text-slate-700' : 'text-slate-400'}`}>
                              {col.label}
                            </span>
                            {isName && (
                              <span className="ml-auto text-[10px] text-slate-400 italic">siempre</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Section 3: Formato ─────────────────────────────────────── */}
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              Formato de exportación
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <FormatCard
                active={format === 'csv'}
                onClick={() => setFormat('csv')}
                icon={<FileText className="w-5 h-5" />}
                title="CSV"
                description="Compatible con Excel, Google Sheets y cualquier hoja de cálculo. UTF-8 con BOM."
              />
              <FormatCard
                active={format === 'excel'}
                onClick={() => setFormat('excel')}
                icon={<Table2 className="w-5 h-5" />}
                title="Excel"
                description="Archivo .xls listo para Microsoft Excel con hoja de cálculo nativa."
              />
            </div>
          </section>
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-slate-200 shrink-0 flex items-center justify-between gap-3 bg-slate-50 rounded-b-2xl">
          {/* Preview */}
          <div className="text-sm text-slate-500">
            {!canExport ? (
              <span className="text-amber-600 font-medium">
                {filteredItems.length === 0 ? 'Selecciona al menos una propiedad' : 'Selecciona al menos un campo'}
              </span>
            ) : (
              <>
                <span className="font-bold text-slate-700">{filteredItems.length}</span>{' '}
                {filteredItems.length === 1 ? 'item' : 'items'}{' '}
                · <span className="font-bold text-slate-700">{orderedColumns.length}</span>{' '}
                {orderedColumns.length === 1 ? 'campo' : 'campos'}
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!canExport || exporting}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-colors shadow-sm"
            >
              {exporting ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block"
                  />
                  Exportando…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Exportar {format === 'csv' ? 'CSV' : 'Excel'}
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── FormatCard ────────────────────────────────────────────────────────────────
function FormatCard({
  active, onClick, icon, title, description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1.5 p-3.5 rounded-xl border-2 text-left transition-all ${
        active
          ? 'border-blue-400 bg-blue-50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className={`${active ? 'text-blue-600' : 'text-slate-500'} transition-colors`}>
        {icon}
      </div>
      <span className={`text-sm font-bold ${active ? 'text-blue-700' : 'text-slate-700'}`}>
        {title}
      </span>
      <span className="text-[11px] text-slate-500 leading-relaxed">{description}</span>
    </button>
  );
}
