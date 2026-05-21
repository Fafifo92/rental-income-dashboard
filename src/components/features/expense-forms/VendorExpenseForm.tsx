'use client';
/**
 * Formulario dedicado: pago a proveedor (Servicios y proveedores).
 *
 * Vendor obligatorio (kind != 'cleaner' — los cleaners se liquidan por /aseo).
 * Categoría se sugiere a partir del kind del vendor pero el usuario puede
 * ajustarla. Property obligatoria. Si el vendor cubre múltiples propiedades
 * (utilities/admin compartidas), redirigimos al usuario a usar el flujo de
 * Shared Bills desde /vendors.
 *
 * Bolsa de créditos: si el vendor es kind='insurance', aparece un bloque para
 * registrar la recarga (créditos comprados, fecha de activación, regla). Al
 * guardar el expense, también se crea una bolsa nueva y se hace backfill de
 * consumos para reservas elegibles. Modelo FIFO: cada recarga = bolsa nueva,
 * no se promedia precio.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Expense } from '@/types';
import type { PropertyRow, BankAccountRow, VendorKind, PropertyGroupRow, PropertyTagRow, PropertyTagAssignmentRow, CreditPoolConsumptionRule, CreditPoolRow } from '@/types/database';
import { listVendors, type Vendor } from '@/services/vendors';
import { listPropertyGroups } from '@/services/propertyGroups';
import { listPropertyTags, listAllTagAssignments } from '@/services/propertyTags';
import { listCreditPools, createCreditPool, backfillConsumptionsForPool } from '@/services/creditPools';
import { formatCurrency } from '@/lib/utils';
import PropertyMultiSelect from '@/components/PropertyMultiSelect';
import {
  FormShell, BankPicker, MoneyField, DateField,
  StatusPicker, DescField, type ExpenseStatus,
} from './Shared';
import { todayISO } from '@/lib/dateUtils';

interface Props {
  properties: PropertyRow[];
  bankAccounts: BankAccountRow[];
  /** Expense being edited; when set, form runs in edit mode (single property, no split). */
  initial?: Expense | null;
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
  properties, bankAccounts, initial = null, onClose, onSave, onSaveMultiple, error,
}: Props) {
  const isEditMode = !!initial;
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(initial?.vendor_id ?? null);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(
    initial?.property_id ? [initial.property_id]
      : (properties.length === 1 ? [properties[0].id] : [])
  );
  const [splitMode, setSplitMode] = useState<'equal' | 'manual'>('equal');
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<number | null>(initial ? Number(initial.amount) : null);
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [status, setStatus] = useState<ExpenseStatus>(initial?.status ?? 'pending');
  const [bankId, setBankId] = useState<string | null>(initial?.bank_account_id ?? null);
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<PropertyGroupRow[]>([]);
  const [tags, setTags] = useState<PropertyTagRow[]>([]);
  const [tagAssigns, setTagAssigns] = useState<PropertyTagAssignmentRow[]>([]);

  // ── Bolsa de créditos (solo si vendor.kind === 'insurance') ───────────────
  const [poolEnabled, setPoolEnabled] = useState(false);
  const [poolCredits, setPoolCredits] = useState<string>('');
  const [poolRule, setPoolRule] = useState<CreditPoolConsumptionRule>('per_person_per_night');
  const [poolCreditsPerUnit, setPoolCreditsPerUnit] = useState<string>('1');
  const [poolChildWeight, setPoolChildWeight] = useState<string>('1');
  const [poolActivatedAt, setPoolActivatedAt] = useState<string>(todayISO());
  const [poolExpiresAt, setPoolExpiresAt] = useState<string>('');
  const [latestPool, setLatestPool] = useState<CreditPoolRow | null>(null);

  useEffect(() => {
    const currentVendorId = initial?.vendor_id ?? null;
    listVendors().then(res => {
      if (!res.error) {
        // In edit mode include the current vendor even if inactive
        setVendors((res.data ?? []).filter(v => v.kind !== 'cleaner' && (v.active || v.id === currentVendorId)));
      }
    });
    listPropertyGroups().then(r => { if (r.data) setGroups(r.data); });
    listPropertyTags().then(r => { if (r.data) setTags(r.data); });
    listAllTagAssignments().then(r => { if (r.data) setTagAssigns(r.data); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedVendor = useMemo(
    () => vendors.find(v => v.id === vendorId) ?? null,
    [vendors, vendorId],
  );

  // Sugerir monto por defecto del vendor cuando se elige uno fijo (solo en creación).
  useEffect(() => {
    if (isEditMode || !selectedVendor) return;
    if (selectedVendor.default_amount && amount === null) {
      setAmount(selectedVendor.default_amount);
    }
  }, [selectedVendor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cuando el vendor es de seguros, cargar la última bolsa para heredar reglas
  // y activar el bloque por defecto.
  useEffect(() => {
    if (isEditMode || !selectedVendor) {
      setPoolEnabled(false);
      setLatestPool(null);
      return;
    }
    if (selectedVendor.kind !== 'insurance') {
      setPoolEnabled(false);
      setLatestPool(null);
      return;
    }
    setPoolEnabled(true);
    listCreditPools().then(res => {
      if (res.error) return;
      const ofVendor = (res.data ?? [])
        .filter(p => p.vendor_id === selectedVendor.id)
        .sort((a, b) => (a.activated_at < b.activated_at ? 1 : -1));
      const latest = ofVendor[0] ?? null;
      setLatestPool(latest);
      if (latest) {
        setPoolRule(latest.consumption_rule);
        setPoolCreditsPerUnit(String(latest.credits_per_unit));
        setPoolChildWeight(String(latest.child_weight));
        if (!poolCredits) setPoolCredits(String(latest.credits_total));
      }
    });
  }, [selectedVendor, isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mantener fecha de activación = fecha del pago si el usuario no la cambia.
  useEffect(() => {
    setPoolActivatedAt(date);
  }, [date]);

  const poolUnitPrice = useMemo(() => {
    const credits = Number(poolCredits);
    if (!amount || !credits || credits <= 0) return 0;
    return amount / credits;
  }, [amount, poolCredits]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!vendorId || !selectedVendor) errs.vendor = 'Selecciona el proveedor';
    if (selectedPropertyIds.length === 0) errs.property = 'Selecciona al menos una propiedad';
    if (!amount || amount <= 0) errs.amount = 'Indica el monto';
    if (status === 'paid' && !bankId) errs.bank = 'Marca la cuenta bancaria si está pagado';
    // Bolsa: si está habilitada, los créditos son obligatorios para poder
    // calcular el precio/crédito. Sin ellos la bolsa no puede consumirse.
    if (poolEnabled && selectedVendor?.kind === 'insurance') {
      const credits = Number(poolCredits);
      if (!Number.isFinite(credits) || credits <= 0) {
        errs.poolCredits = 'Indica los créditos comprados — sin ellos no se puede crear la bolsa';
      }
      if (!amount || amount <= 0) {
        errs.amount = 'El monto del pago define el precio por crédito — es obligatorio';
      }
    }
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

    // Si es vendor de seguros y la bolsa está habilitada, crear la recarga
    // como bolsa nueva (FIFO) y disparar el backfill de consumos.
    if (!isEditMode && poolEnabled && selectedVendor?.kind === 'insurance') {
      const credits = Number(poolCredits);
      if (Number.isFinite(credits) && credits > 0 && amount && amount > 0) {
        const poolName = latestPool?.name ?? selectedVendor.name;
        const res = await createCreditPool({
          vendor_id: selectedVendor.id,
          name: poolName,
          credits_total: credits,
          total_price: amount,
          consumption_rule: poolRule,
          credits_per_unit: Number(poolCreditsPerUnit) || 1,
          child_weight: Number(poolChildWeight) || 1,
          activated_at: poolActivatedAt || date,
          expires_at: poolExpiresAt || null,
          notes: latestPool ? `Recarga de bolsa (FIFO). Bolsa anterior: ${latestPool.id}` : 'Bolsa inicial.',
        });
        if (res.data?.id) {
          // Fire-and-forget: el backfill puede tardar y no debe bloquear.
          backfillConsumptionsForPool(res.data.id).catch(() => undefined);
        }
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
      submitLabel={isEditMode ? 'Guardar cambios' : 'Guardar pago'}
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

      {isEditMode ? (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Propiedad</label>
          <div className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700">
            {properties.find(p => p.id === selectedPropertyIds[0])?.name ?? '—'}
          </div>
        </div>
      ) : (
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
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MoneyField label="Monto" value={amount} onChange={setAmount} required error={errors.amount} />
        <DateField value={date} onChange={setDate} required />
      </div>

      {!isEditMode && selectedVendor?.kind === 'insurance' && (
        <div className="border border-amber-200 rounded-xl bg-amber-50/60 p-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={poolEnabled}
              onChange={e => setPoolEnabled(e.target.checked)}
              className="w-4 h-4 accent-amber-600"
            />
            <span className="text-sm font-semibold text-amber-900">
              🪙 Este pago carga la bolsa de créditos
            </span>
          </label>
          <p className="text-[11px] text-amber-700">
            El sistema creará una bolsa nueva por esta recarga (modelo FIFO: las
            bolsas viejas se consumen primero, las nuevas conservan su precio).
            Las propiedades cubiertas son las del proveedor. Tras guardar, se
            recalculan los consumos de reservas elegibles.
          </p>
          {poolEnabled && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Créditos comprados *</label>
                  <input
                    type="number"
                    min={1}
                    value={poolCredits}
                    onChange={e => setPoolCredits(e.target.value)}
                    placeholder="Ej: 1000"
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-amber-500 outline-none ${errors.poolCredits ? 'border-red-400' : 'border-slate-200'}`}
                  />
                  {errors.poolCredits && <p className="text-xs text-red-500 mt-1">{errors.poolCredits}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Precio por crédito</label>
                  <div className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 font-mono">
                    {poolUnitPrice > 0 ? formatCurrency(poolUnitPrice) : '—'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Regla de consumo</label>
                  <select
                    value={poolRule}
                    onChange={e => setPoolRule(e.target.value as CreditPoolConsumptionRule)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    <option value="per_person_per_night">Por persona y noche</option>
                    <option value="per_person_per_booking">Por persona (toda la reserva)</option>
                    <option value="per_booking">Por reserva (fijo)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Créditos por unidad</label>
                  <input
                    type="number" min={0.01} step={0.01}
                    value={poolCreditsPerUnit}
                    onChange={e => setPoolCreditsPerUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Activar desde</label>
                  <input
                    type="date"
                    value={poolActivatedAt}
                    onChange={e => setPoolActivatedAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Vence (opcional)</label>
                  <input
                    type="date"
                    value={poolExpiresAt}
                    onChange={e => setPoolExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
              </div>
              {poolRule !== 'per_booking' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Peso de niños (0–1)</label>
                  <input
                    type="number" min={0} max={1} step={0.1}
                    value={poolChildWeight}
                    onChange={e => setPoolChildWeight(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
              )}
              {latestPool && (
                <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                  Última bolsa de este proveedor: <b>{latestPool.credits_used}</b>/{latestPool.credits_total} créditos usados
                  ({latestPool.status === 'depleted' ? 'agotada' : latestPool.status})
                  — la nueva bolsa coexistirá hasta que la anterior se agote.
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
