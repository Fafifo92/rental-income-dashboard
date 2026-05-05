'use client';
/**
 * Formulario dedicado: gasto sobre una propiedad.
 *
 * Modos:
 *   • Single: 1 propiedad, 1 fila.
 *   • Compartido: 2+ propiedades. Una sola "factura" repartida (equitativa o
 *     manual) que crea N filas con el mismo `expense_group_id`. La edición de
 *     estado/banco después se aplica al grupo entero (ver updateExpenseGroup).
 *
 * Para gastos fijos (servicios públicos, administración) se permite indicar el
 * período cubierto (desde/hasta), que se guarda como prefijo legible en la
 * descripción: `[Período: YYYY-MM-DD → YYYY-MM-DD]`.
 *
 * NO admite booking_id. NO admite daños.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, ExpenseSubcategory } from '@/types/database';
import { SUBCATEGORY_TO_CATEGORY } from '@/types/database';
import { addMoney, splitMoney } from '@/lib/money';
import MoneyInput from '@/components/MoneyInput';
import {
  FormShell, PropertyPicker, BankPicker, MoneyField, DateField,
  StatusPicker, DescField, type ExpenseStatus,
} from './Shared';
import { todayISO } from '@/lib/dateUtils';

type SubKind = Extract<ExpenseSubcategory, 'utilities' | 'administration' | 'maintenance' | 'stock'>;

const SUBCATS: { id: SubKind; icon: string; label: string; helper: string }[] = [
  { id: 'utilities',      icon: '⚡', label: 'Servicios públicos', helper: 'Luz, agua, gas, internet, basura, TV.' },
  { id: 'administration', icon: '📋', label: 'Administración',     helper: 'Admin del edificio, predial, seguros, valorización.' },
  { id: 'maintenance',    icon: '🔧', label: 'Mantenimiento',      helper: 'Reparaciones, mejoras, pintura.' },
  { id: 'stock',          icon: '📦', label: 'Stock / inventario', helper: 'Compras a granel: papel, jabón, sábanas, utensilios.' },
];

const DETAIL_OPTIONS: Record<SubKind, string[]> = {
  utilities:      ['Energía', 'Agua', 'Gas', 'Internet', 'TV / Streaming', 'Aseo público', 'Otro'],
  administration: ['Administración', 'Impuesto predial', 'Seguro', 'Otro impuesto', 'Otro'],
  maintenance:    ['Cocina', 'Baño', 'Sala', 'Habitación', 'Exterior / Balcón', 'Electrodoméstico', 'Plomería', 'Eléctrico', 'General'],
  stock:          ['Lencería', 'Papel higiénico', 'Jabón / amenities', 'Cocina (utensilios)', 'Decoración', 'Otros'],
};

interface Props {
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  defaultSubcategory?: SubKind;
  onClose: () => void;
  onSave: (expense: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean | void> | void;
  onSaveShared: (rows: Omit<Expense, 'id' | 'owner_id'>[]) => Promise<boolean | void> | void;
  error?: string | null;
}

const composePeriodPrefix = (start: string | null, end: string | null) => {
  if (!start && !end) return '';
  if (start && end) return `[Período: ${start} → ${end}]`;
  if (start) return `[Período: desde ${start}]`;
  return `[Período: hasta ${end}]`;
};

export default function PropertyExpenseForm({
  properties, bankAccounts, defaultSubcategory = 'utilities', onClose, onSave, onSaveShared, error,
}: Props) {
  const [sub, setSub] = useState<SubKind>(defaultSubcategory);
  const [detail, setDetail] = useState<string>('');

  // Single vs compartido entre varias propiedades
  const [shared, setShared] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(properties.length === 1 ? properties[0].id : null);
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<'equal' | 'manual'>('equal');
  const [manual, setManual] = useState<Record<string, number | null>>({});

  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<'fixed' | 'variable'>('variable');
  const [status, setStatus] = useState<ExpenseStatus>('pending');
  const [bankId, setBankId] = useState<string | null>(null);
  const [vendor, setVendor] = useState('');
  const [desc, setDesc] = useState('');

  // Período cubierto (sólo relevante para 'fixed').
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
  const [periodStart, setPeriodStart] = useState<string>(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState<string>(lastOfMonth);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Si se desactiva 'shared', limpiar selección múltiple.
  useEffect(() => {
    if (!shared) { setSharedIds([]); setManual({}); }
  }, [shared]);

  const sharedTotal = useMemo(
    () => addMoney(...sharedIds.map(id => manual[id] ?? 0)),
    [sharedIds, manual],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};

    if (shared) {
      if (sharedIds.length < 2) errs.shared = 'Selecciona al menos 2 propiedades.';
    } else {
      if (!propertyId) errs.property = 'Selecciona la propiedad';
    }
    if (!amount || amount <= 0) errs.amount = 'Indica el monto total';
    if (status === 'paid' && !bankId) errs.bank = 'Marca la cuenta bancaria si está pagado';
    if (shared && splitMode === 'manual') {
      if (Math.abs(sharedTotal - (amount ?? 0)) > 0.005) {
        errs.amount = `La suma de las partes (${sharedTotal.toLocaleString('es-CO')}) no coincide con el total (${(amount ?? 0).toLocaleString('es-CO')})`;
      }
    }
    if (type === 'fixed' && periodStart && periodEnd && periodStart > periodEnd) {
      errs.period = 'La fecha "desde" no puede ser mayor que "hasta".';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const periodPrefix = type === 'fixed' ? composePeriodPrefix(periodStart, periodEnd) : '';
    const description = [
      detail ? `[${detail}]` : '',
      periodPrefix,
      desc.trim(),
    ].filter(Boolean).join(' ').trim() || null;

    const base: Omit<Expense, 'id' | 'owner_id'> = {
      property_id: null,
      category: SUBCATEGORY_TO_CATEGORY[sub],
      subcategory: sub,
      type,
      amount: amount ?? 0,
      date,
      description,
      status,
      bank_account_id: bankId,
      vendor: vendor.trim() || null,
      person_in_charge: null,
      booking_id: null,
      adjustment_id: null,
      vendor_id: null,
      shared_bill_id: null,
      expense_group_id: null,
    };

    setSaving(true);
    if (shared) {
      const total = amount ?? 0;
      const parts = splitMode === 'equal'
        ? splitMoney(total, sharedIds.length)
        : sharedIds.map(id => manual[id] ?? 0);
      const rows = sharedIds.map((pid, i) => ({
        ...base,
        property_id: pid,
        amount: parts[i] ?? 0,
      }));
      await onSaveShared(rows);
    } else {
      await onSave({ ...base, property_id: propertyId });
    }
    setSaving(false);
  };

  const currentMeta = SUBCATS.find(s => s.id === sub)!;
  const equalParts = shared && sharedIds.length > 0 ? splitMoney(amount ?? 0, sharedIds.length) : [];

  return (
    <FormShell
      title="Gasto sobre una propiedad"
      subtitle="Servicios, administración, mantenimiento o compras de stock para el inmueble."
      accent="blue"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error ?? null}
      submitLabel={shared ? `Guardar gasto en ${sharedIds.length || 0} propiedades` : 'Guardar gasto'}
    >
      {/* Selector de subcategoría como chips */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo de gasto *</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {SUBCATS.map(s => (
            <button
              type="button"
              key={s.id}
              onClick={() => { setSub(s.id); setDetail(''); }}
              className={`px-2 py-2 text-xs font-semibold rounded-lg border text-center transition ${
                sub === s.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="text-base">{s.icon}</div>
              <div>{s.label}</div>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-1">{currentMeta.helper}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Detalle <span className="text-slate-400 font-normal">(opcional)</span>
          </label>
          <select
            value={detail}
            onChange={e => setDetail(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">— Sin detalle —</option>
            {DETAIL_OPTIONS[sub].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo</label>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setType('variable')}
              className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border transition ${
                type === 'variable'
                  ? 'bg-orange-100 text-orange-800 border-orange-300'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              Variable
            </button>
            <button
              type="button"
              onClick={() => setType('fixed')}
              className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border transition ${
                type === 'fixed'
                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              Fijo (cubre período)
            </button>
          </div>
        </div>
      </div>

      {/* Período cubierto — sólo cuando type === 'fixed' */}
      {type === 'fixed' && (
        <div className="border border-blue-100 bg-blue-50/50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800">Período que cubre este pago</p>
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Desde" value={periodStart} onChange={setPeriodStart} />
            <DateField label="Hasta" value={periodEnd} onChange={setPeriodEnd} />
          </div>
          {errors.period && <p className="text-xs text-red-500">{errors.period}</p>}
          <p className="text-[10px] text-blue-700/80">
            Las fechas se guardan en la descripción y son editables después. La <b>fecha del gasto</b>
            (abajo) es cuándo se pagó/registró.
          </p>
        </div>
      )}

      {/* Compartido entre varias propiedades */}
      {properties.length >= 2 && (
        <div className="border border-violet-100 bg-violet-50/40 rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shared}
              onChange={e => setShared(e.target.checked)}
              className="w-4 h-4 accent-violet-600"
            />
            <span className="text-xs font-semibold text-violet-800">
              ⇄ Esta factura se comparte entre varias propiedades
            </span>
          </label>
          {shared && (
            <div className="space-y-2 pl-6">
              <div>
                <p className="text-[11px] font-semibold text-slate-700 mb-1">Selecciona las propiedades</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {properties.map(p => {
                    const checked = sharedIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer ${
                          checked ? 'bg-violet-100 border-violet-300' : 'bg-white border-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            setSharedIds(prev =>
                              e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id),
                            );
                            if (!e.target.checked) {
                              setManual(m => { const c = { ...m }; delete c[p.id]; return c; });
                            }
                          }}
                          className="accent-violet-600"
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    );
                  })}
                </div>
                {errors.shared && <p className="text-xs text-red-500 mt-1">{errors.shared}</p>}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-700 mb-1">Cómo dividir el monto</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSplitMode('equal')}
                    className={`flex-1 px-2 py-1.5 text-[11px] font-semibold rounded border ${
                      splitMode === 'equal'
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    Equitativo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMode('manual')}
                    className={`flex-1 px-2 py-1.5 text-[11px] font-semibold rounded border ${
                      splitMode === 'manual'
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    Manual por propiedad
                  </button>
                </div>
              </div>

              {/* Vista de partes */}
              {sharedIds.length > 0 && (
                <div className="bg-white border border-slate-200 rounded p-2 space-y-1">
                  {sharedIds.map((pid, i) => {
                    const prop = properties.find(p => p.id === pid);
                    if (splitMode === 'equal') {
                      return (
                        <div key={pid} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 truncate">{prop?.name}</span>
                          <span className="font-semibold text-slate-800">
                            {(equalParts[i] ?? 0).toLocaleString('es-CO')}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={pid} className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 flex-1 truncate">{prop?.name}</span>
                        <div className="w-32">
                          <MoneyInput
                            value={manual[pid] ?? null}
                            onChange={v => setManual(m => ({ ...m, [pid]: v }))}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    );
                  })}
                  {splitMode === 'manual' && (
                    <div className={`flex items-center justify-between text-xs pt-1 mt-1 border-t ${
                      Math.abs(sharedTotal - (amount ?? 0)) < 0.005 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      <span>Suma actual</span>
                      <span className="font-bold">
                        {sharedTotal.toLocaleString('es-CO')} / {(amount ?? 0).toLocaleString('es-CO')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!shared && (
        <PropertyPicker
          properties={properties}
          value={propertyId}
          onChange={setPropertyId}
          required
          error={errors.property}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MoneyField
          label={shared ? 'Monto total de la factura' : 'Monto'}
          value={amount} onChange={setAmount} required error={errors.amount}
        />
        <DateField label="Fecha del gasto" value={date} onChange={setDate} required />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          Proveedor / vendedor <span className="text-slate-400 font-normal">(opcional)</span>
        </label>
        <input
          type="text" value={vendor} onChange={e => setVendor(e.target.value)}
          placeholder="Nombre o razón social"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      <StatusPicker value={status} onChange={setStatus} />

      {status !== 'pending' && (
        <BankPicker
          banks={bankAccounts}
          value={bankId}
          onChange={setBankId}
          required={status === 'paid'}
          error={errors.bank}
        />
      )}

      <DescField
        value={desc} onChange={setDesc}
        placeholder="Detalles adicionales del gasto (factura, observaciones…)"
      />

      {shared && (
        <p className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1.5">
          💡 Se crearán {sharedIds.length} filas (una por propiedad) ligadas por un mismo
          <code className="bg-white px-1 mx-1 rounded">expense_group_id</code>. Después podrás cambiar el
          estado de toda la factura de una sola vez desde la edición de cualquiera de ellas.
        </p>
      )}
    </FormShell>
  );
}
