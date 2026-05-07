'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/lib/toast';
import {
  listPropertyTags, createPropertyTag, updatePropertyTag, deletePropertyTag,
  listAllTagAssignments, addPropertyTagAssignment, removePropertyTagAssignment,
} from '../../../services/propertyTags';
import { makeBackdropHandlers } from '../../../lib/useBackdropClose';
import { resolveColor, ColorPicker, type Property, type PropertyTagRow } from './propertyTypes';
import type { PropertyTagAssignmentRow } from '@/types/database';

interface Props {
  tags: PropertyTagRow[];
  properties: Property[];
  tagAssigns: PropertyTagAssignmentRow[];
  onClose: () => void;
  onChanged: (tags: PropertyTagRow[]) => void;
  onTagAssignsChanged: (assigns: PropertyTagAssignmentRow[]) => void;
}

export default function TagsManagerModal({
  tags, properties, tagAssigns, onClose, onChanged, onTagAssignsChanged,
}: Props) {
  const [items, setItems] = useState<PropertyTagRow[]>(tags);
  const [assigns, setAssigns] = useState<PropertyTagAssignmentRow[]>(tagAssigns);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('#3b82f6');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [propSearch, setPropSearch] = useState('');

  useEffect(() => { setItems(tags); }, [tags]);
  useEffect(() => { setAssigns(tagAssigns); }, [tagAssigns]);

  const refresh = async () => {
    const r = await listPropertyTags();
    if (r.data) { setItems(r.data); onChanged(r.data); }
  };

  const refreshAssigns = async () => {
    const r = await listAllTagAssignments();
    if (r.data) { setAssigns(r.data); onTagAssignsChanged(r.data); }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const r = await createPropertyTag({ name: newName.trim(), color: newColor });
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    setNewName(''); setNewColor('blue'); setError(null);
    toast.success('Etiqueta creada');
    await refresh();
  };

  const handleUpdate = async (id: string, patch: Partial<{ name: string; color: string }>) => {
    const r = await updatePropertyTag(id, patch);
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    toast.success('Etiqueta actualizada');
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta etiqueta? Se removerá de todas las propiedades.')) return;
    const r = await deletePropertyTag(id);
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    toast.success('Etiqueta eliminada');
    await Promise.all([refresh(), refreshAssigns()]);
  };

  const togglePropertyTag = async (tagId: string, propertyId: string) => {
    const has = assigns.some(a => a.tag_id === tagId && a.property_id === propertyId);
    const r = has
      ? await removePropertyTagAssignment(propertyId, tagId)
      : await addPropertyTagAssignment(propertyId, tagId);
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    await refreshAssigns();
  };

  const filteredProps = (() => {
    const q = propSearch.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter(p => p.name.toLowerCase().includes(q));
  })();

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      {...makeBackdropHandlers(onClose)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-800 mb-1">Gestionar etiquetas</h2>
        <p className="text-xs text-slate-500 mb-4">Crea etiquetas reutilizables y asígnalas a las propiedades que aplican (no se aplican a todas automáticamente).</p>

        <div className="space-y-2 mb-5">
          {items.length === 0 && <p className="text-xs text-slate-400">No hay etiquetas. Crea una abajo.</p>}
          {items.map(t => {
            const memberCount = assigns.filter(a => a.tag_id === t.id).length;
            const expanded = expandedId === t.id;
            return (
              <div key={t.id} className="border border-slate-200 rounded-lg">
                <div className="flex items-center gap-2 p-2">
                  <input
                    type="text"
                    defaultValue={t.name}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== t.name) handleUpdate(t.id, { name: e.target.value.trim() }); }}
                    className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded"
                  />
                  <input
                    type="color"
                    value={resolveColor(t.color)}
                    onChange={e => handleUpdate(t.id, { color: e.target.value })}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                    title="Color de la etiqueta"
                  />
                  <button onClick={() => handleDelete(t.id)} className="text-rose-600 hover:text-rose-800 text-xs px-2 py-1" title="Eliminar etiqueta">
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => { setExpandedId(expanded ? null : t.id); setPropSearch(''); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 bg-slate-50 hover:bg-slate-100 border-t border-slate-100 rounded-b-lg flex items-center justify-between"
                >
                  <span>{expanded ? '▾' : '▸'} Asignar propiedades · {memberCount} con esta etiqueta</span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 p-2 bg-white">
                    {properties.length === 0 ? (
                      <p className="text-xs text-slate-400 px-2 py-3">No hay propiedades.</p>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={propSearch}
                          onChange={e => setPropSearch(e.target.value)}
                          placeholder="Buscar propiedad…"
                          className="w-full mb-2 px-2 py-1 text-xs border border-slate-200 rounded"
                        />
                        <div className="max-h-44 overflow-y-auto space-y-0.5">
                          {filteredProps.length === 0 && <p className="text-xs text-slate-400 px-1 py-2">Sin resultados</p>}
                          {filteredProps.map(p => {
                            const checked = assigns.some(a => a.tag_id === t.id && a.property_id === p.id);
                            return (
                              <label key={p.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 cursor-pointer rounded">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePropertyTag(t.id, p.id)}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="flex-1 text-xs text-slate-700 truncate">{p.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Nueva etiqueta</p>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Ej: Pet-friendly"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            + Agregar etiqueta
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cerrar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
