'use client';
/**
 * Formulario dedicado: insumos de aseo (compra puntual).
 *
 * Quién compró:
 *   A) Yo (dueño)   → vendor=null, status libre
 *   B) Cleaner      → vendor_id=cleaner. Si lo dejas pendiente se acumula en
 *                     su próxima liquidación; si está pagado, ya está saldado.
 *
 * Distribución entre propiedades:
 *   • 1 propiedad → 1 fila.
 *   • Compartido (2+ propiedades) → división equitativa o manual; crea N filas
 *     con el mismo `expense_group_id`. La edición posterior de estado/banco se
 *     aplica al grupo entero (igual que en gastos sobre propiedades).
 *
 * Categoría persistida: 'Insumos de aseo'  ·  subcategory: 'cleaning'
 */
import { useEffect, useMemo, useState } from 'react';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow } from '@/types/database';
import { listVendors, type Vendor } from '@/services/vendors';
import { addMoney, splitMoney } from '@/lib/money';
import MoneyInput from '@/components/MoneyInput';
import {
  FormShell, PropertyPicker, BankPicker, MoneyField, DateField,
  StatusPicker, DescField, type ExpenseStatus,
} from './Shared';

interface Props {
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  onSave: (expense: Omit<Expense, 'id' | 'owner_id'>) => Promise<boolean | void> | void;
  onSaveShared: (rows: Omit<Expense, 'id' | 'owner_id'>[]) => Promise<boolean | void> | void;
  error?: string | null;
}

type WhoBought = 'me' | 'cleaner';

export default function CleaningSuppliesForm({
  properties, bankAccounts, onClose, onSave, onSaveShared, error,
}: Props) {
  const [cleaners, setCleaners] = useState<Vendor[]>([]);
  const [who, setWho] = useState<WhoBought>('me');
  const [cleanerId, setCleanerId] = useState<string | null>(null);

  const [shared, setShared] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(properties.length === 1 ? properties[0].id : null);
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [splitMode, setSplitMode] = useState<'equal' | 'manual'>('equal');
  const [manual, setManual] = useState<Record<string, number | null>>({});

  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<ExpenseStatus>('paid');
  const [bankId, setBankId] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listVendors('cleaner').then(res => {
      if (!res.error) setCleaners((res.data ?? []).filter(c => c.active));
    });
  }, []);

  useEffect(() => {
    if (who === 'cleaner') setStatus('pending');
    else setStatus('paid');
  }, [who]);

  useEffect(() => {
    if (!shared) { setSharedIds([]); setManual({}); }
  }, [shared]);

  const sharedTotal = useMemo(
    () => addMoney(...sharedIds.map(id => manual[id] ?? 0)),
    [sharedIds, manual],
  );
  const equalParts = shared && sharedIds.length > 0 ? splitMoney(amount ?? 0, sharedIds.length) : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (shared) {
      if (sharedIds.length < 2) errs.shared = 'Selecciona al menos 2 propiedades.';
    } else {
      if (!propertyId) errs.property = 'Selecciona la propiedad';
    }
    if (!amount || amount <= 0) errs.amount = 'Indica el monto total';
    if (who === 'cleaner' && !cleanerId) errs.cleaner = 'Selecciona el personal de aseo';
    if (status === 'paid' && !bankId) errs.bank = 'Marca la cuenta bancaria si está pagado';
    if (shared && splitMode === 'manual') {
      if (Math.abs(sharedTotal - (amount ?? 0)) > 0.005) {
        errs.amount = `La suma de las partes (${sharedTotal.toLocaleString('es-CO')}) no coincide con el total (${(amount ?? 0).toLocaleString('es-CO')})`;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const cleaner = cleaners.find(c => c.id === cleanerId);
    const description = desc.trim()
      ? desc.trim()
      : (who === 'cleaner' && cleaner ? `Insumos comprados por ${cleaner.name}` : 'Insumos de aseo');

    const base: Omit<Expense, 'id' | 'owner_id'> = {
      property_id: null,
      category: 'Insumos de aseo',
      subcategory: 'cleaning',
      type: 'variable',
      amount: amount ?? 0,
      date,
      description,
      status,
      bank_account_id: status !== 'pending' ? bankId : null,
      vendor: who === 'cleaner' ? cleaner?.name ?? null : null,
      vendor_id: who === 'cleaner' ? cleanerId : null,
      person_in_charge: null,
      booking_id: null,
      adjustment_id: null,
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

  return (
    <FormShell
      title="Insumos de aseo"
      subtitle="Compra puntual de detergentes, blanqueadores, papel, etc. (no es una liquidación de turno)."
      accent="cyan"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error ?? null}
      submitLabel={shared ? `Guardar en ${sharedIds.length || 0} propiedades` : 'Guardar gasto'}
    >
      {/* ¿Quién pagó? */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">¿Quién compró los insumos? *</label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setWho('me')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
              who === 'me'
                ? 'bg-cyan-600 text-white border-cyan-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            🏠 Yo (dueño)
          </button>
          <button
            type="button"
            onClick={() => setWho('cleaner')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
              who === 'cleaner'
                ? 'bg-cyan-600 text-white border-cyan-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            🧹 Personal de aseo
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          {who === 'me'
            ? 'Tú pagaste directamente; no se liquida a nadie.'
            : 'El cleaner pagó. El gasto aparecerá en su historial. Si lo dejas pendiente, se sumará a su próxima liquidación.'}
        </p>
      </div>

      {who === 'cleaner' && (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Personal de aseo *</label>
          <select
            value={cleanerId ?? ''}
            onChange={e => setCleanerId(e.target.value || null)}
            className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-cyan-500 outline-none ${errors.cleaner ? 'border-red-400' : 'border-slate-200'}`}
          >
            <option value="">— Selecciona —</option>
            {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {cleaners.length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
              No tienes personal de aseo registrado. Agrégalo en <a href="/aseo" className="underline font-semibold">/aseo</a>.
            </p>
          )}
          {errors.cleaner && <p className="text-xs text-red-500 mt-1">{errors.cleaner}</p>}
        </div>
      )}

      {/* Propiedad simple o compartido */}
      {!shared && (
        <PropertyPicker
          properties={properties}
          value={propertyId}
          onChange={setPropertyId}
          required
          error={errors.property}
          helper="Insumos comprados para una propiedad específica."
        />
      )}

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
              ⇄ Esta compra se distribuye entre varias propiedades
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
                    <div className={`flex items-center justify-between text-[11px] pt-1 mt-1 border-t ${
                      Math.abs(sharedTotal - (amount ?? 0)) <= 0.005
                        ? 'text-emerald-700'
                        : 'text-rose-600'
                    }`}>
                      <span>Suma de partes</span>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MoneyField label={shared ? 'Monto total de la factura' : 'Monto'} value={amount} onChange={setAmount} required error={errors.amount} />
        <DateField value={date} onChange={setDate} required />
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
        value={desc} onChange={setDesc} optional
        label="Detalle de lo comprado"
        placeholder="Ej: 4 detergentes, 6 papel higiénico, 2 jabones de loza…"
      />

      {who === 'cleaner' && status === 'pending' && (
        <p className="text-xs text-cyan-800 bg-cyan-50 border border-cyan-200 rounded px-2 py-1.5">
          💡 Este gasto queda <b>pendiente</b> vinculado al cleaner y aparecerá en su historial.
          Cuando hagas la próxima liquidación lo verás listado para reembolsar.
        </p>
      )}
    </FormShell>
  );
}
