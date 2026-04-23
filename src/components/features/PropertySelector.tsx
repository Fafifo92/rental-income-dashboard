import type { PropertyRow } from '@/types/database';

interface Props {
  properties: PropertyRow[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  className?: string;
}

export default function PropertySelector({ properties, value, onChange, className = '' }: Props) {
  if (properties.length === 0) return null;

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || undefined)}
      className={`px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 ${className}`}
    >
      <option value="">Todas las propiedades</option>
      {properties.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}
