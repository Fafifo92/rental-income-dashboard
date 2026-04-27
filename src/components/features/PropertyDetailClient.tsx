import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import { getProperty, updateProperty } from '@/services/properties';
import { listRecurringExpenses } from '@/services/recurringExpenses';
import type {
  PropertyRow,
  PropertyRecurringExpenseRow,
  VendorPropertyRow,
} from '@/types/database';
import { listVendors, type Vendor } from '@/services/vendors';
import { listAllVendorProperties } from '@/services/vendorProperties';
import { formatCurrency } from '@/lib/utils';

interface Props { propertyId: string; }

type Tab = 'details' | 'services';

export default function PropertyDetailClient({ propertyId }: Props) {
  const authStatus = useAuth(true);
  const [tab, setTab] = useState<Tab>('details');
  const [property, setProperty] = useState<PropertyRow | null>(null);
  const [recurring, setRecurring] = useState<PropertyRecurringExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    const [propRes, recRes] = await Promise.all([
      getProperty(propertyId),
      listRecurringExpenses(propertyId),
    ]);
    if (propRes.error) setError(propRes.error);
    else setProperty(propRes.data);
    if (!recRes.error) setRecurring(recRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (authStatus === 'authed') loadAll();
  }, [authStatus, propertyId]);

  if (authStatus === 'checking' || loading) {
    return <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />;
  }

  if (error || !property) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
        {error ?? 'Propiedad no encontrada.'}
        <a href="/properties" className="block mt-3 font-semibold underline">← Volver a propiedades</a>
      </div>
    );
  }

  const activeRecurring = recurring.filter(r => r.is_active);

  return (
    <>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <a href="/properties" className="text-sm text-slate-500 hover:text-blue-600">← Propiedades</a>
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-1">{property.name}</h2>
        {property.address && <p className="text-slate-500 mt-0.5">{property.address}</p>}
      </motion.div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6 flex gap-1">
        {(['details', 'services'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              tab === t ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'details' ? 'Configuración' : 'Servicios que la cubren'}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <DetailsTab property={property} onSaved={loadAll} />
      )}

      {tab === 'services' && (
        <ServicesTab propertyId={propertyId} legacyRecurrings={activeRecurring} />
      )}
    </>
  );
}

// ─── Tab: Configuración ──────────────────────────────────────────────

function DetailsTab({ property, onSaved }: { property: PropertyRow; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: property.name,
    address: property.address ?? '',
    estrato: property.estrato ?? '',
    bedrooms: property.bedrooms ?? '',
    max_guests: property.max_guests ?? '',
    default_cleaning_fee: property.default_cleaning_fee ?? '',
    notes: property.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setError(null);
    const res = await updateProperty(property.id, {
      name: form.name.trim(),
      address: form.address.trim() || null,
      estrato: form.estrato === '' ? null : Number(form.estrato),
      bedrooms: form.bedrooms === '' ? null : Number(form.bedrooms),
      max_guests: form.max_guests === '' ? null : Number(form.max_guests),
      default_cleaning_fee: form.default_cleaning_fee === '' ? null : Number(form.default_cleaning_fee),
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setMsg('Guardado ✓');
    onSaved();
    setTimeout(() => setMsg(null), 2000);
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 max-w-2xl"
    >
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre *</label>
        <input
          type="text" required
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Dirección</label>
        <input
          type="text"
          value={form.address}
          onChange={e => setForm({ ...form, address: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Estrato</label>
          <input
            type="number" min={1} max={6}
            value={form.estrato}
            onChange={e => setForm({ ...form, estrato: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Habitaciones</label>
          <input
            type="number" min={0}
            value={form.bedrooms}
            onChange={e => setForm({ ...form, bedrooms: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Huéspedes máx.</label>
          <input
            type="number" min={1}
            value={form.max_guests}
            onChange={e => setForm({ ...form, max_guests: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Tarifa de aseo por defecto (COP)
        </label>
        <input
          type="number" min={0} step={1000}
          value={form.default_cleaning_fee}
          onChange={e => setForm({ ...form, default_cleaning_fee: e.target.value })}
          placeholder="Ej: 50000"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <p className="text-xs text-slate-500 mt-1">
          Se usa como valor por defecto al asignar aseo a una reserva de esta propiedad. Se puede editar por reserva.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Notas</label>
        <textarea
          rows={3}
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </motion.form>
  );
}

// (RecurringTab eliminada — Fase 16: gastos recurrentes ahora se gestionan en Servicios y proveedores)

// (RecurringModal eliminado — Fase 16)

// ─── Modal: Cambio de precio (SCD Type 2) ─────────────────────────────

// (PriceChangeModal eliminado — Fase 16)

// (PeriodsTab + StatCard eliminados — Fase 16)


/* MarkPaidModal was moved to ./MarkPaidModal.tsx */

// ─── Tab: Servicios que cubren esta propiedad (Fase 15) ──────────────
function ServicesTab({
  propertyId, legacyRecurrings,
}: {
  propertyId: string;
  legacyRecurrings: PropertyRecurringExpenseRow[];
}) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vps, setVps] = useState<VendorPropertyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [vRes, vpRes] = await Promise.all([listVendors(), listAllVendorProperties()]);
      if (vRes.data) setVendors(vRes.data.filter(v => v.kind !== 'cleaner'));
      if (vpRes.data) setVps(vpRes.data);
      setLoading(false);
    })();
  }, []);

  const myVps = vps.filter(vp => vp.property_id === propertyId);
  const rows = myVps.map(vp => {
    const v = vendors.find(x => x.id === vp.vendor_id);
    return v ? { vendor: v, vp } : null;
  }).filter((x): x is { vendor: Vendor; vp: VendorPropertyRow } => x !== null);

  if (loading) return <div className="h-32 bg-slate-100 rounded-2xl animate-pulse" />;

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Servicios y proveedores</h3>
            <p className="text-[11px] text-slate-500">Esta propiedad está cubierta por estos servicios. Edítalos en /vendors.</p>
          </div>
          <a href="/vendors" className="text-xs font-semibold text-blue-600 hover:underline">Ir a Servicios →</a>
        </header>
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Esta propiedad no está vinculada a ningún servicio aún.
            <a href="/vendors" className="ml-1 text-blue-600 hover:underline font-semibold">Crea o edita un servicio</a> y márcala como cubierta.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-5 py-2">Servicio</th>
                <th className="text-left px-5 py-2">Categoría</th>
                <th className="text-right px-5 py-2">Esta propiedad paga</th>
                <th className="text-right px-5 py-2">Día / mes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ vendor, vp }) => {
                let pagaTxt: string;
                if (vp.fixed_amount != null) pagaTxt = `${formatCurrency(Number(vp.fixed_amount))} fijo`;
                else if (vp.share_percent != null) pagaTxt = `${vp.share_percent}% del total`;
                else pagaTxt = 'reparto igual';
                return (
                  <tr key={vp.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-800">{vendor.name}</td>
                    <td className="px-5 py-2 text-slate-500 text-xs">{vendor.category ?? '—'}</td>
                    <td className="px-5 py-2 text-right text-slate-700 text-sm">{pagaTxt}</td>
                    <td className="px-5 py-2 text-right text-slate-500 text-xs">
                      {vendor.day_of_month != null ? `día ${vendor.day_of_month}` : '—'}
                      {vendor.default_amount != null && (
                        <span className="block text-[10px] text-slate-400">≈ {formatCurrency(Number(vendor.default_amount))}/mes</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {legacyRecurrings.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <h4 className="text-sm font-bold text-amber-800 mb-1">⚠ Rubros recurrentes legacy</h4>
          <p className="text-xs text-amber-700 mb-3">
            Estos rubros vienen del modelo anterior. Quedan registrados pero ya no se gestionan desde aquí.
            Crea un servicio en <a href="/vendors" className="underline font-semibold">Servicios y proveedores</a> y elimínalos cuando estén migrados.
          </p>
          <ul className="text-xs text-amber-900 space-y-1">
            {legacyRecurrings.map(r => (
              <li key={r.id} className="flex justify-between bg-white/50 rounded px-2 py-1">
                <span>{r.category}</span>
                <span className="font-semibold">{formatCurrency(Number(r.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
