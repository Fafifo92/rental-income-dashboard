import { useState, useEffect } from 'react';
import { listProperties } from '@/services/properties';
import { listPropertyGroups } from '@/services/propertyGroups';
import { listPropertyTags, listAllTagAssignments } from '@/services/propertyTags';
import type {
  PropertyRow,
  PropertyGroupRow,
  PropertyTagRow,
  PropertyTagAssignmentRow,
} from '@/types/database';

/**
 * Hook de filtro multi-propiedad.
 *
 * - `propertyIds`: array de IDs seleccionadas. Vacío = sin filtro (todas).
 *   Se resetea a [] en cada recarga de página (no persiste).
 * - `setPropertyIds`: setter en memoria.
 *
 * Back-compat:
 * - `propertyId`: primer ID si solo hay uno seleccionado, `undefined` en otro caso.
 *
 * Extras (organización):
 * - `groups`, `tags`, `tagAssigns`: cargados en paralelo. Permiten al filtro
 *   buscar/seleccionar propiedades por grupo o etiqueta.
 */
export function usePropertyFilter() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [groups, setGroups] = useState<PropertyGroupRow[]>([]);
  const [tags, setTags] = useState<PropertyTagRow[]>([]);
  const [tagAssigns, setTagAssigns] = useState<PropertyTagAssignmentRow[]>([]);

  const [propertyIds, setPropertyIdsState] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      listProperties(),
      listPropertyGroups(),
      listPropertyTags(),
      listAllTagAssignments(),
    ]).then(([propRes, gRes, tRes, aRes]) => {
      if (gRes.data) setGroups(gRes.data);
      if (tRes.data) setTags(tRes.data);
      if (aRes.data) setTagAssigns(aRes.data);

      if (propRes.error || !propRes.data) return;
      setProperties(propRes.data);

      // Si la URL trae ?property=<id> (o ?property=a,b), aplica ese filtro.
      // Útil para deep-links desde la página de Propiedades.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('property') ?? params.get('properties');
        if (raw) {
          const urlIds = raw.split(',').map(s => s.trim()).filter(Boolean);
          const valid = urlIds.filter(id => propRes.data!.some(p => p.id === id));
          if (valid.length > 0) {
            setPropertyIdsState(valid);
          }
        }
      }
    });
  }, []);

  const setPropertyIds = (ids: string[]) => setPropertyIdsState(ids);

  const propertyId = propertyIds.length === 1 ? propertyIds[0] : undefined;
  const setPropertyId = (id: string | undefined) => setPropertyIds(id ? [id] : []);

  return {
    properties,
    propertyIds,
    setPropertyIds,
    propertyId,
    setPropertyId,
    groups,
    tags,
    tagAssigns,
  };
}
