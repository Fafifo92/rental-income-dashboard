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
import type { PropertyRow, BankAccountRow, VendorKind } from '@/types/database';
import { listVendors, type Vendor } from '@/services/vendors';
import {
  FormShell, PropertyPicker, BankPicker, MoneyField, DateField,
  StatusPicker, DescField, type ExpenseStatus,
} from './Shared';

interface Props {
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  onClose: () => void;
  onSave: (expense: Omit<Expense, 'id' | 'owner_id'>) => Promise<void> | void;
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
  properties, bankAccounts, onClose, onSave, error,
}: Props) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(properties.length === 1 ? properties[0].id : null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<ExpenseStatus>('pending');
  const [bankId, setBankId] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listVendors().then(res => {
      if (!res.error) setVendors((res.data ?? []).filter(v => v.active && v.kind !== 'cleaner'));
    });
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
    if (!propertyId) errs.property = 'Selecciona la propiedad';
    if (!amount || amount <= 0) errs.amount = 'Indica el monto';
    if (status === 'paid' && !bankId) errs.bank = 'Marca la cuenta bancaria si está pagado';
    setErrors(errs);
    if (Object.keys(errs).length || !selectedVendor) return;

    const kind = selectedVendor.kind as Exclude<VendorKind, 'cleaner'>;
    setSaving(true);
    await onSave({
      property_id: propertyId,
      category: selectedVendor.category ?? KIND_TO_CATEGORY[kind] ?? 'Otros',
      subcategory: KIND_TO_SUBCATEGORY[kind] ?? 'maintenance',
      type: selectedVendor.is_variable ? 'variable' : 'fixed',
      amount: amount ?? 0,
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
    });
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
        <label className="block text-xs font-semibold text-slate-600 mb-1">Proveedor *</label>
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
            No hay proveedores registrados. Crea uno en{' '}
            <a href="/vendors" className="underline font-semibold">/vendors</a>.
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

      <PropertyPicker
        properties={properties}
        value={propertyId}
        onChange={setPropertyId}
        required
        error={errors.property}
        helper="Si esta factura se reparte entre varias propiedades, regístrala desde /vendors → Cobrar factura."
      />

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
