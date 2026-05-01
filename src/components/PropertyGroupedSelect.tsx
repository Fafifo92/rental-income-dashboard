import { useMemo } from 'react';
import type { PropertyRow, PropertyGroupRow } from '@/types/database';

interface Props {
  properties: PropertyRow[];
  groups?: PropertyGroupRow[];
  value: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
  error?: string;
  className?: string;
  placeholder?: string;
}

/**
 * Selector mono-propiedad con `<optgroup>` cuando hay grupos definidos.
 * Si `groups` es vacío/undefined, renderiza una lista plana de `<option>`.
 */
export default function PropertyGroupedSelect({
  properties,
  groups,
  value,
  onChange,
  required,
  error,
  className,
  placeholder,
}: Props) {
  const sortedGroups = useMemo(() => {
    if (!groups) return [];
    return [...groups].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  }, [groups]);

  const useGroups = sortedGroups.length > 0;
  const ungrouped = useGroups ? properties.filter(p => !p.group_id) : properties;

  const cls =
    className ??
    `w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none ${
      error ? 'border-red-400' : 'border-slate-200'
    }`;

  return (
    <select
      value={value ?? ''}
      required={required}
      onChange={e => onChange(e.target.value || null)}
      className={cls}
    >
      <option value="">{placeholder ?? '— Selecciona —'}</option>
      {useGroups &&
        sortedGroups.map(g => {
          const props = properties.filter(p => p.group_id === g.id);
          if (props.length === 0) return null;
          return (
            <optgroup key={g.id} label={g.name}>
              {props.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          );
        })}
      {useGroups
        ? (ungrouped.length > 0 && (
            <optgroup label="Sin grupo">
              {ungrouped.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          ))
        : ungrouped.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
    </select>
  );
}
