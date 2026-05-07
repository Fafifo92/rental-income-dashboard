'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/lib/toast';
import { createProperty, updateProperty } from '../../../services/properties';
import { setPropertyTags } from '../../../services/propertyTags';
import { makeBackdropHandlers } from '../../../lib/useBackdropClose';
import { resolveColor, type Property, type PropertyGroupRow, type PropertyTagRow } from './propertyTypes';

interface Props {
  onClose: () => void;
  onCreated: (p: Property) => void;
  groups: PropertyGroupRow[];
  tags: PropertyTagRow[];
}

export default function PropertyModal({ onClose, onCreated, groups, tags }: Props) {
  const [name, setName]         = useState('');
  const [address, setAddress]   = useState('');
  const [rnt, setRnt]           = useState('');
  const [groupId, setGroupId]   = useState<string | null>(null);
  const [tagIds, setTagIds]     = useState<string[]>([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const res = await createProperty(
      name.trim(),
      address.trim() || undefined,
      'COP',
      rnt.trim() || null,
    );
    if (res.error || !res.data) {
      setSaving(false);
      setError(res.error ?? 'No se pudo crear');
      toast.error(res.error ?? 'No se pudo crear la propiedad');
      return;
    }
    const created = res.data;
    if (groupId) {
      await updateProperty(created.id, { group_id: groupId });
      created.group_id = groupId;
    }
    if (tagIds.length > 0) {
      await setPropertyTags(created.id, tagIds);
    }
    setSaving(false);
    toast.success('Propiedad creada');
    onCreated(created as Property);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 12 }}
        transition={{ duration: 0.25 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 sm:p-8 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-slate-800 mb-6">Nueva Propiedad</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nombre de la propiedad <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Apto El Poblado 204"
              required
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Dirección (opcional)</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Ej: Calle 10 #43E-31, El Poblado"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              RNT <span className="text-slate-400 font-normal">(Registro Nacional de Turismo, opcional)</span>
            </label>
            <input
              type="text"
              value={rnt}
              onChange={e => setRnt(e.target.value)}
              placeholder="Ej: 123456"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Grupo (opcional)</label>
            <select
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value || null)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Sin grupo —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          {tags.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Etiquetas (opcional)</label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
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
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Guardando…' : 'Crear propiedad'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
