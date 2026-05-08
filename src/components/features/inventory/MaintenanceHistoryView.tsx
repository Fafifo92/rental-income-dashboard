'use client';
import { useMemo, useState } from 'react';
import { Wrench, Trash2, RotateCcw } from 'lucide-react';
import type {
  InventoryItemRow,
  MaintenanceScheduleRow,
  PropertyRow,
} from '@/types/database';
// ──────────────────────────────────────────────────────────────────────────
// Historial de mantenimiento (tab)
// ──────────────────────────────────────────────────────────────────────────
const MAINT_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700' },
  done:      { label: 'Realizado',  cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelado',  cls: 'bg-slate-100 text-slate-500' },
};

export function MaintenanceHistoryView({
  schedules,
  items,
  properties,
  propMap,
  onSetMaintTarget,
  onDeleteSchedule,
  onResetExpense,
}: {
  schedules: MaintenanceScheduleRow[];
  items: InventoryItemRow[];
  properties: PropertyRow[];
  propMap: Map<string, PropertyRow>;
  onSetMaintTarget: (item: InventoryItemRow, sched: MaintenanceScheduleRow | null) => void;
  onDeleteSchedule: (id: string) => Promise<void>;
  onResetExpense: (id: string) => Promise<void>;
}) {
  const [propFilter, setPropFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const itemMap = useMemo(() => {
    const m = new Map<string, InventoryItemRow>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    return [...schedules]
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date))
      .filter(s => {
        if (propFilter !== 'all' && s.property_id !== propFilter) return false;
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          const item = itemMap.get(s.item_id);
          if (
            !s.title.toLowerCase().includes(q) &&
            !(item?.name ?? '').toLowerCase().includes(q)
          ) return false;
        }
        return true;
      });
  }, [schedules, propFilter, statusFilter, search, itemMap]);

  if (schedules.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Wrench className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-600">Sin historial de mantenimiento</p>
        <p className="text-sm mt-1">Los mantenimientos agendados y realizados apareceran aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={propFilter}
          onChange={e => setPropFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 outline-none"
        >
          <option value="all">Todas las propiedades</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 outline-none"
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="done">Realizado</option>
          <option value="cancelled">Cancelado</option>
        </select>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por item o titulo..."
          className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Sin resultados con los filtros actuales.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Fecha</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Propiedad</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Item</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Titulo</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Estado</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Gasto</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => {
                  const item = itemMap.get(s.item_id);
                  const prop = propMap.get(s.property_id);
                  const badge = MAINT_STATUS_BADGE[s.status] ?? MAINT_STATUS_BADGE.pending;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-700 font-mono text-xs whitespace-nowrap">
                        {s.scheduled_date}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">
                        {prop?.name ?? '\u2014'}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 text-xs">
                        {item?.name ?? 'Item eliminado'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">
                        <span>{s.title}</span>
                        {s.is_recurring && (
                          <span className="ml-1.5 text-[10px] text-amber-600">{'\u{1F501}'} cada {s.recurrence_days}d</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.status === 'done' && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.expense_registered
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-blue-50 text-blue-600'
                          }`}>
                            {s.expense_registered ? '\u2705 Registrado' : '\u23F3 Sin gasto'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          {item && s.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => onSetMaintTarget(item, s)}
                              className="text-[10px] font-semibold text-amber-700 hover:bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
                            >
                              Editar
                            </button>
                          )}
                          {s.status === 'done' && s.expense_registered && (
                            <button
                              type="button"
                              title="Quitar marca de gasto registrado"
                              onClick={() => onResetExpense(s.id)}
                              className="text-[10px] font-semibold text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded border border-blue-200 flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" /> Quitar gasto
                            </button>
                          )}
                          <button
                            type="button"
                            title="Eliminar registro"
                            onClick={() => onDeleteSchedule(s.id)}
                            className="text-[10px] font-semibold text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded border border-red-200 flex items-center"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-400">
            {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
