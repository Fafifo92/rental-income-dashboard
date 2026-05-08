import type { PropertyGroupRow, PropertyTagRow } from '@/types/database';

export interface Property {
  id: string;
  name: string;
  address?: string | null;
  owner_id: string;
  created_at?: string | null;
  group_id?: string | null;
}

export const DEMO_PROPERTIES: Property[] = [
  {
    id: 'demo-1',
    name: 'Apto El Poblado 204',
    address: 'Calle 10 #43E-31, El Poblado, Medellín',
    owner_id: 'demo',
    created_at: null,
  },
  {
    id: 'demo-2',
    name: 'Suite Laureles 301',
    address: 'Circular 73 #39A-14, Laureles, Medellín',
    owner_id: 'demo',
    created_at: null,
  },
];

export const CATEGORY_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-purple-600',
  'from-orange-500 to-amber-600',
];

const COLOR_NAME_TO_HEX: Record<string, string> = {
  slate:   '#64748b',
  blue:    '#3b82f6',
  violet:  '#8b5cf6',
  amber:   '#f59e0b',
  emerald: '#10b981',
  rose:    '#f43f5e',
  cyan:    '#06b6d4',
  fuchsia: '#d946ef',
};

export function resolveColor(c: string): string {
  if (!c) return '#64748b';
  if (c.startsWith('#')) return c;
  return COLOR_NAME_TO_HEX[c] ?? '#64748b';
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <input
      type="color"
      value={resolveColor(value)}
      onChange={e => onChange(e.target.value)}
      className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
      title="Seleccionar color"
    />
  );
}

// Re-export types consumed by multiple sub-components
export type { PropertyGroupRow, PropertyTagRow };
