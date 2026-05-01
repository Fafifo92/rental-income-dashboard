import { useMemo, useState } from 'react';
import type {
  PropertyRow,
  PropertyGroupRow,
  PropertyTagRow,
  PropertyTagAssignmentRow,
} from '@/types/database';

interface Props {
  properties: PropertyRow[];
  groups?: PropertyGroupRow[];
  tags?: PropertyTagRow[];
  tagAssignments?: PropertyTagAssignmentRow[];
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
  className?: string;
}

/**
 * Multi-selector visual de propiedades estilo grid de tarjetas.
 *
 * - Búsqueda por nombre.
 * - Filtro por etiquetas (AND: la propiedad debe tener todas las etiquetas activas).
 * - Renderiza por grupos cuando se proveen `groups`.
 */
export default function PropertyMultiSelect({
  properties,
  groups,
  tags,
  tagAssignments,
  value,
  onChange,
  error,
  className = '',
}: Props) {
  const [search, setSearch] = useState('');
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);

  const selected = useMemo(() => new Set(value), [value]);

  // Index: property_id -> Set<tag_id>
  const propTagsIndex = useMemo(() => {
    const idx = new Map<string, Set<string>>();
    (tagAssignments ?? []).forEach(a => {
      let s = idx.get(a.property_id);
      if (!s) { s = new Set(); idx.set(a.property_id, s); }
      s.add(a.tag_id);
    });
    return idx;
  }, [tagAssignments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (activeTagIds.length > 0) {
        const ts = propTagsIndex.get(p.id);
        if (!ts) return false;
        for (const tid of activeTagIds) if (!ts.has(tid)) return false;
      }
      return true;
    });
  }, [properties, search, activeTagIds, propTagsIndex]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next));
  };

  const toggleTag = (tid: string) => {
    setActiveTagIds(prev => prev.includes(tid) ? prev.filter(t => t !== tid) : [...prev, tid]);
  };

  const visibleIds = filtered.map(p => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  const renderCard = (p: PropertyRow) => {
    const isSelected = selected.has(p.id);
    return (
      <button
        type="button"
        key={p.id}
        onClick={() => toggle(p.id)}
        className={`text-left rounded-xl border px-3 py-2.5 text-xs transition ${
          isSelected
            ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-200'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
              isSelected ? 'bg-violet-600 border-violet-600' : 'border-slate-300 bg-white'
            }`}
          >
            {isSelected && (
              <svg viewBox="0 0 20 20" className="w-3 h-3 text-white" fill="currentColor">
                <path d="M7.5 13.5L4 10l1.4-1.4 2.1 2.1L14.6 4l1.4 1.4z" />
              </svg>
            )}
          </span>
          <span className={`flex-1 truncate font-medium ${isSelected ? 'text-violet-900' : 'text-slate-700'}`}>
            {p.name}
          </span>
        </div>
      </button>
    );
  };

  // Group rendering
  const sortedGroups = useMemo(() => {
    if (!groups) return [];
    return [...groups].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  }, [groups]);

  const renderGrouped = () => {
    const sections: React.ReactNode[] = [];
    sortedGroups.forEach(g => {
      const items = filtered.filter(p => p.group_id === g.id);
      if (items.length === 0) return;
      sections.push(
        <div key={`hdr-${g.id}`} className="col-span-full text-[11px] font-bold uppercase tracking-wide text-slate-500 mt-1">
          {g.name}
        </div>,
      );
      items.forEach(p => sections.push(renderCard(p)));
    });
    const ungrouped = filtered.filter(p => !p.group_id);
    if (ungrouped.length > 0) {
      sections.push(
        <div key="hdr-none" className="col-span-full text-[11px] font-bold uppercase tracking-wide text-slate-500 mt-1">
          Sin grupo
        </div>,
      );
      ungrouped.forEach(p => sections.push(renderCard(p)));
    }
    return sections;
  };

  const useGroups = (groups?.length ?? 0) > 0;

  return (
    <div className={className}>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar propiedad…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => onChange(Array.from(new Set([...value, ...visibleIds])))}
            disabled={allVisibleSelected || visibleIds.length === 0}
            className="px-2 py-1 text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded hover:bg-violet-100 disabled:opacity-50"
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => onChange(value.filter(id => !visibleIds.includes(id)))}
            disabled={visibleIds.length === 0}
            className="px-2 py-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 disabled:opacity-50"
          >
            Ninguna
          </button>
        </div>
      </div>

      {/* Tag chips */}
      {(tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags!.map(t => {
            const active = activeTagIds.includes(t.id);
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => toggleTag(t.id)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-full border transition ${
                  active
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                {t.name}
              </button>
            );
          })}
          {activeTagIds.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTagIds([])}
              className="px-2 py-0.5 text-[11px] text-slate-500 hover:underline"
            >
              limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      <div
        className={`rounded-lg ${error ? 'ring-1 ring-red-400' : ''}`}
      >
        {filtered.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-6 border border-dashed border-slate-200 rounded-lg">
            Sin resultados
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {useGroups ? renderGrouped() : filtered.map(renderCard)}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[11px] text-slate-500">
          {value.length} de {properties.length} seleccionada{properties.length === 1 ? '' : 's'}
        </p>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
