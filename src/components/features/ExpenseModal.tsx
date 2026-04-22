import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Expense } from '@/types';

type FormData = Omit<Expense, 'id' | 'owner_id' | 'property_id'>;

interface Props {
  onClose: () => void;
  onSave: (expense: FormData) => void;
  error?: string;
}

const CATEGORIES = ['Limpieza', 'Lavandería', 'Internet', 'Servicios Públicos', 'Mantenimiento', 'Administración', 'Welcome Kit', 'Seguros', 'Impuestos', 'Otro'];

const INITIAL: FormData = {
  category: '',
  type: 'variable',
  amount: 0,
  date: new Date().toISOString().split('T')[0],
  description: null,
  status: 'pending',
};

export default function ExpenseModal({ onClose, onSave, error }: Props) {
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Registrar Gasto</h2>
              <p className="text-sm text-slate-500 mt-0.5">Agrega un nuevo gasto a tu registro</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-lg"
            >
              ✕
            </button>
          </div>

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

            {/* API Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg"
              >
                ⚠️ {error}
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
                Guardar Gasto
              </motion.button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
