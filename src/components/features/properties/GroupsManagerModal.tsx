'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/lib/toast';
import {
  listPropertyGroups, createPropertyGroup, updatePropertyGroup, deletePropertyGroup,
} from '../../../services/propertyGroups';
import { updateProperty } from '../../../services/properties';
import { makeBackdropHandlers } from '../../../lib/useBackdropClose';
import { resolveColor, ColorPicker, type Property, type PropertyGroupRow } from './propertyTypes';

interface Props {
  groups: PropertyGroupRow[];
  properties: Property[];
  onClose: () => void;
  onChanged: (groups: PropertyGroupRow[]) => void;
  onPropertiesChanged: (properties: Property[]) => void;
}

export default function GroupsManagerModal({
  groups, properties, onClose, onChanged, onPropertiesChanged,
}: Props) {
  const [items, setItems] = useState<PropertyGroupRow[]>(groups);
  const [props, setProps] = useState<Property[]>(properties);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('#3b82f6');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [propSearch, setPropSearch] = useState('');

  useEffect(() => { setItems(groups); }, [groups]);
  useEffect(() => { setProps(properties); }, [properties]);

  const refresh = async () => {
    const r = await listPropertyGroups();
    if (r.data) { setItems(r.data); onChanged(r.data); }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const r = await createPropertyGroup({ name: newName.trim(), color: newColor });
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    setNewName(''); setNewColor('slate'); setError(null);
    toast.success('Grupo creado');
    await refresh();
  };

  const handleUpdate = async (id: string, patch: Partial<{ name: string; color: string }>) => {
    const r = await updatePropertyGroup(id, patch);
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    toast.success('Grupo actualizado');
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este grupo? Las propiedades asociadas quedarán sin grupo.')) return;
    const r = await deletePropertyGroup(id);
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    toast.success('Grupo eliminado');
    const updated = props.map(p => p.group_id === id ? { ...p, group_id: null } : p);
    setProps(updated);
    onPropertiesChanged(updated);
    await refresh();
  };

  const togglePropertyGroup = async (groupId: string, propertyId: string) => {
    const prop = props.find(p => p.id === propertyId);
    if (!prop) return;
    const isAssigned = prop.group_id === groupId;
    const newGroupId = isAssigned ? null : groupId;
    const r = await updateProperty(propertyId, { group_id: newGroupId });
    if (r.error) { setError(r.error); toast.error(r.error); return; }
    const updated = props.map(p => p.id === propertyId ? { ...p, group_id: newGroupId } : p);
    setProps(updated);
    onPropertiesChanged(updated);
  };

  const filteredProps = (() => {
    const q = propSearch.trim().toLowerCase();
    if (!q) return props;
    return props.filter(p => p.name.toLowerCase().includes(q));
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
        <h2 className="text-lg font-bold text-slate-800 mb-1">Gestionar grupos</h2>
        <p className="text-xs text-slate-500 mb-4">Una propiedad pertenece a un único grupo. Marcar la mueve a este grupo (sale del anterior).</p>

        <div className="space-y-2 mb-5">
          {items.length === 0 && <p className="text-xs text-slate-400">No hay grupos. Crea uno abajo.</p>}
          {items.map(g => {
            const memberCount = props.filter(p => p.group_id === g.id).length;
            const expanded = expandedId === g.id;
            return (
              <div key={g.id} className="border border-slate-200 rounded-lg">
                <div className="flex items-center gap-2 p-2">
                  <input
                    type="text"
                    defaultValue={g.name}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== g.name) handleUpdate(g.id, { name: e.target.value.trim() }); }}
                    className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded"
                  />
                  <input
                    type="color"
                    value={resolveColor(g.color)}
                    onChange={e => handleUpdate(g.id, { color: e.target.value })}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                    title="Color del grupo"
                  />
                  <button onClick={() => handleDelete(g.id)} className="text-rose-600 hover:text-rose-800 text-xs px-2 py-1" title="Eliminar grupo">
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => { setExpandedId(expanded ? null : g.id); setPropSearch(''); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 bg-slate-50 hover:bg-slate-100 border-t border-slate-100 rounded-b-lg flex items-center justify-between"
                >
                  <span>{expanded ? '▾' : '▸'} Asignar propiedades · {memberCount} en este grupo</span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 p-2 bg-white">
                    {props.length === 0 ? (
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
                            const checked = p.group_id === g.id;
                            const inOtherGroup = !!p.group_id && p.group_id !== g.id;
                            return (
                              <label key={p.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 cursor-pointer rounded">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePropertyGroup(g.id, p.id)}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="flex-1 text-xs text-slate-700 truncate">{p.name}</span>
                                {inOtherGroup && (
                                  <span className="text-[9px] text-amber-600 italic">en otro grupo</span>
                                )}
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
          <p className="text-xs font-semibold text-slate-600">Nuevo grupo</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ej: Edificio Aurora"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            + Agregar grupo
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
