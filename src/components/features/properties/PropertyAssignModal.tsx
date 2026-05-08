'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/lib/toast';
import { updateProperty } from '../../../services/properties';
import { setPropertyTags } from '../../../services/propertyTags';
import { makeBackdropHandlers } from '../../../lib/useBackdropClose';
import { resolveColor, type Property, type PropertyGroupRow, type PropertyTagRow } from './propertyTypes';

interface Props {
  property: Property;
  groups: PropertyGroupRow[];
  tags: PropertyTagRow[];
  currentTagIds: string[];
  onClose: () => void;
  onSaved: (groupId: string | null, tagIds: string[]) => void;
}

export default function PropertyAssignModal({
  property, groups, tags, currentTagIds, onClose, onSaved,
}: Props) {
  const [groupId, setGroupId] = useState<string | null>(property.group_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(currentTagIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const upd = await updateProperty(property.id, { group_id: groupId });
    if (upd.error) { setSaving(false); setError(upd.error); toast.error(upd.error); return; }
    const tagRes = await setPropertyTags(property.id, tagIds);
    setSaving(false);
    if (tagRes.error) { setError(tagRes.error); toast.error(tagRes.error); return; }
    toast.success('Cambios guardados');
    onSaved(groupId, tagIds);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-800 mb-1">Grupo y etiquetas</h2>
        <p className="text-xs text-slate-500 mb-4 truncate">{property.name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
            <select
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value || null)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value="">— Sin grupo —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Etiquetas</label>
            {tags.length === 0 ? (
              <p className="text-xs text-slate-400">No hay etiquetas. Crea algunas desde &quot;Gestionar etiquetas&quot;.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => {
                  const checked = tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTagIds(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])}
                      className="px-2 py-1 text-xs font-medium rounded border transition-colors"
                      style={checked
                        ? { backgroundColor: resolveColor(t.color), color: 'white', borderColor: resolveColor(t.color) }
                        : { backgroundColor: 'white', color: '#64748b', borderColor: '#e2e8f0' }}
                    >
                      {checked && '✓ '}{t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
