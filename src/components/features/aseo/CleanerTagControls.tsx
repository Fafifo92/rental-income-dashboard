'use client';
import { useState } from 'react';

export function TagChip({
  active, onClick, label, color, onDelete,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
  onDelete?: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full text-xs font-semibold border transition ${
        active ? 'text-white' : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
      }`}
      style={active ? { backgroundColor: color ?? '#1e293b', borderColor: color ?? '#1e293b' } : undefined}
    >
      <button type="button" onClick={onClick} className="px-3 py-1">
        {label}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`pr-2 ${active ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-red-600'}`}
          title="Eliminar etiqueta"
          aria-label="Eliminar etiqueta"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function NewTagInline({ onCreateTag }: { onCreateTag: (name: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await onCreateTag(name.trim());
    setCreating(false);
    setName('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2 py-1 text-xs font-semibold text-slate-500 border border-dashed border-slate-300 rounded-full hover:border-slate-400 hover:text-slate-700 transition"
      >
        + Nueva etiqueta
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); create(); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="ej: Villavicencio"
        className="px-2 py-1 text-xs border rounded-full w-36 focus:ring-2 focus:ring-blue-400 outline-none"
      />
      <button
        type="button"
        onClick={create}
        disabled={creating || !name.trim()}
        className="px-2 py-1 text-xs font-semibold text-white bg-blue-600 rounded-full hover:bg-blue-700 disabled:opacity-50"
      >
        {creating ? '…' : 'Crear'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
    </div>
  );
}
