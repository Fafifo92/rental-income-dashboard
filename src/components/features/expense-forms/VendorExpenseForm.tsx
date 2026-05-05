'use client';
/**
 * Formulario dedicado: pago a proveedor (Servicios y proveedores).
 *
 * Vendor obligatorio (kind != 'cleaner' — los cleaners se liquidan por /aseo).
 * Categoría se sugiere a partir del kind del vendor pero el usuario puede
 * ajustarla. Property obligatoria. Si el vendor cubre múltiples propiedades
 * (utilities/admin compartidas), redirigimos al usuario a usar el flujo de
 * Shared Bills desde /vendors.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, VendorKind, PropertyGroupRow, PropertyTagRow, PropertyTagAssignmentRow } from '@/types/database';
import { listVendors, type Vendor } from '@/services/vendors';
import { listPropertyGroups } from '@/services/propertyGroups';
import { listPropertyTags, listAllTagAssignments } from '@/services/propertyTags';
import PropertyMultiSelect from '@/components/PropertyMultiSelect';
import {
  FormShell, BankPicker, MoneyField, DateField,
  StatusPicker, DescField, type ExpenseStatus,
} from './Shared';
import { todayISO } from '@/lib/dateUtils';

interface Props {
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  onSave: (expense: Omit<Expense, 'id' | 'owner_id'>) => Promise<void> | void;
  onSaveMultiple?: (expenses: Omit<Expense, 'id' | 'owner_id'>[]) => Promise<void> | void;
  error?: string | null;
}

const KIND_TO_SUBCATEGORY: Record<Exclude<VendorKind, 'cleaner'>, 'utilities' | 'administration' | 'maintenance' | 'stock'> = {
  utility:          'utilities',
  admin:            'administration',
  insurance:        'administration',
  tax:              'administration',
  business_service: 'administration',
  maintenance:      'maintenance',
  other:            'maintenance',
};

const KIND_TO_CATEGORY: Record<Exclude<VendorKind, 'cleaner'>, string> = {
  utility:          'Servicios públicos',
  admin:            'Administración',
  insurance:        'Administración',
  tax:              'Administración',
  business_service: 'Administración',
  maintenance:      'Mantenimiento',
  other:            'Mantenimiento',
};

export default function VendorExpenseForm({
  properties, bankAccounts, onClose, onSave, onSaveMultiple, error,
}: Props) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(
    properties.length === 1 ? [properties[0].id] : []
  );
  const [splitMode, setSplitMode] = useState<'equal' | 'manual'>('equal');
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [status, setStatus] = useState<ExpenseStatus>('pending');
  const [bankId, setBankId] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<PropertyGroupRow[]>([]);
  const [tags, setTags] = useState<PropertyTagRow[]>([]);
  const [tagAssigns, setTagAssigns] = useState<PropertyTagAssignmentRow[]>([]);

  useEffect(() => {
    listVendors().then(res => {
      if (!res.error) setVendors((res.data ?? []).filter(v => v.active && v.kind !== 'cleaner'));
    });
    listPropertyGroups().then(r => { if (r.data) setGroups(r.data); });
    listPropertyTags().then(r => { if (r.data) setTags(r.data); });
    listAllTagAssignments().then(r => { if (r.data) setTagAssigns(r.data); });
  }, []);

  const selectedVendor = useMemo(
    () => vendors.find(v => v.id === vendorId) ?? null,
    [vendors, vendorId],
  );

  // Sugerir monto por defecto del vendor cuando se elige uno fijo.
  useEffect(() => {
    if (!selectedVendor) return;
    if (selectedVendor.default_amount && amount === null) {
      setAmount(selectedVendor.default_amount);
    }
  }, [selectedVendor]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!vendorId || !selectedVendor) errs.vendor = 'Selecciona el proveedor';
    if (selectedPropertyIds.length === 0) errs.property = 'Selecciona al menos una propiedad';
    if (!amount || amount <= 0) errs.amount = 'Indica el monto';
    if (status === 'paid' && !bankId) errs.bank = 'Marca la cuenta bancaria si está pagado';
    setErrors(errs);
    if (Object.keys(errs).length || !selectedVendor) return;

    const kind = selectedVendor.kind as Exclude<VendorKind, 'cleaner'>;
    const baseExpense = {
      category: selectedVendor.category ?? KIND_TO_CATEGORY[kind] ?? 'Otros',
      subcategory: KIND_TO_SUBCATEGORY[kind] ?? 'maintenance',
      type: selectedVendor.is_variable ? 'variable' : 'fixed' as 'variable' | 'fixed',
      date,
      description: desc.trim() || null,
      status,
      bank_account_id: status !== 'pending' ? bankId : null,
      vendor: selectedVendor.name,
      vendor_id: selectedVendor.id,
      person_in_charge: null,
      booking_id: null,
      adjustment_id: null,
      shared_bill_id: null,
      expense_group_id: null,
    };

    setSaving(true);
    if (selectedPropertyIds.length === 1) {
      await onSave({
        ...baseExpense,
        property_id: selectedPropertyIds[0],
        amount: amount ?? 0,
      });
    } else if (onSaveMultiple) {
      const total = amount ?? 0;
      const groupId = crypto.randomUUID();
      const expenses: Omit<Expense, 'id' | 'owner_id'>[] = selectedPropertyIds.map((pid) => {
        let propAmount: number;
        if (splitMode === 'manual') {
          propAmount = Number(manualAmounts[pid]) || 0;
        } else {
          propAmount = Math.round((total / selectedPropertyIds.length) * 100) / 100;
        }
        return {
          ...baseExpense,
          property_id: pid,
          amount: propAmount,
          expense_group_id: groupId,
        };
      });
      await onSaveMultiple(expenses);
    } else {
      const total = amount ?? 0;
      for (const pid of selectedPropertyIds) {
        await onSave({
          ...baseExpense,
          property_id: pid,
          amount: Math.round((total / selectedPropertyIds.length) * 100) / 100,
        });
      }
    }
    setSaving(false);
  };

  return (
    <FormShell
      title="Pago a proveedor"
      subtitle="Servicios públicos, administración, mantenimiento, contador, etc. — vinculado al proveedor configurado."
      accent="violet"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error ?? null}
      submitLabel="Guardar pago"
    >
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-semibold text-slate-600">Proveedor *</label>
          <a
            href="/vendors?new=1"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo proveedor
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
        <select
          value={vendorId ?? ''}
          onChange={e => setVendorId(e.target.value || null)}
          className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:ring-2 focus:ring-violet-500 outline-none ${errors.vendor ? 'border-red-400' : 'border-slate-200'}`}
        >
          <option value="">— Selecciona —</option>
          {vendors.map(v => (
            <option key={v.id} value={v.id}>
              {v.name} · {v.kind}
            </option>
          ))}
        </select>
        {vendors.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
            No hay proveedores registrados. Usa el botón <b>+ Nuevo proveedor</b> de arriba.
          </p>
        )}
        {errors.vendor && <p className="text-xs text-red-500 mt-1">{errors.vendor}</p>}
        {selectedVendor && (
          <p className="text-[10px] text-slate-500 mt-1">
            Categoría sugerida: <b>{selectedVendor.category ?? KIND_TO_CATEGORY[selectedVendor.kind as Exclude<VendorKind, 'cleaner'>]}</b>
            {selectedVendor.default_amount ? ` · Monto típico: ${selectedVendor.default_amount.toLocaleString('es-CO')}` : ''}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          Propiedad(es) * {selectedPropertyIds.length > 1 && <span className="text-violet-600 font-normal">(factura compartida)</span>}
        </label>
        <PropertyMultiSelect
          properties={properties}
          groups={groups}
          tags={tags}
          tagAssignments={tagAssigns}
          value={selectedPropertyIds}
          onChange={setSelectedPropertyIds}
          error={errors.property}
        />
        {selectedPropertyIds.length > 1 && splitMode === 'manual' && (
          <div className="mt-2 space-y-1.5 border border-violet-100 bg-violet-50/40 rounded-lg p-3">
            <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide">Monto por propiedad</p>
            {selectedPropertyIds.map(pid => {
              const p = properties.find(pp => pp.id === pid);
              return (
                <div key={pid} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-slate-700 truncate">{p?.name}</span>
                  <input
                    type="number"
                    min={0}
                    value={manualAmounts[pid] ?? ''}
                    onChange={e => setManualAmounts(prev => ({ ...prev, [pid]: e.target.value }))}
                    placeholder="Monto"
                    className="w-32 px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-violet-500 outline-none"
                  />
                </div>
              );
            })}
          </div>
        )}
        {selectedPropertyIds.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500">División:</span>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="radio" name="split" checked={splitMode === 'equal'} onChange={() => setSplitMode('equal')} className="accent-violet-600" />
              Partes iguales
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="radio" name="split" checked={splitMode === 'manual'} onChange={() => setSplitMode('manual')} className="accent-violet-600" />
              Manual
            </label>
            {splitMode === 'equal' && amount && (
              <span className="text-xs text-violet-700 font-semibold">
                ≈ {(amount / selectedPropertyIds.length).toLocaleString('es-CO', { maximumFractionDigits: 0 })} c/u
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MoneyField label="Monto" value={amount} onChange={setAmount} required error={errors.amount} />
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
        value={desc} onChange={setDesc}
        placeholder="Período facturado, número de factura, observaciones…"
      />
    </FormShell>
  );
}
