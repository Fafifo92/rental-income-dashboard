import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listProperties } from '@/services/properties';
import type { PropertyRow } from '@/types/database';

interface Props {
  uniqueNames: string[];
  onConfirm(map: Record<string, string>, isDemo: boolean): void;
  onBack(): void;
}

export default function ListingMapper({ uniqueNames, onConfirm, onBack }: Props) {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    listProperties().then(result => {
      if (!result.error) setProperties(result.data);
      setLoading(false);
    });
  }, []);

  const isDemo = !loading && properties.length === 0;
  const anyMapped = Object.values(map).some(v => !!v);

  const handleConfirm = () => {
    if (isDemo) {
      const demoMap = Object.fromEntries(uniqueNames.map(n => [n, 'demo']));
      onConfirm(demoMap, true);
    } else {
      // Only pass entries that have been assigned; unmapped will be skipped
      onConfirm(map, false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      <div className={`rounded-xl p-4 border ${isDemo ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
        <p className={`text-sm font-semibold ${isDemo ? 'text-amber-900' : 'text-blue-900'}`}>
          {isDemo ? '⚠️ Sin propiedades — Modo demo' : '🔗 Vincula anuncios a propiedades'}
        </p>
        <p className={`text-xs mt-1 ${isDemo ? 'text-amber-700' : 'text-blue-700'}`}>
          {isDemo
            ? 'No hay propiedades en la base de datos. Las reservas se guardarán localmente en el navegador.'
            : `Encontramos ${uniqueNames.length} anuncio(s) único(s). Asigna los que quieras importar — los que dejes sin seleccionar serán omitidos.`}
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {uniqueNames.map((_, i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3 max-h-64 overflow-y-auto">
          <AnimatePresence>
            {uniqueNames.map((name, i) => (
              <motion.div
                key={name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Anuncio de Airbnb</p>
                </div>
                <span className="text-slate-300 font-bold">→</span>
                <div className="w-56 flex-shrink-0">
                  {isDemo ? (
                    <span className="block w-full text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                      Demo: guardado localmente
                    </span>
                  ) : (
                    <select
                      value={map[name] ?? ''}
                      onChange={e => setMap(prev => ({ ...prev, [name]: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    >
                      <option value="">— Omitir este anuncio</option>
                      {properties.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="px-5 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          ← Atrás
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleConfirm}
          disabled={!isDemo && !anyMapped}
          className="flex-1 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isDemo ? '💾 Guardar en modo demo →' : `Confirmar y persistir →`}
        </motion.button>
      </div>
    </motion.div>
  );
}
