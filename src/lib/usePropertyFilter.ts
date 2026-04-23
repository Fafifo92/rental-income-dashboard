import { useState, useEffect } from 'react';
import { listProperties } from '@/services/properties';
import type { PropertyRow } from '@/types/database';

const STORAGE_KEY = 'str_property_filter';

export function usePropertyFilter() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);

  const [propertyId, setPropertyIdState] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY) || undefined;
    }
    return undefined;
  });

  useEffect(() => {
    listProperties().then(res => {
      if (!res.error) {
        setProperties(res.data);
        // If saved ID no longer exists, clear it
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && !res.data.find(p => p.id === stored)) {
          localStorage.removeItem(STORAGE_KEY);
          setPropertyIdState(undefined);
        }
      }
    });
  }, []);

  const setPropertyId = (id: string | undefined) => {
    setPropertyIdState(id);
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    }
  };

  return { properties, propertyId, setPropertyId };
}
