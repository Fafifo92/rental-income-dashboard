import { useEffect, useState } from 'react';
import PropertyDetailClient from './PropertyDetailClient';

export default function PropertyDetailWrapper() {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPropertyId(params.get('id'));
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!propertyId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800">
        Falta el parámetro <code>?id=</code> en la URL.
        <a href="/properties" className="block mt-3 font-semibold underline">← Volver a propiedades</a>
      </div>
    );
  }

  return <PropertyDetailClient propertyId={propertyId} />;
}
