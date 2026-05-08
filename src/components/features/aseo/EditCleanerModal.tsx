'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';
import type { CleanerGroup } from '@/services/cleanerGroups';
import type { Vendor } from '@/services/vendors';

interface Props {
  cleaner: Vendor;
  initialTagIds: string[];
  groups: CleanerGroup[];
  onClose: () => void;
  onSave: (patch: { name: string; contact: string; active: boolean; tagIds: string[] }) => Promise<string | null>;
}

export default function EditCleanerModal({
  cleaner, initialTagIds, groups, onClose, onSave,
}: Props) {
  const [name, setName] = useState(cleaner.name);
  const [contact, setContact] = useState(cleaner.contact ?? '');
  const [active, setActive] = useState(cleaner.active);
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const backdrop = useBackdropClose(onClose);

  const toggle = (id: string) =>
    setTagIds(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id]);

  const submit = async () => {
    if (!name.trim()) { setErr('El nombre es obligatorio'); return; }
    setSaving(true); setErr(null);
    const e = await onSave({ name, contact, active, tagIds });
    setSaving(false);
    if (e) setErr(e);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">Editar {cleaner.name}</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
            <input
              type="text" value={contact} onChange={e => setContact(e.target.value)}
              placeholder="Teléfono / WhatsApp"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Etiquetas</label>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => {
                const on = tagIds.includes(g.id);
                return (
                  <button
                    type="button" key={g.id} onClick={() => toggle(g.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                      on ? 'text-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
                    }`}
                    style={on ? { backgroundColor: g.color ?? '#475569', borderColor: g.color ?? '#475569' } : undefined}
                  >
                    {on ? '✓ ' : ''}{g.name}
                  </button>
                );
              })}
              {groups.length === 0 && <span className="text-xs text-slate-400">Sin etiquetas creadas todavía.</span>}
            </div>
          </div>
          <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span className="text-xs text-slate-700">Activo (desmarca para desactivar sin borrar historial)</span>
          </label>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:bg-slate-300">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
