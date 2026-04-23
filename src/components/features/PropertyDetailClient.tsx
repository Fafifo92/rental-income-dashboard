import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import { getProperty, updateProperty } from '@/services/properties';
import {
  listRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
} from '@/services/recurringExpenses';
import { changeRecurringExpensePrice } from '@/services/recurringExpenses';
import type { PropertyRow, PropertyRecurringExpenseRow } from '@/types/database';
import { formatCurrency } from '@/lib/utils';

const RECURRING_CATEGORIES = [
  'Administración',
  'Internet',
  'Servicios Públicos',
  'Agua',
  'Energía',
  'Gas',
  'Seguro',
  'Impuesto Predial',
  'TV / Streaming',
  'Vigilancia',
  'Parqueadero',
  'Otro',
];

interface Props { propertyId: string; }

type Tab = 'details' | 'recurring';

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
    if (!recRes.error) setRecurring(recRes.data);
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
  const totalMonthly = activeRecurring.reduce((s, r) => s + Number(r.amount), 0);

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
        {(['details', 'recurring'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              tab === t ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'details' ? 'Configuración' : `Gastos recurrentes (${activeRecurring.length})`}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <DetailsTab property={property} onSaved={loadAll} />
      )}

      {tab === 'recurring' && (
        <RecurringTab
          propertyId={propertyId}
          items={recurring}
          totalMonthly={totalMonthly}
          onChange={loadAll}
        />
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

      <div className="grid grid-cols-3 gap-4">
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

// ─── Tab: Gastos recurrentes ──────────────────────────────────────────

function RecurringTab({
  propertyId,
  items,
  totalMonthly,
  onChange,
}: {
  propertyId: string;
  items: PropertyRecurringExpenseRow[];
  totalMonthly: number;
  onChange: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PropertyRecurringExpenseRow | null>(null);
  const [priceChange, setPriceChange] = useState<PropertyRecurringExpenseRow | null>(null);

  const openCreate = () => { setEditing(null); setShowModal(true); };
  const openEdit = (item: PropertyRecurringExpenseRow) => { setEditing(item); setShowModal(true); };

  const handleToggle = async (item: PropertyRecurringExpenseRow) => {
    await updateRecurringExpense(item.id, { is_active: !item.is_active });
    onChange();
  };

  const handleDelete = async (item: PropertyRecurringExpenseRow) => {
    if (!confirm(`¿Eliminar el gasto recurrente "${item.category}"?`)) return;
    await deleteRecurringExpense(item.id);
    onChange();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Costo fijo mensual estimado</p>
          <p className="text-2xl font-extrabold text-slate-800">{formatCurrency(totalMonthly)}</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-sm"
        >
          + Agregar rubro
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-10 text-center">
          <h4 className="font-bold text-slate-700 mb-2">Sin gastos recurrentes configurados</h4>
          <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto">
            Agrega la administración, internet, servicios públicos y otros costos fijos mensuales para
            que se reflejen automáticamente en tus reportes.
          </p>
          <button
            onClick={openCreate}
            className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 text-sm"
          >
            + Agregar primer rubro
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-4 py-3 font-semibold text-slate-600">Categoría</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-right">Monto</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Vigencia</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Día cobro</th>
                <th className="px-4 py-3 font-semibold text-slate-600">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const current = !item.valid_to;
                return (
                <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{item.category}</div>
                    {item.description && <div className="text-xs text-slate-500">{item.description}</div>}
                    {(item.vendor || item.person_in_charge) && (
                      <div className="text-xs text-slate-400 mt-0.5">
                        {item.vendor && <span>🏢 {item.vendor}</span>}
                        {item.vendor && item.person_in_charge && <span className="mx-1">·</span>}
                        {item.person_in_charge && <span>👤 {item.person_in_charge}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700">
                    {formatCurrency(Number(item.amount))}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    <span>{item.valid_from || '—'}</span>
                    <span className="text-slate-400"> → </span>
                    <span>{item.valid_to ?? 'vigente'}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.day_of_month ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      current && item.is_active ? 'bg-emerald-100 text-emerald-700'
                      : current ? 'bg-slate-200 text-slate-500'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {current ? (item.is_active ? 'Vigente' : 'Inactivo') : 'Histórico'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {current && (
                      <button onClick={() => setPriceChange(item)} className="text-xs text-emerald-700 hover:underline mr-3 font-medium">
                        Cambiar precio
                      </button>
                    )}
                    <button onClick={() => openEdit(item)} className="text-xs text-blue-600 hover:underline mr-3">Editar</button>
                    {current && (
                      <button onClick={() => handleToggle(item)} className="text-xs text-slate-600 hover:underline mr-3">
                        {item.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                    <button onClick={() => handleDelete(item)} className="text-xs text-red-600 hover:underline">Eliminar</button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <RecurringModal
            propertyId={propertyId}
            editing={editing}
            onClose={() => setShowModal(false)}
            onSaved={() => { setShowModal(false); onChange(); }}
          />
        )}
        {priceChange && (
          <PriceChangeModal
            current={priceChange}
            onClose={() => setPriceChange(null)}
            onSaved={() => { setPriceChange(null); onChange(); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RecurringModal({
  propertyId, editing, onClose, onSaved,
}: {
  propertyId: string;
  editing: PropertyRecurringExpenseRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    category: editing?.category ?? '',
    amount: String(editing?.amount ?? ''),
    day_of_month: String(editing?.day_of_month ?? '1'),
    description: editing?.description ?? '',
    is_active: editing?.is_active ?? true,
    valid_from: editing?.valid_from ?? new Date().toISOString().split('T')[0],
    vendor: editing?.vendor ?? '',
    person_in_charge: editing?.person_in_charge ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.category.trim() || !form.amount) return;
    setSaving(true);
    setError(null);
    const payload = {
      property_id: propertyId,
      category: form.category.trim(),
      amount: parseFloat(form.amount),
      day_of_month: form.day_of_month ? parseInt(form.day_of_month) : null,
      description: form.description.trim() || null,
      is_active: form.is_active,
      valid_from: form.valid_from,
      valid_to: editing?.valid_to ?? null,
      vendor: form.vendor.trim() || null,
      person_in_charge: form.person_in_charge.trim() || null,
    };
    const res = editing
      ? await updateRecurringExpense(editing.id, payload)
      : await createRecurringExpense(payload);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-4">
          {editing ? 'Editar rubro recurrente' : 'Nuevo rubro recurrente'}
        </h3>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Categoría *</label>
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">— Seleccionar</option>
              {RECURRING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Monto mensual *</label>
              <input
                type="number" step="1000" required
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Día del mes</label>
              <input
                type="number" min={1} max={31}
                value={form.day_of_month}
                onChange={e => setForm({ ...form, day_of_month: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Ej: Edificio Torre Norte"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Proveedor</label>
              <input
                type="text"
                value={form.vendor}
                onChange={e => setForm({ ...form, vendor: e.target.value })}
                placeholder="Ej: Claro, EPM, Tigo…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">A cargo de</label>
              <input
                type="text"
                value={form.person_in_charge}
                onChange={e => setForm({ ...form, person_in_charge: e.target.value })}
                placeholder="Ej: Francisco, Admón…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Vigente desde</label>
            <input
              type="date"
              value={form.valid_from}
              onChange={e => setForm({ ...form, valid_from: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              Primer mes en que empezó a aplicar este valor. Para cambios de precio futuros usa "Cambiar precio".
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            Activo (cuenta en cálculos)
          </label>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !form.category || !form.amount}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Modal: Cambio de precio (SCD Type 2) ─────────────────────────────

function PriceChangeModal({
  current, onClose, onSaved,
}: {
  current: PropertyRecurringExpenseRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [description, setDescription] = useState(current.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newAmount = parseFloat(amount);
    if (!newAmount || !effectiveDate) return;
    if (effectiveDate <= current.valid_from) {
      setError('La fecha debe ser posterior a la vigencia actual (' + current.valid_from + ')');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await changeRecurringExpensePrice(current.id, effectiveDate, {
      amount: newAmount,
      description: description.trim() || null,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-xl font-bold text-slate-800 mb-1">Cambio de precio</h3>
        <p className="text-sm text-slate-500 mb-4">
          {current.category} — actualmente {formatCurrency(Number(current.amount))}
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
          Esto archiva la versión actual (como histórico) y crea una nueva vigente a partir
          de la fecha indicada. Los reportes pasados siguen usando el valor anterior; los
          futuros usan el nuevo. Ideal para facturas que cambian de valor.
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Nuevo monto *</label>
            <input
              type="number" step="1000" required autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Vigente desde *</label>
            <input
              type="date" required
              min={current.valid_from}
              value={effectiveDate}
              onChange={e => setEffectiveDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Nota del cambio (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: Incremento anual 2025"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-2.5 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving || !amount || !effectiveDate}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Aplicando…' : 'Aplicar cambio'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
