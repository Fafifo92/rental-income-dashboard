import { motion, AnimatePresence } from 'framer-motion';
import MoneyInput from '@/components/MoneyInput';
import { parseMoney } from '@/lib/money';
import type { PropertyRow } from '@/types/database';
import type { AuthStatus } from '@/lib/useAuth';
import type { BookingForm } from './types';
import { todayISO } from './helpers';
import { formatDateDisplay } from '@/lib/dateUtils';

interface Props {
  open: boolean;
  editingId: string | null;
  form: BookingForm;
  formLoading: boolean;
  formWarning: string;
  authStatus: AuthStatus;
  properties: PropertyRow[];
  onChange: (field: keyof BookingForm, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function BookingFormModal({
  open, editingId, form, formLoading, formWarning, authStatus, properties,
  onChange, onSubmit, onClose,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.93, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-bold text-slate-900">{editingId ? 'Editar reserva' : 'Nueva reserva'}</h3>
              <button onClick={onClose}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
            </div>

            {/* Modal body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Row: Canal + Estado */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Canal</label>
                  <select value={form.channel} onChange={e => onChange('channel', e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="">— Selecciona canal —</option>
                    <option value="airbnb">Airbnb</option>
                    <option value="booking">Booking.com</option>
                    <option value="vrbo">Vrbo</option>
                    <option value="direct">Directo</option>
                    <option value="other">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Estado</label>
                  <select value={form.status} onChange={e => onChange('status', e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    <option value="Reservada">Reservada</option>
                    <option value="Inicia hoy">Inicia hoy</option>
                    <option value="En curso">En curso</option>
                    <option value="Completada">Completada</option>
                    <option value="Cancelada">Cancelada</option>
                  </select>
                </div>
              </div>

              {/* Huésped */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Huésped</label>
                <input type="text" value={form.guest_name}
                  onChange={e => onChange('guest_name', e.target.value)}
                  placeholder="Nombre del huésped"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Adultos + Niños */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Adultos</label>
                  <input type="number" min="0" value={form.num_adults}
                    onChange={e => onChange('num_adults', e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Niños</label>
                  <input type="number" min="0" value={form.num_children}
                    onChange={e => onChange('num_children', e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              {/* Stay section — fechas + noches sincronizadas */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estadía</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Check-in *{form.status === 'Inicia hoy' && <span className="ml-1 text-emerald-600">🔒 Hoy</span>}
                    </label>
                    <input type="date" value={form.start_date}
                      onChange={e => onChange('start_date', e.target.value)}
                      disabled={form.status === 'Inicia hoy'}
                      min={form.status === 'Reservada' ? todayISO() : undefined}
                      max={(form.status === 'Completada' || form.status === 'En curso') ? todayISO() : undefined}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-emerald-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Check-out *</label>
                    <input type="date" value={form.end_date}
                      min={form.status === 'En curso'
                        ? (() => { const t = new Date(todayISO()); t.setDate(t.getDate() + 1); return t.toISOString().split('T')[0]; })()
                        : (form.start_date || undefined)}
                      max={form.status === 'Completada' ? todayISO() : undefined}
                      onChange={e => onChange('end_date', e.target.value)}
                      disabled={!form.start_date}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Noches</label>
                    <input type="number" min="1" value={form.num_nights}
                      onChange={e => onChange('num_nights', e.target.value)}
                      placeholder="0"
                      disabled={!form.start_date}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-100"
                    />
                  </div>
                </div>
                {form.start_date && form.end_date && (
                  <p className="text-xs text-slate-500">
                    {formatDateDisplay(form.start_date)}
                    {' → '}
                    {formatDateDisplay(form.end_date)}
                  </p>
                )}
              </div>

              {/* Ingresos + Depósito de seguridad */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ingresos (COP) *</label>
                  <MoneyInput
                    value={parseMoney(form.total_revenue)}
                    onChange={(v) => onChange('total_revenue', v == null ? '' : String(v))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Depósito de seguridad{' '}
                    <span className="font-normal text-slate-400">(opcional)</span>
                  </label>
                  <MoneyInput
                    value={parseMoney(form.security_deposit)}
                    onChange={(v) => onChange('security_deposit', v == null ? '' : String(v))}
                    placeholder="0"
                    inputClassName="text-amber-700"
                  />
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Se debe devolver al huésped al finalizar la estadía.
                  </p>
                </div>
              </div>

              {/* Anuncio */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Anuncio / Propiedad</label>
                <input type="text" value={form.listing_name}
                  onChange={e => onChange('listing_name', e.target.value)}
                  placeholder="Ej: Apto El Poblado 204"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Property picker — only in auth mode */}
              {authStatus === 'authed' && properties.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedad *</label>
                  <select value={form.property_id} onChange={e => onChange('property_id', e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {!form.property_id && (
                      <option value="" disabled>— Selecciona una propiedad —</option>
                    )}
                    {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {/* Confirmation code (optional) */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Código de confirmación <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <input type="text" value={form.confirmation_code}
                  onChange={e => onChange('confirmation_code', e.target.value)}
                  placeholder={form.channel === 'direct' ? 'Se genera DIR-YYYY-XXXXX' : 'Se genera automáticamente'}
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Notas <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <textarea value={form.notes}
                  onChange={e => onChange('notes', e.target.value)}
                  rows={2}
                  placeholder="Info extra del huésped, canal, etc."
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>

              {formWarning && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {formWarning}
                </p>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-slate-50">
              <button onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={onSubmit} disabled={formLoading}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {formLoading ? 'Guardando…' : 'Guardar reserva'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
