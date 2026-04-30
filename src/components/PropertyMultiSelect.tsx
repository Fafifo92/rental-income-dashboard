import { useEffect, useRef, useState } from 'react';
import type { PropertyRow } from '@/types/database';

interface Props {
  properties: PropertyRow[];
  /** IDs seleccionadas. Vacío = todas las propiedades. */
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  placeholder?: string;
}

/**
 * Selector multi-propiedad con popover, búsqueda y atajos "Todas" / "Limpiar".
 * Empty array = "Todas las propiedades" (sin filtro).
 */
export default function PropertyMultiSelect({
  properties,
  value,
  onChange,
  className = '',
  placeholder = 'Todas las propiedades',
}: Props) {
  const [open, setOpen] = useState(false);
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

  if (properties.length === 0) return null;

  const selected = new Set(value);
  const filtered = search.trim()
    ? properties.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : properties;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const label = (() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      return properties.find(p => p.id === value[0])?.name ?? '1 propiedad';
    }
    if (value.length === properties.length) return 'Todas las propiedades';
    return `${value.length} propiedades`;
  })();

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 transition min-w-[180px]"
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400 flex-shrink-0">
          <path fill="currentColor" d="M5 7l5 6 5-6z" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-72 max-h-80 overflow-hidden bg-white border border-slate-200 rounded-lg shadow-lg flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar propiedad…"
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
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">Sin resultados</div>
            ) : (
              filtered.map(p => {
                const checked = selected.has(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="flex-1 truncate text-slate-700">{p.name}</span>
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
