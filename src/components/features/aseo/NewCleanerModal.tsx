'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBackdropClose } from '@/lib/useBackdropClose';
import type { CleanerGroup } from '@/services/cleanerGroups';

interface Props {
  form: { name: string; contact: string; tagIds: string[] };
  setForm: (f: { name: string; contact: string; tagIds: string[] }) => void;
  saving: boolean;
  err: string | null;
  groups: CleanerGroup[];
  onCreateTag: (name: string) => Promise<string | null>;
  onClose: () => void;
  onCreate: () => void;
}

export default function NewCleanerModal({
  form, setForm, saving, err, groups, onCreateTag, onClose, onCreate,
}: Props) {
  const backdrop = useBackdropClose(onClose);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  const toggleTag = (id: string) => {
    setForm({
      ...form,
      tagIds: form.tagIds.includes(id)
        ? form.tagIds.filter(g => g !== id)
        : [...form.tagIds, id],
    });
  };

  const addTag = async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    const id = await onCreateTag(newTagName.trim());
    setCreatingTag(false);
    if (id) {
      setForm({ ...form, tagIds: [...form.tagIds, id] });
      setNewTagName('');
    }
  };

  return (
    <motion.div
      {...backdrop}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">Nueva persona de aseo</h3>
        {err && <p className="text-xs text-red-600 mb-3">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contacto</label>
            <input
              type="text"
              value={form.contact}
              onChange={e => setForm({ ...form, contact: e.target.value })}
              placeholder="Teléfono / WhatsApp"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Etiquetas (opcional)</label>
            <p className="text-[11px] text-slate-500 mb-2">Filtra por región, confianza u otros criterios. Una persona puede tener varias etiquetas.</p>
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {groups.map(g => {
                  const on = form.tagIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleTag(g.id)}
                      className={`px-2 py-1 text-xs font-semibold rounded-full border transition ${
                        on ? 'text-white' : 'text-slate-600 bg-white hover:bg-slate-50 border-slate-300'
                      }`}
                      style={on ? { backgroundColor: g.color ?? '#475569', borderColor: g.color ?? '#475569' } : undefined}
                    >
                      {on ? '✓ ' : '+ '}{g.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Nueva etiqueta (ej: Villavicencio, Confianza)"
                className="flex-1 px-2 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                type="button"
                onClick={addTag}
                disabled={creatingTag || !newTagName.trim()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                + Crear
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button
            onClick={onCreate}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
