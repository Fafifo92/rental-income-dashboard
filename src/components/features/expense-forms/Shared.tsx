'use client';
/**
 * Campos compartidos entre los formularios dedicados de gasto.
 */
import type { PropertyRow, BankAccountRow } from '@/types/database';
import MoneyInput from '@/components/MoneyInput';

export type ExpenseStatus = 'pending' | 'paid' | 'partial';

export function PropertyPicker({
  properties, value, onChange, required, error, helper,
}: {
  properties: PropertyRow[];
  value: string | null;
  onChange: (v: string | null) => void;
  required?: boolean;
  error?: string;
  helper?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        Propiedad {required && <span className="text-rose-600">*</span>}
      </label>
      <select
        value={value ?? ''}
        required={required}
        onChange={e => onChange(e.target.value || null)}
        className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none ${error ? 'border-red-400' : 'border-slate-200'}`}
      >
        <option value="">— Selecciona —</option>
        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {helper && <p className="text-[10px] text-slate-400 mt-1">{helper}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function BankPicker({
  banks, value, onChange, required, error,
}: {
  banks: BankAccountRow[];
  value: string | null;
  onChange: (v: string | null) => void;
  required?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        Cuenta de pago {required && <span className="text-rose-600">*</span>}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none ${error ? 'border-red-400' : 'border-slate-200'}`}
      >
        <option value="">— No especificada —</option>
        {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function MoneyField({
  label, value, onChange, required, error, placeholder = '0',
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label} {required && <span className="text-rose-600">*</span>}
      </label>
      <MoneyInput value={value} onChange={onChange} placeholder={placeholder} required={required} />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function DateField({
  label = 'Fecha', value, onChange, required,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label} {required && <span className="text-rose-600">*</span>}
      </label>
      <input
        type="date"
        value={value}
        required={required}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
  );
}

export function StatusPicker({
  value, onChange,
}: {
  value: ExpenseStatus;
  onChange: (v: ExpenseStatus) => void;
}) {
  const opts: { v: ExpenseStatus; label: string; cls: string }[] = [
    { v: 'pending', label: 'Pendiente', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    { v: 'paid',    label: 'Pagado',    cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    { v: 'partial', label: 'Parcial',   cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  ];
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">Estado</label>
      <div className="flex gap-1.5">
        {opts.map(o => (
          <button
            type="button"
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
              value === o.v ? o.cls : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DescField({
  value, onChange, placeholder, label = 'Descripción', optional = true, rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  optional?: boolean;
  rows?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label} {optional && <span className="text-slate-400 font-normal">(opcional)</span>}
      </label>
      <textarea
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
      />
    </div>
  );
}

type Accent = 'blue' | 'cyan' | 'violet' | 'rose' | 'emerald';

export function FormShell({
  title, subtitle, accent, onClose, onSubmit, saving, error, submitLabel = 'Guardar', children,
}: {
  title: string;
  subtitle?: string;
  accent: Accent;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  saving?: boolean;
  error?: string | null;
  submitLabel?: string;
  children: React.ReactNode;
}) {
  const accentMap: Record<Accent, { header: string; btn: string }> = {
    blue:    { header: 'bg-blue-50 text-blue-800',       btn: 'bg-blue-600 hover:bg-blue-700' },
    cyan:    { header: 'bg-cyan-50 text-cyan-800',       btn: 'bg-cyan-600 hover:bg-cyan-700' },
    violet:  { header: 'bg-violet-50 text-violet-800',   btn: 'bg-violet-600 hover:bg-violet-700' },
    rose:    { header: 'bg-rose-50 text-rose-800',       btn: 'bg-rose-600 hover:bg-rose-700' },
    emerald: { header: 'bg-emerald-50 text-emerald-800', btn: 'bg-emerald-600 hover:bg-emerald-700' },
  };
  const a = accentMap[accent];
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className={`px-6 py-4 border-b border-slate-100 ${a.header}`}>
          <h3 className="text-lg font-bold">{title}</h3>
          {subtitle && <p className="text-xs opacity-80 mt-0.5">{subtitle}</p>}
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          {children}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className={`px-4 py-2 text-sm text-white rounded-lg font-semibold disabled:opacity-50 ${a.btn}`}
            >
              {saving ? 'Guardando…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
