import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, BookingRow } from '@/types/database';
import { listBookings } from '@/services/bookings';

type FormData = Omit<Expense, 'id' | 'owner_id'>;

interface Props {
  properties?: PropertyRow[];
  bankAccounts?: BankAccountRow[];
  onClose: () => void;
  onSave: (expense: FormData) => void;
  error?: string;
  /** Si se provee, el modal entra en modo edición. */
  initial?: FormData | null;
  /** Valores sugeridos al crear (NO activa modo edición). */
  prefill?: Partial<FormData> | null;
  /** Si el gasto está vinculado a un ajuste de reserva (cobro por daño),
   *  pasar este handler activa el botón "Descartar gasto + ajuste". */
  onDiscardLinked?: () => void;
}

const CATEGORIES = ['Limpieza', 'Lavandería', 'Internet', 'Servicios Públicos', 'Mantenimiento', 'Reparación daño', 'Reposición inventario', 'Administración', 'Welcome Kit', 'Seguros', 'Impuestos', 'Toallas y ropa de cama', 'Utensilios y enseres', 'Decoración', 'Otro'];

const INITIAL: FormData = {
  category: '',
  type: 'variable',
  amount: 0,
  date: new Date().toISOString().split('T')[0],
  description: null,
  status: 'pending',
  property_id: null,
  bank_account_id: null,
  vendor: null,
  person_in_charge: null,
  booking_id: null,
  adjustment_id: null,
};

export default function ExpenseModal({ properties = [], bankAccounts = [], onClose, onSave, error, initial, prefill, onDiscardLinked }: Props) {
  const [form, setForm] = useState<FormData>(initial ?? { ...INITIAL, ...(prefill ?? {}) });
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const isEdit = !!initial;
  const isLinkedToDamage = isEdit && !!initial?.adjustment_id;

  // Carga las últimas 50 reservas de la propiedad seleccionada (si hay)
  useEffect(() => {
    listBookings(form.property_id ? { propertyId: form.property_id } : undefined).then(res => {
      if (!res.error) setBookings(res.data.slice(0, 50));
    });
  }, [form.property_id]);

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!form.category) e.category = 'Selecciona una categoría';
    if (!form.amount || form.amount <= 0) e.amount = 'Ingresa un monto válido';
    if (!form.date) e.date = 'La fecha es requerida';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (validate()) onSave(form);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{isEdit ? 'Editar Gasto' : 'Registrar Gasto'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{isEdit ? 'Modifica los datos del gasto.' : 'Agrega un nuevo gasto a tu registro'}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-lg"
            >
              ✕
            </button>
          </div>

          {/* Banner contextual: gasto vinculado a cobro por daño */}
          {isLinkedToDamage && (
            <div className="mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none">🔗</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    Gasto vinculado a cobro por daño
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    Este gasto fue generado automáticamente por un ajuste "Cobro por daño" en una reserva.
                    Completa los datos reales de la reparación (monto real, proveedor, cuenta bancaria, marca como <b>Pagado</b>)
                    para que deje de aparecer en "Cuentas por Pagar". El neto del daño se calcula como
                    <span className="italic"> cobrado al huésped − costo real reparación</span>.
                  </p>
                  <p className="text-xs text-amber-700 mt-1.5">
                    ¿No vas a reparar? Usa <b>"Descartar"</b> abajo — eliminará también el ajuste de la reserva.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">

            {/* Categoría + Tipo */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Categoría *</label>
                <select
                  value={form.category}
                  onChange={e => set('category', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${errors.category ? 'border-red-400' : 'border-slate-200'}`}
                >
                  <option value="">Seleccionar…</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo *</label>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  {(['variable', 'fixed'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set('type', t)}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        form.type === t
                          ? t === 'variable' ? 'bg-orange-500 text-white' : 'bg-blue-600 text-white'
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {t === 'variable' ? 'Variable' : 'Fijo'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Propiedad */}
            {properties.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Propiedad</label>
                <select
                  value={form.property_id ?? ''}
                  onChange={e => set('property_id', e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                >
                  <option value="">General / Sin propiedad específica</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {/* Monto */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Monto (COP) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={form.amount || ''}
                  onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                  placeholder="150,000"
                  className={`w-full pl-7 pr-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${errors.amount ? 'border-red-400' : 'border-slate-200'}`}
                />
              </div>
              {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
            </div>

            {/* Fecha + Estado */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${errors.date ? 'border-red-400' : 'border-slate-200'}`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Estado</label>
                <select
                  value={form.status}
                  onChange={e => set('status', e.target.value as Expense['status'])}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                >
                  <option value="pending">Pendiente</option>
                  <option value="paid">Pagado</option>
                  <option value="partial">Parcial</option>
                </select>
              </div>
            </div>

            {/* Descripción */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción</label>
              <textarea
                rows={2}
                value={form.description ?? ''}
                onChange={e => set('description', e.target.value || null)}
                placeholder="Descripción opcional…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
              />
            </div>

            {/* Proveedor + A cargo de */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Proveedor <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.vendor ?? ''}
                  onChange={e => set('vendor', e.target.value || null)}
                  placeholder="Ej: EPM, Claro, ferretería…"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  A cargo de <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.person_in_charge ?? ''}
                  onChange={e => set('person_in_charge', e.target.value || null)}
                  placeholder="Ej: María (aseadora)"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                />
              </div>
            </div>

            {/* Cuenta bancaria */}
            {bankAccounts.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Pagado desde <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <select
                  value={form.bank_account_id ?? ''}
                  onChange={e => set('bank_account_id', e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none transition"
                >
                  <option value="">— Sin asignar —</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.bank ? ` (${a.bank})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Vincular a reserva — siempre visible (opcional) */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Vincular a reserva <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              {bookings.length > 0 ? (
                <select
                  value={form.booking_id ?? ''}
                  onChange={e => set('booking_id', e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none transition"
                >
                  <option value="">— No vinculado —</option>
                  {bookings.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.confirmation_code} · {b.guest_name ?? 'sin nombre'} · {b.start_date}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {form.property_id
                    ? 'No hay reservas para esta propiedad todavía.'
                    : 'Selecciona una propiedad para ver sus reservas.'}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Útil para cleaning fees, daños, amenities o cargos ligados a una estadía puntual.
              </p>
            </div>

            {/* API Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg"
              >
                {error}
              </motion.p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <motion.button
                type="submit"
                whileTap={{ scale: 0.97 }}
                className="flex-1 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {isEdit ? 'Guardar cambios' : 'Guardar Gasto'}
              </motion.button>
            </div>

            {/* Descartar gasto + ajuste vinculado (sólo en damage_charge) */}
            {onDiscardLinked && isLinkedToDamage && (
              <div className="pt-3 mt-3 border-t border-slate-100">
                {!confirmDiscard ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(true)}
                    className="w-full py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
                  >
                    🗑 Descartar este gasto y su ajuste por daño
                  </button>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-red-900">
                      ⚠ ¿Descartar definitivamente?
                    </p>
                    <p className="text-xs text-red-800 mt-1">
                      Se eliminarán <b>dos registros</b>:
                    </p>
                    <ul className="text-xs text-red-800 list-disc list-inside mt-1 space-y-0.5">
                      <li>Este gasto pendiente.</li>
                      <li>El ajuste <span className="font-mono">damage_charge</span> de la reserva vinculada (el "ingreso" cobrado al huésped por ese daño también desaparece).</li>
                    </ul>
                    <p className="text-xs text-red-700 mt-2 italic">
                      Úsalo sólo si el cobro nunca se efectuó o decidiste no proceder. Acción irreversible.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(false)}
                        className="flex-1 py-2 text-xs font-medium text-slate-700 border border-slate-200 bg-white rounded-lg hover:bg-slate-50"
                      >
                        No, dejar como está
                      </button>
                      <button
                        type="button"
                        onClick={onDiscardLinked}
                        className="flex-1 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700"
                      >
                        Sí, descartar ambos
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
