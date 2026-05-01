import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  PropertyRow,
  PropertyGroupRow,
  PropertyTagRow,
  PropertyTagAssignmentRow,
} from '@/types/database';

interface Props {
  properties: PropertyRow[];
  /** IDs seleccionadas. Vacío = todas las propiedades. */
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  placeholder?: string;
  /** Opcional: grupos para chips rápidos y búsqueda por nombre de grupo. */
  groups?: PropertyGroupRow[];
  /** Opcional: etiquetas para chips rápidos y búsqueda por etiqueta. */
  tags?: PropertyTagRow[];
  /** Opcional: asignaciones M:N propiedad↔etiqueta. */
  tagAssigns?: PropertyTagAssignmentRow[];
}

const COLOR_DOT: Record<string, string> = {
  slate: 'bg-slate-400', blue: 'bg-blue-500', violet: 'bg-violet-500',
  amber: 'bg-amber-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500',
  cyan: 'bg-cyan-500', fuchsia: 'bg-fuchsia-500',
};
const COLOR_PILL: Record<string, string> = {
  slate:    'bg-slate-100 text-slate-700 border-slate-200',
  blue:     'bg-blue-100 text-blue-700 border-blue-200',
  violet:   'bg-violet-100 text-violet-700 border-violet-200',
  amber:    'bg-amber-100 text-amber-700 border-amber-200',
  emerald:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  rose:     'bg-rose-100 text-rose-700 border-rose-200',
  cyan:     'bg-cyan-100 text-cyan-700 border-cyan-200',
  fuchsia:  'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
};

/**
 * Selector multi-propiedad con popover, búsqueda y atajos "Todas" / "Limpiar".
 * Empty array = "Todas las propiedades" (sin filtro).
 *
 * Si se pasan `groups` y/o `tags` (+ `tagAssigns`):
 *  - El buscador empareja también nombre de grupo y de etiqueta.
 *  - Aparecen chips rápidos arriba para seleccionar/quitar todas las propiedades
 *    de un grupo o que tengan una etiqueta.
 *  - Cada opción muestra debajo del nombre la chip de su grupo y sus etiquetas.
 */
export default function PropertyMultiSelectFilter({
  properties,
  value,
  onChange,
  className = '',
  placeholder = 'Todas las propiedades',
  groups = [],
  tags = [],
  tagAssigns = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      // 288 = w-72 en px. Si no cabe a la derecha, abre hacia la izquierda.
      setFlipLeft(rect.left + 288 > window.innerWidth - 8);
    }
    setOpen(o => !o);
  };

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);

  // property_id -> Tag[]
  const tagsByProperty = useMemo(() => {
    const m = new Map<string, PropertyTagRow[]>();
    for (const a of tagAssigns) {
      const t = tagById.get(a.tag_id);
      if (!t) continue;
      const arr = m.get(a.property_id) ?? [];
      arr.push(t);
      m.set(a.property_id, arr);
    }
    return m;
  }, [tagAssigns, tagById]);

  // tag_id -> property_ids[]
  const propIdsByTag = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of tagAssigns) {
      const arr = m.get(a.tag_id) ?? [];
      arr.push(a.property_id);
      m.set(a.tag_id, arr);
    }
    return m;
  }, [tagAssigns]);

  if (properties.length === 0) return null;

  const selected = new Set(value);

  // Búsqueda extendida: nombre prop ∪ grupo ∪ etiqueta
  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter(p => {
      if (p.name.toLowerCase().includes(q)) return true;
      const g = p.group_id ? groupById.get(p.group_id) : null;
      if (g && g.name.toLowerCase().includes(q)) return true;
      const ts = tagsByProperty.get(p.id) ?? [];
      if (ts.some(t => t.name.toLowerCase().includes(q))) return true;
      return false;
    });
  })();

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  // Selecciona/quita en bloque las propiedades de un grupo
  const toggleGroup = (groupId: string) => {
    const ids = properties.filter(p => p.group_id === groupId).map(p => p.id);
    if (ids.length === 0) return;
    const allSelected = ids.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    onChange(Array.from(next));
  };

  // Selecciona/quita en bloque las propiedades con cierta etiqueta
  const toggleTag = (tagId: string) => {
    const ids = propIdsByTag.get(tagId) ?? [];
    if (ids.length === 0) return;
    const allSelected = ids.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    onChange(Array.from(next));
  };

  const groupAllSelected = (groupId: string) => {
    const ids = properties.filter(p => p.group_id === groupId).map(p => p.id);
    return ids.length > 0 && ids.every(id => selected.has(id));
  };
  const tagAllSelected = (tagId: string) => {
    const ids = propIdsByTag.get(tagId) ?? [];
    return ids.length > 0 && ids.every(id => selected.has(id));
  };

  const label = (() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      return properties.find(p => p.id === value[0])?.name ?? '1 propiedad';
    }
    if (value.length === properties.length) return 'Todas las propiedades';
    return `${value.length} propiedades`;
  })();

  // Sólo mostrar grupos/etiquetas que tienen al menos 1 propiedad asociada
  const usableGroups = groups.filter(g => properties.some(p => p.group_id === g.id));
  const usableTags = tags.filter(t => (propIdsByTag.get(t.id) ?? []).length > 0);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 transition min-w-[180px]"
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400 flex-shrink-0">
          <path fill="currentColor" d="M5 7l5 6 5-6z" />
        </svg>
      </button>

      {open && (
        <div className={`absolute z-30 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-xl flex flex-col ${flipLeft ? 'right-0' : 'left-0'}`}>
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, grupo o etiqueta…"
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-400 outline-none"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100 text-[11px] gap-2">
            <button
              type="button"
              onClick={() => onChange(properties.map(p => p.id))}
              className="text-blue-600 hover:underline font-medium"
            >
              Seleccionar todas
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-slate-500 hover:underline"
            >
              Limpiar
            </button>
          </div>

          {(usableGroups.length > 0 || usableTags.length > 0) && (
            <div className="px-2 py-2 border-b border-slate-100 space-y-1.5">
              {usableGroups.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Grupos</p>
                  <div className="flex flex-wrap gap-1">
                    {usableGroups.map(g => {
                      const all = groupAllSelected(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition ${
                            all ? COLOR_PILL[g.color] ?? COLOR_PILL.slate : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          }`}
                          title={all ? 'Quitar todas' : 'Seleccionar todas las del grupo'}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${COLOR_DOT[g.color] ?? COLOR_DOT.slate}`} />
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {usableTags.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Etiquetas</p>
                  <div className="flex flex-wrap gap-1">
                    {usableTags.map(t => {
                      const all = tagAllSelected(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.id)}
                          className={`text-[11px] font-medium px-2 py-0.5 rounded border transition ${
                            all ? COLOR_PILL[t.color] ?? COLOR_PILL.blue : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          }`}
                          title={all ? 'Quitar todas' : 'Seleccionar todas con esta etiqueta'}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="overflow-y-auto max-h-52 flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">Sin resultados</div>
            ) : (
              filtered.map(p => {
                const checked = selected.has(p.id);
                const g = p.group_id ? groupById.get(p.group_id) : null;
                const ts = tagsByProperty.get(p.id) ?? [];
                return (
                  <label
                    key={p.id}
                    className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-slate-700">{p.name}</span>
                      {(g || ts.length > 0) && (
                        <span className="flex flex-wrap gap-1 mt-0.5">
                          {g && (
                            <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${COLOR_PILL[g.color] ?? COLOR_PILL.slate}`}>
                              <span className={`w-1 h-1 rounded-full ${COLOR_DOT[g.color] ?? COLOR_DOT.slate}`} />
                              {g.name}
                            </span>
                          )}
                          {ts.map(t => (
                            <span key={t.id} className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${COLOR_PILL[t.color] ?? COLOR_PILL.blue}`}>
                              {t.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
