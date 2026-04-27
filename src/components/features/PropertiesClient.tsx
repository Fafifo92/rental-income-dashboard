import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../lib/useAuth';
import { listProperties, createProperty } from '../../services/properties';
import { makeBackdropHandlers } from '../../lib/useBackdropClose';

interface Property {
  id: string;
  name: string;
  address?: string | null;
  owner_id: string;
  created_at?: string | null;
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

// ─── Property Card ─────────────────────────────────────────────────────────────

function PropertyCard({ property, index, isDemo }: { property: Property; index: number; isDemo: boolean }) {
  const colorClass = CATEGORY_COLORS[index % CATEGORY_COLORS.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      <div className={`h-2 bg-gradient-to-r ${colorClass}`} />

      <div className="p-6">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-800 text-lg leading-tight truncate">{property.name}</h3>
          {property.address && (
            <p className="text-slate-500 text-sm mt-1 truncate">{property.address}</p>
          )}
          {isDemo && (
            <span className="inline-block mt-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
              Datos demo
            </span>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2">
          {!isDemo && (
            <a
              href={`/property-detail?id=${property.id}`}
              className="text-center text-xs font-medium text-blue-600 hover:text-blue-800 py-2 px-2 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Config.
            </a>
          )}
          <a
            href="/bookings"
            className="text-center text-xs font-medium text-slate-600 hover:text-slate-800 py-2 px-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Reservas
          </a>
          <a
            href="/expenses"
            className="text-center text-xs font-medium text-slate-600 hover:text-slate-800 py-2 px-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Gastos
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Create Property Modal ──────────────────────────────────────────────────────

function PropertyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Property) => void }) {
  const [name, setName]       = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const res = await createProperty(name.trim(), address.trim() || undefined);
    setSaving(false);
    if (res.error || !res.data) { setError(res.error ?? 'No se pudo crear'); return; }
    onCreated(res.data);
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 max-h-[90vh] overflow-y-auto"
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

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function PropertiesClient() {
  const authStatus                    = useAuth();
  const [properties, setProperties]   = useState<Property[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const isDemo                        = authStatus !== 'authed';

  useEffect(() => {
    if (authStatus === 'checking') return;

    if (authStatus === 'demo') {
      setProperties(DEMO_PROPERTIES);
      setLoading(false);
      return;
    }

    // Authenticated — load from Supabase
    listProperties().then(res => {
      setProperties(res.error ? [] : res.data as Property[]);
      setLoading(false);
    });
  }, [authStatus]);

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
        className="flex items-center justify-between mb-6"
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map((p, i) => (
            <PropertyCard key={p.id} property={p} index={i} isDemo={isDemo} />
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

      {/* Create modal */}
      <AnimatePresence>
        {showModal && (
          <PropertyModal
            onClose={() => setShowModal(false)}
            onCreated={(p) => {
              setProperties(prev => [...prev, p]);
              setShowModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
