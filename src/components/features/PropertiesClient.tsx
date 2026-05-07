import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../lib/useAuth';
import { listProperties } from '../../services/properties';
import { listPropertyGroups } from '../../services/propertyGroups';
import { listPropertyTags, listAllTagAssignments } from '../../services/propertyTags';
import type { PropertyGroupRow, PropertyTagRow, PropertyTagAssignmentRow } from '@/types/database';
import { DEMO_PROPERTIES, type Property } from './properties/propertyTypes';
import PropertyCard from './properties/PropertyCard';
import PropertyModal from './properties/PropertyModal';
import PropertyAssignModal from './properties/PropertyAssignModal';
import GroupsManagerModal from './properties/GroupsManagerModal';
import TagsManagerModal from './properties/TagsManagerModal';

// Re-export for OccupancyByProperty (and any other consumer)
export { resolveColor } from './properties/propertyTypes';

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
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: section.group.color }} />
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

