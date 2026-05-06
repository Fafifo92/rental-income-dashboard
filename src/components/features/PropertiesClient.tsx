import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../lib/useAuth';
import { listProperties, createProperty, updateProperty } from '../../services/properties';
import {
  listPropertyGroups, createPropertyGroup, updatePropertyGroup, deletePropertyGroup,
} from '../../services/propertyGroups';
import {
  listPropertyTags, createPropertyTag, updatePropertyTag, deletePropertyTag,
  listAllTagAssignments, setPropertyTags,
  addPropertyTagAssignment, removePropertyTagAssignment,
} from '../../services/propertyTags';
import { makeBackdropHandlers } from '../../lib/useBackdropClose';
import type { PropertyGroupRow, PropertyTagRow, PropertyTagAssignmentRow } from '@/types/database';

interface Property {
  id: string;
  name: string;
  address?: string | null;
  owner_id: string;
  created_at?: string | null;
  group_id?: string | null;
}

const DEMO_PROPERTIES: Property[] = [
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

const CATEGORY_COLORS = ['from-blue-500 to-indigo-600', 'from-emerald-500 to-teal-600', 'from-violet-500 to-purple-600', 'from-orange-500 to-amber-600'];

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

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
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

// ─── Property Card ─────────────────────────────────────────────────────────────

function PropertyCard({
  property, index, isDemo, group, tags, onEdit,
}: {
  property: Property;
  index: number;
  isDemo: boolean;
  group?: PropertyGroupRow;
  tags?: PropertyTagRow[];
  onEdit?: () => void;
}) {
  const colorClass = CATEGORY_COLORS[index % CATEGORY_COLORS.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      <div className={`h-2 bg-gradient-to-r ${colorClass}`} />

      <div className="p-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="font-bold text-slate-800 text-lg leading-tight truncate flex-1">{property.name}</h3>
            {group && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                style={{
                  backgroundColor: resolveColor(group.color) + '18',
                  borderColor: resolveColor(group.color) + '50',
                  color: resolveColor(group.color),
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: resolveColor(group.color) }} />
                {group.name}
              </span>
            )}
          </div>
          {property.address && (
            <p className="text-slate-500 text-sm mt-1 truncate">{property.address}</p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map(t => (
                <span
                  key={t.id}
                  className="px-1.5 py-0.5 text-[10px] font-medium rounded border"
                  style={{
                    backgroundColor: resolveColor(t.color) + '18',
                    borderColor: resolveColor(t.color) + '50',
                    color: resolveColor(t.color),
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {isDemo && (
            <span className="inline-block mt-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
              Datos demo
            </span>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-4 gap-2">
          {!isDemo && (
            <a
              href={`/property-detail?id=${property.id}`}
              className="text-center text-xs font-medium text-blue-600 hover:text-blue-800 py-2 px-1 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Config.
            </a>
          )}
          {!isDemo && onEdit && (
            <button
              onClick={onEdit}
              title="Asignar grupo y etiquetas"
              className="text-center text-xs font-medium text-violet-600 hover:text-violet-800 py-2 px-1 rounded-lg hover:bg-violet-50 transition-colors"
            >
              Organizar
            </button>
          )}
          <a
            href={`/bookings?property=${property.id}`}
            className="text-center text-xs font-medium text-slate-600 hover:text-slate-800 py-2 px-1 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Reservas
          </a>
          <a
            href={`/expenses?property=${property.id}`}
            className="text-center text-xs font-medium text-slate-600 hover:text-slate-800 py-2 px-1 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Gastos
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Create Property Modal ──────────────────────────────────────────────────────

function PropertyModal({
  onClose, onCreated, groups, tags,
}: {
  onClose: () => void;
  onCreated: (p: Property) => void;
  groups: PropertyGroupRow[];
  tags: PropertyTagRow[];
}) {
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
                      className={`px-2 py-1 text-xs font-medium rounded border ${
                        checked ? COLOR_PILL[t.color] ?? COLOR_PILL.blue : 'bg-white text-slate-500 border-slate-200'
                      }`}
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

// ─── Edit assignment (group/tags) modal ─────────────────────────────────────────

function PropertyAssignModal({
  property, groups, tags, currentTagIds, onClose, onSaved,
}: {
  property: Property;
  groups: PropertyGroupRow[];
  tags: PropertyTagRow[];
  currentTagIds: string[];
  onClose: () => void;
  onSaved: (groupId: string | null, tagIds: string[]) => void;
}) {
  const [groupId, setGroupId] = useState<string | null>(property.group_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(currentTagIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const upd = await updateProperty(property.id, { group_id: groupId });
    if (upd.error) { setSaving(false); setError(upd.error); return; }
    const tagRes = await setPropertyTags(property.id, tagIds);
    setSaving(false);
    if (tagRes.error) { setError(tagRes.error); return; }
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
              <p className="text-xs text-slate-400">No hay etiquetas. Crea algunas desde "Gestionar etiquetas".</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => {
                  const checked = tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTagIds(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])}
                      className={`px-2 py-1 text-xs font-medium rounded border ${
                        checked ? COLOR_PILL[t.color] ?? COLOR_PILL.blue : 'bg-white text-slate-500 border-slate-200'
                      }`}
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

// ─── Groups manager modal ───────────────────────────────────────────────────────

function GroupsManagerModal({
  groups, properties, onClose, onChanged, onPropertiesChanged,
}: {
  groups: PropertyGroupRow[];
  properties: Property[];
  onClose: () => void;
  onChanged: (groups: PropertyGroupRow[]) => void;
  onPropertiesChanged: (properties: Property[]) => void;
}) {
  const [items, setItems] = useState<PropertyGroupRow[]>(groups);
  const [props, setProps] = useState<Property[]>(properties);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('#3b82f6');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [propSearch, setPropSearch] = useState('');

  // Mantener sincronizado si el padre actualiza
  useEffect(() => { setItems(groups); }, [groups]);
  useEffect(() => { setProps(properties); }, [properties]);

  const refresh = async () => {
    const r = await listPropertyGroups();
    if (r.data) { setItems(r.data); onChanged(r.data); }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const r = await createPropertyGroup({ name: newName.trim(), color: newColor });
    if (r.error) { setError(r.error); return; }
    setNewName(''); setNewColor('slate'); setError(null);
    await refresh();
  };

  const handleUpdate = async (id: string, patch: Partial<{ name: string; color: string }>) => {
    const r = await updatePropertyGroup(id, patch);
    if (r.error) { setError(r.error); return; }
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este grupo? Las propiedades asociadas quedarán sin grupo.')) return;
    const r = await deletePropertyGroup(id);
    if (r.error) { setError(r.error); return; }
    // Refleja localmente: limpiar group_id de propiedades de ese grupo
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
    if (r.error) { setError(r.error); return; }
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

        {/* Existing */}
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

        {/* Add new */}
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

// ─── Tags manager modal ────────────────────────────────────────────────────────

function TagsManagerModal({
  tags, properties, tagAssigns, onClose, onChanged, onTagAssignsChanged,
}: {
  tags: PropertyTagRow[];
  properties: Property[];
  tagAssigns: PropertyTagAssignmentRow[];
  onClose: () => void;
  onChanged: (tags: PropertyTagRow[]) => void;
  onTagAssignsChanged: (assigns: PropertyTagAssignmentRow[]) => void;
}) {
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
    if (r.error) { setError(r.error); return; }
    setNewName(''); setNewColor('blue'); setError(null);
    await refresh();
  };

  const handleUpdate = async (id: string, patch: Partial<{ name: string; color: string }>) => {
    const r = await updatePropertyTag(id, patch);
    if (r.error) { setError(r.error); return; }
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta etiqueta? Se removerá de todas las propiedades.')) return;
    const r = await deletePropertyTag(id);
    if (r.error) { setError(r.error); return; }
    await Promise.all([refresh(), refreshAssigns()]);
  };

  const togglePropertyTag = async (tagId: string, propertyId: string) => {
    const has = assigns.some(a => a.tag_id === tagId && a.property_id === propertyId);
    const r = has
      ? await removePropertyTagAssignment(propertyId, tagId)
      : await addPropertyTagAssignment(propertyId, tagId);
    if (r.error) { setError(r.error); return; }
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

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function PropertiesClient() {
  const authStatus                    = useAuth();
  const [properties, setProperties]   = useState<Property[]>([]);
  const [groups, setGroups]           = useState<PropertyGroupRow[]>([]);
  const [tags, setTags]               = useState<PropertyTagRow[]>([]);
  const [tagAssigns, setTagAssigns]   = useState<PropertyTagAssignmentRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [showGroupsMgr, setShowGroupsMgr] = useState(false);
  const [showTagsMgr, setShowTagsMgr] = useState(false);
  const [editing, setEditing]         = useState<Property | null>(null);
  const isDemo                        = authStatus !== 'authed';

  useEffect(() => {
    if (authStatus === 'checking') return;

    if (authStatus === 'demo') {
      setProperties(DEMO_PROPERTIES);
      setLoading(false);
      return;
    }

    Promise.all([
      listProperties(),
      listPropertyGroups(),
      listPropertyTags(),
      listAllTagAssignments(),
    ]).then(([propRes, gRes, tRes, aRes]) => {
      setProperties(propRes.error ? [] : (propRes.data as Property[]));
      if (gRes.data) setGroups(gRes.data);
      if (tRes.data) setTags(tRes.data);
      if (aRes.data) setTagAssigns(aRes.data);
      setLoading(false);
    });
  }, [authStatus]);

  const tagsByPropertyId = useMemo(() => {
    const idx = new Map<string, PropertyTagRow[]>();
    const tagById = new Map(tags.map(t => [t.id, t]));
    tagAssigns.forEach(a => {
      const t = tagById.get(a.tag_id);
      if (!t) return;
      const arr = idx.get(a.property_id) ?? [];
      arr.push(t);
      idx.set(a.property_id, arr);
    });
    return idx;
  }, [tags, tagAssigns]);

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  // Group properties by group for display
  const grouped = useMemo(() => {
    const sortedGroups = [...groups].sort(
      (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name),
    );
    const sections: { group: PropertyGroupRow | null; items: Property[] }[] = [];
    sortedGroups.forEach(g => {
      const items = properties.filter(p => p.group_id === g.id);
      if (items.length > 0) sections.push({ group: g, items });
    });
    const ungrouped = properties.filter(p => !p.group_id);
    if (ungrouped.length > 0) sections.push({ group: null, items: ungrouped });
    return sections;
  }, [groups, properties]);

  if (authStatus === 'checking' || loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-pulse">
            <div className="h-2 bg-slate-200" />
            <div className="p-6 space-y-3">
              <div className="h-4 bg-slate-200 rounded w-3/4" />
              <div className="h-3 bg-slate-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-4 flex-wrap gap-3"
      >
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Propiedades
            {isDemo && (
              <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full align-middle">
                Modo demo
              </span>
            )}
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            {properties.length} propiedad{properties.length !== 1 ? 'es' : ''} registrada{properties.length !== 1 ? 's' : ''}
          </p>
        </div>

        {authStatus === 'authed' && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm text-sm"
          >
            <span>+</span> Nueva Propiedad
          </button>
        )}
      </motion.div>

      {/* Groups & tags admin section */}
      {authStatus === 'authed' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <h3 className="text-sm font-bold text-slate-700">🏷️ Grupos y etiquetas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Organiza tus propiedades por edificios, zonas o características.
            </p>
          </div>
          <button
            onClick={() => setShowGroupsMgr(true)}
            className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
          >
            Gestionar grupos ({groups.length})
          </button>
          <button
            onClick={() => setShowTagsMgr(true)}
            className="px-3 py-2 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100"
          >
            Gestionar etiquetas ({tags.length})
          </button>
        </div>
      )}

      {/* Properties grid */}
      {properties.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-12 text-center"
        >
          <div className="text-4xl mb-4 text-slate-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4a1 1 0 001-1v-5h2v5a1 1 0 001 1h4a1 1 0 001-1V10" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Sin propiedades aún</h3>
          <p className="text-slate-500 mb-6 max-w-sm mx-auto">
            Agrega tu primera propiedad para comenzar a registrar reservas y gastos por unidad.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            + Nueva Propiedad
          </button>
        </motion.div>
      ) : isDemo || groups.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map((p, i) => (
            <PropertyCard
              key={p.id}
              property={p}
              index={i}
              isDemo={isDemo}
              group={p.group_id ? groupById.get(p.group_id) : undefined}
              tags={tagsByPropertyId.get(p.id) ?? []}
              onEdit={!isDemo ? () => setEditing(p) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(section => (
            <div key={section.group?.id ?? 'none'}>
              <div className="flex items-center gap-2 mb-3">
                {section.group && (
                  <span className={`w-3 h-3 rounded-full ${COLOR_DOT[section.group.color] ?? COLOR_DOT.slate}`} />
                )}
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                  {section.group?.name ?? 'Sin grupo'}
                </h3>
                <span className="text-xs text-slate-400">({section.items.length})</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {section.items.map((p, i) => (
                  <PropertyCard
                    key={p.id}
                    property={p}
                    index={i}
                    isDemo={isDemo}
                    group={p.group_id ? groupById.get(p.group_id) : undefined}
                    tags={tagsByPropertyId.get(p.id) ?? []}
                    onEdit={() => setEditing(p)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Login prompt for demo users */}
      {isDemo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-sm text-slate-600"
        >
          ¿Quieres gestionar tus propiedades reales?{' '}
          <a href="/login" className="font-semibold text-blue-600 hover:text-blue-800 underline">
            Crea tu cuenta gratis →
          </a>
        </motion.div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showModal && (
          <PropertyModal
            onClose={() => setShowModal(false)}
            onCreated={(p) => {
              setProperties(prev => [...prev, p]);
              setShowModal(false);
              // Refresh assignments to reflect any tag selection
              listAllTagAssignments().then(r => { if (r.data) setTagAssigns(r.data); });
            }}
            groups={groups}
            tags={tags}
          />
        )}
        {showGroupsMgr && (
          <GroupsManagerModal
            groups={groups}
            properties={properties}
            onClose={() => setShowGroupsMgr(false)}
            onChanged={setGroups}
            onPropertiesChanged={setProperties}
          />
        )}
        {showTagsMgr && (
          <TagsManagerModal
            tags={tags}
            properties={properties}
            tagAssigns={tagAssigns}
            onClose={() => setShowTagsMgr(false)}
            onChanged={setTags}
            onTagAssignsChanged={setTagAssigns}
          />
        )}
        {editing && (
          <PropertyAssignModal
            property={editing}
            groups={groups}
            tags={tags}
            currentTagIds={(tagsByPropertyId.get(editing.id) ?? []).map(t => t.id)}
            onClose={() => setEditing(null)}
            onSaved={(groupId, tagIds) => {
              setProperties(prev => prev.map(p => p.id === editing.id ? { ...p, group_id: groupId } : p));
              // Update assignments locally
              setTagAssigns(prev => {
                const others = prev.filter(a => a.property_id !== editing.id);
                const ownerId = editing.owner_id;
                const newOnes: PropertyTagAssignmentRow[] = tagIds.map(tag_id => ({
                  property_id: editing.id, tag_id, owner_id: ownerId, created_at: new Date().toISOString(),
                }));
                return [...others, ...newOnes];
              });
              setEditing(null);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
